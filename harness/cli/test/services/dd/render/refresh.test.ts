import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoRegenerateSibling } from '../../../../src/acts/dd/build.js';
import { NodeSchemaFs } from '../../../../src/acts/dd/schema-fs.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';
import {
  type DdRefreshFs,
  type DdRefreshHash,
  type DdRefreshIssue,
  type DdWatcherPort,
  type DdWatchSubscription,
  referencesTarget,
  refreshLiveReferences,
  watchForRegeneration,
} from '../../../../src/services/dd/render/refresh.js';
import { parseSchemaDeclaration } from '../../../../src/services/dd/schema/declarations.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CHAIN = `${FIXTURES}chain/repo/`;

/** Content IS the hash: injective, deterministic, and obviously not a real digest. */
const fakeHash: DdRefreshHash = { sha256Hex: (input) => `h(${input.length}:${input.slice(0, 8)})` };

class FakeFs implements DdRefreshFs {
  constructor(private readonly files: Map<string, string>) {}
  readText(path: string): string | null {
    return this.files.get(path) ?? null;
  }
}

class FakeWatcher implements DdWatcherPort {
  roots: string[] = [];
  closed = 0;
  private handler: ((changed: readonly string[]) => void) | null = null;

  constructor(private readonly failWith?: Error) {}

  watch(root: string, onChange: (changed: readonly string[]) => void): DdWatchSubscription {
    if (this.failWith) throw this.failWith;
    this.roots.push(root);
    this.handler = onChange;
    return {
      close: () => {
        this.closed += 1;
      },
    };
  }

  /** Drive the subscription exactly as a real watcher would. */
  fire(...changed: string[]): void {
    this.handler?.(changed);
  }
}

function doc(absolutePath: string): DdDoc {
  const parsed = parse(readFileSync(absolutePath, 'utf8'));
  if (Array.isArray(parsed)) throw new Error(`fixture is not a dd document: ${absolutePath}`);
  return parsed;
}

function chainSchema(): { schema: ResolvedDdSchema; gateTerminal: readonly string[] } {
  const path = `${CHAIN}.dd/schemas/render/chain/schema.json`;
  const declaration = parseSchemaDeclaration(readFileSync(path, 'utf8'), 'render/chain', path);
  if (!declaration.ok) throw new Error('chain fixture schema failed to parse');
  return {
    schema: declaration.declaration.schema,
    gateTerminal: declaration.declaration.gateTerminal,
  };
}

describe('refreshLiveReferences — the CLI path', () => {
  it('summarises a live transclusion across files, keyed by the address as written', () => {
    const resolved = chainSchema();
    const result = refreshLiveReferences({
      doc: doc(`${CHAIN}docs/consumer.dd.json`),
      path: `${CHAIN}docs/consumer.dd.json`,
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      fs: new NodeSchemaFs(),
      hash: new NodeHash(),
    });
    expect(result.issues).toEqual([]);
    expect(result.derived.get('source.dd.json#items')).toMatchObject({
      terminal: 2,
      total: 3,
      complete: false,
    });
  });

  it('reports a basis that has moved without calling it a failure', () => {
    const resolved = chainSchema();
    const result = refreshLiveReferences({
      doc: doc(`${CHAIN}docs/consumer.dd.json`),
      path: `${CHAIN}docs/consumer.dd.json`,
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      fs: new NodeSchemaFs(),
      hash: new NodeHash(),
    });
    expect(result.refreshed).toHaveLength(1);
    expect(result.refreshed[0]?.recorded).toBe('sha-source-v1');
    expect(result.refreshed[0]?.actual).not.toBe('sha-source-v1');
    expect(result.issues).toEqual([]);
  });

  it('never rewrites the document it refreshes', () => {
    const before = readFileSync(`${CHAIN}docs/consumer.dd.json`, 'utf8');
    const resolved = chainSchema();
    const source = doc(`${CHAIN}docs/consumer.dd.json`);
    refreshLiveReferences({
      doc: source,
      path: `${CHAIN}docs/consumer.dd.json`,
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      fs: new NodeSchemaFs(),
      hash: new NodeHash(),
    });
    expect(readFileSync(`${CHAIN}docs/consumer.dd.json`, 'utf8')).toEqual(before);
    expect(source.references[0]?.sha).toBe('sha-source-v1');
  });

  it('reports an unreadable live target as a WARN and still returns a usable result', () => {
    const resolved = chainSchema();
    const result = refreshLiveReferences({
      doc: {
        dd: { schema: 'render/chain' },
        sections: [{ name: 'meta', value: { title: 'T', upstream: 'gone.dd.json#items' } }],
        references: [{ path: 'gone.dd.json', sha: 'x', mode: 'live' }],
      },
      path: '/repo/docs/consumer.dd.json',
      schema: resolved.schema,
      fs: new FakeFs(new Map()),
      hash: fakeHash,
    });
    expect(result.issues).toEqual([
      {
        class: 'basis-refresh-failed',
        severity: 'WARN',
        path: '/repo/docs/gone.dd.json',
        message: 'live reference target is missing or unreadable: /repo/docs/gone.dd.json',
      },
    ]);
    expect(result.derived.size).toBe(0);
  });

  it("leaves pinned entries alone — those are the other phase's", () => {
    const resolved = chainSchema();
    const result = refreshLiveReferences({
      doc: {
        dd: { schema: 'render/chain' },
        sections: [{ name: 'meta', value: { title: 'T', upstream: 'gone.dd.json#items' } }],
        references: [{ path: 'gone.dd.json', sha: 'x', mode: 'pinned' }],
      },
      path: '/repo/docs/consumer.dd.json',
      schema: resolved.schema,
      fs: new FakeFs(new Map()),
      hash: fakeHash,
    });
    expect(result.issues).toEqual([]);
    expect(result.refreshed).toEqual([]);
    expect(result.derived.size).toBe(0);
  });

  it('knows which documents declare a target', () => {
    const consumer = doc(`${CHAIN}docs/consumer.dd.json`);
    expect(
      referencesTarget(consumer, `${CHAIN}docs/consumer.dd.json`, `${CHAIN}docs/source.dd.json`),
    ).toBe(true);
    expect(
      referencesTarget(consumer, `${CHAIN}docs/consumer.dd.json`, `${CHAIN}docs/other.dd.json`),
    ).toBe(false);
  });
});

describe('watchForRegeneration — the subscription contract', () => {
  function harness(files: Map<string, string>, dependents: Record<string, string[]> = {}) {
    const watcher = new FakeWatcher();
    const rebuilt: string[] = [];
    const issues: DdRefreshIssue[] = [];
    const pending: Promise<unknown>[] = [];
    const subscription = watchForRegeneration({
      root: '/repo',
      watcher,
      fs: new FakeFs(files),
      hash: fakeHash,
      dependentsOf: (changed) => dependents[changed] ?? [],
      regenerate: (path) => {
        rebuilt.push(path);
        const result = Promise.resolve({ regenerated: true });
        pending.push(result);
        return result;
      },
      onIssue: (issue) => issues.push(issue),
    });
    return { watcher, rebuilt, issues, subscription, settle: () => Promise.all(pending) };
  }

  it('subscribes to the root it was given and closes through', () => {
    const files = new Map([['/repo/a.dd.json', 'one']]);
    const { watcher, subscription } = harness(files);
    expect(watcher.roots).toEqual(['/repo']);
    subscription.close();
    expect(watcher.closed).toBe(1);
  });

  it('rebuilds dependents when the content actually changes', async () => {
    const files = new Map([['/repo/src.dd.json', 'one']]);
    const { watcher, rebuilt, settle } = harness(files, {
      '/repo/src.dd.json': ['/repo/consumer.dd.json'],
    });
    watcher.fire('/repo/src.dd.json');
    files.set('/repo/src.dd.json', 'two');
    watcher.fire('/repo/src.dd.json');
    await settle();
    expect(rebuilt).toEqual(['/repo/consumer.dd.json', '/repo/consumer.dd.json']);
  });

  it('ignores an event whose content did not change (the content-hash contract)', async () => {
    const files = new Map([['/repo/src.dd.json', 'unchanged']]);
    const { watcher, rebuilt, settle } = harness(files, {
      '/repo/src.dd.json': ['/repo/consumer.dd.json'],
    });
    watcher.fire('/repo/src.dd.json');
    // A save-with-no-edit, an mtime touch, an atomic-rename dance: all the same bytes.
    watcher.fire('/repo/src.dd.json', '/repo/src.dd.json');
    watcher.fire('/repo/src.dd.json');
    await settle();
    expect(rebuilt).toEqual(['/repo/consumer.dd.json']);
  });

  it('treats a deletion as forgettable, so recreation counts as a change', async () => {
    const files = new Map([['/repo/src.dd.json', 'one']]);
    const { watcher, rebuilt, settle } = harness(files, {
      '/repo/src.dd.json': ['/repo/consumer.dd.json'],
    });
    watcher.fire('/repo/src.dd.json');
    files.delete('/repo/src.dd.json');
    watcher.fire('/repo/src.dd.json');
    files.set('/repo/src.dd.json', 'one');
    watcher.fire('/repo/src.dd.json');
    await settle();
    expect(rebuilt).toEqual(['/repo/consumer.dd.json', '/repo/consumer.dd.json']);
  });

  it('reports a failed regeneration instead of swallowing it', async () => {
    const watcher = new FakeWatcher();
    const issues: DdRefreshIssue[] = [];
    let settle: Promise<unknown> = Promise.resolve();
    watchForRegeneration({
      root: '/repo',
      watcher,
      fs: new FakeFs(new Map([['/repo/src.dd.json', 'one']])),
      hash: fakeHash,
      dependentsOf: () => ['/repo/consumer.dd.json'],
      regenerate: () => {
        settle = Promise.resolve({ regenerated: false, reason: 'schema unresolvable' });
        return settle as Promise<{ regenerated: boolean; reason?: string }>;
      },
      onIssue: (issue) => issues.push(issue),
    });
    watcher.fire('/repo/src.dd.json');
    await settle;
    await Promise.resolve();
    expect(issues).toEqual([
      {
        class: 'watch-failed',
        severity: 'WARN',
        path: '/repo/consumer.dd.json',
        message: 'regeneration failed after /repo/src.dd.json changed: schema unresolvable',
      },
    ]);
  });

  it('returns an inert subscription when the watcher itself refuses', () => {
    const issues: DdRefreshIssue[] = [];
    const subscription = watchForRegeneration({
      root: '/repo',
      watcher: new FakeWatcher(new Error('inotify limit reached')),
      fs: new FakeFs(new Map()),
      hash: fakeHash,
      dependentsOf: () => [],
      regenerate: () => Promise.resolve({ regenerated: true }),
      onIssue: (issue) => issues.push(issue),
    });
    expect(issues[0]?.class).toBe('watch-failed');
    expect(issues[0]?.message).toContain('inotify limit reached');
    // Inert, not absent: a caller must still be able to close it.
    expect(() => subscription.close()).not.toThrow();
  });
});

describe('watch → CLI regeneration end to end', () => {
  let repo = '';

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'dd-watch-'));
    cpSync(`${CHAIN}`, repo, { recursive: true });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('regenerates the consumer markdown when its transcluded source is edited', async () => {
    const source = join(repo, 'docs/source.dd.json');
    const consumer = join(repo, 'docs/consumer.dd.json');
    const consumerMd = join(repo, 'docs/consumer.dd.md');
    const io = { mode: 'json' as const, writers: { out: () => {}, err: () => {} } };

    expect(readFileSync(consumerMd, 'utf8')).toContain('[~] 2/3');

    const watcher = new FakeWatcher();
    const pending: Promise<unknown>[] = [];
    watchForRegeneration({
      root: repo,
      watcher,
      fs: new NodeSchemaFs(),
      hash: new NodeHash(),
      dependentsOf: (changed) =>
        referencesTarget(doc(consumer), consumer, changed) ? [consumer] : [],
      // The CLI path itself — not a re-derivation of it.
      regenerate: (path) => {
        const result = autoRegenerateSibling(path, repo, io);
        pending.push(result);
        return result;
      },
    });

    const edited = JSON.parse(readFileSync(source, 'utf8')) as {
      sections: { name: string; value: { state: string }[] }[];
    };
    const items = edited.sections.find((section) => section.name === 'items');
    if (!items) throw new Error('chain source lost its items section');
    for (const entry of items.value) entry.state = 'checked';
    writeFileSync(source, JSON.stringify(edited, null, 2));

    watcher.fire(source);
    await Promise.all(pending);

    expect(readFileSync(consumerMd, 'utf8')).toContain('[x] 3/3');
  });
});
