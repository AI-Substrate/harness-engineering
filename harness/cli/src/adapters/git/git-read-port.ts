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
}
