import type { GitReadPort, ShardBlob } from '../../adapters/git/git-read-port.js';
import { TELEMETRY_REF_GLOB } from '../../adapters/git/git-write-port.js';
import { otlpLogsToEvents } from './otlp/logs.js';
import { splitJsonl } from './rolled-shard.js';
import type { Segment } from './segment.js';

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
  /** Token total summed across the ref's turn events / loose segments. */
  tokens: { grand_total: number; output: number };
  /** `true` iff ≥1 turn/segment carried non-null tokens (else an honest unmeasured ref). */
  measured: boolean;
  /** Rough segment count (one per rolled logs record / loose `<seq>.json`). */
  segments: number;
}

/** The harness session id is the ref's LAST path segment (`…/<date>/<session>`). */
function sessionIdOfRef(ref: string): string | null {
  const seg = ref.split('/').pop();
  return seg !== undefined && seg.length > 0 ? seg : null;
}

/** Sum tokens across one ref's shard blobs (rolled `session.logs.jsonl`, legacy `<seq>.logs.jsonl`, loose `<seq>.json`). */
function tokensFromBlobs(blobs: readonly ShardBlob[]): {
  grand_total: number;
  output: number;
  measured: boolean;
  segments: number;
} {
  let grand = 0;
  let output = 0;
  let measured = false;
  let segments = 0;
  for (const b of blobs) {
    if (b.name.endsWith('.logs.jsonl')) {
      // One OTLP LogsData per line (rolled) or the whole blob (legacy per-seq).
      for (const line of splitJsonl(b.content)) {
        let logs: unknown;
        try {
          logs = JSON.parse(line);
        } catch {
          continue; // a corrupt record is skipped, never fatal
        }
        segments += 1;
        for (const ev of otlpLogsToEvents(logs as never)) {
          if (ev.kind !== 'turn') continue;
          const t = (ev.in ?? 0) + (ev.out ?? 0) + (ev.cache_read ?? 0) + (ev.cache_create ?? 0);
          if (t > 0) {
            measured = true;
            grand += t;
            output += ev.out ?? 0;
          }
        }
      }
    } else if (/^\d+\.json$/.test(b.name)) {
      let seg: Segment | null = null;
      try {
        seg = JSON.parse(b.content) as Segment;
      } catch {
        continue;
      }
      segments += 1;
      if (seg?.tokens != null) {
        measured = true;
        grand += seg.tokens.grand_total ?? 0;
        output += seg.tokens.output ?? 0;
      }
    }
  }
  return { grand_total: grand, output, measured, segments };
}

/**
 * Enumerate every `refs/harness-telemetry/*` rollup and decode each session's token
 * total, keyed by harness session id. A session with multiple date-sharded refs folds
 * into one lane (tokens summed). Fail-safe: any error → empty map (never throws).
 */
export function readRefLanes(gitRead: GitReadPort): Map<string, RefLane> {
  const out = new Map<string, RefLane>();
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
    const { grand_total, output, measured, segments } = tokensFromBlobs(blobs);
    const prev = out.get(sid);
    if (prev === undefined) {
      out.set(sid, {
        harness_session_id: sid,
        tokens: { grand_total, output },
        measured,
        segments,
      });
    } else {
      // Same session, multiple date refs — fold (sum).
      prev.tokens.grand_total += grand_total;
      prev.tokens.output += output;
      prev.measured = prev.measured || measured;
      prev.segments += segments;
    }
  }
  return out;
}
