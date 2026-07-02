/**
 * Git WRITE port — the plumbing half of git, behind an interface (plan 034
 * Phase 4). Where {@link GitPort} is read-only informational facts, this writes
 * objects + refs via PLUMBING (`hash-object`/`mktree`/`commit-tree`/`update-ref`)
 * so a telemetry flush never touches the index or working tree (AC-06), and
 * FORCE-pushes each session's rolled start-date ref (`+ref:ref`) best-effort
 * (plan 049 reworked the former per-(date,session) shard into ONE rolled ref per
 * session at its start date; AC-14). Injected so the sync-service stays
 * unit-testable with `FakeGitWrite` and never shells out to `git`.
 *
 * ATTRIBUTION (2026-06-25 decision — reverses the former §T1 non-individual
 * forcing): a telemetry commit's author + committer are the **contributor's own
 * configured git identity**, so each `refs/harness-telemetry/*` ref is traceable
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
 * The ref a session's rolled flush targets:
 * `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>`, where `datePath` =
 * `YYYY/MM/DD` is the session's STABLE START date (plan 049 — reworked from the
 * former per-(capture-date, session) shard, which grew one ref per capture-day).
 * A session now costs exactly ONE ref, keyed at its first-segment date.
 *
 * Keying by (start-date, session) still means no two writers ever target the same
 * ref, so a team's concurrent pushes never contend. The push is a FORCED orphan
 * rewrite (`+ref:ref`): every sync rebuilds the whole session from the local
 * buffer into a fresh orphan commit, so the tip tree is always the complete
 * session (fixing the F-03 clobber where a reader peeling only the tip tree lost
 * earlier segments). The `session` is the opaque per-session id (the pushing
 * engineer's identity is on the commit, not in the ref name). The start-date
 * prefix doubles as the retention/prune key. Each ref's commit tree is the rolled
 * shape — `session.logs.jsonl` + `session.metrics.jsonl` (every seq concatenated
 * seq-ordered) + `manifest.json` — NOT the old flat `<seq>.json` set.
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
  email: 'noreply@harness-engineering-fake.com',
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

/** One flat blob in a rolled ref's tip tree (name + verbatim bytes) — the union read result. */
export interface RefTreeBlob {
  /** The tree entry name (`session.logs.jsonl` / `session.metrics.jsonl` / `<seq>.json` / `manifest.json`). */
  name: string;
  /** The blob's UTF-8 content, byte-verbatim (`cat-file blob`). */
  content: string;
}

export interface GitWritePort {
  /** Write a blob to the object DB (`hash-object -w --stdin`); returns its sha. */
  hashObject(content: string): string;
  /** Build one tree level from entries (`mktree`); returns the tree sha. Nest by passing subtree shas. */
  mktree(entries: TreeEntry[]): string;
  /** The current sha a ref points at, or null when the ref does not exist. */
  refTip(ref: string): string | null;
  /**
   * The tree sha at a ref's tip (`rev-parse <ref>^{tree}`), or null when the ref
   * does not exist. LOCAL only — reads the ref's own object, never the remote — so
   * the single-writer-per-ref / no-fetch-to-write invariant is preserved. The
   * idempotency probe for H5: a tree match means the shard is already published.
   */
  refTree(ref: string): string | null;
  /**
   * Read a ref's tip tree into its flat blobs — a LOCAL `cat-file` walk of
   * `<ref>^{tree}` (the ref's OWN object, NEVER the remote), returning null when
   * the ref does not exist. This is the UNION SOURCE for the rolled rewrite (plan
   * 049 T007): the already-published (flushed) seqs live in this tree, the unflushed
   * seqs live in the local buffer, and the writer concatenates ref-tree ++ new-buffer
   * to rebuild the whole-session tip. Keeps the append fetch-free (AC-03) — it is a
   * local read, in the same `cat-file` class as {@link refTree}'s peel, so the
   * single-writer-per-ref / no-fetch-to-write invariant holds.
   */
  readRefTree(ref: string): RefTreeBlob[] | null;
  /**
   * Read ONE named blob from a ref's tip tree — a LOCAL `cat-file blob <ref>:<name>`
   * (the ref's OWN object, NEVER the remote), returning null when the ref OR the path
   * is absent. The targeted fast path for the steady-state no-op sync decision (plan
   * 049 DL-001): that decision needs ONLY `manifest.json`'s `max_seq`, and a full
   * {@link readRefTree} `cat-file`s every blob — including the multi-MB
   * `session.logs.jsonl` — just to reach the manifest, which dominated a no-op sync.
   * FAIL CLOSED, in the same discipline as {@link readRefTree}: a spawn-level failure
   * (ENOBUFS truncation / timeout) THROWS (never a silent partial), while a clean
   * non-zero exit (ref/path absent) returns null. Uses the shared `GIT_MAX_BUFFER`;
   * fetch-free (AC-03) — the same `cat-file` class as {@link refTree}'s peel.
   */
  readRefBlob(ref: string, name: string): string | null;
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
  /**
   * List the REMOTE telemetry ref names (`ls-remote origin refs/harness-telemetry/*`)
   * — the ONE sanctioned network read (plan 049 migration). Returns just the ref
   * names (`refs/harness-telemetry/…`); `[]` when the remote has none. Throws on a
   * transport failure so the caller can defer the migration (never write the
   * completion sentinel on a failed pull). NOT used by the steady-state flush — the
   * append path stays fetch-free (AC-03).
   */
  lsRemoteTelemetryRefs(): string[];
  /**
   * Fetch ONE ref into the local object store (`fetch --no-tags origin +<ref>:<ref>`)
   * so its full commit history is locally walkable for the migration union — the
   * other half of the one sanctioned pull. Throws on failure. Rides ambient git auth.
   */
  fetchRef(ref: string): void;
  /**
   * Delete a REMOTE ref (`push --no-verify origin :<ref>`) — the migration's cleanup
   * of an old-shape ref after its content is verifiably rolled up. `--no-verify` is
   * load-bearing (rides the same hook-immune push path as {@link push}). Throws on
   * failure so the caller can retry next run (never advances the sentinel).
   */
  deleteRemoteRef(ref: string): void;
}
