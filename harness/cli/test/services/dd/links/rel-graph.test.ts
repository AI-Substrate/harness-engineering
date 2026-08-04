import { describe, expect, it } from 'vitest';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import type { SchemaResolver } from '../../../../src/services/dd/core/validate.js';
import type { DocLoader } from '../../../../src/services/dd/core/walk.js';
import { toMermaid } from '../../../../src/services/dd/links/graph.js';
import { mapAddress } from '../../../../src/services/dd/links/map.js';
import { traverseCorpus } from '../../../../src/services/dd/links/traverse.js';

const ROOT = '/repo';
const PLAN = '/repo/docs/plan.dd.json';
const TASKS = '/repo/docs/tasks.dd.json';

const PLAN_SCHEMA: ResolvedDdSchema = {
  name: 'test/rel-plan',
  sections: {
    acceptance_criteria: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            claim: { type: 'string' },
            state: { type: 'state' },
            pressure: { type: 'link', rel: 'pressure' },
          },
        },
      },
    },
  },
};

const TASK_SCHEMA: ResolvedDdSchema = {
  name: 'test/rel-tasks',
  sections: {
    tasks: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            title: { type: 'string' },
            state: { type: 'state' },
            satisfies: { type: 'array', items: { type: 'link', rel: 'satisfies' } },
            notes_link: { type: 'link' },
          },
        },
      },
    },
  },
};

const DOCS: Record<string, DdDoc> = {
  [PLAN]: {
    dd: { schema: 'test/rel-plan' },
    sections: [
      {
        name: 'acceptance_criteria',
        value: [{ id: 'ac-0001', claim: 'it works', state: 'unchecked' }],
      },
    ],
    references: [],
  },
  [TASKS]: {
    dd: { schema: 'test/rel-tasks' },
    sections: [
      {
        name: 'tasks',
        value: [
          {
            id: 'tk-0001',
            title: 'build',
            state: 'unchecked',
            satisfies: ['plan.dd.json#acceptance_criteria/ac-0001'],
            notes_link: 'plan.dd.json#acceptance_criteria',
          },
        ],
      },
    ],
    references: [],
  },
};

const loader: DocLoader = {
  load: (path) => {
    const doc = DOCS[path];
    return doc
      ? { ok: true, path, doc, sha: `sha-${path}`, tracked: true }
      : { ok: false, path, reason: 'missing', message: `missing ${path}` };
  },
};

const schemaResolver: SchemaResolver = {
  resolve: (ref) => {
    if (ref === 'test/rel-plan') return { ok: true, schema: PLAN_SCHEMA };
    if (ref === 'test/rel-tasks') return { ok: true, schema: TASK_SCHEMA };
    return { ok: false, message: `schema not found: ${ref}` };
  },
};

function corpus() {
  return traverseCorpus(
    [PLAN, TASKS],
    { schemaResolver, docLoader: loader },
    {
      repoRoot: ROOT,
      mode: 'direct',
    },
  );
}

describe('dd graph — relation labels (dw-0141)', () => {
  it('carries the declared relation on every traversed edge', () => {
    const edges = corpus().edges;
    expect(edges.map((edge) => ({ location: edge.location, rel: edge.rel }))).toStrictEqual([
      { location: '$.sections[tasks].value[0].satisfies[0]', rel: 'satisfies' },
      // An undeclared rel is `ref` — the edge is still first-class, it just
      // carries no extra meaning.
      { location: '$.sections[tasks].value[0].notes_link', rel: 'ref' },
    ]);
  });

  it('labels a mermaid arrow with its relation, and leaves `ref` unlabelled', () => {
    const mermaid = toMermaid(corpus(), ROOT);
    expect(mermaid).toContain('-->|satisfies|');
    // `ref` is what every undeclared link already carries; labelling it would put
    // a word on every arrow in the corpus and mean nothing on any of them.
    expect(mermaid).not.toContain('|ref|');
  });
});

describe('dd graph map — --rel filter (dw-0142)', () => {
  const seed = { path: PLAN, interior: ['acceptance_criteria', 'ac-0001'] };

  it('shows every relation when no filter is given', () => {
    const result = mapAddress(
      seed,
      corpus().edges,
      { schemaResolver, docLoader: loader },
      {
        repoRoot: ROOT,
        depth: 3,
        maxNodes: 20,
        direction: 'both',
      },
    );
    expect(result.edges.map((edge) => edge.rel)).toStrictEqual(['satisfies']);
  });

  it('walks only the matching relation, and nothing when none match', () => {
    const options = { repoRoot: ROOT, depth: 3, maxNodes: 20, direction: 'both' as const };
    const kept = mapAddress(
      seed,
      corpus().edges,
      { schemaResolver, docLoader: loader },
      {
        ...options,
        rels: ['satisfies'],
      },
    );
    expect(kept.edges).toHaveLength(1);
    expect(kept.edges[0]?.rel).toBe('satisfies');

    const dropped = mapAddress(
      seed,
      corpus().edges,
      { schemaResolver, docLoader: loader },
      {
        ...options,
        rels: ['proven_by'],
      },
    );
    expect(dropped.edges).toHaveLength(0);
    // The seed itself is always on the page — a filter narrows the walk, it never
    // erases the thing that was asked about.
    expect(dropped.nodes.map((node) => node.arm)).toStrictEqual(['seed']);
  });

  it('shows the incoming work-accounting on an AC (ac-7005)', () => {
    const result = mapAddress(
      seed,
      corpus().edges,
      { schemaResolver, docLoader: loader },
      {
        repoRoot: ROOT,
        depth: 3,
        maxNodes: 20,
        direction: 'in',
        rels: ['satisfies'],
      },
    );
    const inbound = result.nodes.filter((node) => node.arm === 'in');
    expect(inbound.map((node) => node.address)).toStrictEqual(['docs/tasks.dd.json#tasks/tk-0001']);
  });
});
