import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import type {
  SchemaResolveResult,
  SchemaResolver,
} from '../../../../src/services/dd/core/validate.js';
import type { DocLoader, DocLoadResult } from '../../../../src/services/dd/core/walk.js';
import {
  addressableAt,
  anchorForLocation,
  type DdMapDirection,
  type DdMapResult,
  indexDocument,
  isWithinLocation,
  mapAddress,
  resolveMapSeed,
} from '../../../../src/services/dd/links/map.js';
import type { DdLinkEdge } from '../../../../src/services/dd/links/model.js';
import {
  cellWidth,
  PLAIN_MAP_PALETTE,
  renderMapTree,
} from '../../../../src/services/dd/links/report.js';
import { traverseCorpus } from '../../../../src/services/dd/links/traverse.js';

const REPO = '/repo';

/** Built rather than written, so no regex literal carries a control character. */
const ESC = String.fromCharCode(27);

/**
 * A plan whose ROWS carry links and whose `meta` carries a link of its own.
 *
 * The `meta` link is the whole reason this schema exists: it is the edge that a
 * document-scoped answer wrongly includes when it is handed a row address, so
 * every scoping assertion below can fail rather than merely pass.
 */
const PLAN_SCHEMA: ResolvedDdSchema = {
  name: 'map/plan',
  sections: {
    meta: {
      shape: {
        type: 'object',
        fields: { title: { type: 'string' }, log: { type: 'link' } },
      },
    },
    rows: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            claim: { type: 'text' },
            state: { type: 'state' },
            pressure: { type: 'link' },
            proven_by: { type: 'link' },
          },
        },
      },
    },
  },
};

const LOG_SCHEMA: ResolvedDdSchema = {
  name: 'map/log',
  sections: {
    entries: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            text: { type: 'string' },
            cites: { type: 'link' },
          },
        },
      },
    },
  },
};

const PRESSURE_SCHEMA: ResolvedDdSchema = {
  name: 'map/pressure',
  sections: {
    rows: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            criterion: { type: 'string' },
            state: { type: 'state' },
          },
        },
      },
    },
  },
};

const SCHEMAS = new Map<string, ResolvedDdSchema>([
  [PLAN_SCHEMA.name, PLAN_SCHEMA],
  [LOG_SCHEMA.name, LOG_SCHEMA],
  [PRESSURE_SCHEMA.name, PRESSURE_SCHEMA],
]);

class MapSchemaResolver implements SchemaResolver {
  resolve(schemaRef: string): SchemaResolveResult {
    const found = SCHEMAS.get(schemaRef);
    return found ? { ok: true, schema: found } : { ok: false, message: `no schema: ${schemaRef}` };
  }
}

class MapDocLoader implements DocLoader {
  readonly loads: string[] = [];

  constructor(private readonly docs: ReadonlyMap<string, DdDoc>) {}

  load(path: string): DocLoadResult {
    this.loads.push(path);
    const doc = this.docs.get(path);
    return doc
      ? { ok: true, path, doc, sha: `sha-${path}`, tracked: true }
      : { ok: false, path, reason: 'missing', message: `address target is missing: ${path}` };
  }
}

function corpus(docs: Record<string, DdDoc>): {
  deps: { schemaResolver: SchemaResolver; docLoader: MapDocLoader };
  edges: DdLinkEdge[];
  paths: string[];
} {
  const map = new Map(Object.entries(docs));
  const deps = { schemaResolver: new MapSchemaResolver(), docLoader: new MapDocLoader(map) };
  const paths = [...map.keys()].sort();
  const graph = traverseCorpus(paths, deps, { repoRoot: REPO, mode: 'direct' });
  return { deps, edges: graph.edges, paths };
}

function doc(schema: string, sections: DdDoc['sections']): DdDoc {
  return { dd: { schema }, sections, references: [] };
}

/** The shape the whole phase turns on: two rows, same section, different targets. */
function twoRowCorpus() {
  return corpus({
    [`${REPO}/docs/plan.dd.json`]: doc('map/plan', [
      { name: 'meta', value: { title: 'A plan', log: 'log.dd.json#entries' } },
      {
        name: 'rows',
        value: [
          {
            id: 'ac-0001',
            claim: 'The first claim',
            state: 'checked',
            pressure: 'pressure.dd.json#rows/bp-0001',
            proven_by: 'log.dd.json#entries/lg-0001',
          },
          {
            id: 'ac-0002',
            claim: 'The second claim',
            state: 'unchecked',
            pressure: 'pressure.dd.json#rows/bp-0002',
          },
        ],
      },
    ]),
    [`${REPO}/docs/pressure.dd.json`]: doc('map/pressure', [
      {
        name: 'rows',
        value: [
          { id: 'bp-0001', criterion: 'The first pressure', state: 'checked' },
          { id: 'bp-0002', criterion: 'The second pressure', state: 'unchecked' },
        ],
      },
    ]),
    [`${REPO}/docs/log.dd.json`]: doc('map/log', [
      {
        name: 'entries',
        value: [
          {
            id: 'lg-0001',
            text: 'Proved the first claim',
            cites: 'pressure.dd.json#rows/bp-0001',
          },
          { id: 'lg-0002', text: 'Mentions the first claim', cites: 'plan.dd.json#rows/ac-0001' },
        ],
      },
    ]),
  });
}

function mapFrom(
  seedAddress: string,
  built: ReturnType<typeof corpus>,
  options: Partial<{ depth: number; maxNodes: number; direction: DdMapDirection }> = {},
): DdMapResult {
  const seed = resolveMapSeed(seedAddress, built.deps, { repoRoot: REPO });
  if (!seed.ok) throw new Error(`seed did not resolve: ${JSON.stringify(seed.issues)}`);
  return mapAddress(seed, built.edges, built.deps, {
    repoRoot: REPO,
    depth: options.depth ?? 3,
    maxNodes: options.maxNodes ?? 20,
    direction: options.direction ?? 'both',
  });
}

function addresses(result: DdMapResult, arm: 'in' | 'out'): string[] {
  return result.nodes.filter((node) => node.arm === arm).map((node) => node.address);
}

describe('dd graph map — item-scoped edge selection (T002)', () => {
  it('answers about the ROW, not the file the row lives in', () => {
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, twoRowCorpus(), {
      direction: 'out',
      depth: 1,
    });
    // Only ac-0001's own two cells. The `meta.log` edge and ac-0002's pressure
    // both belong to the same DOCUMENT and to neither this row nor its answer —
    // which is exactly the confusion `dd links` still has.
    expect(addresses(result, 'out')).toEqual([
      'docs/pressure.dd.json#rows/bp-0001',
      'docs/log.dd.json#entries/lg-0001',
    ]);
    expect(result.seed.location).toBe('$.sections[rows].value[0]');
  });

  it('gives a sibling row a different answer, so a section-wide answer cannot pass', () => {
    const built = twoRowCorpus();
    const first = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, {
      direction: 'out',
      depth: 1,
    });
    const second = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0002`, built, {
      direction: 'out',
      depth: 1,
    });
    expect(addresses(second, 'out')).toEqual(['docs/pressure.dd.json#rows/bp-0002']);
    expect(addresses(first, 'out')).not.toEqual(addresses(second, 'out'));
  });

  it('keeps the section-wide answer for a section address, and the file for a bare path', () => {
    const built = twoRowCorpus();
    const section = mapFrom(`${REPO}/docs/plan.dd.json#rows`, built, {
      direction: 'out',
      depth: 1,
    });
    expect(addresses(section, 'out')).toEqual([
      'docs/pressure.dd.json#rows/bp-0001',
      'docs/log.dd.json#entries/lg-0001',
      'docs/pressure.dd.json#rows/bp-0002',
    ]);
    // The section answer is everything under the section and NOTHING above it.
    expect(addresses(section, 'out')).not.toContain('docs/log.dd.json#entries');

    const whole = mapFrom(`${REPO}/docs/plan.dd.json`, built, { direction: 'out', depth: 1 });
    expect(addresses(whole, 'out')).toContain('docs/log.dd.json#entries');
    expect(addresses(whole, 'out')).toHaveLength(4);
  });

  it('derives the prefix from the DOCUMENT, so a row is found wherever it sits', () => {
    // The id says nothing about position. Moving `ac-0002` to the front must move
    // its location with it — an implementation that mapped id text to an index
    // would answer with the other row's links here and stay green above.
    const built = corpus({
      [`${REPO}/docs/plan.dd.json`]: doc('map/plan', [
        { name: 'meta', value: { title: 'Reordered', log: 'log.dd.json#entries' } },
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0002',
              claim: 'Now first',
              state: 'unchecked',
              pressure: 'p.dd.json#rows/bp-0002',
            },
            {
              id: 'ac-0001',
              claim: 'Now second',
              state: 'checked',
              pressure: 'p.dd.json#rows/bp-0001',
            },
          ],
        },
      ]),
      [`${REPO}/docs/p.dd.json`]: doc('map/pressure', [
        {
          name: 'rows',
          value: [
            { id: 'bp-0001', criterion: 'first', state: 'checked' },
            { id: 'bp-0002', criterion: 'second', state: 'unchecked' },
          ],
        },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, {
      direction: 'out',
      depth: 1,
    });
    expect(result.seed.location).toBe('$.sections[rows].value[1]');
    expect(addresses(result, 'out')).toEqual(['docs/p.dd.json#rows/bp-0001']);
  });

  it('does not let a cell claim a sibling whose name merely extends it', () => {
    // The containment trap that is real. `[1]` cannot be confused with `[10]`
    // because the `]` terminates it — but `…value[0].pressure` IS a textual
    // prefix of `…value[0].pressure_note`, so a bare `startsWith` hands one cell
    // the sibling cell's edge.
    const schema: ResolvedDdSchema = {
      name: 'map/twin',
      sections: {
        rows: {
          shape: {
            type: 'array',
            items: {
              type: 'object',
              fields: {
                id: { type: 'string' },
                pressure: { type: 'link' },
                pressure_note: { type: 'link' },
              },
            },
          },
        },
      },
    };
    SCHEMAS.set(schema.name, schema);
    const built = corpus({
      [`${REPO}/docs/twin.dd.json`]: doc('map/twin', [
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              pressure: 'p.dd.json#rows/bp-0001',
              pressure_note: 'p.dd.json#rows/bp-0002',
            },
          ],
        },
      ]),
      [`${REPO}/docs/p.dd.json`]: doc('map/pressure', [
        {
          name: 'rows',
          value: [
            { id: 'bp-0001', criterion: 'the cell', state: 'checked' },
            { id: 'bp-0002', criterion: 'the sibling', state: 'checked' },
          ],
        },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/twin.dd.json#rows/ac-0001/pressure`, built, {
      direction: 'out',
      depth: 1,
    });
    expect(result.seed.location).toBe('$.sections[rows].value[0].pressure');
    expect(addresses(result, 'out')).toEqual(['docs/p.dd.json#rows/bp-0001']);
  });

  it('rejects a boundary-free containment directly', () => {
    const prefix = '$.sections[rows].value[1]';
    expect(isWithinLocation('$.sections[rows].value[1]', prefix)).toBe(true);
    expect(isWithinLocation('$.sections[rows].value[1].pressure', prefix)).toBe(true);
    expect(isWithinLocation('$.sections[rows].value[1][0]', prefix)).toBe(true);
    expect(isWithinLocation('$.sections[rows].value[10].pressure', prefix)).toBe(false);
    expect(isWithinLocation('$.sections[meta].value.log', prefix)).toBe(false);
    // The case a bare `startsWith` gets wrong: a sibling field whose name
    // extends this one. An array index is already terminated by its `]`.
    expect(isWithinLocation('$.sections[rows].value[1]x', prefix)).toBe(false);
    const cell = '$.sections[rows].value[1].pressure';
    expect(isWithinLocation('$.sections[rows].value[1].pressure_note', cell)).toBe(false);
    expect(isWithinLocation('$.sections[rows].value[1].pressure.deep', cell)).toBe(true);
    // The document node: everything is inside it, which is the whole-file answer.
    expect(isWithinLocation('$.sections[meta].value.log', null)).toBe(true);
  });
});

describe('dd graph map — the address index (T002)', () => {
  const built = twoRowCorpus();
  const index = indexDocument(
    `${REPO}/docs/plan.dd.json`,
    built.deps.docLoader.load(`${REPO}/docs/plan.dd.json`).ok
      ? (built.deps.docLoader.load(`${REPO}/docs/plan.dd.json`) as { doc: DdDoc }).doc
      : (undefined as never),
    PLAN_SCHEMA,
  );

  it('pairs every interior with the location an edge would carry', () => {
    expect(addressableAt(index, ['rows', 'ac-0002'])?.location).toBe('$.sections[rows].value[1]');
    expect(addressableAt(index, ['rows', 'ac-0001', 'pressure'])?.location).toBe(
      '$.sections[rows].value[0].pressure',
    );
    expect(addressableAt(index, ['meta'])?.location).toBe('$.sections[meta].value');
    expect(addressableAt(index, ['rows', 'ac-9999'])).toBeUndefined();
  });

  it('names the row a cell belongs to, not the cell and not the file', () => {
    expect(anchorForLocation(index, '$.sections[rows].value[0].pressure')).toEqual([
      'rows',
      'ac-0001',
    ]);
    // Nothing in `meta` is an instance, so the section is the honest answer.
    expect(anchorForLocation(index, '$.sections[meta].value.log')).toEqual(['meta']);
  });

  it('agrees with the locations the traversal actually produced', () => {
    // The index and `collectLinkCells` are two walks over one shape, and they
    // only stay honest while every edge lands inside something the index knows.
    for (const edge of built.edges) {
      if (edge.from !== `${REPO}/docs/plan.dd.json`) continue;
      const anchor = anchorForLocation(index, edge.location);
      expect(anchor.length).toBeGreaterThan(0);
      expect(addressableAt(index, anchor)).toBeDefined();
    }
  });
});

describe('dd graph map — bidirectional transitive walk (T003)', () => {
  it('answers both questions in one invocation, past the first hop', () => {
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, twoRowCorpus());
    const outbound = result.nodes.filter((node) => node.arm === 'out');
    // Two hops out: the row cites the log entry, and the log entry cites the
    // pressure row. One hop in either direction cannot answer this.
    expect(outbound.map((node) => [node.address, node.distance])).toEqual([
      ['docs/pressure.dd.json#rows/bp-0001', 1],
      ['docs/log.dd.json#entries/lg-0001', 1],
    ]);
    const twoHop = result.edges.filter(
      (edge) => edge.from === outbound[1]?.key && edge.arm === 'out',
    );
    expect(twoHop).toHaveLength(1);
    expect(twoHop[0]?.address).toBe('pressure.dd.json#rows/bp-0001');

    // …and on the inbound arm, in the same answer, an edge from another document.
    expect(addresses(result, 'in')).toEqual(['docs/log.dd.json#entries/lg-0002']);
  });

  it('names the citing ROW on the inbound arm, never merely the citing file', () => {
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, twoRowCorpus(), {
      direction: 'in',
    });
    expect(result.nodes.map((node) => node.address)).toEqual([
      'docs/plan.dd.json#rows/ac-0001',
      'docs/log.dd.json#entries/lg-0002',
    ]);
  });

  it('honours --direction on every pass, not merely the first (P4 F002)', () => {
    const built = twoRowCorpus();
    const out = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, { direction: 'out' });
    expect(out.nodes.some((node) => node.arm === 'in')).toBe(false);
    const inward = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, { direction: 'in' });
    expect(inward.nodes.some((node) => node.arm === 'out')).toBe(false);
  });

  it('terminates a cycle and draws it as a cycle', () => {
    const built = corpus({
      [`${REPO}/docs/a.dd.json`]: doc('map/log', [
        {
          name: 'entries',
          value: [{ id: 'lg-000a', text: 'A', cites: 'b.dd.json#entries/lg-000b' }],
        },
      ]),
      [`${REPO}/docs/b.dd.json`]: doc('map/log', [
        {
          name: 'entries',
          value: [{ id: 'lg-000b', text: 'B', cites: 'a.dd.json#entries/lg-000a' }],
        },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/a.dd.json#entries/lg-000a`, built, {
      direction: 'out',
      depth: 10,
    });
    expect(result.nodes.map((node) => node.address)).toEqual([
      'docs/a.dd.json#entries/lg-000a',
      'docs/b.dd.json#entries/lg-000b',
    ]);
    // The closing edge is recorded even though it schedules nothing: a cycle
    // drawn as a chain is a wrong picture, not a tidier one.
    expect(result.edges).toHaveLength(2);
    expect(result.truncated.cut).toBe(false);
  });

  it('does not lose a node when several rows cite the same target', () => {
    // Without the visited check the repeats are re-queued, the walk's derived
    // tripwire fires, and whatever is still queued is dropped — a SHORT answer
    // reported as a complete one, which is the failure this map must never make.
    const built = corpus({
      [`${REPO}/docs/hub.dd.json`]: doc('map/plan', [
        { name: 'meta', value: { title: 'Repeats' } },
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              claim: 'one',
              state: 'unchecked',
              pressure: 'same.dd.json#rows/bp-0001',
            },
            {
              id: 'ac-0002',
              claim: 'two',
              state: 'unchecked',
              pressure: 'same.dd.json#rows/bp-0001',
            },
            {
              id: 'ac-0003',
              claim: 'three',
              state: 'unchecked',
              pressure: 'same.dd.json#rows/bp-0001',
            },
            {
              id: 'ac-0004',
              claim: 'four',
              state: 'unchecked',
              pressure: 'other.dd.json#rows/bp-0002',
            },
          ],
        },
      ]),
      [`${REPO}/docs/same.dd.json`]: doc('map/pressure', [
        { name: 'rows', value: [{ id: 'bp-0001', criterion: 'cited thrice', state: 'checked' }] },
      ]),
      [`${REPO}/docs/other.dd.json`]: doc('map/pressure', [
        { name: 'rows', value: [{ id: 'bp-0002', criterion: 'cited once', state: 'checked' }] },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/hub.dd.json#rows`, built, {
      direction: 'out',
      depth: 2,
      maxNodes: 50,
    });
    expect(addresses(result, 'out')).toEqual([
      'docs/same.dd.json#rows/bp-0001',
      'docs/other.dd.json#rows/bp-0002',
    ]);
    expect(result.truncated.cut).toBe(false);
    // Every citation is still an edge — deduplicating NODES must not silently
    // deduplicate the links that prove the shape.
    expect(
      result.edges.filter((edge) => edge.address === 'same.dd.json#rows/bp-0001'),
    ).toHaveLength(3);
  });

  it('terminates a row that cites itself', () => {
    const built = corpus({
      [`${REPO}/docs/self.dd.json`]: doc('map/log', [
        {
          name: 'entries',
          value: [{ id: 'lg-0001', text: 'Self', cites: 'self.dd.json#entries/lg-0001' }],
        },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/self.dd.json#entries/lg-0001`, built, { depth: 10 });
    expect(result.nodes).toHaveLength(1);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('shows a dangling target rather than swallowing it', () => {
    const built = corpus({
      [`${REPO}/docs/plan.dd.json`]: doc('map/plan', [
        { name: 'meta', value: { title: 'Broken' } },
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              claim: 'Points nowhere',
              state: 'unchecked',
              pressure: 'gone.dd.json#rows/bp-0001',
            },
          ],
        },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, { direction: 'out' });
    const dangling = result.nodes.filter((node) => node.arm === 'out');
    expect(dangling).toHaveLength(1);
    // The address is still reported in full — a target that is missing is not a
    // target that is unknown, and naming it is how a reader finds what to fix.
    expect(dangling[0]).toMatchObject({
      resolved: false,
      address: 'docs/gone.dd.json#rows/bp-0001',
    });
  });

  it('reports a seed that does not resolve, with the reason the resolver gives', () => {
    const built = twoRowCorpus();
    const missing = resolveMapSeed(`${REPO}/docs/plan.dd.json#rows/ac-9999`, built.deps, {
      repoRoot: REPO,
    });
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.issues[0]).toMatchObject({
      class: 'link-unresolved',
      severity: 'ERROR',
      reason: 'id-not-found',
    });
  });
});

/** A corpus that is deliberately bigger than the bounds it will be walked with. */
function wideCorpus(width: number, chain: number) {
  const docs: Record<string, DdDoc> = {};
  docs[`${REPO}/docs/hub.dd.json`] = doc('map/plan', [
    { name: 'meta', value: { title: 'Hub' } },
    {
      name: 'rows',
      value: Array.from({ length: width }, (_, index) => ({
        id: `ac-${String(index).padStart(4, '0')}`,
        claim: `Claim ${index}`,
        state: 'unchecked',
        pressure: `leaf-${index}.dd.json#rows/bp-0001`,
      })),
    },
  ]);
  for (let index = 0; index < width; index += 1) {
    docs[`${REPO}/docs/leaf-${index}.dd.json`] = doc('map/pressure', [
      { name: 'rows', value: [{ id: 'bp-0001', criterion: `Leaf ${index}`, state: 'unchecked' }] },
    ]);
  }
  for (let step = 0; step < chain; step += 1) {
    docs[`${REPO}/docs/step-${step}.dd.json`] = doc('map/log', [
      {
        name: 'entries',
        value: [
          {
            id: 'lg-0001',
            text: `Step ${step}`,
            cites: `step-${step + 1}.dd.json#entries/lg-0001`,
          },
        ],
      },
    ]);
  }
  docs[`${REPO}/docs/step-${chain}.dd.json`] = doc('map/log', [
    { name: 'entries', value: [{ id: 'lg-0001', text: 'The end' }] },
  ]);
  return corpus(docs);
}

describe('dd graph map — the bounds bind (T006)', () => {
  it('stops at --max-nodes over a corpus that is larger than it', () => {
    const built = wideCorpus(40, 0);
    const result = mapFrom(`${REPO}/docs/hub.dd.json#rows`, built, {
      direction: 'out',
      maxNodes: 20,
      depth: 5,
    });
    expect(result.nodes).toHaveLength(20);
    expect(result.truncated.cut).toBe(true);
    expect(result.truncated.nodes).toHaveLength(21);
    expect(result.truncated.nodes.every((cut) => cut.reason === 'max-nodes')).toBe(true);
  });

  it('changes its answer when the bound is raised past the corpus', () => {
    // A cap only ever run against a small corpus has been demonstrated, not
    // tested: the same seed under two bounds must give two different answers.
    const built = wideCorpus(40, 0);
    const bounded = mapFrom(`${REPO}/docs/hub.dd.json#rows`, built, {
      direction: 'out',
      maxNodes: 20,
      depth: 5,
    });
    const loose = mapFrom(`${REPO}/docs/hub.dd.json#rows`, built, {
      direction: 'out',
      maxNodes: 100,
      depth: 5,
    });
    expect(loose.nodes).toHaveLength(41);
    expect(loose.truncated.cut).toBe(false);
    expect(loose.truncated.nodes).toEqual([]);
    expect(bounded.nodes.length).toBeLessThan(loose.nodes.length);
  });

  it('stops at --depth over a chain that is deeper than it, and says where', () => {
    const built = wideCorpus(0, 8);
    const result = mapFrom(`${REPO}/docs/step-0.dd.json#entries/lg-0001`, built, {
      direction: 'out',
      depth: 3,
      maxNodes: 100,
    });
    expect(result.nodes.map((node) => node.distance)).toEqual([0, 1, 2, 3]);
    expect(result.truncated.cut).toBe(true);
    expect(result.truncated.nodes).toEqual([
      { address: 'docs/step-4.dd.json#entries/lg-0001', reason: 'depth', arm: 'out' },
    ]);
  });

  it('reports `truncated` on an unbounded run too, so an answer is never ambiguous', () => {
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, twoRowCorpus());
    expect(result.truncated).toEqual({ cut: false, nodes: [] });
    expect(result.bounds).toEqual({ depth: 3, max_nodes: 20, direction: 'both' });
  });

  it('never lets one arm\u2019s deeper nodes displace the other arm\u2019s nearer ones', () => {
    // What level order actually buys. A depth-first walk of the outbound arm
    // would spend the whole budget on the chain and report "nothing reaches
    // this" — which is a wrong answer, not a smaller one.
    const built = corpus({
      [`${REPO}/docs/plan.dd.json`]: doc('map/plan', [
        { name: 'meta', value: { title: 'Deep one way' } },
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              claim: 'Seed',
              state: 'unchecked',
              proven_by: 'chain.dd.json#entries/lg-0001',
            },
          ],
        },
      ]),
      [`${REPO}/docs/chain.dd.json`]: doc('map/log', [
        {
          name: 'entries',
          value: [
            { id: 'lg-0001', text: 'One', cites: 'chain.dd.json#entries/lg-0002' },
            { id: 'lg-0002', text: 'Two', cites: 'chain.dd.json#entries/lg-0003' },
            { id: 'lg-0003', text: 'Three' },
          ],
        },
      ]),
      [`${REPO}/docs/citer.dd.json`]: doc('map/log', [
        {
          name: 'entries',
          value: [{ id: 'lg-9001', text: 'Cites the seed', cites: 'plan.dd.json#rows/ac-0001' }],
        },
      ]),
    });
    const result = mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, {
      maxNodes: 3,
      depth: 5,
    });
    expect(result.nodes.filter((node) => node.arm === 'in')).toHaveLength(1);
    expect(result.nodes.filter((node) => node.distance === 2)).toHaveLength(0);
    expect(result.truncated.cut).toBe(true);
  });
});

describe('dd graph map — the human render (T005)', () => {
  const render = (): string =>
    renderMapTree(mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, twoRowCorpus()));

  it('pins the plain render, byte for byte', () => {
    expect(render()).toBe(
      [
        'dd graph map  plan.dd.json#rows/ac-0001',
        '  relative to docs/',
        '',
        '  <- inbound   what reaches this',
        '  └─<-     log.dd.json#entries/lg-0002  Mentions the first claim',
        '',
        '  @  [x] #rows/ac-0001  The first claim',
        '',
        '  -> outbound  where this goes',
        '  ├─-> [x] pressure.dd.json#rows/bp-0001  The first pressure',
        '  └─->     log.dd.json#entries/lg-0001  Proved the first claim',
        // The diamond drawn as a diamond: the log entry reaches the pressure row
        // the seed already reaches, so it is referenced rather than repeated.
        '    └─↩ pressure.dd.json#rows/bp-0001  (already shown)',
        '',
        '',
      ].join('\n'),
    );
  });

  it('carries no ANSI at all through the plain palette', () => {
    expect(render()).not.toContain(`${ESC}[`);
  });

  it('wraps inside 80 columns', () => {
    for (const line of render().split('\n')) {
      expect(cellWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  it('styles through the palette, and only through the palette', () => {
    const styled = renderMapTree(
      mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, twoRowCorpus()),
      {
        ...PLAIN_MAP_PALETTE,
        seed: (text) => `<seed>${text}</seed>`,
        mark: (mark) => (text) => `<${mark}>${text}</${mark}>`,
      },
    );
    expect(styled).toContain('<seed>ac-0001</seed>');
    expect(styled).toContain('<[x]>[x]</[x]>');

    // The marks are where colour does real work, so each one must reach the
    // palette under its own name rather than through a shared "state" accent.
    const holding = renderMapTree(
      mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0002`, twoRowCorpus(), { direction: 'out' }),
      { ...PLAIN_MAP_PALETTE, mark: (mark) => (text) => `<${mark}>${text}</${mark}>` },
    );
    expect(holding).toContain('<[ ]>[ ]</[ ]>');
  });

  it('makes a cut impossible to miss, and never counts it short', () => {
    const rendered = renderMapTree(
      mapFrom(`${REPO}/docs/hub.dd.json#rows`, wideCorpus(40, 0), {
        direction: 'out',
        maxNodes: 8,
        depth: 5,
      }),
    );
    expect(rendered).toContain('! TRUNCATED — 33 node(s) not shown');
    // Only a sample is named, but the count above it is the whole truth.
    expect(rendered).toContain('… and 28 more');
  });

  it('says so when a row reaches nothing, instead of drawing an empty tree', () => {
    const rendered = renderMapTree(
      mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0002`, twoRowCorpus(), { direction: 'in' }),
    );
    expect(rendered).toContain('(nothing in the corpus reaches this)');
  });

  it('shows an unresolved target as unresolved', () => {
    const built = corpus({
      [`${REPO}/docs/plan.dd.json`]: doc('map/plan', [
        { name: 'meta', value: { title: 'Broken' } },
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              claim: 'Points nowhere',
              state: 'unchecked',
              pressure: 'gone.dd.json#rows/bp-0001',
            },
          ],
        },
      ]),
    });
    expect(
      renderMapTree(mapFrom(`${REPO}/docs/plan.dd.json#rows/ac-0001`, built, { direction: 'out' })),
    ).toContain('(unresolved)');
  });
});

/**
 * The width contract, proved on an address that actually breaks it.
 *
 * A width test over today's exemplar addresses proves nothing: those addresses
 * are short, so every line passes whether or not the render can handle a long
 * one. These build a corpus whose addresses genuinely exceed the budget, and
 * assert on the VISIBLE width — ANSI stripped — because a `.length` over a
 * styled string counts escape bytes as columns and would wave a broken layout
 * through. A self-defeating probe is worse than no probe.
 */
/**
 * The width helper itself, pinned against hand-written facts.
 *
 * This block exists because of what the shared oracle CANNOT do. Making the
 * renderer and the tests measure through one function is what stops their
 * geometry disagreeing — but it also means a mutation of that function moves
 * both sides together and every width assertion stays green. Agreement is not
 * correctness. So the helper gets its own anchor: known code points, known
 * widths, written out rather than computed.
 *
 * And the anchor's POPULATION has to match the CLAIM's population. The table
 * spans CJK, Hangul, kana, Yi, Tangut, compatibility forms, fullwidth,
 * halfwidth, emoji, transport symbols and three astral planes; a block that
 * sampled only ideographs would be sound in shape and unrepresentative in
 * reach — proof that shares a blind spot with the thing it proves.
 *
 * Every expected value below was read from Python's `unicodedata`
 * (`east_asian_width` + `category`, Unicode 16.0.0) — the same source the table
 * was derived from, but consulted per code point and written out by hand, so a
 * wrongly regenerated table fails here instead of being ratified by it.
 */
describe('cellWidth — characters are not columns (T005)', () => {
  it('counts ASCII one cell each', () => {
    expect(cellWidth('')).toBe(0);
    expect(cellWidth('a')).toBe(1);
    expect(cellWidth('docs/plan.dd.json#rows/ac-0001')).toBe(30);
  });

  it('counts every WIDE family as two cells, not just the ideographs', () => {
    expect(cellWidth('\u1100')).toBe(2); // Hangul Jamo choseong kiyeok
    expect(cellWidth('\u3042')).toBe(2); // hiragana A
    expect(cellWidth('\u30a1')).toBe(2); // katakana small A
    expect(cellWidth('\u33ff')).toBe(2); // CJK compatibility, SQUARE GAL
    expect(cellWidth('\u3400')).toBe(2); // CJK extension A
    expect(cellWidth('\u4e00')).toBe(2); // CJK unified ideograph
    expect(cellWidth('\ua000')).toBe(2); // Yi syllable
    expect(cellWidth('\ua960')).toBe(2); // Hangul Jamo extended-A
    expect(cellWidth('\uac00')).toBe(2); // Hangul syllable GA
    expect(cellWidth('\ud7a3')).toBe(2); // Hangul syllable HIH
    expect(cellWidth('\uf900')).toBe(2); // CJK compatibility ideograph
    expect(cellWidth('\ufe30')).toBe(2); // vertical presentation form
    expect(cellWidth('\uff21')).toBe(2); // FULLWIDTH LATIN CAPITAL LETTER A
    expect(cellWidth('\uffe5')).toBe(2); // fullwidth yen sign
  });

  it('counts the ASTRAL wide families, on all three planes', () => {
    expect(cellWidth('\u{17000}')).toBe(2); // Tangut
    expect(cellWidth('\u{1b000}')).toBe(2); // kana supplement
    expect(cellWidth('\u{20000}')).toBe(2); // CJK extension B, plane 2
    expect(cellWidth('\u{2a6df}')).toBe(2); // CJK extension B, upper end
    expect(cellWidth('\u{30000}')).toBe(2); // CJK extension G, plane 3
  });

  it('counts emoji and transport symbols as two cells', () => {
    // The finding that sent the table back to be derived rather than authored:
    // U+1F680 is East_Asian_Width=W, and an authored table had no range for it.
    expect(cellWidth('\u{1f680}')).toBe(2); // ROCKET
    expect(cellWidth('\u{1f600}')).toBe(2); // GRINNING FACE
    expect(cellWidth('\u{1f947}')).toBe(2); // FIRST PLACE MEDAL
    expect(cellWidth('\u{1f9d1}')).toBe(2); // ADULT
    expect(cellWidth('\u{1fa70}')).toBe(2); // BALLET SHOES
    expect(cellWidth('\u231a')).toBe(2); // WATCH, a BMP emoji
  });

  it('counts HALFWIDTH forms as one cell, despite living beside the fullwidth ones', () => {
    expect(cellWidth('\uff61')).toBe(1); // HALFWIDTH IDEOGRAPHIC FULL STOP
    expect(cellWidth('\uff9f')).toBe(1); // halfwidth katakana semi-voiced mark
  });

  it('counts combining marks and format controls as no cells at all', () => {
    expect(cellWidth('e\u0301')).toBe(1); // e + combining acute
    expect(cellWidth('\u200b')).toBe(0); // zero-width space
    expect(cellWidth('a\u200db')).toBe(2); // zero-width joiner between two letters
    expect(cellWidth('\ufe0f')).toBe(0); // variation selector-16
  });

  it('counts AMBIGUOUS as one cell — the documented decision, not an accident', () => {
    // There is no correct answer for East_Asian_Width=A: it renders one cell in
    // a Latin context and two in a CJK one. One is chosen, and it is load
    // bearing — the render's OWN furniture is ambiguous, so choosing two would
    // have made every tree line count double against its own budget.
    expect(cellWidth('\u25b6')).toBe(1); // BLACK RIGHT-POINTING TRIANGLE
    expect(cellWidth('\u00e9')).toBe(1); // e-acute, precomposed
    expect(cellWidth('\u2502')).toBe(1); // the tree's own vertical guide
    expect(cellWidth('\u2514\u2500')).toBe(2); // the tree's own corner + dash
    expect(cellWidth('\u2026')).toBe(1); // the ellipsis in "… and N more"
    expect(cellWidth('\u2014')).toBe(1); // the em dash in the TRUNCATED banner
  });

  it('counts an astral non-ideograph as one cell, not two code units', () => {
    // The other half of "characters are not columns": a code point outside the
    // BMP is two UTF-16 units and still one cell.
    expect('\u{1d400}'.length).toBe(2);
    expect(cellWidth('\u{1d400}')).toBe(1);
    expect(cellWidth('\u{1f1e6}')).toBe(1); // regional indicator, per the stated scope
    expect(cellWidth('\u2603')).toBe(1); // SNOWMAN is EAW=N, not every symbol is wide
  });

  it('holds across a spread of the whole claimed range', () => {
    // A regeneration that drops or shifts a run fails here rather than passing
    // because the sample happened to sit inside a surviving range.
    const facts: readonly (readonly [string, number])[] = [
      ['\u0041', 1], // EAW=Na
      ['\u07ff', 1], // EAW=N
      ['\u1100', 2], // EAW=W
      ['\u1160', 1], // EAW=N
      ['\u2329', 2], // EAW=W
      ['\u232b', 1], // EAW=N
      ['\u2e80', 2], // EAW=W
      ['\u303f', 1], // EAW=N
      ['\u4dbf', 2], // EAW=W
      ['\u4dc0', 2], // EAW=W — Yijing hexagrams are wide, which I guessed wrong
      ['\u9fff', 2], // EAW=W
      ['\ua4d0', 1], // EAW=N
      ['\uac00', 2], // EAW=W
      ['\ud7b0', 1], // EAW=N
      ['\ufaff', 2], // EAW=W
      ['\ufb00', 1], // EAW=N
      ['\uff60', 2], // EAW=F
      ['\uff62', 1], // EAW=H
      ['\uffe6', 2], // EAW=F
      ['\uffe8', 1], // EAW=H
      ['\u{10000}', 1], // EAW=N
      ['\u{16fe0}', 2], // EAW=W
      ['\u{1d400}', 1], // EAW=N
      ['\u{1f680}', 2], // EAW=W
      ['\u{20000}', 2], // EAW=W
      ['\u{2fffe}', 1], // EAW=N
      ['\u{30000}', 2], // EAW=W
      ['\u{40000}', 1], // EAW=N
    ];
    for (const [char, cells] of facts) {
      expect([char.codePointAt(0)?.toString(16), cellWidth(char)]).toEqual([
        char.codePointAt(0)?.toString(16),
        cells,
      ]);
    }
  });

  it('names the Unicode version it reflects, so staleness is checkable', () => {
    // The provenance header is the only thing that makes this table auditable.
    // A table with no stated version can only be trusted, never checked.
    const source = readFileSync(
      new URL('../../../../src/services/dd/links/report.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('Unicode 16.0.0');
    expect(source).toContain('unicodedata.unidata_version');
  });
});

describe('dd graph map — the 80-column contract, on addresses that break it (T005)', () => {
  /** Deep enough that even the header's folder line has to continue. */
  const DEEP = 'docs/plans/archive/065-deterministic-documents/tasks/phase-7-graph-map/evidence';
  /** Long enough that a single address cannot fit a line on its own. */
  const LONG = 'unreasonably-but-entirely-legitimate-document-name-nobody-plans-for';

  const seedAddress = `${REPO}/${DEEP}/plan-${LONG}.dd.json#rows/ac-0001`;

  function longCorpus() {
    return corpus({
      [`${REPO}/${DEEP}/plan-${LONG}.dd.json`]: doc('map/plan', [
        { name: 'meta', value: { title: 'A plan filed a long way down' } },
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              claim: 'The claim under test',
              state: 'checked',
              pressure: `pressure-${LONG}.dd.json#rows/bp-0001`,
              proven_by: `log-${LONG}.dd.json#entries/lg-0001`,
            },
          ],
        },
      ]),
      [`${REPO}/${DEEP}/pressure-${LONG}.dd.json`]: doc('map/pressure', [
        {
          name: 'rows',
          value: [{ id: 'bp-0001', criterion: 'The pressure', state: 'checked' }],
        },
      ]),
      [`${REPO}/${DEEP}/log-${LONG}.dd.json`]: doc('map/log', [
        {
          name: 'entries',
          value: [
            {
              id: 'lg-0001',
              text: 'Proved it',
              cites: `pressure-${LONG}.dd.json#rows/bp-0001`,
            },
            {
              id: 'lg-0002',
              text: 'Mentions it',
              cites: `plan-${LONG}.dd.json#rows/ac-0001`,
            },
          ],
        },
      ]),
    });
  }

  /** A palette that emits real SGR, so the styled render is measured as shipped. */
  const ANSI_PALETTE = {
    seed: (text: string) => `${ESC}[1m${text}${ESC}[22m`,
    inbound: (text: string) => `${ESC}[1m${ESC}[35m${text}${ESC}[39m${ESC}[22m`,
    outbound: (text: string) => `${ESC}[1m${ESC}[36m${text}${ESC}[39m${ESC}[22m`,
    path: (text: string) => `${ESC}[2m${text}${ESC}[22m`,
    id: (text: string) => `${ESC}[36m${text}${ESC}[39m`,
    label: (text: string) => `${ESC}[2m${text}${ESC}[22m`,
    faint: (text: string) => `${ESC}[2m${text}${ESC}[22m`,
    alarm: (text: string) => `${ESC}[1m${ESC}[31m${text}${ESC}[39m${ESC}[22m`,
    mark: () => (text: string) => `${ESC}[32m${text}${ESC}[39m`,
  };

  const strip = (text: string): string => text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

  // The renderer's own width function, on purpose. An oracle that measures
  // differently from the renderer is how the 146-column line got through: the
  // code believed characters were columns and so did the test that cleared it.
  const widths = (rendered: string): number[] =>
    strip(rendered)
      .split('\n')
      .map((line) => cellWidth(line));

  const renders = (options: Partial<{ maxNodes: number; depth: number }> = {}) => {
    const built = longCorpus();
    return {
      plain: renderMapTree(mapFrom(seedAddress, built, options)),
      styled: renderMapTree(mapFrom(seedAddress, built, options), ANSI_PALETTE),
    };
  };

  it('proves the fixture actually exceeds the budget without wrapping', () => {
    // Without this the whole describe could pass on a corpus that never needed
    // wrapping at all — the failure mode it exists to rule out.
    expect(`${DEEP}/plan-${LONG}.dd.json#rows/ac-0001`.length).toBeGreaterThan(80);
    expect(`pressure-${LONG}.dd.json#rows/bp-0001`.length).toBeGreaterThan(60);
  });

  it('keeps every plain line inside 80 columns', () => {
    for (const width of widths(renders().plain)) expect(width).toBeLessThanOrEqual(80);
  });

  it('keeps every styled line inside 80 VISIBLE columns', () => {
    const { plain, styled } = renders();
    for (const width of widths(styled)) expect(width).toBeLessThanOrEqual(80);
    // Colour may not move a break: the styled render must strip back to the
    // plain one exactly, which also proves the styling is applied after wrapping.
    expect(strip(styled)).toBe(plain);
    expect(styled).toContain(`${ESC}[`);
  });

  it('keeps every line inside 80 columns when a bound fires too', () => {
    const { plain, styled } = renders({ maxNodes: 2, depth: 1 });
    expect(plain).toContain('! TRUNCATED');
    for (const width of widths(plain)) expect(width).toBeLessThanOrEqual(80);
    for (const width of widths(styled)) expect(width).toBeLessThanOrEqual(80);
  });

  it('wraps the address instead of shortening it — the whole address survives', () => {
    const plain = renders().plain;
    const address = `pressure-${LONG}.dd.json#rows/bp-0001`;

    // It genuinely had to break: no single line carries the whole address...
    for (const line of plain.split('\n')) expect(line).not.toContain(address);
    // ...and yet every character of it is still there, in order, once the
    // continuation indents are removed. Nothing was clipped and no ellipsis was
    // substituted for the part that did not fit — half an address is not a
    // shorter address, it is one that resolves to nothing.
    expect(plain).not.toContain('\u2026');
    const joined = plain
      .split('\n')
      .map((line) => line.replace(/^[ \u2502]+/, ''))
      .join('');
    expect(joined).toContain(address);
  });

  it('keeps the budget when the INDENT is what runs long, not the address', () => {
    // The other width a line has that the render cannot shorten. A long chain
    // grows the tree indent two columns per level, so a deep enough walk pushes
    // even a short address off the edge unless the indent stops widening.
    const deep = renderMapTree(
      mapFrom(`${REPO}/docs/step-0.dd.json#entries/lg-0001`, wideCorpus(0, 45), {
        direction: 'out',
        depth: 50,
        maxNodes: 60,
      }),
    );
    expect(deep.split('\n').filter((line) => line.includes('\u2514\u2500'))).not.toHaveLength(0);
    for (const width of widths(deep)) expect(width).toBeLessThanOrEqual(80);
  });

  it('aligns a continuation under the address column, keeping the tree readable', () => {
    const lines = renders().plain.split('\n');
    const row = lines.findIndex((line) => line.includes('\u251c\u2500->'));
    expect(row).toBeGreaterThan(-1);
    const column = (lines[row] ?? '').indexOf('pressure-');
    expect(column).toBeGreaterThan(0);

    // The continuation starts in the same column the address started in, so the
    // eye tracks one address down the page rather than reading the wrap as a
    // second node...
    const next = lines[row + 1] ?? '';
    expect(next.length - next.replace(/^[ \u2502]+/, '').length).toBe(column);
    // ...and the branch guide is still drawn through it, so a wrapped row does
    // not visually detach the siblings below it from their parent.
    expect(next).toContain('\u2502');
  });
});
