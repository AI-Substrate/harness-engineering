import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { telemetryDir } from './cursor.js';
import type { Event } from './events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from './otlp/logs.js';
import { rollupToOtlpMetrics } from './otlp/metrics.js';
import type { LogsData, MetricsData } from './otlp/types.js';
import { computeRollup, parseIso } from './rollup.js';
import type { Segment } from './segment.js';

/**
 * `SessionExport` (plan 047 Phase 1) — a thin, validatable envelope wrapping ONE
 * coding session's combined OTel telemetry. Mirrored by `session-export.schema.json`.
 *
 * STILL OTEL, ONE FILE (workshop 001): `signals.logs`/`signals.metrics` are OTLP
 * payloads. The load-bearing rule — **Logs are the lossless substrate, metrics are
 * derived** (KF-02/KF-03): everything is unified through the EVENT STREAM. Per seq
 * the events come from (in priority) a `<seq>.logs.jsonl` companion (`otlpLogsToEvents`)
 * → the segment's own `event_stream` → a v1 (no-`event_stream`) segment normalized
 * to a minimal stream (T007). The merged events then regenerate ONE `resourceLogs`
 * (via {@link segmentToOtlpLogs}) and ONE `resourceMetrics` (via {@link rollupToOtlpMetrics}
 * over `computeRollup(all events)`) — **forward only, never inverting metrics, never
 * summing per-command cumulative metrics**.
 *
 * READ-ONLY + FAIL-SAFE: reads the buffer, never mutates it; an absent/corrupt
 * seq is skipped, never fatal.
 */

export const SESSION_EXPORT_SCHEMA_VERSION = 'harness.session-export/v1' as const;

export interface SessionExportIdentity {
  harness_session_id: string;
  harness: string;
  harness_version: string | null;
  pij_session_id: string | null;
  branch: string | null;
  models: string[];
}

export interface SessionExportSource {
  kind: 'temp' | 'git-ref';
  root: string;
  segment_count: number;
}

export interface SessionExportTokens {
  in: number;
  out: number;
  cache_read: number;
  cache_create: number;
  total: number;
  /** "unknown" (never 0) when any segment's subagent tokens were unknown (AC-10). */
  subagent_tokens: number | 'unknown';
  grand_total: number | 'unknown';
}

export interface SessionExportSummary {
  /** Histogram of each combined segment's `schema_version` — records exactly what went in (AC-02). */
  segment_schema_versions: Record<string, number>;
  first_timecode: string | null;
  last_timecode: string | null;
  tokens: SessionExportTokens;
  /** Field names absent/unknown across the session, surfaced honestly (AC-10). */
  degraded: string[];
}

export interface SessionExportSignals {
  logs: LogsData;
  metrics: MetricsData;
}

export interface SessionExport {
  schema_version: typeof SESSION_EXPORT_SCHEMA_VERSION;
  identity: SessionExportIdentity;
  source: SessionExportSource;
  summary: SessionExportSummary;
  signals: SessionExportSignals;
}

/** The fs surface the combine reads through (P2: no `node:*` in services). */
type CombineFs = Pick<FsPort, 'readText' | 'readdir'>;

export interface CombineSessionDeps {
  fs: CombineFs;
  proc: Pick<ProcessPort, 'cwd'>;
  env?: Pick<EnvPort, 'home'>;
}

export interface CombineSessionOpts {
  /** Explicit telemetry buffer root override; the buffer is `<root>/.harness/temp/telemetry`. */
  root?: string;
}

/** A v1 flat-view segment carries histograms instead of an `event_stream`. */
interface V1FlatView {
  timecode?: string;
  tokens?: { input?: number; output?: number; cache_read?: number; cache_create?: number } | null;
  skills?: Record<string, number>;
  tools?: Record<string, number>;
  harness_commands?: Record<string, number> | string[];
  models?: Record<string, unknown>;
}

/**
 * Normalize a v1 (no-`event_stream`) segment to a MINIMAL event stream (T007 · F-02).
 * A v1 segment has flat count histograms and no per-event timestamps, so there is no
 * real timeline to reconstruct — every synthesized event is stamped at the segment's
 * `timecode` (honest: counts preserved, no fabricated durations). This keeps
 * {@link segmentToOtlpLogs}/{@link rollupToOtlpMetrics} from throwing on `.map` of
 * `undefined` while the counts survive into the combined logs.
 */
export function normalizeV1ToEvents(seg: Segment): Event[] {
  const v1 = seg as unknown as V1FlatView;
  const t = v1.timecode ?? seg.timecode ?? '';
  const out: Event[] = [];
  const tok = v1.tokens;
  if (tok && (tok.input || tok.output || tok.cache_read || tok.cache_create)) {
    const turn: Event = { t, kind: 'turn', dur_s: 0 };
    if (typeof tok.input === 'number') turn.in = tok.input;
    if (typeof tok.output === 'number') turn.out = tok.output;
    if (typeof tok.cache_read === 'number') turn.cache_read = tok.cache_read;
    if (typeof tok.cache_create === 'number') turn.cache_create = tok.cache_create;
    out.push(turn);
  }
  for (const [name, count] of Object.entries(v1.skills ?? {})) {
    for (let i = 0; i < count; i++) out.push({ t, kind: 'skill', name, status: 'completed' });
  }
  for (const [name, count] of Object.entries(v1.tools ?? {})) {
    out.push({ t, kind: 'tools', name, count, span_s: 0 });
  }
  const hc = v1.harness_commands;
  if (Array.isArray(hc)) {
    for (const verb of hc) out.push({ t, kind: 'harness', verb });
  } else if (hc) {
    for (const [verb, count] of Object.entries(hc)) {
      for (let i = 0; i < count; i++) out.push({ t, kind: 'harness', verb });
    }
  }
  return out;
}

/** Does this segment carry the v2 `event_stream` substrate? (v1 legacy segments do not.) */
function hasEventStream(seg: Segment): boolean {
  return Array.isArray(seg.event_stream);
}

/**
 * The `Event[]` for one seq, from the highest-fidelity source available:
 * a `.logs.jsonl` OTLP companion (already the exact serialized stream) → the segment's
 * own `event_stream` → a v1-normalized minimal stream. Never throws.
 */
function eventsForSeq(seg: Segment, companionLogsRaw: string | null): Event[] {
  if (companionLogsRaw !== null) {
    try {
      return otlpLogsToEvents(JSON.parse(companionLogsRaw) as LogsData);
    } catch {
      // fall through to the segment
    }
  }
  if (hasEventStream(seg)) return [...seg.event_stream];
  return normalizeV1ToEvents(seg);
}

interface SeqRead {
  seg: Segment;
  events: Event[];
}

/** Read one session subdir's segments (+ optional OTLP companions), corrupt-safe. */
function readSessionSeqs(fs: CombineFs, sessionDir: string): SeqRead[] {
  const seqs = fs
    .readdir(sessionDir)
    .map((n) => /^(\d+)\.json$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[0], seq: Number.parseInt(m[1], 10) }))
    .sort((a, b) => a.seq - b.seq);
  const out: SeqRead[] = [];
  for (const f of seqs) {
    const raw = fs.readText(posixJoin(sessionDir, f.name));
    if (raw === null) continue;
    let seg: Segment;
    try {
      seg = JSON.parse(raw) as Segment;
    } catch {
      continue; // a corrupt buffer file is skipped, never fatal
    }
    const companion = fs.readText(posixJoin(sessionDir, `${f.seq}.logs.jsonl`));
    out.push({ seg, events: eventsForSeq(seg, companion) });
  }
  return out;
}

/** Build the session identity from the read segments (first-seen wins for scalar fields). */
function buildIdentity(sessionId: string, reads: readonly SeqRead[]): SessionExportIdentity {
  const models: string[] = [];
  let harness = 'unknown';
  let harnessVersion: string | null = null;
  let pij: string | null = null;
  let branch: string | null = null;
  let first = true;
  for (const { seg } of reads) {
    if (first) {
      harness = seg.harness ?? 'unknown';
      harnessVersion = seg.harness_version ?? null;
      branch = seg.branch ?? null;
      first = false;
    }
    const p = seg.captured_env?.PIJ_SESSION_ID;
    if (pij === null && typeof p === 'string' && p.length > 0) pij = p;
    for (const name of Object.keys(seg.models ?? {})) {
      if (!models.includes(name)) models.push(name);
    }
  }
  return {
    harness_session_id: sessionId,
    harness,
    harness_version: harnessVersion,
    pij_session_id: pij,
    branch,
    models,
  };
}

/** Sum session token totals; subagent tokens degrade to "unknown" (never 0) if any are unknown. */
function buildTokens(reads: readonly SeqRead[]): {
  tokens: SessionExportTokens;
  degraded: string[];
} {
  let inTok = 0;
  let out = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let subagent = 0;
  let subagentKnown = true;
  for (const { seg } of reads) {
    const t = seg.tokens;
    if (t == null) {
      subagentKnown = false;
      continue;
    }
    inTok += t.input ?? 0;
    out += t.output ?? 0;
    cacheRead += t.cache_read ?? 0;
    cacheCreate += t.cache_create ?? 0;
    if (typeof t.subagent_tokens === 'number') subagent += t.subagent_tokens;
    else subagentKnown = false;
  }
  const total = inTok + out + cacheRead + cacheCreate;
  const degraded: string[] = [];
  if (!subagentKnown) degraded.push('subagent_tokens');
  return {
    tokens: {
      in: inTok,
      out,
      cache_read: cacheRead,
      cache_create: cacheCreate,
      total,
      subagent_tokens: subagentKnown ? subagent : 'unknown',
      grand_total: subagentKnown ? total + subagent : 'unknown',
    },
    degraded,
  };
}

/**
 * Combine one session's buffered segments into a schema-valid {@link SessionExport}
 * from the temp source. Fail-safe: an unreadable/empty session yields a well-formed
 * export with `segment_count: 0` and empty signals (never throws).
 */
export function combineSession(
  sessionId: string,
  deps: CombineSessionDeps,
  opts?: CombineSessionOpts,
): SessionExport {
  const root = opts?.root ?? deps.proc.cwd();
  const telDir = telemetryDir(root);
  const sessionDir = posixJoin(telDir, sessionId);
  const reads = readSessionSeqs(deps.fs, sessionDir);

  // Schema-version histogram (records v1 too — AC-02) + timecode bounds.
  const versions: Record<string, number> = {};
  let firstTc: string | null = null;
  let lastTc: string | null = null;
  const hasV1 = reads.some(({ seg }) => !hasEventStream(seg));
  for (const { seg } of reads) {
    const v = seg.schema_version ?? 'unknown';
    versions[v] = (versions[v] ?? 0) + 1;
    const tc = seg.timecode;
    if (typeof tc === 'string' && tc.length > 0) {
      if (firstTc === null || tc < firstTc) firstTc = tc;
      if (lastTc === null || tc > lastTc) lastTc = tc;
    }
  }

  // Unify through the event stream: merge all events, order by `t`.
  const allEvents = reads
    .flatMap((r) => r.events)
    .slice()
    .sort((a, b) => parseIso(a.t) - parseIso(b.t));

  const identity = buildIdentity(sessionId, reads);
  const { tokens, degraded } = buildTokens(reads);
  if (hasV1) degraded.push('v1_segments');

  // A synthetic session-level segment: forward-regenerate ONE logs + ONE metrics.
  const sessionSeg: Segment = {
    schema_version: reads[0]?.seg.schema_version ?? 'unknown',
    command: reads[0]?.seg.command ?? 'session',
    harness: identity.harness,
    harness_version: identity.harness_version ?? 'unknown',
    harness_session_id: sessionId,
    timecode: firstTc ?? '',
    window: { since: 'session-start', from: 0, to: 0 },
    branch: identity.branch,
    tokens: null,
    effort: null,
    event_stream: allEvents,
    rollup: allEvents.length > 0 ? computeRollup(allEvents) : null,
  };
  if (reads[0]?.seg.captured_env) sessionSeg.captured_env = reads[0].seg.captured_env;

  return {
    schema_version: SESSION_EXPORT_SCHEMA_VERSION,
    identity,
    source: { kind: 'temp', root: telemetryDir('.'), segment_count: reads.length },
    summary: {
      segment_schema_versions: versions,
      first_timecode: firstTc,
      last_timecode: lastTc,
      tokens,
      degraded,
    },
    signals: {
      logs: segmentToOtlpLogs(sessionSeg),
      metrics: rollupToOtlpMetrics(sessionSeg),
    },
  };
}
