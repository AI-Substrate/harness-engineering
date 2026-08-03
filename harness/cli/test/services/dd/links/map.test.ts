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
import { PLAIN_MAP_PALETTE, renderMapTree } from '../../../../src/services/dd/links/report.js';
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
      expect([...line].length).toBeLessThanOrEqual(80);
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
