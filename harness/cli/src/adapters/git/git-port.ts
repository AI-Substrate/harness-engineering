/**
 * Git port — informational repository facts behind an interface.
 *
 * Used by `doctor` for context (are we in a repo? which branch?). Injected so
 * doctor stays unit-testable with `FakeGit` and never shells out to `git`.
 */
/**
 * Whether the index carried staged content at the moment it was read (plan 082
 * tk-0003) — THE discriminator the commit guard rests on.
 *
 * It exists because everything cheaper was measured dead. Parent-count catches
 * only `--no-ff` merges. The reflog subject catches ff-pull, cherry-pick, revert
 * and amend, and misses seven transitions that read `commit: <msg>` byte-for-byte
 * like a real commit. `.git` state (MERGE_HEAD / SQUASH_MSG) cannot be consulted
 * at all: `merge --squash` never writes MERGE_HEAD, and git unlinks SQUASH_MSG
 * before even its OWN post-commit hook runs — an agent hook fires later still and
 * would read an empty directory.
 *
 * What remains is the index, read at PRE — BEFORE the commit that would erase the
 * evidence. A genuine agent edit reaches PRE with a CLEAN index (the agent has
 * not staged anything yet). All seven defeaters — `merge --squash`,
 * `cherry-pick -n`, `revert -n`, `git apply`, `checkout <ref> -- <path>`,
 * `restore --source`, `read-tree -m -u` — reach it with content ALREADY STAGED,
 * because staging is how each of them delivers content it did not author here.
 *
 * `unknown` is not a third outcome to reason over: it means the read failed, and
 * the guard treats it exactly as it treats `already-staged` — stay silent. The
 * only error direction this can produce is a FALSE NEGATIVE (a missing note),
 * which is the direction the plan's risk register demands.
 */
export type IndexState = 'clean' | 'already-staged' | 'unknown';

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
  /**
   * Whether the index carries staged content RIGHT NOW (`git diff --cached
   * --quiet`: exit 0 clean, exit 1 already-staged, anything else `unknown`).
   *
   * Read-only and cheap — one spawn, no output parsed. Correct on an UNBORN HEAD
   * too (verified: an empty index in a fresh repo exits 0, a staged file exits 1),
   * which matters because the very first commit in a repository is a case the
   * guard must still get right.
   *
   * See {@link IndexState} for why this, and not the reflog or `.git` state, is
   * the discriminator.
   */
  indexState(): IndexState;
  /**
   * The parents of HEAD, in order (`rev-list --parents -1 HEAD`). `[]` for a root
   * commit; `null` when HEAD cannot be read at all (unborn branch, not a repo).
   *
   * `null` and `[]` are different answers and the guard treats them differently:
   * `[]` is an established fact about a root commit, `null` is a read that did not
   * happen. Order matters — only the FIRST parent carries lineage, while the COUNT
   * is what rejects a merge commit.
   */
  headParents(): readonly string[] | null;
}
