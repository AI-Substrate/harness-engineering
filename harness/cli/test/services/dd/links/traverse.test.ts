import { describe, expect, it } from 'vitest';
import { traverseCorpus } from '../../../../src/services/dd/links/traverse.js';
import { deps, docPath, FixtureDocLoader, REPO } from './helpers.js';

function traverse(seeds: string[], mode: 'direct' | 'sweep' = 'sweep') {
  const loader = new FixtureDocLoader();
  return { loader, graph: traverseCorpus(seeds, deps(loader), { repoRoot: REPO, mode }) };
}

describe('dd links traversal — loop breakers', () => {
  it('terminates the two-document loop, visiting each document once', () => {
    const { loader, graph } = traverse([
      docPath('docs/cycle-a.dd.json'),
      docPath('docs/cycle-b.dd.json'),
    ]);
    // This is the mutation-sensitive assertion: without the visited set the queue
    // never drains, the derived tripwire fires, and both expectations below fail
    // in milliseconds instead of hanging the suite.
    expect(loader.loads).toEqual([
      docPath('docs/cycle-a.dd.json'),
      docPath('docs/cycle-b.dd.json'),
    ]);
    expect(graph.issues).toEqual([]);
    expect(graph.visited).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
  });

  it('terminates a document that cites itself', () => {
    const { loader, graph } = traverse([docPath('docs/self-cycle.dd.json')]);
    expect(loader.loads).toEqual([docPath('docs/self-cycle.dd.json')]);
    expect(graph.visited).toEqual([docPath('docs/self-cycle.dd.json')]);
    // Self-reference by path, not by the bare-`#` form: the edge still points
    // back at its own document, which is what the visited set has to survive.
    expect(graph.edges[0]).toMatchObject({
      from: docPath('docs/self-cycle.dd.json'),
      to: docPath('docs/self-cycle.dd.json'),
      sameDocument: false,
    });
    expect(graph.issues).toEqual([]);
  });

  it('records the bare-# form as a same-document edge', () => {
    const { graph } = traverse([docPath('docs/bare-same-doc.dd.json')]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        sameDocument: true,
        to: docPath('docs/bare-same-doc.dd.json'),
      }),
    ]);
    expect(graph.visited).toHaveLength(1);
  });

  it('terminates the whole corpus at radius infinity', () => {
    const seeds = [
      docPath('docs/cycle-a.dd.json'),
      docPath('docs/self-cycle.dd.json'),
      docPath('docs/plan.dd.json'),
      docPath('docs/nested/child.dd.json'),
    ];
    const { loader, graph } = traverse(seeds);
    expect(new Set(loader.loads).size).toBe(loader.loads.length);
    expect(graph.issues.filter((issue) => issue.class === 'link-scan-failed')).toEqual([]);
  });
});

describe('dd links traversal — edges and nodes', () => {
  it('records every schema-declared link cell as an edge', () => {
    const { graph } = traverse([docPath('docs/plan.dd.json')]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: docPath('docs/plan.dd.json'),
        to: docPath('docs/evidence.dd.json'),
        address: 'evidence.dd.json#entries',
        target: 'links/evidence/section/entries',
        sameDocument: false,
      }),
      expect.objectContaining({
        address: 'evidence.dd.json#entries/ev-5e6f',
        to: docPath('docs/evidence.dd.json'),
      }),
    ]);
  });

  it('marks documents reached by a link but never seeded as external', () => {
    const { graph } = traverse([docPath('docs/plan.dd.json')]);
    expect(graph.nodes).toEqual([
      expect.objectContaining({ path: docPath('docs/plan.dd.json'), external: false }),
      expect.objectContaining({
        path: docPath('docs/evidence.dd.json'),
        schema: 'links/evidence',
        external: true,
      }),
    ]);
  });

  it('never follows an address out of the repository', () => {
    const { graph, loader } = traverse([docPath('docs/path-escape.dd.json')]);
    expect(graph.edges[0]?.to).toBeNull();
    expect(loader.loads).toEqual([docPath('docs/path-escape.dd.json')]);
  });

  it('reports a document whose schema will not resolve instead of calling it a leaf', () => {
    const { graph } = traverse([docPath('docs/plan.dd.json')], 'direct');
    const unknown = traverseCorpus(
      [docPath('docs/plan.dd.json')],
      {
        schemaResolver: { resolve: () => ({ ok: false, message: 'schema not found: links/plan' }) },
        docLoader: new FixtureDocLoader(),
      },
      { repoRoot: REPO, mode: 'direct' },
    );
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(unknown.edges).toEqual([]);
    expect(unknown.nodes).toEqual([
      expect.objectContaining({ path: docPath('docs/plan.dd.json'), schema: 'links/plan' }),
    ]);
    expect(unknown.issues).toEqual([
      expect.objectContaining({ class: 'link-scan-incomplete', severity: 'WARN' }),
    ]);
  });

  it('reports an unreadable seed, and stays silent about an unreadable neighbour', () => {
    const seeded = traverse([docPath('docs/missing.dd.json')]);
    expect(seeded.graph.issues).toEqual([
      expect.objectContaining({ class: 'link-scan-incomplete', severity: 'WARN' }),
    ]);
    // A neighbour that will not load is dd-core's `address-target-missing` WARN,
    // owned by the document that points at it — repeating it here would double it.
    const neighbour = traverse([docPath('docs/target-missing.dd.json')]);
    expect(neighbour.graph.issues).toEqual([]);
    expect(neighbour.graph.edges[0]?.to).toBe(docPath('docs/missing.dd.json'));
  });
});

describe('dd links traversal — sweep exclusion (OD-1)', () => {
  const excluded = docPath('docs/sweep-excluded.dd.json');

  it('skips an opted-out document in sweep mode only', () => {
    const paths = (mode: 'direct' | 'sweep') =>
      traverse([excluded], mode).graph.nodes.map((node) => node.path);
    expect(paths('sweep')).toEqual([]);
    expect(paths('direct')).toContain(excluded);
  });

  it('skips fixture-path documents in sweep mode only', () => {
    const loader = new FixtureDocLoader();
    const asFixture = `${REPO}/test/services/dd/fixtures/plan.dd.json`;
    const load = (mode: 'direct' | 'sweep') =>
      traverseCorpus(
        [asFixture],
        {
          schemaResolver: deps(loader).schemaResolver,
          docLoader: {
            load: (path) => ({ ...loader.load(docPath('docs/plan.dd.json')), path }) as never,
          },
        },
        { repoRoot: REPO, mode, follow: false },
      );
    expect(load('sweep').nodes).toEqual([]);
    expect(load('direct').nodes).toEqual([expect.objectContaining({ path: asFixture })]);
  });
});
