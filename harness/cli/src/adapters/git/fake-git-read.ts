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

  constructor(seedRefs: Record<string, ShardBlob[]> = {}) {
    for (const [ref, blobs] of Object.entries(seedRefs)) this.shards.set(ref, blobs);
  }

  /** Seed (or replace) one ref's committed shard tree. Returns `this` for chaining. */
  seedShard(ref: string, blobs: ShardBlob[]): this {
    this.shards.set(ref, blobs);
    return this;
  }

  listTelemetryRefs(glob: string): string[] {
    this.calls.push('listTelemetryRefs');
    // Model `for-each-ref <prefix>/*`: match every seeded ref under the glob's
    // prefix (the sole shape the telemetry act passes). Deterministic sort.
    const prefix = glob.endsWith('/*') ? glob.slice(0, -1) : glob;
    return [...this.shards.keys()].filter((ref) => ref.startsWith(prefix)).sort();
  }

  readShardTree(ref: string): ShardBlob[] {
    this.calls.push('readShardTree');
    this.readRefs.push(ref);
    // Return a COPY so a caller mutating the result can never corrupt the seed.
    return (this.shards.get(ref) ?? []).map((b) => ({ ...b }));
  }
}
