/**
 * Git WRITE port — the plumbing half of git, behind an interface (plan 034
 * Phase 4). Where {@link GitPort} is read-only informational facts, this writes
 * objects + refs via PLUMBING (`hash-object`/`mktree`/`commit-tree`/`update-ref`)
 * so a telemetry flush never touches the index or working tree (AC-06), and
 * pushes each per-(date,session) shard's refspec best-effort (AC-14). Injected so
 * the sync-service stays unit-testable with `FakeGitWrite` and never shells out to
 * `git`.
 *
 * §T1 (AC-07/13): the commit author AND committer are forced to the
 * NON-INDIVIDUAL {@link TELEMETRY_AUTHOR} identity inside the adapter — it is
 * never a `commitTree` parameter, so no call site can substitute an engineer's
 * `git config user.email`.
 */

/**
 * The out-of-tree ref NAMESPACE every repo's telemetry shards into. Telemetry is
 * NOT one shared mutable ref — many engineers pushing to a single ref from
 * independent clones is a distributed write-contention problem (every second
 * pusher gets a non-fast-forward rejection). Instead each flush targets its own
 * ref under this prefix (see {@link telemetryRefFor}), the canonical git answer
 * for "many writers append out-of-tree metadata" (cf. Gerrit `refs/changes/*`,
 * GitHub `refs/pull/*`).
 */
export const TELEMETRY_REF_PREFIX = 'refs/harness-telemetry';

/**
 * The wildcard a central scraper fetches in ONE round-trip to collect every
 * session's telemetry — `git fetch origin '<glob>:<glob>'` is a single network
 * operation, not one fetch per ref. Servers can also keep the namespace out of
 * ordinary clones via `uploadpack.hideRefs=refs/harness-telemetry/`.
 */
export const TELEMETRY_REF_GLOB = `${TELEMETRY_REF_PREFIX}/*`;

/**
 * The ref a single flush targets:
 * `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` (`datePath` = `YYYY/MM/DD`).
 *
 * Sharding by (capture-date, session) means no two writers ever target the same
 * ref, so a team's concurrent pushes never contend — each push is a clean
 * create-or-fast-forward, no fetch/merge/retry needed. The `session` is the
 * opaque per-session id (NOT an individual identity — §T1/P12; same granularity
 * already in the buffer paths). The date prefix doubles as the retention/prune
 * key (a scraper can drop `refs/harness-telemetry/<YYYY>/<MM>/<DD>/*` after
 * ingesting that day). Each ref's commit tree is a flat `<seq>.json` set — the
 * date+session hierarchy lives in the ref name, not the tree.
 */
export function telemetryRefFor(datePath: string, session: string): string {
  return `${TELEMETRY_REF_PREFIX}/${datePath}/${session}`;
}

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
