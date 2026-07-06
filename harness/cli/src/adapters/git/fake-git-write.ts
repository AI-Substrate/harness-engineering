import type { GitIdentity, GitWritePort, RefTreeBlob, TreeEntry } from './git-write-port.js';

/** Deterministic content hash (FNV-1a → base36) — gives the fake content-addressed objects. */
function fakeHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Deterministic git-write plumbing for tests (fakes over mocks — assert on
 * history). Records every call on `calls`; deterministic object/commit shas;
 * an in-memory ref map with real compare-and-set semantics so a service test can
 * exercise the ff-retry, the orphan rollback, and the offline push-failure path.
 *
 * ATTRIBUTION: `commitTree` records the **contributor's identity** (the
 * constructor's `identity`, default a representative engineer) — mirroring the
 * real adapter, which lets git use the configured `user.name`/`user.email`.
 */
export class FakeGitWrite implements GitWritePort {
  readonly calls: string[] = [];
  readonly commits: {
    tree: string;
    parent: string | null;
    message: string;
    author: GitIdentity;
    committer: GitIdentity;
  }[] = [];
  readonly trees: TreeEntry[][] = [];
  readonly blobs: string[] = [];
  readonly pushed: string[] = [];
  /** Refspecs passed to {@link deleteRemoteRef} (fakes over mocks — assert on history). */
  readonly deletedRemote: string[] = [];
  /** Refs passed to {@link fetchRef}. */
  readonly fetched: string[] = [];

  /** Set true to make `push` throw (models offline / auth failure / non-ff). */
  failPush = false;
  /** Fail `push` only for refspecs matching this predicate (models a per-ref failure). */
  failPushMatching: ((refspec: string) => boolean) | null = null;
  /** Set true to make the FIRST `updateRef` lose a race (a concurrent writer moves the tip). */
  staleOnce = false;
  /**
   * Set true to make `readRefTree` throw — models the real adapter's FAIL-CLOSED
   * path (a partial / ENOBUFS-truncated blob read) so a service test can prove the
   * sync surfaces `ok:false` and leaves the ref + buffer + watermark untouched
   * (plan 049 round-2 F1).
   */
  failReadRefTree = false;
  /**
   * Set true to make `readRefBlob` throw — models the real adapter's FAIL-CLOSED
   * path (a spawn-level / ENOBUFS failure on the single-blob manifest read) so a
   * service test can prove the no-op decision fails closed: sync `ok:false`, ref +
   * buffer + watermark untouched (plan 049 DL-001).
   */
  failReadRefBlob = false;
  /** The `name`s passed to {@link readRefBlob} — proves the no-op path reads ONLY `manifest.json`. */
  readonly readBlobNames: string[] = [];
  /** The remote telemetry ref names {@link lsRemoteTelemetryRefs} reports (the migration's remote view). */
  private remoteTelemetryRefs: string[] = [];
  /**
   * Per-ref TREE-sha override for {@link refTree} — the migration TOCTOU seam. When
   * set for a ref, `refTree` returns the override INSTEAD of the ref's real tree,
   * modelling a racing forced push that changed the ref's content between our verify
   * and delete (so the delete is skipped). Does NOT affect {@link refTip}/writes.
   */
  readonly refTreeOverride = new Map<string, string>();

  private commitN = 0;
  private staleConsumed = false;
  private readonly refs = new Map<string, string>();
  /** commit sha → its tree sha, so {@link refTree} can peel a ref like real git. */
  private readonly commitTrees = new Map<string, string>();
  /** tree sha → its entries, so {@link readRefTree} can lift a ref's flat blobs back. */
  private readonly treeEntriesBySha = new Map<string, TreeEntry[]>();
  /** blob sha → content, so a test can read a rolled tree entry's bytes back. */
  private readonly blobBySha = new Map<string, string>();

  constructor(
    seedRefs: Record<string, string> = {},
    /** The contributor identity each recorded commit carries (attributable). */
    private readonly identity: GitIdentity = { name: 'Engineer', email: 'engineer@example.com' },
  ) {
    for (const [ref, sha] of Object.entries(seedRefs)) this.refs.set(ref, sha);
  }

  hashObject(content: string): string {
    this.calls.push('hashObject');
    this.blobs.push(content);
    // CONTENT-ADDRESSED like real git: identical bytes → identical sha (lets a
    // re-flush of the same buffer recompute a stable tree for the H5 idempotency probe).
    const sha = `blob-${fakeHash(content)}`;
    this.blobBySha.set(sha, content);
    return sha;
  }

  mktree(entries: TreeEntry[]): string {
    this.calls.push('mktree');
    this.trees.push(entries);
    const serialized = entries.map((e) => `${e.mode} ${e.type} ${e.sha}\t${e.name}`).join('\n');
    const treeSha = `tree-${fakeHash(serialized)}`;
    // Content-addressed: identical entries → identical tree sha; remember the entries
    // so readRefTree can lift the ref's blobs back (the union source, plan 049 T007).
    this.treeEntriesBySha.set(treeSha, [...entries]);
    return treeSha;
  }

  refTip(ref: string): string | null {
    this.calls.push('refTip');
    return this.refs.get(ref) ?? null;
  }

  refTree(ref: string): string | null {
    this.calls.push('refTree');
    const override = this.refTreeOverride.get(ref);
    if (override !== undefined) return override; // TOCTOU seam — a racer changed the tree
    const commit = this.refs.get(ref);
    return commit ? (this.commitTrees.get(commit) ?? null) : null;
  }

  readRefTree(ref: string): RefTreeBlob[] | null {
    this.calls.push('readRefTree');
    if (this.failReadRefTree)
      throw new Error(
        'FakeGitWrite.readRefTree: simulated partial/ENOBUFS blob read (fail closed)',
      );
    const commit = this.refs.get(ref);
    if (commit === undefined) return null; // ref does not exist → fresh session
    const treeSha = this.commitTrees.get(commit);
    if (treeSha === undefined) return null;
    const entries = this.treeEntriesBySha.get(treeSha);
    if (entries === undefined) return null;
    // Lift each blob's bytes back verbatim (content-addressed via blobBySha) — the
    // real adapter's `cat-file blob` equivalent. Subtrees never occur in a rolled tree.
    return entries
      .filter((e) => e.type === 'blob')
      .map((e) => ({ name: e.name, content: this.blobBySha.get(e.sha) ?? '' }));
  }

  readRefBlob(ref: string, name: string): string | null {
    this.calls.push('readRefBlob');
    this.readBlobNames.push(name);
    if (this.failReadRefBlob)
      throw new Error(
        'FakeGitWrite.readRefBlob: simulated spawn/ENOBUFS single-blob read (fail closed)',
      );
    const commit = this.refs.get(ref);
    if (commit === undefined) return null; // ref does not exist → fresh session
    const treeSha = this.commitTrees.get(commit);
    if (treeSha === undefined) return null;
    const entries = this.treeEntriesBySha.get(treeSha);
    if (entries === undefined) return null;
    const entry = entries.find((e) => e.type === 'blob' && e.name === name);
    if (entry === undefined) return null; // path absent in the tree → clean null
    return this.blobBySha.get(entry.sha) ?? null;
  }

  commitTree(tree: string, parent: string | null, message: string): string {
    this.calls.push('commitTree');
    // Attribution: author AND committer are the contributor's identity (the real
    // adapter lets git use the configured user.name/user.email) — record both.
    this.commits.push({
      tree,
      parent,
      message,
      author: this.identity,
      committer: this.identity,
    });
    const commit = `commit${++this.commitN}`;
    this.commitTrees.set(commit, tree); // so refTree can peel this commit to its tree
    return commit;
  }

  updateRef(ref: string, newSha: string, oldSha: string | null): boolean {
    this.calls.push('updateRef');
    if (this.staleOnce && !this.staleConsumed) {
      // A concurrent writer moves the tip out from under this CAS — once.
      this.staleConsumed = true;
      this.refs.set(ref, `concurrent-${ref}`);
      return false;
    }
    if ((this.refs.get(ref) ?? null) !== (oldSha ?? null)) return false; // stale CAS
    this.refs.set(ref, newSha);
    return true;
  }

  deleteRef(ref: string): void {
    this.calls.push('deleteRef');
    this.refs.delete(ref);
  }

  push(refspec: string): void {
    this.calls.push('push');
    if (this.failPush || this.failPushMatching?.(refspec)) {
      throw new Error('FakeGitWrite.push: simulated push failure');
    }
    this.pushed.push(refspec);
  }

  lsRemoteTelemetryRefs(): string[] {
    this.calls.push('lsRemoteTelemetryRefs');
    if (this.failPush)
      throw new Error('FakeGitWrite.lsRemoteTelemetryRefs: simulated transport failure');
    return [...this.remoteTelemetryRefs];
  }

  fetchRef(ref: string): void {
    this.calls.push('fetchRef');
    this.fetched.push(ref);
  }

  deleteRemoteRef(ref: string): void {
    this.calls.push('deleteRemoteRef');
    this.deletedRemote.push(ref);
    this.remoteTelemetryRefs = this.remoteTelemetryRefs.filter((r) => r !== ref);
  }

  /** Seed the remote telemetry ref names {@link lsRemoteTelemetryRefs} will report. Chainable. */
  seedRemoteTelemetryRefs(refs: string[]): this {
    this.remoteTelemetryRefs = [...refs];
    return this;
  }

  /** Test helper — current tip without recording a `refTip` call. */
  tip(ref: string): string | null {
    return this.refs.get(ref) ?? null;
  }

  /** Test helper — the content of a hashed blob by its (tree-entry) sha. */
  contentOf(sha: string): string | undefined {
    return this.blobBySha.get(sha);
  }
}
