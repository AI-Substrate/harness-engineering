import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { ensureTemp } from '../shared/temp.js';
import { sanitizeSessionId, telemetryDir } from './cursor.js';

/**
 * Capture LIVENESS (plan 070, deliverable 1) — the instrument that makes a
 * capture that *silently did not happen* observable.
 *
 * The defect it exists for (session `1a501a09`, 2026-08-03): capture fired once
 * on the session's first command, then never again for ~10 further invocations
 * while the transcript grew from 2 lines to 56. Nothing surfaced — capture
 * failures are swallowed BY DESIGN (the zero-host-impact contract), so the
 * session committed ONE thin, internally consistent, non-zero segment that
 * under-represented it ~27×. **That failure mode produces a confident wrong
 * number, not a gap** — which is why nothing downstream could notice it.
 *
 * The expectation this module encodes: *an eligible invocation (active harness,
 * telemetry on, top-level) that observes an UNCONSUMED window SHOULD produce a
 * capture.* When it does not, the absence is written down here — named, counted,
 * and readable by `harness doctor`. It NEVER synthesizes the missing segment
 * (house law: the detector marks absence; it never fabricates data) and it never
 * throws into the host command.
 *
 * Marker file: `.harness/temp/telemetry/<session>.liveness.json`, a sibling of
 * the `.cursor` / `.flushed` / `.branch` markers, inside the self-ignoring temp
 * tree. LOCAL-ONLY: it is not a `<seq>.json` segment, so no transport (sync /
 * OTLP spool / ref push) ever picks it up.
 */

/** Suffix of the per-session liveness marker file. */
export const LIVENESS_SUFFIX = '.liveness.json';

/**
 * Consecutive un-captured eligible attempts before the DOCTOR raises the signal.
 * One anomaly is recorded and reported in the layer detail (nothing is hidden);
 * TWO IN A ROW is a stall — the 1a501a09 shape ran to ~10. The threshold exists
 * so a single transient (a transcript rotating under a read, a source that
 * appears a moment later) does not turn into a standing alarm, while a genuine
 * stall — which never self-heals, because the frozen cursor keeps re-presenting
 * the same unconsumed window — trips on its second invocation.
 */
export const LIVENESS_STALL_THRESHOLD = 2;

/**
 * What one eligible capture attempt did, classified from FACTS observed during
 * the attempt (was a segment written? what were the watermark and the source
 * extent?) — never from which branch the code believed it took.
 *
 * - `captured` — a segment was written and the cursor advanced. Healthy.
 * - `no-window` — the source had nothing beyond the watermark. Healthy idle
 *   (a `flow rail` poll, a repeat command); NOT an anomaly and NOT persisted, so
 *   the write-free idle path stays write-free.
 * - `position-unsupported` — the matched adapter exposes no `currentPosition`
 *   (the null-default, or a future harness). Liveness is UNJUDGEABLE here, so it
 *   is neutral: we do not claim a stall we cannot see.
 * - `unread-window` — the source extent was BEYOND the watermark and no segment
 *   was written. **The 1a501a09 shape.** Anomalous.
 * - `source-unreadable` — the adapter supports positions but could not read one
 *   (transcript missing / unreadable / env stripped). Anomalous: an active
 *   harness whose own source cannot be read captures nothing, silently.
 * - `error` — a throw escaped the capture body and was swallowed. Anomalous.
 */
export type CaptureOutcome =
  | 'captured'
  | 'no-window'
  | 'position-unsupported'
  | 'unread-window'
  | 'source-unreadable'
  | 'error';

/** Outcomes that mean an eligible window was NOT captured when it should have been. */
const ANOMALOUS: ReadonlySet<CaptureOutcome> = new Set<CaptureOutcome>([
  'unread-window',
  'source-unreadable',
  'error',
]);

/** True when this outcome is a capture that should have happened and did not. */
export function isAnomalous(outcome: CaptureOutcome): boolean {
  return ANOMALOUS.has(outcome);
}

/**
 * Facts gathered DURING one capture attempt. Filled progressively so that a throw
 * mid-attempt still leaves behind whatever was genuinely observed before it —
 * every field is `null` until the attempt actually learned it (nothing is guessed).
 */
export interface CaptureProbe {
  /** Raw harness session id, once detection/resolution produced one. */
  session: string | null;
  /** Detected harness id (`cursor-agent`, `claude-code`, …). */
  harness: string | null;
  /**
   * The watermark as it stands at the END of the attempt: the prior one when
   * nothing was consumed, the newly advanced one when a segment was written. A
   * first capture has no PRIOR watermark, so recording the pre-attempt value
   * would leave the lane's high-water unknown exactly when it is needed.
   */
  cursor: number | null;
  /** The source extent observed this attempt (`null` = unreadable / not yet read). */
  position: number | null;
  /** Whether the matched adapter can report a position at all. */
  positionSupported: boolean;
  /** The session source file, when the adapter can name one (for later residue checks). */
  sourcePath: string | null;
  /** True once a segment file has been written and the cursor advanced. */
  captured: boolean;
  /** Constructor name of an escaped error (a CLASS, never a message — no content). */
  errorKind?: string;
}

/** A fresh probe: everything unknown until the attempt observes it. */
export function newCaptureProbe(): CaptureProbe {
  return {
    session: null,
    harness: null,
    cursor: null,
    position: null,
    positionSupported: false,
    sourcePath: null,
    captured: false,
  };
}

/**
 * Classify an attempt from what it observed. `threw` short-circuits to `error`;
 * otherwise a written segment is `captured`, an adapter with no position sense is
 * `position-unsupported`, an unreadable source is `source-unreadable`, and a
 * source extent beyond the watermark with nothing written is `unread-window`.
 */
export function classifyAttempt(probe: CaptureProbe, threw: boolean): CaptureOutcome {
  if (threw) return 'error';
  if (probe.captured) return 'captured';
  if (!probe.positionSupported) return 'position-unsupported';
  if (probe.position === null) return 'source-unreadable';
  return probe.position > (probe.cursor ?? 0) ? 'unread-window' : 'no-window';
}

/** The durable per-session liveness state (the marker file's contents). */
export interface LivenessRecord {
  /** Path-sanitized session id — the marker's own key (matches the `.cursor` sidecar). */
  session: string;
  harness: string;
  last_attempt_at: string;
  last_command: string;
  last_outcome: CaptureOutcome;
  /** The lane's high-water watermark and source extent after the LAST recorded attempt. */
  cursor: number | null;
  position: number | null;
  /** Lifetime counts. `anomalies` never decreases — a lost window stays on the record. */
  captures: number;
  anomalies: number;
  /** Anomalous attempts since the last successful capture (reset only by a capture). */
  consecutive_uncaptured: number;
  last_capture_at: string | null;
  /** Error CLASS of the last swallowed throw, when there was one. */
  last_error_kind?: string;
  /**
   * The session's source file, when the adapter could name one, plus the unit its
   * extent is measured in. Recorded so a LATER `doctor` can re-measure the source
   * and see whether the watermark ever caught up — the only way to catch a lane
   * whose source finished growing after the last harness command ran.
   */
  source?: string;
  source_unit?: 'nonempty-lines';
}

/** `.harness/temp/telemetry/<session>.liveness.json` for a raw session id. */
export function livenessPathFor(cwd: string, sessionId: string): string {
  return posixJoin(telemetryDir(cwd), `${sanitizeSessionId(sessionId)}${LIVENESS_SUFFIX}`);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Parse a marker file tolerantly — a missing, truncated, or hand-edited file
 * reads as `null` (start fresh) rather than throwing. A marker is diagnostic
 * state, never an authority: it can always be deleted with no consequence beyond
 * losing history.
 */
export function parseLivenessRecord(text: string | null): LivenessRecord | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.session !== 'string' || o.session.length === 0) return null;
  const record: LivenessRecord = {
    session: o.session,
    harness: str(o.harness, 'unknown'),
    last_attempt_at: str(o.last_attempt_at, ''),
    last_command: str(o.last_command, ''),
    last_outcome: str(o.last_outcome, 'error') as CaptureOutcome,
    cursor: numOrNull(o.cursor),
    position: numOrNull(o.position),
    captures: num(o.captures),
    anomalies: num(o.anomalies),
    consecutive_uncaptured: num(o.consecutive_uncaptured),
    last_capture_at: typeof o.last_capture_at === 'string' ? o.last_capture_at : null,
  };
  if (typeof o.last_error_kind === 'string' && o.last_error_kind.length > 0) {
    record.last_error_kind = o.last_error_kind;
  }
  if (typeof o.source === 'string' && o.source.length > 0) {
    record.source = o.source;
    record.source_unit = 'nonempty-lines';
  }
  return record;
}

/** One eligible capture attempt, as handed to the marker. */
export interface LivenessAttempt {
  session: string;
  harness: string;
  command: string;
  at: string;
  outcome: CaptureOutcome;
  cursor: number | null;
  position: number | null;
  errorKind?: string;
  /** The session's source file, when the adapter could name one. */
  sourcePath?: string | null;
}

/**
 * Fold one attempt into the prior record (PURE). A capture resets the consecutive
 * counter (the lane is proven live again) but never rewinds `anomalies` — the
 * windows already lost stay on the record.
 */
export function mergeAttempt(
  prev: LivenessRecord | null,
  attempt: LivenessAttempt,
): LivenessRecord {
  const anomalous = isAnomalous(attempt.outcome);
  const captured = attempt.outcome === 'captured';
  const record: LivenessRecord = {
    session: attempt.session,
    harness: attempt.harness,
    last_attempt_at: attempt.at,
    last_command: attempt.command,
    last_outcome: attempt.outcome,
    cursor: attempt.cursor,
    position: attempt.position,
    captures: (prev?.captures ?? 0) + (captured ? 1 : 0),
    anomalies: (prev?.anomalies ?? 0) + (anomalous ? 1 : 0),
    consecutive_uncaptured: captured
      ? 0
      : (prev?.consecutive_uncaptured ?? 0) + (anomalous ? 1 : 0),
    last_capture_at: captured ? attempt.at : (prev?.last_capture_at ?? null),
  };
  const errorKind = attempt.errorKind ?? (captured ? undefined : prev?.last_error_kind);
  if (errorKind !== undefined) record.last_error_kind = errorKind;
  // A source path once known is kept even when a later attempt cannot resolve it:
  // losing the path would erase the residue check exactly when the source became
  // unreadable, which is when it matters most.
  const source = attempt.sourcePath ?? prev?.source;
  if (source !== undefined && source !== null && source.length > 0) {
    record.source = source;
    record.source_unit = 'nonempty-lines';
  }
  return record;
}

/**
 * Persist one attempt onto the session's marker. NEVER THROWS and never touches
 * the host command (AC-5).
 *
 * Two outcomes are deliberately NOT persisted — `no-window` and
 * `position-unsupported`. Both are neutral (they neither prove nor disprove
 * liveness), and skipping them keeps capture's write-free idle path exactly as
 * write-free as it was before this module existed: the marker costs I/O only on
 * a real capture (which already writes five files) or on an anomaly (which is
 * the entire point). Skipping them also cannot mask a stall — a stalled lane
 * keeps re-presenting the same unconsumed window, so its attempts are anomalous,
 * not neutral.
 *
 * A failure of the marker write itself degrades SILENTLY and NON-RECURSIVELY (it
 * never retries and never writes a second marker to describe the first one's
 * failure). The absence of a fresh marker is itself readable: `doctor` reports
 * the last recorded attempt and its age.
 */
export function recordCaptureAttempt(
  deps: { fs: FsPort; proc: ProcessPort },
  cwd: string,
  attempt: LivenessAttempt,
): void {
  try {
    if (attempt.outcome === 'no-window' || attempt.outcome === 'position-unsupported') return;
    const path = livenessPathFor(cwd, attempt.session);
    const prev = parseLivenessRecord(deps.fs.readText(path));
    const next = mergeAttempt(prev, { ...attempt, session: sanitizeSessionId(attempt.session) });
    ensureTemp({ fs: deps.fs, proc: deps.proc });
    deps.fs.mkdirp(telemetryDir(cwd));
    const tmp = `${path}.tmp`;
    deps.fs.writeText(tmp, `${JSON.stringify(next, null, 2)}\n`);
    deps.fs.rename(tmp, path);
  } catch {
    // Silent + non-recursive by contract: the detector can never be the reason a
    // host command changes behaviour, and it never tries to mark its own failure.
  }
}

/** Read every session's liveness marker from a repo's telemetry dir (tolerant, never throws). */
export function readLivenessRecords(fs: FsPort, cwd: string): LivenessRecord[] {
  const dir = telemetryDir(cwd);
  let names: string[];
  try {
    names = fs.readdir(dir);
  } catch {
    return [];
  }
  const out: LivenessRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(LIVENESS_SUFFIX)) continue;
    const record = parseLivenessRecord(fs.readText(posixJoin(dir, name)));
    if (record !== null) out.push(record);
  }
  return out;
}

/** One session whose capture lane has stopped consuming its window. */
export interface StalledSession {
  session: string;
  harness: string;
  /** The frozen watermark and the source extent that ran away from it. */
  cursor: number | null;
  position: number | null;
  consecutive_uncaptured: number;
  last_outcome: CaptureOutcome;
  last_command: string;
  last_attempt_at: string;
  last_error_kind?: string;
}

/**
 * A lane that went quiet holding more unconsumed source than it ever captured.
 * Distinct from a stall: every individual attempt may have looked perfectly
 * healthy ("nothing new since last time"), and the source only reached its full
 * length after the last harness command of the session had already run.
 */
export interface ResidueSession {
  session: string;
  harness: string;
  /** Where the watermark stopped, and how far the source has since been measured to run. */
  cursor: number;
  extent: number;
  /** `extent - cursor` — source units captured by nobody. */
  residue: number;
  last_attempt_at: string;
  idle_hours: number;
}

/**
 * How long a lane must be idle before unconsumed residue is called a loss rather
 * than work-in-flight. A live agent is ALWAYS a few lines ahead of its last
 * capture — that is the normal steady state, not a defect. Six hours is far past
 * any plausible pause inside one working session, so a lane still holding
 * residue at that point is not going to consume it: the session is over.
 */
export const LIVENESS_RESIDUE_IDLE_MS = 6 * 60 * 60 * 1000;

/**
 * Residue floor. A session that only ever consumed a line or two is too small to
 * distinguish a loss from a normal end-of-session tail (the closing turns after
 * the final harness command are ALWAYS unconsumed), so the ratio rule below gets
 * a floor rather than firing on a 3-line tail.
 */
export const LIVENESS_RESIDUE_MIN_LINES = 10;

/**
 * True when a quiet lane left behind MORE than it ever consumed. Ratio-based on
 * purpose: an absolute line threshold would be either noisy for short sessions
 * or blind for long ones, whereas "the part nobody captured is bigger than the
 * part that was" scales with the session and is exactly the 1a501a09 shape
 * (2 consumed, 54 abandoned — a ~27× under-count).
 */
export function isResidueLoss(cursor: number, extent: number): boolean {
  const residue = extent - cursor;
  return residue >= LIVENESS_RESIDUE_MIN_LINES && residue > cursor;
}

/** The detector's verdict over a repo's recorded lanes. */
export interface LivenessVerdict {
  /** Lanes at or past {@link LIVENESS_STALL_THRESHOLD} consecutive un-captured attempts. */
  stalled: StalledSession[];
  /** Quiet lanes still holding more unconsumed source than they ever captured. */
  residue: ResidueSession[];
  /** Lifetime anomalous attempts across every recorded lane (visible even below the threshold). */
  anomalies: number;
  /** How many lanes have a marker at all. */
  sessions: number;
}

/** Non-empty line count of a source file, or `null` when it cannot be read. */
export function sourceExtent(fs: FsPort, path: string): number | null {
  const text = fs.readText(path);
  if (text === null) return null;
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

/**
 * The detector (PURE). Fires for a lane whose consecutive un-captured attempts
 * reached the threshold, and — separately — for a lane that has gone quiet while
 * still holding more unconsumed source than it ever captured.
 *
 * `measure` re-reads a recorded source's extent; it is injected so the detector
 * stays pure and so a caller with no filesystem (or no interest) can pass a
 * function returning `null` and get the stall check alone.
 *
 * Quiet by construction for every healthy shape:
 * - a fresh session's first capture → `captured`, counter 0;
 * - a zero-harness or kill-switched run → never eligible, so no marker exists;
 * - an idle poll with no new transcript → `no-window`, neutral and unpersisted;
 * - an adapter with no position sense → `position-unsupported`, neutral;
 * - a recovered lane (an anomaly, then a capture) → counter reset to 0, with the
 *   history still visible in `anomalies`;
 * - a LIVE lane a few lines ahead of its watermark → below the idle threshold,
 *   so normal in-flight lag is never called a loss.
 */
export function evaluateCaptureLiveness(
  records: readonly LivenessRecord[],
  measure: (path: string) => number | null = () => null,
  nowIso?: string,
): LivenessVerdict {
  const stalled: StalledSession[] = [];
  const residue: ResidueSession[] = [];
  const now = nowIso === undefined ? Number.NaN : Date.parse(nowIso);
  let anomalies = 0;
  for (const record of records) {
    anomalies += record.anomalies;
    if (record.consecutive_uncaptured >= LIVENESS_STALL_THRESHOLD) {
      const entry: StalledSession = {
        session: record.session,
        harness: record.harness,
        cursor: record.cursor,
        position: record.position,
        consecutive_uncaptured: record.consecutive_uncaptured,
        last_outcome: record.last_outcome,
        last_command: record.last_command,
        last_attempt_at: record.last_attempt_at,
      };
      if (record.last_error_kind !== undefined) entry.last_error_kind = record.last_error_kind;
      stalled.push(entry);
      continue; // already reported as a stall — one lane, one verdict
    }
    if (record.source === undefined || record.cursor === null) continue;
    const idleMs = now - Date.parse(record.last_attempt_at);
    if (!Number.isFinite(idleMs) || idleMs < LIVENESS_RESIDUE_IDLE_MS) continue;
    const extent = measure(record.source);
    if (extent === null || !isResidueLoss(record.cursor, extent)) continue;
    residue.push({
      session: record.session,
      harness: record.harness,
      cursor: record.cursor,
      extent,
      residue: extent - record.cursor,
      last_attempt_at: record.last_attempt_at,
      idle_hours: Math.floor(idleMs / (60 * 60 * 1000)),
    });
  }
  return { stalled, residue, anomalies, sessions: records.length };
}
