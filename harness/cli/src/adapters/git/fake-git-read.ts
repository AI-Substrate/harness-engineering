import type { GitReadPort, ShardBlob } from './git-read-port.js';

/**
 * Deterministic git-READ plumbing for tests (fakes over mocks — assert on
 * history). Records every call on `calls`; replays an in-memory map of
 * `ref → ShardBlob[]` seeded at construction (or via {@link seedShard}) so a
 * service/act test can drive the git-ref source WITHOUT a real repo, and a
 * `listTelemetryRefs` returns exactly the seeded refs whose name matches the glob.
 *
 * READ-ONLY like the real adapter: there is deliberately NO write/fetch/update
 * surface — the fake cannot mutate a ref or a tree, mirroring the port's
 * read-only-by-construction guarantee.
 */
export class FakeGitRead implements GitReadPort {
  readonly calls: string[] = [];
  /** Every ref passed to {@link readShardTree} (fakes over mocks — assert on history). */
  readonly readRefs: string[] = [];
  private readonly shards = new Map<string, ShardBlob[]>();
  /** ref → commit ids (tip-first), for {@link listRefHistory}. */
  private readonly history = new Map<string, string[]>();
  /** commit id → its flat tree blobs, for {@link readTreeAtCommit}. */
  private readonly commitTrees = new Map<string, ShardBlob[]>();
  /** Refs the LOCAL `for-each-ref` ({@link listTelemetryRefs}) reports (excludes remote-only). */
  private readonly local = new Set<string>();

  constructor(seedRefs: Record<string, ShardBlob[]> = {}) {
    for (const [ref, blobs] of Object.entries(seedRefs)) this.seedShard(ref, blobs);
  }

  /** Seed (or replace) one LOCAL ref's committed shard TIP tree. Returns `this` for chaining. */
  seedShard(ref: string, blobs: ShardBlob[]): this {
    this.local.add(ref);
    this.putTip(ref, blobs);
    return this;
  }

  /**
   * Seed a FULL LOCAL commit history (tip-first: `trees[0]` is the tip). Models an
   * old-shape ref whose earlier syncs clobbered segments into non-tip commits — the
   * migration union walk must recover them. `trees[0]` also becomes the tip tree.
   */
  seedHistory(ref: string, trees: ShardBlob[][]): this {
    this.local.add(ref);
    this.putHistory(ref, trees);
    return this;
  }

  /**
   * Seed a REMOTE-ONLY ref: walkable (history + trees present, as after a `fetchRef`)
   * but ABSENT from the local `for-each-ref` — models an old ref that lives only on the
   * remote (a clone that never re-ran) and is discovered via `ls-remote` + fetched.
   */
  seedRemoteOnly(ref: string, trees: ShardBlob[][]): this {
    this.putHistory(ref, trees);
    return this;
  }

  private putTip(ref: string, blobs: ShardBlob[]): void {
    this.shards.set(ref, blobs);
    if (!this.history.has(ref)) {
      const cid = `${ref}@0`;
      this.history.set(ref, [cid]);
      this.commitTrees.set(cid, blobs);
    } else {
      const tip = this.history.get(ref)?.[0];
      if (tip !== undefined) this.commitTrees.set(tip, blobs);
    }
  }

  private putHistory(ref: string, trees: ShardBlob[][]): void {
    const cids = trees.map((_, i) => `${ref}@${i}`);
    this.history.set(ref, cids);
    cids.forEach((cid, i) => {
      this.commitTrees.set(cid, trees[i] ?? []);
    });
    this.shards.set(ref, trees[0] ?? []);
  }

  listTelemetryRefs(glob: string): string[] {
    this.calls.push('listTelemetryRefs');
    // Model `for-each-ref <prefix>/*`: match every LOCAL seeded ref under the glob's
    // prefix (remote-only refs are invisible until fetched). Deterministic sort.
    const prefix = glob.endsWith('/*') ? glob.slice(0, -1) : glob;
    return [...this.local].filter((ref) => ref.startsWith(prefix)).sort();
  }

  readShardTree(ref: string): ShardBlob[] {
    this.calls.push('readShardTree');
    this.readRefs.push(ref);
    // Return a COPY so a caller mutating the result can never corrupt the seed.
    return (this.shards.get(ref) ?? []).map((b) => ({ ...b }));
  }

  /**
   * The strict variants (FX001 · R2). An in-memory map cannot FAIL to be read — an
   * absent ref is genuinely absent — so both delegate, and a control that needs a port
   * failure overrides either form on the instance (the delegation makes overriding the
   * plain method enough).
   */
  listTelemetryRefsStrict(glob: string): string[] {
    return this.listTelemetryRefs(glob);
  }

  readShardTreeStrict(ref: string): ShardBlob[] {
    return this.readShardTree(ref);
  }

  /**
   * Faithful to the real `cat-file --batch-check` probe: ONE call classifies the whole
   * set from the seeded TIP trees, WITHOUT reading any blob content — so it is recorded
   * as a single `refsWithBlob` call and never appears in {@link readRefs} (plan 067's
   * O(corpus)→O(buffer) contract is asserted on exactly that history).
   */
  refsWithBlob(refs: readonly string[], name: string): string[] {
    this.calls.push('refsWithBlob');
    return refs.filter((ref) => (this.shards.get(ref) ?? []).some((b) => b.name === name));
  }

  listRefHistory(ref: string): string[] {
    this.calls.push('listRefHistory');
    return [...(this.history.get(ref) ?? [])];
  }

  readTreeAtCommit(commit: string): ShardBlob[] {
    this.calls.push('readTreeAtCommit');
    return (this.commitTrees.get(commit) ?? []).map((b) => ({ ...b }));
  }
}
