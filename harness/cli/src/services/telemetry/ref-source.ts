import type { GitReadPort, ShardBlob } from '../../adapters/git/git-read-port.js';
import { TELEMETRY_REF_GLOB } from '../../adapters/git/git-write-port.js';
import type { Event } from './events.js';
import { reconstructSegmentFromOtlpLogs } from './otlp/logs.js';
import { splitJsonl } from './rolled-shard.js';
import { decodeSegment, type Segment } from './segment.js';
import type { TokenEvidence } from './token-evidence.js';
import {
  completeUsageTokens,
  reduceUsageEvents,
  tokenEvidenceFromLegacyTokens,
  tokenEvidenceFromObservation,
} from './usage-observation.js';

/**
 * Fleet ref source (plan 052 · T005 — dossier F-03 / SUGG-001). `get-fleet` reads the
 * live temp buffer, but the post-commit flush hook syncs + PRUNES temp, so a lane's
 * segments VANISH mid-run once flushed — its telemetry now lives ONLY in a
 * `refs/harness-telemetry/*` rollup. This reader enumerates those rollups and decodes
 * each session's committed token total, so a flushed lane stays visible (source `ref`)
 * instead of collapsing to an orphan (AC-06).
 *
 * READ-ONLY + FAIL-SAFE: a `for-each-ref` enumeration + `cat-file` reads through the
 * git READ port — never a fetch, never a write. A corrupt/partial blob is skipped, the
 * whole thing degrades to an empty map (never throws). PRIVACY (P12): tokens survive
 * the OTLP round-trip as counts; no prose is reconstructed.
 *
 * JOIN: a rolled ref is `refs/harness-telemetry/<start-date>/<harness-session-id>`, so
 * the harness session id is the ref's LAST path segment — the key the pij registry
 * reverse-maps a rostered pij id onto.
 */

/** One session's committed telemetry, recovered from its ref rollup. */
export interface RefLane {
  /** The harness session id (the ref's last path segment) — the registry join key. */
  harness_session_id: string;
  pij_session_id: string | null;
  /** Token total summed across the ref's turn events / loose segments. */
  tokens: { grand_total: number; output: number };
  /** `true` iff ≥1 turn/segment carried non-null tokens (else an honest unmeasured ref). */
  measured: boolean;
  token_evidence: TokenEvidence;
  /** Rough segment count (one per rolled logs record / loose `<seq>.json`). */
  segments: number;
}

/** The harness session id is the ref's LAST path segment (`…/<date>/<session>`). */
function sessionIdOfRef(ref: string): string | null {
  const seg = ref.split('/').pop();
  return seg !== undefined && seg.length > 0 ? seg : null;
}

function decodeLooseSegment(content: string): Segment | null {
  try {
    return decodeSegment(JSON.parse(content));
  } catch {
    return null;
  }
}

/** Sum tokens across one ref's shard blobs (rolled `session.logs.jsonl`, legacy `<seq>.logs.jsonl`, loose `<seq>.json`). */
function tokensFromBlobs(blobs: readonly ShardBlob[]): {
  grand_total: number;
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
  measured: boolean;
  missing: boolean;
  segments: number;
  events: Event[];
  pij_session_id: string | null;
} {
  let grand = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let measured = false;
  let missing = false;
  let segments = 0;
  let pijSessionId: string | null = null;
  const events: Event[] = [];
  for (const b of blobs) {
    if (b.name.endsWith('.logs.jsonl')) {
      for (const line of splitJsonl(b.content)) {
        let logs: unknown;
        try {
          logs = JSON.parse(line);
        } catch {
          continue;
        }
        const reconstructed = reconstructSegmentFromOtlpLogs(logs as never);
        if (!reconstructed.ok) continue;
        const seg = reconstructed.segment;
        segments += 1;
        pijSessionId ??= seg.captured_env?.PIJ_SESSION_ID ?? null;
        events.push(...seg.event_stream);
        const hasTyped = seg.event_stream.some((event) => event.kind === 'usage');
        let segmentMeasured = false;
        for (const ev of seg.event_stream) {
          if (ev.kind !== 'turn') continue;
          if (
            ev.in !== undefined ||
            ev.out !== undefined ||
            ev.cache_read !== undefined ||
            ev.cache_create !== undefined
          ) {
            measured = true;
            segmentMeasured = true;
          }
          input += ev.in ?? 0;
          output += ev.out ?? 0;
          cacheRead += ev.cache_read ?? 0;
          cacheCreate += ev.cache_create ?? 0;
        }
        if (!hasTyped && !segmentMeasured) missing = true;
      }
    } else if (/^\d+\.json$/.test(b.name)) {
      const seg = decodeLooseSegment(b.content);
      if (seg === null) continue;
      segments += 1;
      pijSessionId ??= seg.captured_env?.PIJ_SESSION_ID ?? null;
      events.push(...seg.event_stream);
      if (seg.tokens === null && !seg.event_stream.some((event) => event.kind === 'usage')) {
        missing = true;
      }
      if (seg.tokens != null) {
        measured = true;
        grand += seg.tokens.grand_total;
        input += seg.tokens.input;
        output += seg.tokens.output;
        cacheRead += seg.tokens.cache_read;
        cacheCreate += seg.tokens.cache_create;
      }
    }
  }
  if (grand === 0 && measured) grand = input + output + cacheRead + cacheCreate;
  return {
    grand_total: grand,
    input,
    output,
    cache_read: cacheRead,
    cache_create: cacheCreate,
    measured,
    missing,
    segments,
    events,
    pij_session_id: pijSessionId,
  };
}

/** Decode one ref's blobs back into whole {@link Segment}s (rolled OTLP + loose json). */
function segmentsFromBlobs(blobs: readonly ShardBlob[]): Segment[] {
  const out: Segment[] = [];
  for (const b of blobs) {
    if (b.name.endsWith('.logs.jsonl')) {
      for (const line of splitJsonl(b.content)) {
        try {
          const reconstructed = reconstructSegmentFromOtlpLogs(JSON.parse(line) as never);
          if (reconstructed.ok) out.push(reconstructed.segment);
        } catch {
          // a corrupt rolled record is skipped, never fatal
        }
      }
    } else if (/^\d+\.json$/.test(b.name)) {
      const seg = decodeLooseSegment(b.content);
      if (seg !== null) out.push(seg);
    }
  }
  return out;
}

/**
 * Is there a `refs/harness-telemetry/*` namespace to read AT ALL in this clone?
 *
 * The provenance answer a reader owes its caller (FX001 · T2): "no evidence" and "no
 * ref surface to look at" are different statements, and only the second one tells an
 * operator that the fix is a `git fetch` rather than a re-run. Fail-safe: any error →
 * `false` (never throws).
 */
export function telemetryRefsPresent(gitRead: GitReadPort): boolean {
  try {
    return gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB).length > 0;
  } catch {
    return false;
  }
}

/**
 * The committed WHOLE-session segments per harness session id — the flushed truth the
 * buffer prune is allowed to delete (finding 02). Readers union these with the buffer's
 * unflushed delta and fold ONCE, which is the same reconstruction `sync` itself performs
 * and the only way a post-prune read still equals the pre-prune whole.
 *
 * Fail-safe: any error → empty map (never throws).
 */
export function readRefSegments(gitRead: GitReadPort): Map<string, Segment[]> {
  const out = new Map<string, Segment[]>();
  let refs: string[];
  try {
    refs = gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB);
  } catch {
    return out;
  }
  for (const ref of refs) {
    const session = sessionIdOfRef(ref);
    if (session === null) continue;
    let blobs: readonly ShardBlob[];
    try {
      blobs = gitRead.readShardTree(ref);
    } catch {
      continue;
    }
    const segments = segmentsFromBlobs(blobs);
    if (segments.length === 0) continue;
    const prior = out.get(session);
    if (prior === undefined) out.set(session, segments);
    else prior.push(...segments);
  }
  return out;
}

/**
 * Enumerate every `refs/harness-telemetry/*` rollup and decode each session's token
 * total, keyed by harness session id. A session with multiple date-sharded refs folds
 * into one lane (tokens summed). Fail-safe: any error → empty map (never throws).
 */
export function readRefLanes(gitRead: GitReadPort): Map<string, RefLane> {
  const out = new Map<string, RefLane>();
  const usageEvents = new Map<string, Event[]>();
  const legacyTotals = new Map<
    string,
    {
      input: number;
      output: number;
      cache_read: number;
      cache_create: number;
      measured: boolean;
      missing: boolean;
    }
  >();
  let refs: string[];
  try {
    refs = gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB);
  } catch {
    return out;
  }
  for (const ref of refs) {
    const sid = sessionIdOfRef(ref);
    if (sid === null) continue;
    let blobs: ShardBlob[];
    try {
      blobs = gitRead.readShardTree(ref);
    } catch {
      continue;
    }
    const decoded = tokensFromBlobs(blobs);
    usageEvents.set(sid, [...(usageEvents.get(sid) ?? []), ...decoded.events]);
    const legacy = legacyTotals.get(sid) ?? {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_create: 0,
      measured: false,
      missing: false,
    };
    legacy.input += decoded.input;
    legacy.output += decoded.output;
    legacy.cache_read += decoded.cache_read;
    legacy.cache_create += decoded.cache_create;
    legacy.measured = legacy.measured || decoded.measured;
    legacy.missing = legacy.missing || decoded.missing;
    legacyTotals.set(sid, legacy);

    const prev = out.get(sid);
    if (prev === undefined) {
      out.set(sid, {
        harness_session_id: sid,
        pij_session_id: decoded.pij_session_id,
        tokens: { grand_total: decoded.grand_total, output: decoded.output },
        measured: decoded.measured && !decoded.missing,
        token_evidence: tokenEvidenceFromObservation(null, 'ref'),
        segments: decoded.segments,
      });
    } else {
      prev.pij_session_id ??= decoded.pij_session_id;
      prev.tokens.grand_total += decoded.grand_total;
      prev.tokens.output += decoded.output;
      prev.measured = prev.measured || decoded.measured;
      prev.segments += decoded.segments;
    }
  }
  for (const [sid, lane] of out) {
    const observation = reduceUsageEvents(usageEvents.get(sid) ?? []);
    const legacy = legacyTotals.get(sid);
    lane.token_evidence =
      observation !== null
        ? tokenEvidenceFromObservation(observation, 'ref')
        : tokenEvidenceFromLegacyTokens(
            legacy?.measured
              ? {
                  input: legacy.input,
                  output: legacy.output,
                  cache_read: legacy.cache_read,
                  cache_create: legacy.cache_create,
                }
              : null,
            'ref',
            // A rolled ref holds every seq of the session in ONE tree, so this sum is
            // the whole session by construction — not an observation of it (R2-01).
            { wholeSession: true },
          );
    if (observation === null && legacy?.measured && legacy.missing) {
      lane.token_evidence.coverage = 'partial';
      lane.token_evidence.reason = 'source_unavailable';
      lane.measured = false;
    }
    if (observation === null) continue;
    const usage = completeUsageTokens(observation);
    if (usage === null) {
      lane.tokens = { grand_total: 0, output: observation.output ?? 0 };
      lane.measured = false;
      continue;
    }
    lane.tokens = { grand_total: usage.total, output: usage.output };
    lane.measured = true;
  }
  return out;
}
