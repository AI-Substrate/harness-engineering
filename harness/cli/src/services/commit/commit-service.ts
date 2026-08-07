import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitAttributionPort } from '../../adapters/git/git-attribution-port.js';
import type { ProbeOutcome } from '../../adapters/net/socket-probe-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import type { IngressReading } from '../doctor/collector/ingress.js';
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
 * Every {@link ProbeOutcome}, plus `unconfigured`, lands in exactly one of three
 * branches:
 *
 * - **`connected`** → commit with NO trace2 override, then bounded verify that a
 *   `refs/notes/ai` note landed.
 * - **`file`** (target is already a plain file) → commit with NO override; the
 *   configured target is already buffering, and overriding it would only move
 *   the buffer somewhere the user did not choose.
 * - **EVERY other outcome** (`denied` | `refused` | `absent` | `timeout` |
 *   `error:<code>` | `unconfigured`) → commit with `GIT_TRACE2_EVENT` pointed at
 *   a buffer file under the gitignored harness temp dir, and skip note-verify,
 *   because delivery is DEFERRED BY DESIGN and a missing note there is expected
 *   rather than a finding.
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

/** Which of the three ac-0005 branches ran. Reported, so the choice is never implicit. */
export type CommitMode = 'direct-verified' | 'file-buffered' | 'harness-buffered';

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
  const cwd = toPosix(deps.proc.cwd());
  const dir = posixJoin(cwd, HARNESS_DIR, TEMP_DIR, TRACE2_BUFFER_DIR);
  if (!deps.fs.exists(dir)) deps.fs.mkdirp(dir);
  // Self-gitignore on first use, exactly as the shared temp guarantee does: the
  // buffer must be uncommittable even in a repo that never added the root rule.
  const ignore = posixJoin(dir, '.gitignore');
  if (!deps.fs.exists(ignore)) {
    deps.fs.writeText(ignore, '# Buffered trace2 events — never committed.\n*\n');
  }
  return posixJoin(dir, TRACE2_BUFFER_FILE);
}

/**
 * Append `sha` to the buffer's sidecar. APPEND, because one buffer legitimately
 * accumulates several commits before anyone runs the nudge.
 */
function recordBufferedSha(deps: CommitDeps, buffer: string, sha: string): void {
  const sidecar = `${buffer}${TRACE2_SHAS_SUFFIX}`;
  const existing = deps.fs.readText(sidecar) ?? '';
  if (existing.split('\n').includes(sha)) return;
  deps.fs.writeText(
    sidecar,
    `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${sha}\n`,
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
  // `file` and `connected` commit with NO override; everything else buffers.
  const bufferedBranch = deps.ingress.target.kind !== 'file' && probe !== 'connected';
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
    const fileTarget = deps.ingress.target.kind === 'file' ? deps.ingress.target.path : null;
    const written = buffer ?? fileTarget;
    return {
      ok: true,
      mode: bufferedBranch
        ? 'harness-buffered'
        : fileTarget !== null
          ? 'file-buffered'
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

  if (deps.ingress.target.kind === 'file') {
    const target = deps.ingress.target.path;
    // The sidecar goes beside the FILE TARGET too, not just the harness buffer.
    // Without it the eventual drain of that file could confirm nothing, and an
    // unconfirmable segment is one the nudge must keep forever.
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
