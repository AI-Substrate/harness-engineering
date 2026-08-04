/**
 * Git READ port — the read-only mirror of {@link GitWritePort} (plan 047 Phase 3).
 * Where the write port PUBLISHES a session's telemetry shard as an orphan ref via
 * plumbing, this READS a committed shard back — `for-each-ref` to enumerate the
 * `refs/harness-telemetry/*` namespace + a `cat-file` tree walk to lift the flat
 * OTLP blobs — so `session save --source git-ref` can reconstruct a `SessionExport`
 * from committed telemetry WITHOUT ever touching the index or working tree.
 *
 * READ-ONLY BY CONSTRUCTION (KF-06, AC-08): the port exposes ONLY `for-each-ref`
 * + `cat-file` capabilities — never write / fetch / checkout / update-ref — so a
 * read can never mutate a ref, fetch from a remote, or dirty the working tree
 * (`git status --porcelain` is byte-identical before and after). Injected so the
 * telemetry act stays unit-testable with {@link FakeGitRead} and never shells out.
 *
 * The ref NAMESPACE + naming are shared with the write side — reuse
 * `TELEMETRY_REF_GLOB` / `telemetryRefFor` from `git-write-port.ts` verbatim (one
 * source of truth for the `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` shape).
 */

/**
 * One flat blob in a committed shard tree — the `cat-file` read of a single tree
 * entry. `name` is the entry name within the (flat) shard tree (`<seq>.logs.jsonl`
 * / `<seq>.metrics.jsonl` / `<seq>.json`); `content` is its UTF-8 bytes. A shard's
 * canonical shape is the OTLP pair (`<seq>.logs.jsonl` + `<seq>.metrics.jsonl`)
 * with NO `<seq>.json` (sync-service publishes the pair, keeping the segment json
 * LOCAL), so the read path reconstructs identity + events from the logs blob.
 */
export interface ShardBlob {
  /** The flat entry name within the shard tree (e.g. `0.logs.jsonl`). No slashes. */
  name: string;
  /** The blob's UTF-8 content (verbatim `cat-file` output). */
  content: string;
}

export interface GitReadPort {
  /**
   * Enumerate the telemetry refs matching `glob` (`for-each-ref <glob>`), newest
   * ordering not guaranteed. Pass {@link TELEMETRY_REF_GLOB}. Returns the full ref
   * names (`refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>`); `[]` when none
   * exist. LOCAL only — never contacts a remote.
   */
  listTelemetryRefs(glob: string): string[];
  /**
   * Read a committed shard ref's flat tree into its blobs (a `cat-file` tree walk
   * of `<ref>^{tree}`). Returns each entry's name + UTF-8 content; `[]` for an
   * empty/absent tree. READ-ONLY — never writes an object, moves a ref, or touches
   * the working tree.
   */
  readShardTree(ref: string): ShardBlob[];
  /**
   * {@link listTelemetryRefs}, but a FAILED enumeration THROWS instead of returning
   * `[]` (FX001 · R2). The fail-safe form cannot tell "this clone holds no telemetry
   * refs" from "`for-each-ref` itself failed", so a reader that reports an
   * ESTABLISHED miss — "checked, and empty" — has no way to know it established
   * nothing. An empty namespace is still `[]`; only a failure throws.
   *
   * OPTIONAL: an implementation that genuinely cannot distinguish the two omits it,
   * and callers fall back to {@link listTelemetryRefs} (fail-safe, less precise).
   */
  listTelemetryRefsStrict?(glob: string): string[];
  /**
   * {@link readShardTree}, but a FAILED tree read THROWS instead of returning `[]`
   * (FX001 · R2). An ABSENT or genuinely EMPTY tree still returns `[]` — the
   * distinction is failure vs emptiness, not presence vs absence.
   *
   * OPTIONAL, as {@link listTelemetryRefsStrict}.
   */
  readShardTreeStrict?(ref: string): ShardBlob[];
  /**
   * Which of `refs` carry a blob at path `name` in their TIP tree — the CHEAP shape
   * probe (plan 067). Answers "is this ref already rolled?" (`manifest.json` present)
   * for the WHOLE set in ONE `cat-file --batch-check`: header-only, no content, no
   * per-ref spawn, cost independent of how many blobs each tree holds. Classifying by
   * {@link readShardTree} instead re-read every blob of every ref — the 18,217-spawn
   * empty sync. Returns the matching refs in input order; a ref that does not exist
   * (or has no such path) is simply absent. LOCAL only — never contacts a remote.
   */
  refsWithBlob(refs: readonly string[], name: string): string[];
  /**
   * List the commit shas in a ref's FULL history, tip-first (`rev-list <ref>`) — the
   * migration union walk (plan 049 · F-03 recovery). A multi-sync old-shape ref
   * clobbered earlier segments into non-tip commits; walking the whole history and
   * unioning trees recovers them. `[]` when the ref is absent. LOCAL only (the ref
   * must already be fetched) — never contacts a remote.
   */
  listRefHistory(ref: string): string[];
  /**
   * Read the flat tree at ONE commit sha (`cat-file` walk of `<commit>^{tree}`) — the
   * per-commit half of the history union. Same shape as {@link readShardTree} but
   * anchored at an arbitrary commit rather than a ref tip. `[]` for an empty/absent
   * tree. READ-ONLY.
   */
  readTreeAtCommit(commit: string): ShardBlob[];
}
