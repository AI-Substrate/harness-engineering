import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import type { GitAttributionPort } from '../../../adapters/git/git-attribution-port.js';
import type { SocketRelayPort } from '../../../adapters/net/socket-probe-port.js';
import type { ProcessPort } from '../../../adapters/process/process-port.js';
import {
  TRACE2_BUFFER_DIR,
  TRACE2_BUFFER_FILE,
  TRACE2_SHAS_SUFFIX,
} from '../../commit/commit-service.js';
import { posixJoin, toPosix } from '../../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../../shared/temp.js';
import type { IngressReading } from './ingress.js';

/**
 * `harness doctor telemetry-nudge` (plan 074 · ac-0006) — best-effort recovery
 * of buffered trace2 events.
 *
 * The mechanism is proven: `GIT_TRACE2_EVENT=<file>` buffers git's events, and
 * replaying that file's bytes into the collector's `af_unix` socket produces a
 * full, correct authorship note the daemon cannot distinguish from live traffic
 * (dossier F-07, and re-confirmed by this plan's own tk-000b spike against a
 * live daemon: 3/3 buffered commits recovered).
 *
 * ## The segment lifecycle, and why each step is shaped this way
 *
 * 1. **ROTATE FIRST.** The live buffer is `rename`d to a timestamped segment
 *    before a single byte is read. This is not tidiness — it is the only way an
 *    appender can never race a truncation. The prototype truncated after a
 *    successful flush, which loses any event a concurrent `git` wrote during the
 *    replay. A rename is atomic; a concurrent `git` holding the old handle keeps
 *    writing to the (now-detached) inode, and a new `git` creates a fresh buffer.
 * 2. **REPLAY THE WHOLE SEGMENT.** Not a filtered subset: the daemon reconstructs
 *    state from the event stream, so a partial replay is a corrupted story.
 * 3. **DELETE ONLY ON FULL CONFIRMATION.** The segment is removed only when
 *    EVERY commit sha named in its events now carries a `refs/notes/ai` note. A
 *    partially-confirmed segment is RETAINED INTACT — never rewritten to drop
 *    the confirmed part, because rewriting would destroy exactly the event
 *    context the unconfirmed commits need on a later retry.
 * 4. **NO AUTOMATIC RE-REPLAY IN v1.** A retained segment is LISTED with an
 *    explicit retry instruction and left alone. The tk-000b spike did establish
 *    that duplicate replay is idempotent against a live daemon (notes came back
 *    byte-identical, the notes ref did not grow), but that is one observation on
 *    one daemon in one session — not enough to make an automatic, unattended
 *    re-replay loop safe across daemon restarts and multi-repo interleaving
 *    (U-3). v1 ships the conservative behaviour ac-0006 specifies; the spike
 *    result is what a future plan would build the automatic retry on.
 *
 * It NEVER fails the doctor run, and every no-op path (no buffer, no socket, a
 * non-`af_unix` target) is a graceful, honest report rather than an error.
 */

/** Timestamped segment name — sortable, and collision-safe within a second. */
export function segmentName(nowIso: string, salt: string): string {
  return `segment-${nowIso.replace(/[:.]/g, '-')}-${salt}.jsonl`;
}

/**
 * Commit shas a buffered segment is expected to cover.
 *
 * TWO sources, unioned, and the first is the one that actually carries the load:
 *
 * 1. The SIDECAR `harness commit` writes. git's trace2 stream contains **no
 *    commit sha** — verified against a live daemon — because the events are
 *    emitted while the commit is still being made and git-ai's daemon derives
 *    the sha itself. Scanning the payload alone would therefore find nothing,
 *    and "every named sha carries a note" would be vacuously true on every
 *    segment: a delete that confirmed nothing.
 * 2. A permissive scan of the payload, kept as a belt. If a future git or a
 *    different producer ever does name shas, they are used; a false positive
 *    costs one cheap note lookup, whereas a schema parser that drifted would
 *    cost a silently-deleted segment.
 */
export function commitShasIn(payload: string, sidecar?: string | null): string[] {
  const found = new Set<string>();
  for (const line of (sidecar ?? '').split('\n')) {
    const sha = line.trim();
    if (/^[0-9a-f]{40}$/.test(sha)) found.add(sha);
  }
  for (const match of payload.matchAll(/\b[0-9a-f]{40}\b/g)) {
    found.add(match[0]);
  }
  return [...found];
}

/** Why a nudge did nothing. Each is a legitimate, reportable state — never an error. */
export type NudgeSkipReason =
  | 'no-buffer'
  | 'empty-buffer'
  | 'no-socket'
  | 'non-af-unix'
  | 'relay-failed'
  | 'unconfirmable';

export interface RetainedSegment {
  path: string;
  /** Shas from this segment that still carry no note. */
  stillMissing: string[];
  /** Shas from this segment now confirmed. */
  recovered: string[];
  /** Why it was kept: partly confirmed, unconfirmable, or the replay itself failed. */
  reason: 'partial' | 'unconfirmable' | 'relay-failed';
}

export interface NudgeOutcome {
  status: 'replayed' | 'retained' | 'skipped';
  reason?: NudgeSkipReason;
  /** The segment the live buffer was rotated into, when rotation happened. */
  segment: string | null;
  bytes: number;
  /** Shas that now carry a note and did not before. */
  recovered: string[];
  /** Shas named in the segment that still carry no note. */
  stillMissing: string[];
  /** Segments kept intact because they were only partly confirmed. */
  retained: RetainedSegment[];
  detail: string;
  next_action?: string;
}

export interface NudgeDeps {
  fs: Pick<FsPort, 'exists' | 'readText' | 'writeText' | 'mkdirp' | 'rename' | 'deleteFile'>;
  proc: Pick<ProcessPort, 'cwd'>;
  clock: Pick<Clock, 'nowIso'>;
  relay: SocketRelayPort;
  git: Pick<GitAttributionPort, 'hasAiNote'>;
  ingress: IngressReading;
  /** Override the buffer path (the `file`-target branch of ac-0005 uses this). */
  bufferPath?: string;
  /** Disambiguates two segments rotated inside the same clock tick. */
  salt?: string;
  /** Bounded, injectable wait — a test drives the settle loop with no wall clock. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to let git-ai's ASYNCHRONOUS note write settle before judging. */
  confirmTimeoutMs?: number;
}

/**
 * git-ai writes its notes ASYNCHRONOUSLY: the daemon accepts the replayed
 * stream, then does the work. Judging confirmation the instant `send` resolves
 * therefore races it — observed live, where a commit reported `stillMissing`
 * and its note appeared about two seconds later, needlessly retaining a segment
 * that had in fact been fully recovered.
 *
 * So the nudge settles the same way `harness commit`'s verify does: poll, bounded,
 * and resolve the moment every sha confirms.
 */
export const CONFIRM_TIMEOUT_MS = 8_000;
export const CONFIRM_POLL_MS = 250;

/** Poll until every sha carries a note, or the budget runs out. Returns those still missing. */
async function settleNotes(deps: NudgeDeps, shas: readonly string[]): Promise<string[]> {
  const budget = deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  let missing = shas.filter((sha) => !deps.git.hasAiNote(sha));
  while (missing.length > 0 && waited < budget) {
    await sleep(CONFIRM_POLL_MS);
    waited += CONFIRM_POLL_MS;
    missing = missing.filter((sha) => !deps.git.hasAiNote(sha));
  }
  return missing;
}

function defaultBuffer(deps: NudgeDeps): string {
  const cwd = toPosix(deps.proc.cwd());
  return posixJoin(cwd, HARNESS_DIR, TEMP_DIR, TRACE2_BUFFER_DIR, TRACE2_BUFFER_FILE);
}

function skip(reason: NudgeSkipReason, detail: string, next_action?: string): NudgeOutcome {
  return {
    status: 'skipped',
    reason,
    segment: null,
    bytes: 0,
    recovered: [],
    stillMissing: [],
    retained: [],
    detail,
    ...(next_action !== undefined && { next_action }),
  };
}

/**
 * Rotate, replay, confirm. Never throws, never fails the host command.
 */
export async function telemetryNudge(deps: NudgeDeps): Promise<NudgeOutcome> {
  // ---- the graceful no-ops, checked BEFORE anything is moved ---------------
  if (deps.ingress.target.kind === 'unconfigured') {
    return skip(
      'non-af-unix',
      'no trace2 target is configured, so there is no collector ingress to replay into — nothing was moved or sent.',
      'Install the collector with `harness doctor --install-collector`, then re-run this verb.',
    );
  }
  if (deps.ingress.target.kind !== 'af_unix') {
    return skip(
      'non-af-unix',
      `the configured trace2 target is a plain file (${deps.ingress.target.path}), not an af_unix socket — there is no ingress to replay into. Nothing was moved or sent.`,
      'Point `trace2.eventTarget` at the git-ai socket (`harness doctor --install-collector`), then re-run this verb with `--buffer` naming the file to drain.',
    );
  }
  const socket = deps.ingress.target.path;
  if (deps.ingress.outcome !== 'connected') {
    return skip(
      'no-socket',
      `the collector ingress at ${socket} is not reachable from here (probe: ${deps.ingress.outcome ?? 'not probed'}) — replaying now would lose the buffer for nothing, so NOTHING was moved or sent.`,
      'Re-run this verb from an UNSANDBOXED shell (and check the git-ai daemon is running with `harness doctor`). The buffer is intact and waiting.',
    );
  }

  const buffer = deps.bufferPath ?? defaultBuffer(deps);
  if (!deps.fs.exists(buffer)) {
    return skip(
      'no-buffer',
      `no buffered trace2 events at ${buffer} — nothing to replay. This is the healthy shape when every commit reached the collector directly.`,
    );
  }
  const payload = deps.fs.readText(buffer);
  if (payload === null || payload.trim() === '') {
    return skip('empty-buffer', `the buffer at ${buffer} is empty — nothing to replay.`);
  }

  // ---- ROTATE FIRST: appenders can never race a truncation ----------------
  const segment = posixJoin(
    buffer.slice(0, buffer.lastIndexOf('/')),
    segmentName(deps.clock.nowIso(), deps.salt ?? 'a'),
  );
  const bufferSidecar = `${buffer}${TRACE2_SHAS_SUFFIX}`;
  const sidecarText = deps.fs.exists(bufferSidecar) ? deps.fs.readText(bufferSidecar) : null;
  deps.fs.rename(buffer, segment);
  // The sidecar travels WITH its segment. Leaving it on the live buffer would
  // attribute this segment's commits to the next one.
  const segmentSidecar = `${segment}${TRACE2_SHAS_SUFFIX}`;
  if (sidecarText !== null) deps.fs.rename(bufferSidecar, segmentSidecar);

  const shas = commitShasIn(payload, sidecarText);
  // Only shas that were MISSING before the replay can be "recovered" by it.
  const before = shas.filter((sha) => !deps.git.hasAiNote(sha));

  const sent = await deps.relay.send(socket, payload);
  if (!sent.ok) {
    // The segment stays exactly where it is. A failed send must never cost the
    // buffer — that is the whole reason rotation precedes deletion.
    return {
      status: 'retained',
      reason: 'relay-failed',
      segment,
      bytes: 0,
      recovered: [],
      stillMissing: before,
      retained: [{ path: segment, stillMissing: before, recovered: [], reason: 'relay-failed' }],
      detail: `the replay into ${socket} failed (${sent.outcome}). The rotated segment is RETAINED INTACT at ${segment} — nothing was lost.`,
      next_action: `Fix the ingress (see \`harness doctor\`), then re-run \`harness doctor telemetry-nudge --buffer ${segment}\` to retry this segment.`,
    };
  }

  if (shas.length === 0) {
    // The replay was ACCEPTED, but nothing about it can be confirmed: no commit
    // was recorded for this buffer (it was not produced by `harness commit`, so
    // no sidecar exists, and git's own events name no sha). Deleting here would
    // be a delete on a vacuous confirmation — "every named sha has a note" is
    // trivially true of an empty set, which is exactly the confident wrong
    // answer this plan exists to kill. So it is kept, and said plainly.
    return {
      status: 'retained',
      reason: 'unconfirmable',
      segment,
      bytes: sent.bytes,
      recovered: [],
      stillMissing: [],
      retained: [{ path: segment, stillMissing: [], recovered: [], reason: 'unconfirmable' }],
      detail: `replayed ${sent.bytes} bytes into ${socket}, but delivery could NOT be confirmed: this buffer records no commit sha (git's trace2 events never name one, and no \`harness commit\` sidecar was found beside it). The segment is RETAINED INTACT at ${segment} rather than deleted on an unprovable claim.`,
      next_action: `Check \`harness doctor\`'s attribution-at-risk row to see whether the commits gained notes; delete ${segment} yourself once you are satisfied. Commits made through \`harness commit\` record their sha and confirm automatically.`,
    };
  }

  const stillMissing = await settleNotes(deps, before);
  const recovered = before.filter((sha) => !stillMissing.includes(sha));

  if (stillMissing.length === 0) {
    // FULLY confirmed: every commit this segment named now carries a note.
    deps.fs.deleteFile(segment);
    if (sidecarText !== null) deps.fs.deleteFile(segmentSidecar);
    return {
      status: 'replayed',
      segment,
      bytes: sent.bytes,
      recovered,
      stillMissing: [],
      retained: [],
      detail:
        before.length === 0
          ? `replayed ${sent.bytes} bytes into ${socket}. All ${shas.length} commit(s) this segment names already carried a refs/notes/ai entry, so it was deleted.`
          : `replayed ${sent.bytes} bytes into ${socket} and CONFIRMED all ${recovered.length} commit(s) it named now carry a refs/notes/ai entry — the segment was deleted.`,
    };
  }

  // PARTIAL: keep the segment whole. Never rewrite it to drop the confirmed
  // part — the unconfirmed commits need that event context on a retry.
  return {
    status: 'retained',
    segment,
    bytes: sent.bytes,
    recovered,
    stillMissing,
    retained: [{ path: segment, stillMissing, recovered, reason: 'partial' }],
    detail: `replayed ${sent.bytes} bytes into ${socket}: ${recovered.length} commit(s) recovered, ${stillMissing.length} still missing a note. The segment is RETAINED INTACT at ${segment} (it is never partially rewritten), and v1 does NOT automatically re-replay it.`,
    next_action: `Re-run \`harness doctor telemetry-nudge --buffer ${segment}\` to retry this segment explicitly. Commits made before git-ai was installed will never gain a note and will stay listed here.`,
  };
}
