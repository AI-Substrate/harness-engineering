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
}
