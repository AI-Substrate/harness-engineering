import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { telemetryDir } from './cursor.js';
import type { Event } from './events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from './otlp/logs.js';
import { rollupToOtlpMetrics } from './otlp/metrics.js';
import {
  RES_BRANCH,
  RES_COMMAND,
  RES_ENV,
  RES_HARNESS,
  RES_SCHEMA_VERSION,
  RES_SERVICE_VERSION,
  RES_SESSION,
} from './otlp/semconv.js';
import { type AnyValue, attrMap, type LogsData, type MetricsData, readStr } from './otlp/types.js';
import { computeRollup, parseIso } from './rollup.js';
import type { Segment, SegmentModelStat, SegmentTokens } from './segment.js';

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
  /**
   * The source discriminator echoed into `source.kind` (default `'temp'`). The
   * git-ref source passes `'git-ref'`; combine itself is source-agnostic — it reads
   * whatever the injected {@link CombineFs} exposes (a temp buffer or committed
   * shard blobs wrapped as an fs).
   */
  kind?: SessionExportSource['kind'];
  /**
   * Echoed into `source.root` (default the repo-relative temp buffer path). The
   * git-ref source passes the ref namespace (`refs/harness-telemetry/*`) so the
   * envelope is honest about where the bytes came from — never a `/Users/…` leak.
   */
  sourceRoot?: string;
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

/** Build a `SegmentTokens` from an event-derived rollup's token buckets. */
function tokensFromRollup(
  t: { in: number; out: number; cache_read: number; cache_create: number } | null,
): SegmentTokens | null {
  if (t === null) return null;
  const total = t.in + t.out + t.cache_read + t.cache_create;
  // A committed shard's OTLP logs carry per-turn in/out/cache tokens but NOT
  // subagent-token attribution (that lived only in the segment json, which the
  // canonical shard omits), so subagent reconstructs as 0-observed — honest to
  // what the counts-only substrate carries (KF-02: forward-regen, never invert).
  return {
    input: t.in,
    output: t.out,
    cache_read: t.cache_read,
    cache_create: t.cache_create,
    total,
    subagent_tokens: 0,
    grand_total: total,
  };
}

/** Distinct model names (+ a minimal turns/output stat) from an event stream — the identity seam. */
function modelsFromEvents(events: readonly Event[]): Record<string, SegmentModelStat> {
  const models: Record<string, SegmentModelStat> = {};
  for (const e of events) {
    const model = e.kind === 'model' ? e.model : e.kind === 'turn' ? e.model : undefined;
    if (typeof model !== 'string' || model.length === 0) continue;
    models[model] ??= { turns: 0, output_tokens: 0 };
    const stat = models[model];
    if (e.kind === 'turn') {
      stat.turns += 1;
      if (typeof e.out === 'number') stat.output_tokens += e.out;
    }
  }
  return models;
}

/** Rebuild the allowlisted env snapshot from the `harness.env` kvlist resource attribute. */
function envFromKvlist(attr: AnyValue | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of attr?.kvlistValue?.values ?? []) {
    const s = readStr(value);
    if (s !== undefined) out[key] = s;
  }
  return out;
}

/**
 * Reconstruct one seq's {@link SeqRead} from a committed OTLP **logs** blob when
 * there is NO `<seq>.json` — the canonical committed-shard shape (`sync-service`
 * publishes `<seq>.logs.jsonl` + `<seq>.metrics.jsonl` and keeps the json LOCAL).
 * Events come from {@link otlpLogsToEvents} (lossless inverse); identity + tokens +
 * models are lifted from the `harness.*` resource attributes + the event stream, so
 * a logs-only shard yields a NON-empty, identity-bearing segment (not `segment_count:0`).
 * Never throws — a corrupt blob is skipped.
 */
function reconstructFromLogs(logsRaw: string): SeqRead | null {
  let logs: LogsData;
  try {
    logs = JSON.parse(logsRaw) as LogsData;
  } catch {
    return null; // a corrupt logs blob is skipped, never fatal
  }
  const events = otlpLogsToEvents(logs);
  const m = attrMap(logs.resourceLogs?.[0]?.resource?.attributes);
  const branch = readStr(m.get(RES_BRANCH));
  const rollup = events.length > 0 ? computeRollup(events) : null;
  const seg: Segment = {
    schema_version: readStr(m.get(RES_SCHEMA_VERSION)) ?? 'unknown',
    command: readStr(m.get(RES_COMMAND)) ?? 'session',
    harness: readStr(m.get(RES_HARNESS)) ?? 'unknown',
    harness_version: readStr(m.get(RES_SERVICE_VERSION)) ?? 'unknown',
    harness_session_id: readStr(m.get(RES_SESSION)) ?? '',
    timecode: events[0]?.t ?? '',
    window: { since: 'session-start', from: 0, to: 0 },
    branch: branch ?? null,
    tokens: tokensFromRollup(rollup?.tokens ?? null),
    effort: null,
    event_stream: events,
    rollup,
  };
  const models = modelsFromEvents(events);
  if (Object.keys(models).length > 0) seg.models = models;
  const capturedEnv = envFromKvlist(m.get(RES_ENV));
  if (Object.keys(capturedEnv).length > 0) seg.captured_env = capturedEnv;
  return { seg, events };
}

/**
 * Read one session subdir's segments, corrupt-safe + SOURCE-AGNOSTIC. A `<seq>.json`
 * is read json-anchored (identity/tokens from the segment, events from the
 * `<seq>.logs.jsonl` companion) — the temp path, UNCHANGED. A `<seq>.logs.jsonl`
 * with NO matching `<seq>.json` (the canonical committed shard) is reconstructed
 * logs-rooted (P3 git-ref) so a logs-only shard is never dropped.
 */
function readSessionSeqs(fs: CombineFs, sessionDir: string): SeqRead[] {
  const jsonSeqs = new Set<number>();
  const logsOnly: number[] = [];
  for (const n of fs.readdir(sessionDir)) {
    const j = /^(\d+)\.json$/.exec(n);
    if (j !== null) {
      jsonSeqs.add(Number.parseInt(j[1], 10));
      continue;
    }
    const l = /^(\d+)\.logs\.jsonl$/.exec(n);
    if (l !== null) logsOnly.push(Number.parseInt(l[1], 10));
  }
  // Union of json seqs + logs-only seqs (a logs blob whose json is absent), sorted.
  const seqs = [
    ...new Set<number>([...jsonSeqs, ...logsOnly.filter((s) => !jsonSeqs.has(s))]),
  ].sort((a, b) => a - b);
  const out: SeqRead[] = [];
  for (const seq of seqs) {
    if (jsonSeqs.has(seq)) {
      const raw = fs.readText(posixJoin(sessionDir, `${seq}.json`));
      if (raw === null) continue;
      let seg: Segment;
      try {
        seg = JSON.parse(raw) as Segment;
      } catch {
        continue; // a corrupt buffer file is skipped, never fatal
      }
      const companion = fs.readText(posixJoin(sessionDir, `${seq}.logs.jsonl`));
      out.push({ seg, events: eventsForSeq(seg, companion) });
    } else {
      const logsRaw = fs.readText(posixJoin(sessionDir, `${seq}.logs.jsonl`));
      if (logsRaw === null) continue;
      const recon = reconstructFromLogs(logsRaw);
      if (recon !== null) out.push(recon);
    }
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
    source: {
      kind: opts?.kind ?? 'temp',
      root: opts?.sourceRoot ?? telemetryDir('.'),
      segment_count: reads.length,
    },
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
