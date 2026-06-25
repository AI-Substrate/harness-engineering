/**
 * Git WRITE port — the plumbing half of git, behind an interface (plan 034
 * Phase 4). Where {@link GitPort} is read-only informational facts, this writes
 * objects + refs via PLUMBING (`hash-object`/`mktree`/`commit-tree`/`update-ref`)
 * so a telemetry flush never touches the index or working tree (AC-06), and
 * pushes each per-(date,session) shard's refspec best-effort (AC-14). Injected so
 * the sync-service stays unit-testable with `FakeGitWrite` and never shells out to
 * `git`.
 *
 * ATTRIBUTION (2026-06-25 decision — reverses the former §T1 non-individual
 * forcing): a telemetry commit's author + committer are the **contributor's own
 * configured git identity**, so each `refs/harness-telemetry/*` shard is traceable
 * to who pushed it. {@link TELEMETRY_FALLBACK_AUTHOR} is used ONLY when the repo
 * has no configured `user.name`/`user.email`, so the commit never fails in an
 * unconfigured environment.
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
 * opaque per-session id (the same granularity already in the buffer paths; the
 * pushing engineer's identity is on the commit, not in the ref name). The date
 * prefix doubles as the retention/prune
 * key (a scraper can drop `refs/harness-telemetry/<YYYY>/<MM>/<DD>/*` after
 * ingesting that day). Each ref's commit tree is a flat `<seq>.json` set — the
 * date+session hierarchy lives in the ref name, not the tree.
 */
export function telemetryRefFor(datePath: string, session: string): string {
  return `${TELEMETRY_REF_PREFIX}/${datePath}/${session}`;
}

/** A git commit identity (author / committer). */
export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * The FALLBACK commit identity — used ONLY when the repo has no configured git
 * `user.name`/`user.email`. Normally a telemetry commit carries the contributor's
 * own configured identity (the 2026-06-25 attribution decision — telemetry refs
 * are traceable to who pushed them); this generic identity is the safety net so an
 * unconfigured environment never fails the commit.
 */
export const TELEMETRY_FALLBACK_AUTHOR: GitIdentity = {
  name: 'harness-telemetry',
  email: 'noreply@anthropic.com',
};

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
   * `commit-tree` using the **contributor's configured git identity** for author +
   * committer (attributable); falls back to {@link TELEMETRY_FALLBACK_AUTHOR} only
   * when no `user.name`/`user.email` is configured. `parent` null = an orphan root
   * (first ever telemetry commit). Returns the commit sha.
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
