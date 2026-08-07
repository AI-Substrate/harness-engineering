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
import {
  isWithin,
  posixDirname,
  posixJoin,
  posixNormalize,
  resolveInRepo,
  toPosix,
} from '../../shared/posix-path.js';
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
 *    EVERY commit sha its SIDECAR names now carries a `refs/notes/ai` note.
 *    Identity comes from the sidecar and nowhere else — never from scanning the
 *    payload, which carries git's own argv and would let a `Revert <sha>` commit
 *    message enrol an unrelated historical commit in the confirmation set. A
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
 * 5. **EVERY RUN ENUMERATES.** Nothing carries state between invocations, so the
 *    buffer directory IS the state: each run lists `segment-*.jsonl` and reports
 *    every one still on disk with a retry pointer. A run that leaves any segment
 *    behind is `retained`, never `replayed` and never a healthy `skipped`.
 *
 * It NEVER fails the doctor run, and every no-op path (no buffer, no socket, a
 * non-`af_unix` target) is a graceful, honest report rather than an error.
 */

/** Timestamped segment name — sortable, and collision-safe within a second. */
export function segmentName(nowIso: string, salt: string): string {
  return `segment-${nowIso.replace(/[:.]/g, '-')}-${salt}.jsonl`;
}

/**
 * Commit shas a buffered segment is expected to cover — read from the SIDECAR,
 * and from nothing else.
 *
 * git's trace2 stream contains **no commit sha** — verified against a live
 * daemon — because the events are emitted while the commit is still being made
 * and git-ai's daemon derives the sha itself. So `harness commit` writes the sha
 * down beside the buffer, and that file is the SOLE identity source.
 *
 * An earlier draft also scanned the payload for any 40-hex token "as a belt".
 * That was wrong, and the review caught it: the trace2 `start` event carries
 * git's own ARGV, so `git commit -m "Revert <sha>"` (or a cherry-pick, or a
 * message quoting a hash) injects the sha of an UNRELATED historical commit into
 * the confirmation set. If that older commit has no AI note — and pre-git-ai
 * commits never will — the segment can never fully confirm, so it is retained
 * forever and an innocent commit is reported as missing attribution. A scan over
 * attacker-or-author-controlled text cannot establish identity, so it does not
 * get a vote. A segment with no sidecar is `unconfirmable`, and that is an
 * honest, reportable state — never a guess.
 */
export function commitShasIn(sidecar: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const line of (sidecar ?? '').split('\n')) {
    const sha = line.trim();
    if (/^[0-9a-f]{40}$/.test(sha)) found.add(sha);
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
  | 'unconfirmable'
  | 'buffer-refused'
  | 'fs-error';

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
  /** Shas this run's segment named that still carry no note. `retained[]` carries the rest. */
  stillMissing: string[];
  /**
   * EVERY buffered segment still on disk when the run finished — this run's, plus
   * any left by an earlier one. Enumerated from the buffer directory rather than
   * remembered, because nothing carries state between invocations.
   */
  retained: RetainedSegment[];
  detail: string;
  next_action?: string;
}

export interface NudgeDeps {
  fs: Pick<
    FsPort,
    'exists' | 'readText' | 'writeText' | 'mkdirp' | 'rename' | 'deleteFile' | 'readdir'
  >;
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

/** A rotated segment: `segment-<iso>-<salt>.jsonl`, beside the buffer it came from. */
export const SEGMENT_PREFIX = 'segment-';
export const SEGMENT_SUFFIX = '.jsonl';

function isSegmentName(name: string): boolean {
  return name.startsWith(SEGMENT_PREFIX) && name.endsWith(SEGMENT_SUFFIX);
}

/**
 * Resolve `--buffer` and CONTAIN it. Two jobs, both caught by the review:
 *
 * 1. **Resolve.** A relative `--buffer buffer.jsonl` used to be taken verbatim,
 *    and the segment path was then built by slicing at the last `/` — which for
 *    a bare filename is index `-1`, producing the nonsense sibling `buffer.json`
 *    and a `rename` that throws out of a verb whose whole contract is never to.
 * 2. **Contain.** This verb RENAMES and can DELETE the path it is handed, so an
 *    arbitrary absolute path is a real hazard. Two roots are legitimate, and
 *    nothing else is: anywhere under the repo (where `harness commit` writes its
 *    own buffer and segments), and the directory of the trace2 FILE target the
 *    operator themselves configured git to write into — which is exactly the
 *    ac-0005 file branch's drain, and its retained segments.
 */
type BufferResolution = { ok: true; path: string } | { ok: false; detail: string };

function resolveBuffer(deps: NudgeDeps): BufferResolution {
  if (deps.bufferPath === undefined) return { ok: true, path: defaultBuffer(deps) };
  const cwd = toPosix(deps.proc.cwd());
  const resolved = posixNormalize(resolveInRepo(deps.bufferPath, cwd));
  if (isWithin(cwd, resolved)) return { ok: true, path: resolved };
  const target = deps.ingress.target;
  if (target.kind === 'file' && isWithin(posixDirname(toPosix(target.path)), resolved)) {
    return { ok: true, path: resolved };
  }
  return {
    ok: false,
    detail: `refusing to drain ${resolved}: it is neither inside this repository (${cwd}) nor beside the configured trace2 file target. This verb RENAMES and can DELETE the file it is given, so it only ever touches paths the harness or your own git config named. Nothing was moved or sent.`,
  };
}

/** What a segment on disk still owes, read from its sidecar. Pure reads — never mutates. */
function inspectSegment(deps: NudgeDeps, path: string): RetainedSegment {
  const shas = commitShasIn(deps.fs.readText(`${path}${TRACE2_SHAS_SUFFIX}`));
  if (shas.length === 0) {
    return { path, stillMissing: [], recovered: [], reason: 'unconfirmable' };
  }
  const stillMissing = shas.filter((sha) => !deps.git.hasAiNote(sha));
  return {
    path,
    stillMissing,
    recovered: shas.filter((sha) => !stillMissing.includes(sha)),
    reason: 'partial',
  };
}

/**
 * EVERY segment still beside the buffer, not just this run's.
 *
 * The review's F002: a segment retained by an earlier invocation was invisible
 * to every later one, because the only `retained` value was the segment the
 * current run had just rotated. A later nudge with no live buffer therefore
 * reported `no-buffer` and called that "the healthy shape" while unrecovered
 * commits sat in a file two directories away. Nothing carries state between
 * invocations, so the directory listing IS the state.
 */
function enumerateSegments(deps: NudgeDeps, buffer: string): RetainedSegment[] {
  const dir = posixDirname(buffer);
  return deps.fs
    .readdir(dir)
    .filter(isSegmentName)
    .sort()
    .map((name) => inspectSegment(deps, posixJoin(dir, name)));
}

/**
 * Fold every remaining segment into the outcome. A run that leaves ANY segment
 * on disk is `retained`, never `replayed` and never a healthy `skipped` — the
 * status is a claim about the machine's state, not about this invocation's luck.
 */
function withRemainingSegments(outcome: NudgeOutcome, remaining: RetainedSegment[]): NudgeOutcome {
  if (remaining.length === 0) return outcome;
  const known = new Map(remaining.map((r) => [r.path, r]));
  // This run's own findings are richer (they know the replay happened), so they win.
  for (const own of outcome.retained) known.set(own.path, own);
  const merged = [...known.values()].sort((a, b) => a.path.localeCompare(b.path));
  const others = merged.filter((r) => r.path !== outcome.segment);
  const retry = merged[0]?.path;
  return {
    ...outcome,
    status: 'retained',
    retained: merged,
    detail:
      others.length === 0
        ? outcome.detail
        : `${outcome.detail} ${others.length} earlier segment(s) are ALSO still on disk and unrecovered: ${others.map((r) => r.path).join(', ')}.`,
    ...(retry !== undefined && {
      next_action: `Re-run \`harness doctor telemetry-nudge --buffer ${retry}\` (repeat for each remaining segment) from a shell that can reach the collector socket. Segments with no \`harness commit\` sidecar can never be confirmed automatically — delete those yourself once \`harness doctor\`'s attribution-at-risk row is clean.`,
    }),
  };
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

/** Never let a filesystem surprise escape a verb whose contract is to always report. */
function fsMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Rotate, replay, confirm — then report every segment still on disk.
 *
 * Never throws, never fails the host command: a filesystem error is one more
 * honest reading, not an exception out of a recovery verb.
 */
export async function telemetryNudge(deps: NudgeDeps): Promise<NudgeOutcome> {
  const resolution = resolveBuffer(deps);
  if (!resolution.ok) {
    return skip(
      'buffer-refused',
      resolution.detail,
      'Pass a `--buffer` path inside this repository, or beside your configured `trace2.eventTarget` file.',
    );
  }
  const buffer = resolution.path;
  let outcome: NudgeOutcome;
  try {
    outcome = await runNudge(deps, buffer);
  } catch (err) {
    outcome = skip(
      'fs-error',
      `the nudge could not complete: ${fsMessage(err)}. Any rotated segment is still on disk — nothing is deleted except on a full confirmation.`,
      'Check the permissions on the harness trace2 buffer directory, then re-run this verb.',
    );
  }
  try {
    return withRemainingSegments(outcome, enumerateSegments(deps, buffer));
  } catch {
    // The enumeration is a REPORT enhancement; it must never cost the outcome.
    return outcome;
  }
}

async function runNudge(deps: NudgeDeps, buffer: string): Promise<NudgeOutcome> {
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
      `the configured trace2 target is a plain file (${deps.ingress.target.path}), not an af_unix socket — there is no ingress to replay into, and this verb cannot invent one. Nothing was moved or sent.`,
      `FIRST point \`trace2.eventTarget\` back at the git-ai socket (\`harness doctor --install-collector\`) — until then there is nowhere to replay to — THEN re-run \`harness doctor telemetry-nudge --buffer ${deps.ingress.target.path}\` to drain the file.`,
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
    posixDirname(buffer),
    segmentName(deps.clock.nowIso(), deps.salt ?? 'a'),
  );
  const bufferSidecar = `${buffer}${TRACE2_SHAS_SUFFIX}`;
  const sidecarText = deps.fs.exists(bufferSidecar) ? deps.fs.readText(bufferSidecar) : null;
  try {
    deps.fs.rename(buffer, segment);
  } catch (err) {
    return skip(
      'fs-error',
      `could not rotate ${buffer} to ${segment} (${fsMessage(err)}) — NOTHING was moved or sent, and the buffer is intact.`,
      'Check the permissions on that directory, then re-run this verb.',
    );
  }
  // The sidecar travels WITH its segment. Leaving it on the live buffer would
  // attribute this segment's commits to the next one. A failure here is not
  // fatal — the shas are already in memory for this run's confirmation — but the
  // segment then has no sidecar of its own, so a LATER run reads it as
  // unconfirmable rather than silently mis-attributing it.
  const segmentSidecar = `${segment}${TRACE2_SHAS_SUFFIX}`;
  let sidecarMoved = false;
  if (sidecarText !== null) {
    try {
      deps.fs.rename(bufferSidecar, segmentSidecar);
      sidecarMoved = true;
    } catch {
      sidecarMoved = false;
    }
  }

  const shas = commitShasIn(sidecarText);
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
    // FULLY confirmed: every commit this segment named now carries a note. A
    // delete that fails is not an error — the enumeration pass will find the
    // survivor and report it, which is strictly more honest than throwing.
    try {
      deps.fs.deleteFile(segment);
      if (sidecarMoved) deps.fs.deleteFile(segmentSidecar);
    } catch {
      /* reported by the enumeration pass */
    }
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
