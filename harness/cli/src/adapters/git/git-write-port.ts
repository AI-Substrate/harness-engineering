/**
 * Git WRITE port — the plumbing half of git, behind an interface (plan 034
 * Phase 4). Where {@link GitPort} is read-only informational facts, this writes
 * objects + refs via PLUMBING (`hash-object`/`mktree`/`commit-tree`/`update-ref`)
 * so a telemetry flush never touches the index or working tree (AC-06), and
 * pushes a single refspec best-effort (AC-14). Injected so the sync-service stays
 * unit-testable with `FakeGitWrite` and never shells out to `git`.
 *
 * §T1 (AC-07/13): the commit author AND committer are forced to the
 * NON-INDIVIDUAL {@link TELEMETRY_AUTHOR} identity inside the adapter — it is
 * never a `commitTree` parameter, so no call site can substitute an engineer's
 * `git config user.email`.
 */

/** The single out-of-tree ref every repo's telemetry accumulates into (orphan history). */
export const TELEMETRY_REF = 'refs/harness-telemetry';

/**
 * The non-individual commit identity (§T1, ratified 2026-06-23). The ONLY
 * identity any telemetry commit ever carries — author and committer both. Not a
 * parameter anywhere; storing an engineer's email durably is the surveillance
 * vector P12 forbids, so the email is a constant `noreply@…`, never read from git
 * config.
 */
export const TELEMETRY_AUTHOR = {
  name: 'harness-telemetry',
  email: 'noreply@anthropic.com',
} as const;

/** A single `git mktree` entry (`<mode> SP <type> SP <sha> TAB <name>`). */
export interface TreeEntry {
  /** `100644` (blob) or `040000` (subtree). */
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  /** The entry name within this tree level (no slashes — nest via subtrees). */
  name: string;
}

export interface GitWritePort {
  /** Write a blob to the object DB (`hash-object -w --stdin`); returns its sha. */
  hashObject(content: string): string;
  /** Build one tree level from entries (`mktree`); returns the tree sha. Nest by passing subtree shas. */
  mktree(entries: TreeEntry[]): string;
  /** The current sha a ref points at, or null when the ref does not exist. */
  refTip(ref: string): string | null;
  /**
   * `commit-tree` with the {@link TELEMETRY_AUTHOR} identity FORCED for author +
   * committer; `parent` null = an orphan root (first ever telemetry commit).
   * Returns the commit sha.
   */
  commitTree(tree: string, parent: string | null, message: string): string;
  /**
   * Compare-and-set `update-ref ref newSha [oldSha]`. Returns false when the
   * current tip ≠ `oldSha` (a concurrent writer moved it) — the caller re-reads
   * {@link refTip} and retries (ff-loop). Pass `oldSha` null for an orphan create.
   */
  updateRef(ref: string, newSha: string, oldSha: string | null): boolean;
  /** Delete a ref (`update-ref -d`) — the rollback when a first/orphan push fails. */
  deleteRef(ref: string): void;
  /** Push a SINGLE refspec via ambient git auth (`push origin <refspec>`); throws on failure. */
  push(refspec: string): void;
}
