/**
 * Git port — informational repository facts behind an interface.
 *
 * Used by `doctor` for context (are we in a repo? which branch?). Injected so
 * doctor stays unit-testable with `FakeGit` and never shells out to `git`.
 */
/**
 * One `git reflog` entry, whole (plan 082 tk-0002).
 *
 * The commit guard has to tell "the agent authored this here" from "HEAD moved
 * for some other reason", and the reflog SUBJECT is the discriminator that
 * separates a fast-forward pull, cherry-pick, revert and amend from an authored
 * commit — parent-count alone catches only `--no-ff` merges (measured across ten
 * transitions in ten isolated repos).
 *
 * So `subject` is the FULL `%gs` line, never a sha, a prefix or a truncation:
 * the entries the guard must reject differ from an authored commit ONLY in that
 * text (`pull: Fast-forward` vs `commit: <msg>`), and a caller handed a
 * truncation cannot recover what was cut. It is a HARD LIMIT, not a total
 * discriminator — `merge --squash` + commit, `git apply`, `checkout <ref> --
 * <path>`, `restore --source` and `read-tree -m -u` all read `commit: <msg>`,
 * byte-identical to a real commit (measured). Whatever separates those must come
 * from somewhere other than this port.
 */
export interface ReflogEntry {
  /** The full lowercase OID the ref pointed at AFTER the operation (`%H`). */
  sha: string;
  /** The reflog selector, e.g. `HEAD@{0}` (`%gD`). */
  selector: string;
  /**
   * The reflog subject VERBATIM and COMPLETE (`%gs`) — e.g. `commit: fix thing`,
   * `commit (amend): fix thing`, `pull: Fast-forward`, `cherry-pick`. May be empty
   * (an `update-ref` without `-m` writes no message); never `null`, never cut.
   */
  subject: string;
}

/**
 * A reflog read, with "the read failed" kept distinct from "there is nothing to
 * read" (the FX001 · R2 lesson the telemetry read port learned the hard way).
 *
 * The distinction is load-bearing HERE specifically because the guard's safe
 * default is SILENCE: a caller that cannot tell an empty reflog from a failed
 * read has no way to know it established nothing, and would emit on evidence it
 * never actually had. An existing ref whose reflog is absent or empty is a real,
 * successful `{ status: 'ok', entries: [] }` — git exits 0 (verified) — and only
 * a genuine failure is `unavailable`.
 */
export type ReflogRead =
  | { status: 'ok'; entries: readonly ReflogEntry[] }
  | {
      status: 'unavailable';
      /**
       * `unreadable` — git itself refused or could not answer: not a repository,
       * unknown/unborn ref, git absent, or the call timed out. Deliberately NOT
       * split further: the exit status alone cannot distinguish those cases, and
       * inventing the distinction would be a guess reported as a finding.
       * `malformed` — git answered, but the output did not parse.
       * `bad-limit` — the caller asked for a non-positive or non-integer count.
       */
      reason: 'unreadable' | 'malformed' | 'bad-limit';
    };

export interface GitPort {
  /** True if the cwd is inside a git work tree. */
  isRepo(): boolean;
  /** Current branch name, or null if not a repo / detached HEAD. */
  currentBranch(): string | null;
  /** Current product HEAD commit, or null for unborn/no-repo/invalid output. Detached HEAD is valid. */
  currentCommit(): string | null;
  /**
   * The `origin` remote URL — the provenance header's `repo` join key. `null`
   * when there is no `origin` remote (or not a repo). `origin`-only by design:
   * it's the conventional canonical remote and keeps the join key stable.
   */
  remoteUrl(): string | null;
  /**
   * Absolute roots from `git worktree list --porcelain -z`, deduped in
   * first-seen order. Discovery is bounded and fail-closed: callers never
   * receive a truncated or guessed candidate set.
   */
  knownWorktreeRoots(maxCandidates: number):
    | { status: 'ok'; roots: readonly string[] }
    | {
        status: 'unavailable';
        reason: 'not-a-repository' | 'malformed' | 'too-many';
      };
  /**
   * The newest `limit` entries of `ref`'s reflog, NEWEST FIRST (`HEAD@{0}` first).
   *
   * Read-only and LOCAL — `git reflog show` creates nothing, moves nothing and
   * never contacts a remote, so it belongs on this informational port beside
   * {@link currentCommit} rather than on the telemetry read/write ports.
   *
   * Returns `{ status: 'ok', entries: [] }` when the ref exists but carries no
   * reflog; see {@link ReflogRead} for why that is not the same answer as a
   * failure.
   */
  readReflog(ref: string, limit: number): ReflogRead;
}
