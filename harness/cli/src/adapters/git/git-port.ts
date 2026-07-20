/**
 * Git port — informational repository facts behind an interface.
 *
 * Used by `doctor` for context (are we in a repo? which branch?). Injected so
 * doctor stays unit-testable with `FakeGit` and never shells out to `git`.
 */
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
}
