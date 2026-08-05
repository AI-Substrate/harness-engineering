import type { GitReadPort, ShardBlob } from '../../adapters/git/git-read-port.js';
import { TELEMETRY_REF_GLOB } from '../../adapters/git/git-write-port.js';
import type { Event } from './events.js';
import { reconstructSegmentFromOtlpLogs } from './otlp/logs.js';
import { splitJsonl } from './rolled-shard.js';
import {
  decodeSegmentDetailed,
  SEGMENT_SCHEMA_PIN,
  type Segment,
  type SegmentDecodeResult,
  type SegmentRefusalReason,
} from './segment.js';
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

/**
 * Decode one loose `<seq>.json` blob, KEEPING the refusal reason.
 *
 * The `catch` names its outcome rather than returning `null` (packet ruling #1.2):
 * unparseable JSON is a malformed record, and if this function's own failure path
 * collapsed to a bare `null` it would have re-created the exact silence the reason
 * channel exists to remove — in the function that supplies it.
 */
function decodeLooseSegment(content: string): SegmentDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'malformed', schema_version: null };
  }
  return decodeSegmentDetailed(parsed);
}

/** Records this read REFUSED, kept apart by reason — they are different facts (packet · pin). */
export interface SegmentRefusalTally {
  /**
   * Well-formed records at a KNOWN version below {@link SEGMENT_SCHEMA_PIN} — declined
   * by policy, not broken. With the pin at the floor this counter is UNREACHABLE from
   * production and is expected to read 0 forever; it is kept present and countable so
   * that an absence is a stated 0 rather than a missing field, and so the lane can name
   * the refusal if the pin is ever raised.
   *
   * BOUNDARY: this lane threads no pin (see {@link decodeLooseSegment}), so unlike the
   * combine lane it cannot be driven to produce a below-pin refusal in a test either.
   * Deliberately NOT fixed by adding a second knob — the counting site is shared
   * (`tallyRefusal`), and inventing a test-only parameter here would install exactly
   * the extra door the combine lane's control exists to police.
   */
  below_pin: number;
  /** Records declaring a version outside the decoder's declared set (includes ABOVE the pin). */
  unsupported_version: number;
  /** Records at the pin that failed structural validation, or carried no readable version. */
  malformed: number;
}

/** A zero tally — one construction site so no caller invents a partial shape. */
export function emptyRefusalTally(): SegmentRefusalTally {
  return { below_pin: 0, unsupported_version: 0, malformed: 0 };
}

/** Count one refusal into a tally by its reason (never folds two reasons together). */
export function tallyRefusal(tally: SegmentRefusalTally, reason: SegmentRefusalReason): void {
  tally[reason] += 1;
}

/** Total refusals across every reason — for callers that only need "how many were not read". */
export function totalRefusals(tally: SegmentRefusalTally): number {
  return tally.below_pin + tally.unsupported_version + tally.malformed;
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
      const decoded = decodeLooseSegment(b.content);
      // DECLINED PROPAGATION, deliberately (packet ruling #1.1). This function answers
      // one question — "how many tokens did this ref commit" — and a refused record
      // contributes no tokens whatever the reason. `missing` below already reports the
      // honest gap for records that WERE read. The refusal REASONS are surfaced by
      // `segmentsFromBlobs`/`readRefSegmentsOutcome`, which read the same blobs;
      // counting them twice on two paths would double-report the same records.
      if (!decoded.ok) continue;
      const seg = decoded.segment;
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

/**
 * Decode one ref's blobs back into whole {@link Segment}s (rolled OTLP + loose json),
 * counting the records it had to REJECT — **by reason** (packet · pin).
 *
 * A refused record is skipped and the read continues — the documented fail-safe, and
 * the right call: one corrupt line must not blind a whole session. But "I read nothing"
 * and "I rejected everything I read" are different statements, so the count travels
 * with the result instead of being destroyed here (FX001 · R2). The packet splits that
 * count further: "I declined a 2.6 record because of the pin" and "I could not parse
 * this" are also different statements, and folding them was the pin's whole defect.
 */
function segmentsFromBlobs(blobs: readonly ShardBlob[]): {
  segments: Segment[];
  refused: SegmentRefusalTally;
} {
  const out: Segment[] = [];
  const refused = emptyRefusalTally();
  for (const b of blobs) {
    if (b.name.endsWith('.logs.jsonl')) {
      for (const line of splitJsonl(b.content)) {
        try {
          const reconstructed = reconstructSegmentFromOtlpLogs(JSON.parse(line) as never);
          if (reconstructed.ok) out.push(reconstructed.segment);
          // A rolled OTLP record is reassembled field-by-field rather than version-gated,
          // so this path has no version to name — `malformed` is the honest reason here.
          else tallyRefusal(refused, 'malformed');
        } catch {
          // a corrupt rolled record is skipped, never fatal
          tallyRefusal(refused, 'malformed');
        }
      }
    } else if (/^\d+\.json$/.test(b.name)) {
      const decoded = decodeLooseSegment(b.content);
      if (decoded.ok) out.push(decoded.segment);
      else tallyRefusal(refused, decoded.reason);
    }
  }
  return { segments: out, refused };
}

/**
 * Prefer the port's STRICT read when it has one, so a failed git command raises instead
 * of arriving as an empty tree (FX001 · R2). A port without the strict form degrades to
 * the fail-safe one — less precise, never worse.
 */
function listRefsStrict(gitRead: GitReadPort): string[] {
  return gitRead.listTelemetryRefsStrict !== undefined
    ? gitRead.listTelemetryRefsStrict(TELEMETRY_REF_GLOB)
    : gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB);
}

function readShardStrict(gitRead: GitReadPort, ref: string): readonly ShardBlob[] {
  return gitRead.readShardTreeStrict !== undefined
    ? gitRead.readShardTreeStrict(ref)
    : gitRead.readShardTree(ref);
}

/**
 * Whether a `refs/harness-telemetry/*` namespace exists to read in this clone — the
 * answers a boolean could not hold (FX001 · R2/R3).
 *
 * `present` / `absent` are established facts. The other two are the ones that used to
 * masquerade as `absent`, each a different reason the surface was never established:
 *
 * - `unreadable` — the enumeration itself FAILED, so any downstream "checked and empty"
 *   is a fabrication (R2).
 * - `not_checked` — there was no git read port to look WITH. "I have no port" is not
 *   "there is nothing there", and the caller that had to say so was reaching for
 *   `absent` because this value did not exist (R3). Only a CALLER can produce it — the
 *   probe below always has a port by construction.
 *
 * The type being too small to express the truth is the defect; the branch that then
 * picks the wrong value is only its symptom.
 */
export type RefNamespaceState = 'present' | 'absent' | 'unreadable' | 'not_checked';

/**
 * Probe the ref namespace (FX001 · T2/R2). Never throws — the failure is REPORTED
 * (`unreadable`) rather than swallowed into a false `absent`, which is the whole
 * difference between "fetch the namespace" and "nothing is known".
 */
export function telemetryRefNamespace(gitRead: GitReadPort): RefNamespaceState {
  try {
    return listRefsStrict(gitRead).length > 0 ? 'present' : 'absent';
  } catch {
    return 'unreadable';
  }
}

/** A ref-surface read that keeps WHY it came back empty (FX001 · R2). */
export interface RefSegmentsRead {
  /**
   * `ok` — every ref this read touched was actually read, whatever it held.
   * `port_failed` — a git read itself failed, so the surface was never established and
   * an empty result proves nothing.
   */
  status: 'ok' | 'port_failed';
  /** Whatever WAS decoded, keyed by harness session id (possibly partial on failure). */
  segments: Map<string, Segment[]>;
  /**
   * Records rejected — never a port failure, always a real record. Kept as a
   * per-reason tally (packet · pin): a record declined by the {@link SEGMENT_SCHEMA_PIN}
   * and a record that would not parse are different facts and must not share a counter.
   */
  refused: SegmentRefusalTally;
  /**
   * Total rejected, across every reason.
   *
   * BACK-COMPAT, and deliberately NOT removed: existing callers ask "did this read
   * reject anything" and that question is still well-posed. It is a SUM of `refused`,
   * computed at one site, so it can never disagree with the tally — the FX003 · D2
   * lesson (one source, consumers read it) rather than a second independent count.
   */
  skipped: number;
}

/**
 * The committed WHOLE-session segments per harness session id — the flushed truth the
 * buffer prune is allowed to delete (finding 02). Readers union these with the buffer's
 * unflushed delta and fold ONCE, which is the same reconstruction `sync` itself performs
 * and the only way a post-prune read still equals the pre-prune whole.
 *
 * Never throws. The two kinds of empty are kept APART (FX001 · R2): a malformed record
 * is skipped and counted (fail-safe, by design), a failed git read sets
 * `status: 'port_failed'` — because a caller reporting an established miss must be able
 * to tell "the ref did not hold it" from "the ref was never read".
 */
export function readRefSegmentsOutcome(gitRead: GitReadPort): RefSegmentsRead {
  const out = new Map<string, Segment[]>();
  const refused = emptyRefusalTally();
  let refs: string[];
  try {
    refs = listRefsStrict(gitRead);
  } catch {
    return { status: 'port_failed', segments: out, refused, skipped: totalRefusals(refused) };
  }
  let portFailed = false;
  for (const ref of refs) {
    const session = sessionIdOfRef(ref);
    if (session === null) continue;
    let blobs: readonly ShardBlob[];
    try {
      blobs = readShardStrict(gitRead, ref);
    } catch {
      // This ref was never read. Keep going — the others may still answer — but the
      // read as a whole can no longer claim to have consulted the surface.
      portFailed = true;
      continue;
    }
    const decoded = segmentsFromBlobs(blobs);
    refused.below_pin += decoded.refused.below_pin;
    refused.unsupported_version += decoded.refused.unsupported_version;
    refused.malformed += decoded.refused.malformed;
    if (decoded.segments.length === 0) continue;
    const prior = out.get(session);
    if (prior === undefined) out.set(session, decoded.segments);
    else prior.push(...decoded.segments);
  }
  return {
    status: portFailed ? 'port_failed' : 'ok',
    segments: out,
    refused,
    skipped: totalRefusals(refused),
  };
}

/**
 * {@link readRefSegmentsOutcome} narrowed to its segments — the fail-safe form for
 * callers that only union the ref's bytes into a larger read and report their own
 * degradation (the durable buffer union). Reach for the outcome form when an EMPTY
 * result has to be explained.
 */
export function readRefSegments(gitRead: GitReadPort): Map<string, Segment[]> {
  return readRefSegmentsOutcome(gitRead).segments;
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
