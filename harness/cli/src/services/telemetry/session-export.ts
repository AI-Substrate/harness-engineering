import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { telemetryDir } from './cursor.js';
import type { Event } from './events.js';
import {
  type OtlpLogsProduction,
  produceOtlpLogs,
  reconstructSegmentFromOtlpLogs,
} from './otlp/logs.js';
import { produceOtlpMetrics } from './otlp/metrics.js';
import type { LogsData, MetricsData } from './otlp/types.js';
import {
  type PijIdentity,
  type PijIdentityDeps,
  resolveSessionPijIdentity,
} from './pij-identity.js';
import { emptyRefusalTally, type SegmentRefusalTally, tallyRefusal } from './ref-source.js';
import { ROLLED_LOGS_NAME, splitJsonl } from './rolled-shard.js';
import { computeRollup, parseIso } from './rollup.js';
import {
  decodeSegmentDetailed,
  type Segment,
  type SegmentDecodeOptions,
  type SegmentModelStat,
  type SegmentTokens,
} from './segment.js';
import { readFlushedWatermark } from './session-evidence.js';
import type { TokenEvidence } from './token-evidence.js';
import {
  completeUsageTokens,
  reduceUsageEvents,
  tokenEvidenceFromLegacyTokens,
  tokenEvidenceFromObservation,
} from './usage-observation.js';

/**
 * `SessionExport` (plan 047 Phase 1) — a thin, validatable envelope wrapping ONE
 * coding session's combined OTel telemetry. Mirrored by `session-export.schema.json`.
 *
 * STILL OTEL, ONE FILE (workshop 001): `signals.logs`/`signals.metrics` are OTLP
 * payloads. The load-bearing rule — **Logs are the lossless substrate, metrics are
 * derived** (KF-02/KF-03): everything is unified through the EVENT STREAM. Per seq
 * the events come from (in priority) a strictly reconstructed `<seq>.logs.jsonl` companion
 * → the segment's own `event_stream` → a v1 (no-`event_stream`) segment normalized
 * to a minimal stream (T007). The merged events then regenerate ONE `resourceLogs`
 * (via {@link produceOtlpLogs}) and ONE `resourceMetrics` (via {@link produceOtlpMetrics}
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
  /**
   * HOW the pij identity was established, or why it was not (FX002). ALWAYS present.
   *
   * `pij_session_id` above stays exactly as it was — the resolved id or `null` — so
   * every existing consumer is unaffected. What was missing is the DIFFERENCE between
   * "this seat has no pij identity" and "this seat's identity could not be resolved":
   * an adopted seat never had `PIJ_SESSION_ID` in its environment, so it captured
   * none, and the join failed at the root with no error and no marker. Those are the
   * seats doing the most interesting work, including our own orchestrator seats.
   */
  pij_identity: PijIdentity;
}

export interface SessionExportSource {
  kind: 'temp' | 'git-ref';
  root: string;
  segment_count: number;
}

export interface SessionExportTokens {
  in: number | null;
  out: number | null;
  cache_read: number | null;
  cache_create: number | null;
  total: number | null;
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
  token_evidence: TokenEvidence;
  /** Field names absent/unknown across the session, surfaced honestly (AC-10). */
  degraded: string[];
  /**
   * Paths the capture recorded as written/edited in a segment's `files` lists
   * (plan 068 item 3). The OTLP logs carry only `file` EVENTS, which exist solely
   * where the harness exposed a measurable per-file payload — so on harnesses that
   * expose a path but no payload this is the only surviving evidence that the file
   * was touched. Carried so the read path can render it with a named gap instead
   * of dropping it. OMITTED when no segment carried a path list.
   */
  files_observed?: { written: string[]; edited: string[] };
  /**
   * plan 070 — how many contributing segments were RECONCILED: windows recovered
   * LATE from an orphaned capture lane, after the session had stopped running
   * harness commands. Nobody watched that work happen; it was reconstructed from
   * the harness's own transcript afterwards.
   *
   * OMITTED when no segment was reconciled, which is every ordinary session.
   *
   * This is a COUNT, deliberately: it says how much of the session was recovered,
   * and it cannot be used to decide whether any PARTICULAR event was. That
   * question is answered where OTLP already models provenance — the reconciled
   * events keep their own `ResourceLogs`, carrying `harness.capture_mode`, so a
   * reader asks per event and gets a per-event answer (see the split below).
   * An earlier revision carried time RANGES here instead, and a live event that
   * merely fell inside a recovered window rendered as reconciled.
   */
  reconciled_segments?: number;
  /**
   * Records this session's read REFUSED, by reason (packet · pin). ALWAYS present —
   * an all-zero tally is the statement "I refused nothing", which is exactly the
   * claim a reader needs and cannot make from an omitted field.
   *
   * `below_pin` is the one this packet exists for: a 2.6 record is declined by the
   * read pin, and before the fix that was a bare `null` inside the decoder — wire
   * identical to malformed, truncated, or absent. If someone asks "where did the 2.6
   * evidence go", the answer is HERE, in the output, not in a commit message.
   */
  segments_refused: SegmentRefusalTally;
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
 * {@link produceOtlpLogs}/{@link produceOtlpMetrics} from reading `.map` of
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
      const reconstructed = reconstructSegmentFromOtlpLogs(
        JSON.parse(companionLogsRaw) as LogsData,
      );
      if (reconstructed.ok) return reconstructed.segment.event_stream;
    } catch {
      // fall through to the strictly decoded segment
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

/**
 * Reconstruct one seq's {@link SeqRead} from a committed OTLP **logs** blob when
 * there is NO `<seq>.json` — the canonical committed-shard shape (`sync-service`
 * publishes `<seq>.logs.jsonl` + `<seq>.metrics.jsonl` and keeps the json LOCAL).
 * Events come from strict OTLP reconstruction; identity + tokens +
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
  const reconstructed = reconstructSegmentFromOtlpLogs(logs);
  if (!reconstructed.ok) return null;
  const seg = reconstructed.segment;
  const events = seg.event_stream;
  seg.tokens = tokensFromRollup(seg.rollup?.tokens ?? null);
  const models = modelsFromEvents(events);
  if (Object.keys(models).length > 0) seg.models = models;
  return { seg, events };
}

/**
 * Read one session subdir's segments, corrupt-safe + SOURCE-AGNOSTIC across THREE
 * shapes (plan 049 dual-shape):
 *   • temp buffer / legacy committed shard — per-seq `<seq>.json` (json-anchored, with
 *     an optional `<seq>.logs.jsonl` companion) and/or logs-only `<seq>.logs.jsonl`
 *     (reconstructed logs-rooted). UNCHANGED.
 *   • ROLLED committed ref — a single `session.logs.jsonl` holding every seq's OTLP
 *     logs record (one JSON object per line, seq-ordered); each line is reconstructed
 *     logs-rooted. Loose `<seq>.json` fallbacks (partial/absent spool at roll time)
 *     are still picked up by the per-seq branch below, so nothing is dropped.
 * A seq is only ever in ONE shape (the roller never both concatenates AND leaves a
 * loose json for the same seq), so there is no double-count.
 */
function readSessionSeqs(
  fs: CombineFs,
  sessionDir: string,
  decodeOptions: SegmentDecodeOptions,
): { reads: SeqRead[]; refused: SegmentRefusalTally } {
  const names = fs.readdir(sessionDir);
  const out: SeqRead[] = [];
  const refused = emptyRefusalTally();

  // Rolled shape (plan 049): reconstruct every seq from the concatenated logs blob.
  if (names.includes(ROLLED_LOGS_NAME)) {
    const rolledLogs = fs.readText(posixJoin(sessionDir, ROLLED_LOGS_NAME));
    if (rolledLogs !== null) {
      for (const line of splitJsonl(rolledLogs)) {
        const recon = reconstructFromLogs(line);
        if (recon !== null) out.push(recon);
        // A rolled OTLP line is reassembled field-by-field, so it has no version to
        // name — `malformed` is the honest reason for a refusal on this path.
        else tallyRefusal(refused, 'malformed');
      }
    }
  }

  const jsonSeqs = new Set<number>();
  const logsOnly: number[] = [];
  for (const n of names) {
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
  for (const seq of seqs) {
    if (jsonSeqs.has(seq)) {
      const raw = fs.readText(posixJoin(sessionDir, `${seq}.json`));
      if (raw === null) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // a corrupt buffer file is skipped, never fatal — but it is COUNTED, and its
        // reason named, rather than vanishing (packet ruling #1.2: this function's own
        // failure path must not re-create the silence the reason channel removes).
        tallyRefusal(refused, 'malformed');
        continue;
      }
      const decoded = decodeSegmentDetailed(parsed, decodeOptions);
      if (!decoded.ok) {
        tallyRefusal(refused, decoded.reason);
        continue;
      }
      const seg = decoded.segment;
      const companion = fs.readText(posixJoin(sessionDir, `${seq}.logs.jsonl`));
      out.push({ seg, events: eventsForSeq(seg, companion) });
    } else {
      const logsRaw = fs.readText(posixJoin(sessionDir, `${seq}.logs.jsonl`));
      if (logsRaw === null) continue;
      const recon = reconstructFromLogs(logsRaw);
      if (recon !== null) out.push(recon);
      else tallyRefusal(refused, 'malformed');
    }
  }
  return { reads: out, refused };
}

/** Build the session identity from the read segments (first-seen wins for scalar fields). */
function buildIdentity(
  sessionId: string,
  reads: readonly SeqRead[],
  identityDeps: PijIdentityDeps | undefined,
): SessionExportIdentity {
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
  // FX002: an adopted seat captured no PIJ_SESSION_ID, so `pij` is null above with no
  // way to tell "has no pij identity" from "identity could not be resolved". Resolve on
  // READ through the existing registry substrate, and keep WHY when it cannot be done.
  const pijIdentity = resolveSessionPijIdentity(
    reads.map((r) => r.seg),
    sessionId,
    identityDeps,
  );
  return {
    harness_session_id: sessionId,
    harness,
    harness_version: harnessVersion,
    // Never fabricated: only a genuinely resolved identity fills this in. An
    // unresolved one stays null and reports its reason alongside.
    pij_session_id: pij ?? (pijIdentity.status === 'resolved' ? pijIdentity.pij_id : null),
    branch,
    models,
    pij_identity: pijIdentity,
  };
}

/** Sum session token totals; subagent tokens degrade to "unknown" (never 0) if any are unknown. */
function buildTokens(
  reads: readonly SeqRead[],
  events: readonly Event[],
  source: 'live' | 'ref',
): {
  tokens: SessionExportTokens;
  token_evidence: TokenEvidence;
  degraded: string[];
} {
  const observation = reduceUsageEvents(events);
  if (observation !== null) {
    const usage = completeUsageTokens(observation);
    if (usage === null) {
      return {
        tokens: {
          in: observation.input ?? null,
          out: observation.output ?? null,
          cache_read: observation.cache_read ?? null,
          cache_create: observation.cache_create ?? null,
          total: null,
          subagent_tokens: 'unknown',
          grand_total: 'unknown',
        },
        token_evidence: tokenEvidenceFromObservation(observation, source),
        degraded: ['typed_usage_partial'],
      };
    }
    return {
      tokens: {
        in: usage.input,
        out: usage.output,
        cache_read: usage.cache_read,
        cache_create: usage.cache_create,
        total: usage.total,
        subagent_tokens: 0,
        grand_total: usage.total,
      },
      token_evidence: tokenEvidenceFromObservation(observation, source),
      degraded: [],
    };
  }
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
  const anyLegacyTokens = reads.some(({ seg }) => seg.tokens !== null);
  const tokenEvidence = tokenEvidenceFromLegacyTokens(
    anyLegacyTokens
      ? { input: inTok, output: out, cache_read: cacheRead, cache_create: cacheCreate }
      : null,
    source,
    // Only a committed ref combine is whole-session by construction. A temp combine is a
    // sum of capture windows and can never contain the shutdown tail, so it must not
    // outrank a vendor final (R2-01).
    { wholeSession: source === 'ref' },
  );
  if (anyLegacyTokens && reads.some(({ seg }) => seg.tokens === null)) {
    tokenEvidence.coverage = 'partial';
    tokenEvidence.reason = 'source_unavailable';
  }
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
    token_evidence: tokenEvidence,
    degraded,
  };
}

/**
 * Concatenate two logs productions into one `LogsData`, preserving each side's own
 * `ResourceLogs` (and therefore its resource-level provenance). Used only when a
 * session mixes live and reconciled capture; the skipped-kind notes union.
 */
function mergeLogs(
  live: OtlpLogsProduction | undefined,
  reconciled: OtlpLogsProduction,
): OtlpLogsProduction {
  const resourceLogs = [
    ...(live?.logs.resourceLogs ?? []),
    ...(reconciled.logs.resourceLogs ?? []),
  ];
  const skipped = new Set<string>([...(live?.skipped ?? []), ...reconciled.skipped]);
  return { logs: { resourceLogs }, skipped: [...skipped].sort() };
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
  return combineSessionAtPin(sessionId, deps, opts, undefined);
}

/**
 * TEST-ONLY SEAM — the below-pin surfacing door, deliberately shaped as an IDENTIFIER
 * rather than as a field on {@link CombineSessionOpts} (packet ruling #11).
 *
 * `pin` used to live on the production options bag. A reviewer then CONSTRUCTED the
 * evasion rather than arguing it: `combineSession(id, deps, { ...JSON.parse(cfg) })`
 * type-checks, carries no `pin` token anywhere in `src/`, and raised the read policy
 * with all three static scans green. A field on a bag production callers already pass
 * can be filled by DATA, and data leaves nothing for a text scan to find.
 *
 * An identifier cannot arrive that way. `JSON.parse` returns values, never bindings;
 * to reach this function a caller must WRITE this name, and a written name is the one
 * thing the exhaustive `src/` scan cannot miss. That is the seal: not a rule against
 * setting a pin, but a door no data-shaped value can open.
 *
 * It exists because `below_pin` is unreachable in production at a floor pin, and a
 * channel nobody reads is not a channel (ruling #1.1) — the ENVELOPE plumbing that
 * carries a refusal reason out to `summary.segments_refused` has to stay exercised at
 * a real caller's surface, not just inside the decoder.
 *
 * NO `src/` CALLER MAY NAME THIS. `test/services/telemetry/pin-knob-src-usage.test.ts`
 * asserts that, and a planted violation fails it.
 */
export function combineSessionAtPinForTests(
  sessionId: string,
  deps: CombineSessionDeps,
  opts: CombineSessionOpts | undefined,
  readPin: string,
): SessionExport {
  return combineSessionAtPin(sessionId, deps, opts, readPin);
}

/**
 * The combine itself. Private: the only two ways in are {@link combineSession} (no
 * pin — the floor policy) and {@link combineSessionAtPinForTests} (a declared pin).
 */
function combineSessionAtPin(
  sessionId: string,
  deps: CombineSessionDeps,
  opts: CombineSessionOpts | undefined,
  readPin: string | undefined,
): SessionExport {
  const root = opts?.root ?? deps.proc.cwd();
  const telDir = telemetryDir(root);
  const sessionDir = posixJoin(telDir, sessionId);
  const { reads, refused: segmentsRefused } = readSessionSeqs(deps.fs, sessionDir, {
    ...(readPin === undefined ? {} : { pin: readPin }),
  });

  // Schema-version histogram (records v1 too — AC-02) + timecode bounds.
  const versions: Record<string, number> = {};
  let firstTc: string | null = null;
  let lastTc: string | null = null;
  const hasV1 = reads.some(({ seg }) => !hasEventStream(seg));
  // Paths the capture SAW touched (plan 068 item 3) — de-duplicated, first-seen order.
  const filesWritten: string[] = [];
  const filesEdited: string[] = [];
  for (const { seg } of reads) {
    for (const path of seg.files?.written ?? []) {
      if (!filesWritten.includes(path)) filesWritten.push(path);
    }
    for (const path of seg.files?.edited ?? []) {
      if (!filesEdited.includes(path)) filesEdited.push(path);
    }
  }
  for (const { seg } of reads) {
    const v = seg.schema_version ?? 'unknown';
    versions[v] = (versions[v] ?? 0) + 1;
    const tc = seg.timecode;
    if (typeof tc === 'string' && tc.length > 0) {
      if (firstTc === null || tc < firstTc) firstTc = tc;
      if (lastTc === null || tc > lastTc) lastTc = tc;
    }
  }

  // plan 070 — which EVENTS came from a reconciled segment, held by object identity
  // while the per-segment structure still exists. Identity, not time: a live event
  // and a recovered one can share an instant (and an interleaved window is the
  // normal case for a lane recovered between two live captures), so any range-based
  // answer marks live work as reconstructed. Consumed below to keep the recovered
  // events in their OWN `ResourceLogs` rather than collapsing them with the rest.
  const reconciledEvents = new Set<Event>();
  let reconciledSegments = 0;
  for (const r of reads) {
    if (r.seg.capture_mode !== 'reconciled') continue;
    reconciledSegments += 1;
    for (const event of r.events) reconciledEvents.add(event);
  }

  // Unify through the event stream: merge all events, order by `t`.
  const allEvents = reads
    .flatMap((r) => r.events)
    .slice()
    .sort((a, b) => parseIso(a.t) - parseIso(b.t));

  const identity = buildIdentity(
    sessionId,
    reads,
    deps.env ? { fs: deps.fs, env: deps.env } : undefined,
  );
  const { tokens, token_evidence, degraded } = buildTokens(
    reads,
    allEvents,
    opts?.kind === 'git-ref' ? 'ref' : 'live',
  );
  const sessionSchemaVersion = allEvents.some((event) => event.kind === 'usage')
    ? '2.7'
    : (reads[0]?.seg.schema_version ?? 'unknown');
  if (hasV1) degraded.push('v1_segments');

  // A pure-temp read of a session the sync has already flushed sees only the delta
  // since the last commit — the prune deleted the rest (finding 02). The committed ref
  // still has it, so say the read is partial and point at `--source auto`, rather than
  // letting a post-commit subset pass as the whole session. `git-ref`/`auto` reads
  // already carry the flushed bytes and are exempt.
  if (opts?.kind !== 'git-ref') {
    const watermark = readFlushedWatermark(deps.fs, telDir, sessionId);
    if (watermark > 0 && token_evidence.coverage !== 'unavailable') {
      token_evidence.coverage = 'partial';
      token_evidence.reason = 'flushed_segments_unreadable';
      degraded.push('pruned_buffer');
    }
  }

  // A synthetic session-level segment: forward-regenerate ONE logs + ONE metrics.
  const sessionSeg: Segment = {
    schema_version: sessionSchemaVersion,
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
  if (reads[0]?.seg.captured_env && reads[0].seg.schema_version === sessionSchemaVersion) {
    sessionSeg.captured_env = reads[0].seg.captured_env;
  }

  // A metric or event the producer contract cannot admit is DROPPED and NAMED here,
  // never thrown: one bad datapoint/event used to make the whole session unreadable
  // (plan 068 item 1). `metric_skipped:<name>` / `event_skipped:<kind>` are the
  // degrade notes the read surfaces carry.
  const producedMetrics = produceOtlpMetrics(sessionSeg);
  for (const name of producedMetrics.skipped) degraded.push(`metric_skipped:${name}`);
  // The collapse is honest for everything EXCEPT capture provenance, which OTLP
  // models on the resource. So the synthetic session keeps one resource per capture
  // mode instead of one overall: live events under an unmarked resource, recovered
  // events under one carrying `harness.capture_mode`. Every reader that flattens
  // (`otlpLogsToEvents`) is unaffected; a reader that asks per event
  // (`otlpLogsToEventRecords`) gets an exact answer that survives both the collapse
  // and any interleaving. Sessions with nothing reconciled — every ordinary one —
  // still produce exactly ONE resource, byte-identically to before.
  const liveEvents = allEvents.filter((event) => !reconciledEvents.has(event));
  const lateEvents = allEvents.filter((event) => reconciledEvents.has(event));
  const producedLogs =
    lateEvents.length === 0
      ? produceOtlpLogs(sessionSeg)
      : mergeLogs(
          liveEvents.length === 0
            ? undefined
            : produceOtlpLogs({ ...sessionSeg, event_stream: liveEvents }),
          produceOtlpLogs({
            ...sessionSeg,
            event_stream: lateEvents,
            capture_mode: 'reconciled',
          }),
        );
  for (const kind of producedLogs.skipped) degraded.push(`event_skipped:${kind}`);

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
      token_evidence,
      degraded,
      ...(filesWritten.length > 0 || filesEdited.length > 0
        ? { files_observed: { written: filesWritten, edited: filesEdited } }
        : {}),
      ...(reconciledSegments > 0 ? { reconciled_segments: reconciledSegments } : {}),
      segments_refused: segmentsRefused,
    },
    signals: {
      logs: producedLogs.logs,
      metrics: producedMetrics.metrics,
    },
  };
}
