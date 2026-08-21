import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitAttributionPort } from '../../adapters/git/git-attribution-port.js';
import type { ProbeOutcome } from '../../adapters/net/socket-probe-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import type { IngressReading } from '../doctor/collector/ingress.js';
import { trace2Policy } from '../doctor/collector/ingress.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';

/**
 * `harness commit` (plan 074 · ac-0005) — the commit path that cannot silently
 * lose attribution.
 *
 * The problem it solves, in one line: an agent's natural `git add … && git
 * commit -m …` is a COMPOUND command, compound commands fall into the sandbox,
 * the sandbox denies the trace2 socket connect, git silently disables trace2,
 * and the commit lands with no authorship note — after which git-ai's recovery
 * ladder attests those lines as known-HUMAN (dossier F-02/F-03/F-04). A single
 * allowlisted entrypoint sidesteps the shape problem (F-06, proven live), and
 * doing the work INSIDE that entrypoint is what makes the rest possible.
 *
 * ## The branch partition is EXHAUSTIVE, and the exclusivity is not optional
 *
 * Every {@link ProbeOutcome}, plus `unconfigured`, lands in exactly one of four
 * branches:
 *
 * - **`connected`** → commit with NO trace2 override, then bounded verify that a
 *   `refs/notes/ai` note landed.
 * - **`file`** (target is already a plain file) → commit with NO override; the
 *   configured target is already buffering, and overriding it would only move
 *   the buffer somewhere the user did not choose.
 * - **`named_pipe`** (a live Windows ingress) → commit with NO override, no
 *   sidecar, and NO claim: attribution cannot be VERIFIED on this transport
 *   (the pipe itself is probeable since plan 082 · F006 — reachability and
 *   attribution are different questions), so this branch reports plainly that
 *   nothing was verified rather than calling a live ingress a buffer
 *   (plan 075 · ac-0005).
 * - **EVERY other outcome** (`denied` | `refused` | `absent` | `timeout` |
 *   `error:<code>` | `unconfigured`) → commit with `GIT_TRACE2_EVENT` pointed at
 *   a buffer file under the gitignored harness temp dir, and skip note-verify,
 *   because delivery is DEFERRED BY DESIGN and a missing note there is expected
 *   rather than a finding.
 *
 * The selection is made from `TRACE2_TARGET_POLICY`, so a NEW target kind cannot
 * reach any of these branches without first declaring, to the compiler, whether
 * anything is already receiving events for it.
 *
 * The connected and buffered branches are mutually exclusive because
 * `GIT_TRACE2_EVENT` **replaces** the configured socket target rather than
 * adding to it (F-08, and the correction the prototype's own comment records).
 * There is no belt-and-braces here: setting the buffer on a healthy ingress
 * would DIVERT events away from the collector, turning the fix into the bug.
 *
 * ## What it never does
 *
 * - It never rolls back. A verify miss is a warning on a commit that really
 *   happened; unmaking the user's commit to satisfy a health check would be a
 *   far worse outcome than an unattributed commit.
 * - It never blocks. A verify miss degrades the envelope and exits honestly.
 * - It never stages implicitly. Pathspecs are EXPLICIT — there is no `--all` in
 *   v1, so a stray buffer or scratch file cannot be swept into a commit. The
 *   buffer lives under `.harness/temp/`, which is gitignored, so it is
 *   unstageable by LOCATION as well as by policy.
 * - It never touches a shell. Staging and committing go through
 *   {@link GitAttributionPort}, which is `execFile` semantics — a commit message
 *   is one argument, never a fragment of a command line.
 */

/** The buffer's home: gitignored, never committed, and shared with the nudge. */
export const TRACE2_BUFFER_DIR = 'trace2';
export const TRACE2_BUFFER_FILE = 'buffer.jsonl';

/**
 * The SIDECAR that records which commits a buffer is expected to cover.
 *
 * It exists because of a fact only a live daemon run reveals: git's trace2 event
 * stream contains **no commit sha at all**. The events are emitted while the
 * commit is still being made, and git-ai's daemon derives the sha itself by
 * reading the repo after it sees the `cmd_name:commit` event. So a nudge that
 * tried to confirm delivery by scanning the buffer for shas would find none, and
 * "every commit this segment named now carries a note" would be VACUOUSLY true —
 * it would delete every segment while confirming nothing. That is exactly the
 * confident-wrong-answer shape this plan exists to kill.
 *
 * `harness commit` does know the sha — it just made the commit — so it writes it
 * down beside the buffer, and the nudge confirms against that. One sha per line.
 */
export const TRACE2_SHAS_SUFFIX = '.shas';
export const TRACE2_SHAS_FILE = `${TRACE2_BUFFER_FILE}${TRACE2_SHAS_SUFFIX}`;

/**
 * The repo-local ledger of every FILE trace2 target this harness has committed
 * into (review round 2 · direction A).
 *
 * `trace2.eventTarget` is read from GLOBAL config only, so a `file` target is a
 * MACHINE-GLOBAL absolute path outside the repository. The nudge's containment
 * guard — correctly — refuses to rename or delete an arbitrary path handed to
 * `--buffer`. But the recovery `harness commit` prescribes is "reconfigure to
 * the socket FIRST, then drain the old file", and the instant the reconfigure
 * lands the live target is no longer that file, so containment refused the very
 * path it had just told the operator to drain. The advice was unexecutable.
 *
 * The fix is not to widen the guard to "any absolute path" — that would give the
 * guard away. It is to authorize by RECORD: the harness writes down the target
 * it buffered into, and the nudge later trusts THAT because the harness itself
 * wrote it, not because a caller asked nicely. One absolute POSIX path per line.
 */
export const TRACE2_TARGETS_FILE = 'known-targets';

/** The gitignored directory the buffer, its sidecar, and the target ledger share. */
export function trace2Dir(cwd: string): string {
  return posixJoin(toPosix(cwd), HARNESS_DIR, TEMP_DIR, TRACE2_BUFFER_DIR);
}

/** Where {@link TRACE2_TARGETS_FILE} lives for a repo rooted at `cwd`. */
export function knownTargetsPath(cwd: string): string {
  return posixJoin(trace2Dir(cwd), TRACE2_TARGETS_FILE);
}

/**
 * The environment variable that REPLACES git's configured trace2 target.
 *
 * Named once, here, because "replaces" is the entire reason ac-0005's branches
 * are mutually exclusive: setting this on a healthy ingress would DIVERT events
 * away from the collector rather than duplicate them.
 */
export const TRACE2_EVENT_ENV = 'GIT_TRACE2_EVENT';

/** How long to wait for git-ai's ASYNCHRONOUS note write before judging it missing. */
export const VERIFY_TIMEOUT_MS = 5_000;
export const VERIFY_POLL_MS = 250;

/** Which of the four ac-0005 branches ran. Reported, so the choice is never implicit. */
export type CommitMode =
  | 'direct-verified'
  | 'file-buffered'
  | 'harness-buffered'
  /**
   * The target is a LIVE ingress the harness cannot VERIFY attribution against —
   * today, a Windows named pipe (plan 075 · ac-0005). The pipe is reachable and
   * probeable (plan 082 · F006); what is unavailable is the evidence that a note
   * landed, because nobody has established how the collector behaves on this
   * transport. The commit is made with NO trace2 override, because overriding
   * would DIVERT events away from a collector that may well be receiving them;
   * and nothing is claimed about attribution afterwards, because nothing was
   * measured.
   */
  | 'ingress-unverified';

/** Did attribution land? `skipped` is the buffered branch, where a miss is by design. */
export type VerifyResult = 'landed' | 'missing' | 'skipped';

export interface CommitOutcome {
  ok: boolean;
  mode: CommitMode;
  /** The probe outcome that selected the branch. `null` for a non-socket target. */
  probe: ProbeOutcome | null;
  sha: string | null;
  /**
   * The commit SUCCEEDED but its sha could not be read back (`rev-parse HEAD`
   * failed). A separate flag and not `sha === null`, because that value also
   * means "nothing was staged, no commit made" — and conflating a commit that
   * happened with one that did not is precisely the failure mode this whole plan
   * exists to eliminate.
   */
  shaUnknown: boolean;
  staged: string[];
  verify: VerifyResult;
  /** The buffer file trace2 was pointed at, when a branch used one. */
  buffer: string | null;
  detail: string;
  next_action?: string;
  /** Exit code from git, verbatim when the commit itself failed. */
  gitCode: number;
}

export interface CommitDeps {
  git: GitAttributionPort;
  ingress: IngressReading;
  fs: Pick<FsPort, 'exists' | 'mkdirp' | 'writeText' | 'readText'>;
  proc: Pick<ProcessPort, 'cwd'>;
  clock: Pick<Clock, 'nowIso'>;
  /** Bounded, injectable wait — a test drives the verify loop with no wall clock. */
  sleep?: (ms: number) => Promise<void>;
  verifyTimeoutMs?: number;
}

/** Ensure the gitignored buffer directory exists and hand back the buffer path. */
function bufferPath(deps: CommitDeps): string {
  return posixJoin(ensureTrace2Dir(deps), TRACE2_BUFFER_FILE);
}

/** Create the gitignored trace2 directory on first use and hand back its path. */
function ensureTrace2Dir(deps: CommitDeps): string {
  const dir = trace2Dir(deps.proc.cwd());
  if (!deps.fs.exists(dir)) deps.fs.mkdirp(dir);
  // Self-gitignore on first use, exactly as the shared temp guarantee does: the
  // buffer must be uncommittable even in a repo that never added the root rule.
  const ignore = posixJoin(dir, '.gitignore');
  if (!deps.fs.exists(ignore)) {
    deps.fs.writeText(ignore, '# Buffered trace2 events — never committed.\n*\n');
  }
  return dir;
}

/**
 * Write down a FILE trace2 target this repository buffered into, so the nudge
 * can still authorize draining it AFTER the prescribed reconfigure to `af_unix`
 * has taken that path out of the live git config.
 *
 * Repo-local and gitignored: the record is this repository's own statement about
 * a path it actually used, never a shared or user-supplied list.
 */
function recordFileTarget(deps: CommitDeps, target: string): void {
  ensureTrace2Dir(deps);
  const path = knownTargetsPath(deps.proc.cwd());
  const existing = deps.fs.readText(path) ?? '';
  const normalized = toPosix(target);
  if (existing.split('\n').includes(normalized)) return;
  deps.fs.writeText(
    path,
    `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${normalized}\n`,
  );
}

/**
 * Append `sha` to the buffer's sidecar, TAGGED WITH THIS REPOSITORY'S IDENTITY.
 *
 * APPEND, because one buffer legitimately accumulates several commits before
 * anyone runs the nudge — and, for a `file` target, commits from several
 * REPOSITORIES, because that target is machine-global. That is the round 2
 * regression: an untagged sidecar let every repo try to confirm every sha
 * against its own `refs/notes/ai`, so another repository's commits could never
 * resolve there, the segment was retained forever, and unrelated commits were
 * reported as unattributed. The line format is `<sha> <git-common-dir>`; a bare
 * sha is a pre-identity entry, read by LOCATION instead (see the nudge).
 */
function recordBufferedSha(deps: CommitDeps, buffer: string, sha: string): void {
  const sidecar = `${buffer}${TRACE2_SHAS_SUFFIX}`;
  const repo = deps.git.gitCommonDir();
  const line = repo === null ? sha : `${sha} ${toPosix(repo)}`;
  const existing = deps.fs.readText(sidecar) ?? '';
  if (existing.split('\n').includes(line)) return;
  deps.fs.writeText(
    sidecar,
    `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${line}\n`,
  );
}

/**
 * Poll for the note git-ai writes ASYNCHRONOUSLY. Bounded — a commit must never
 * hang on a health check — and a miss is reported, never escalated.
 */
async function verifyNote(deps: CommitDeps, sha: string): Promise<VerifyResult> {
  const budget = deps.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  for (;;) {
    if (deps.git.hasAiNote(sha)) return 'landed';
    if (waited >= budget) return 'missing';
    await sleep(VERIFY_POLL_MS);
    waited += VERIFY_POLL_MS;
  }
}

/**
 * Stage the given pathspecs and commit, choosing the branch from the ingress.
 *
 * `pathspecs` is required and explicit. An empty index after staging is a no-op
 * success, not an error — there is nothing dishonest about "nothing to commit".
 */
export async function harnessCommit(
  deps: CommitDeps,
  message: string,
  pathspecs: readonly string[],
): Promise<CommitOutcome> {
  const probe = deps.ingress.outcome;

  if (pathspecs.length > 0) {
    const staging = deps.git.stage(pathspecs);
    if (!staging.ok) {
      return {
        ok: false,
        mode: 'direct-verified',
        probe,
        sha: null,
        shaUnknown: false,
        staged: [],
        verify: 'skipped',
        buffer: null,
        gitCode: staging.code,
        detail: `staging failed (git exit ${staging.code}): ${staging.stderr}`,
        next_action: 'Fix the reported pathspec(s) and re-run `harness commit`.',
      };
    }
  }

  const staged = deps.git.stagedPaths();
  if (staged.length === 0) {
    return {
      ok: true,
      mode: 'direct-verified',
      probe,
      sha: null,
      shaUnknown: false,
      staged: [],
      verify: 'skipped',
      buffer: null,
      gitCode: 0,
      detail: 'nothing staged — no commit made.',
    };
  }

  // ---- branch selection: EXHAUSTIVE over every ac-0001 outcome -------------
  //
  // The question is NOT "is this a file?" — that framing is what made a Windows
  // named pipe take the file branch (plan 075). The question is "is anything
  // ALREADY receiving this commit's events?", and the kind table answers it for
  // every target kind, with the compiler refusing a kind that has not answered.
  //
  // - `always`             — a file git is writing into, or a live pipe git can
  //                          talk to. Overriding would REPLACE that target, so
  //                          it would divert events rather than duplicate them.
  // - `when-probe-connected` — a socket; only the probe can say.
  // - `never`              — nothing is listening; the harness buffers.
  const policy = trace2Policy(deps.ingress.target);
  const receiving =
    policy.receives === 'always' ||
    (policy.receives === 'when-probe-connected' && probe === 'connected');
  const bufferedBranch = !receiving;
  const buffer = bufferedBranch ? bufferPath(deps) : null;

  const result = deps.git.commit(
    message,
    buffer === null ? undefined : { [TRACE2_EVENT_ENV]: buffer },
  );
  if (!result.ok) {
    return {
      ok: false,
      mode: bufferedBranch ? 'harness-buffered' : 'direct-verified',
      probe,
      sha: null,
      shaUnknown: false,
      staged,
      verify: 'skipped',
      buffer,
      gitCode: result.code,
      detail: `git commit failed (exit ${result.code}): ${result.stderr}`,
      next_action: 'Read the git error above; nothing was committed and nothing was buffered.',
    };
  }

  if (result.sha === null) {
    // The commit SUCCEEDED (git exited 0) but reading HEAD back failed. The
    // review's F007: this used to be reported as a commit FAILURE — exit 1, "not
    // committed" — for a commit that is really in the history. That is the
    // confident wrong answer in its most damaging form, because it invites the
    // operator to re-run and double-commit. So: honest DEGRADED, never an error,
    // and the buffer is left in place so its events are still recoverable.
    const fileTarget =
      policy.drainable && deps.ingress.target.kind !== 'unconfigured'
        ? deps.ingress.target.path
        : null;
    // Even with no sha to record, WRITE THE TARGET DOWN: the segment is real and
    // the operator will be told to drain it after reconfiguring, which only the
    // record makes authorizable.
    if (fileTarget !== null) recordFileTarget(deps, fileTarget);
    const written = buffer ?? fileTarget;
    return {
      ok: true,
      mode: bufferedBranch
        ? 'harness-buffered'
        : fileTarget !== null
          ? 'file-buffered'
          : // A live ingress whose ATTRIBUTION was never established is NOT
            // `direct-verified`: nothing here was verified, and saying so is the
            // point. (F006 made the pipe probeable, so this is no longer "we
            // cannot connect to it" — it is "no note was waited for on a
            // transport whose collector behaviour is unmeasured".)
            policy.receives === 'always'
            ? 'ingress-unverified'
            : 'direct-verified',
      probe,
      sha: null,
      shaUnknown: true,
      staged,
      // Nothing can be verified without a sha — and an unverified commit is not
      // a missing note, it is an unknown one.
      verify: 'skipped',
      buffer: written,
      gitCode: 0,
      detail: `git commit SUCCEEDED, but reading HEAD back failed, so this commit's sha is UNKNOWN to the harness. The commit is real and in your history — do NOT re-run this command.${written === null ? '' : ` Its trace2 events are in ${written} and are still replayable, but no sidecar sha could be recorded, so a nudge will report that segment as unconfirmable rather than delete it.`}`,
      next_action: `Run \`git log -1\` to see the commit, then \`git notes --ref=ai show HEAD\` to check whether attribution landed.${written === null ? '' : ` If it did not, run \`harness doctor telemetry-nudge${bufferedBranch ? '' : ` --buffer ${written}`}\` from an unsandboxed shell.`}`,
    };
  }

  const short = result.sha.slice(0, 12);

  if (bufferedBranch) {
    // Record the sha this buffer is expected to cover. Without it the nudge can
    // confirm nothing (git's trace2 stream names no commit), and an unconfirmable
    // segment is one it must not delete.
    if (buffer !== null) recordBufferedSha(deps, buffer, result.sha);
    return {
      ok: true,
      mode: 'harness-buffered',
      probe,
      sha: result.sha,
      shaUnknown: false,
      staged,
      // Verify is SKIPPED, not failed: the events went to a file by design, so
      // the daemon has not seen them yet and an absent note proves nothing.
      verify: 'skipped',
      buffer,
      gitCode: 0,
      detail: `committed ${short} — DEGRADED: the collector ingress was ${describeProbe(deps.ingress.target.kind === 'unconfigured' ? 'unconfigured' : probe)}, so this commit's trace2 events were buffered to ${buffer} instead of reaching git-ai. Attribution is DEFERRED, not lost, and not yet proven.`,
      next_action: `Run \`harness doctor telemetry-nudge\` from an UNSANDBOXED shell to replay ${buffer} into the collector. Read \`harness instructions commit\` for the safe commit shapes and what each one guarantees.`,
    };
  }

  if (deps.ingress.target.kind === 'named_pipe') {
    // ac-0005. Everything this branch does NOT do is the point:
    //
    // - no `GIT_TRACE2_EVENT` override — git talked to the pipe exactly as it
    //   normally would, and diverting a live ingress to "protect" it would turn
    //   the fix into the bug (the F-08 exclusivity rule, applied to a transport
    //   whose collector behaviour we have never measured — F006 made the pipe
    //   PROBEABLE, which is a different question from whether the daemon on the
    //   other end records what it receives);
    // - no `.shas` sidecar and no known-targets record beside the pipe path —
    //   those are the bookkeeping of a DRAINABLE buffer, and writing them next
    //   to a pipe both asserts a falsehood and may simply fail;
    // - no verify, and therefore no claim: `refs/notes/ai` may well have landed,
    //   but nobody has established how the collector behaves on this transport,
    //   and reporting an unmeasured miss as `missing` would be the same
    //   confident wrong answer in the opposite direction.
    const pipe = deps.ingress.target.path;
    return {
      ok: true,
      mode: 'ingress-unverified',
      probe,
      sha: result.sha,
      shaUnknown: false,
      staged,
      verify: 'skipped',
      // NOT a buffer. Nothing was buffered, and naming one here is precisely the
      // lie this plan exists to stop telling.
      buffer: null,
      gitCode: 0,
      detail: `committed ${short} — DEGRADED: the collector ingress is a Windows NAMED PIPE (${pipe}). The commit was made with NO trace2 override, so git wrote its events to that pipe as usual — but attribution was NOT VERIFIED on this platform, and nothing here was buffered. Whether the note landed is UNKNOWN, not proven and not disproven.`,
      next_action: `Check for yourself with \`git notes --ref=ai show ${short}\`. Do NOT run \`harness doctor telemetry-nudge\` — there is no buffer to drain and no replay path for the named-pipe transport; it will refuse.`,
    };
  }

  if (policy.drainable && deps.ingress.target.kind !== 'unconfigured') {
    const target = deps.ingress.target.path;
    // The sidecar goes beside the FILE TARGET too, not just the harness buffer.
    // Without it the eventual drain of that file could confirm nothing, and an
    // unconfirmable segment is one the nudge must keep forever. The target path
    // itself is recorded repo-locally so the nudge can still authorize draining
    // it once `trace2.eventTarget` has been pointed back at the socket.
    recordFileTarget(deps, target);
    recordBufferedSha(deps, target, result.sha);
    return {
      ok: true,
      mode: 'file-buffered',
      probe,
      sha: result.sha,
      shaUnknown: false,
      staged,
      verify: 'skipped',
      buffer: target,
      gitCode: 0,
      detail: `committed ${short} — DEGRADED: the configured trace2 target is a plain FILE (${target}), so this commit's events buffered there rather than reaching the collector. Attribution is DEFERRED, not lost, and not yet proven.`,
      // The ORDER is the point (review F003): while `trace2.eventTarget` names a
      // file there is no socket to replay into, so a bare nudge would skip. The
      // reconfiguration is a PREREQUISITE, not an afterthought — naming the drain
      // command without it promises a recovery that cannot run.
      next_action: `FIRST point \`trace2.eventTarget\` back at the git-ai socket (\`harness doctor --install-collector\`) — while it names a file there is no ingress to replay into — THEN run \`harness doctor telemetry-nudge --buffer ${target}\` from a shell that can reach the socket. See \`harness instructions commit\`.`,
    };
  }

  const verify = await verifyNote(deps, result.sha);
  if (verify === 'landed') {
    return {
      ok: true,
      mode: 'direct-verified',
      probe,
      sha: result.sha,
      shaUnknown: false,
      staged,
      verify,
      buffer: null,
      gitCode: 0,
      detail: `committed ${short} and VERIFIED: a refs/notes/ai entry landed, so the collector recorded this commit's authorship.`,
    };
  }

  // A verify miss NEVER rolls back and NEVER blocks — the commit is real and
  // stays. What changes is that the operator now knows, instead of a wrong
  // number being recorded silently.
  return {
    ok: true,
    mode: 'direct-verified',
    probe,
    sha: result.sha,
    shaUnknown: false,
    staged,
    verify: 'missing',
    buffer: null,
    gitCode: 0,
    detail: `committed ${short} — DEGRADED: the ingress probe said \`connected\`, but no refs/notes/ai entry appeared within ${deps.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS}ms. The commit stands; its authorship is UNRECORDED, and git-ai may later attest those lines as known-human.`,
    next_action:
      'Check the git-ai daemon is running (`harness doctor`), then re-run `harness doctor telemetry-nudge`. Read `harness instructions commit` for what each commit shape does and does not guarantee.',
  };
}

/** Operator phrasing for the outcome that selected the buffered branch. */
function describeProbe(probe: ProbeOutcome | 'unconfigured' | null): string {
  switch (probe) {
    case 'denied':
      return 'DENIED (a sandbox blocked the socket connect)';
    case 'refused':
      return 'refused (a stale socket with nothing listening)';
    case 'absent':
      return 'absent (the git-ai daemon is not running)';
    case 'timeout':
      return 'unreachable (the probe timed out)';
    case 'unconfigured':
    case null:
      return 'not configured (no trace2 target is set)';
    default:
      return `unreachable (${probe})`;
  }
}
