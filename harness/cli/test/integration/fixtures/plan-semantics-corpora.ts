import type { DdDoc, ResolvedDdSchema } from '../../../src/services/dd/core/model.js';
import type {
  SchemaResolveResult,
  SchemaResolver,
} from '../../../src/services/dd/core/validate.js';
import type { DocLoader, DocLoadResult } from '../../../src/services/dd/core/walk.js';
import type { DdLinkEdge } from '../../../src/services/dd/links/model.js';
import { traverseCorpus } from '../../../src/services/dd/links/traverse.js';
import type {
  PlanDocument as ForkPlanDocument,
  PlanEdge as ForkPlanEdge,
  PlanItem as ForkPlanItem,
  readPlanCheck as forkReadPlanCheck,
  SurveyDimension,
} from '../../../src/services/dd/plan/index.js';

/**
 * The plan-semantics trial corpora, shared by the falsifier suite and the golden
 * generator.
 *
 * These live in ONE module on purpose. The goldens are captured from the fork by
 * running these exact corpora through it; if the generator and the suite each
 * owned a copy, a drifted fixture would silently re-baseline the goldens it was
 * supposed to be measured against — which is the failure the goldens exist to
 * prevent (plan 080 phase-2, tk-0007).
 */
export const SCHEMA: ResolvedDdSchema = {
  name: 'trial/plan',
  sections: {
    criteria: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: { id: { type: 'string' }, title: { type: 'string' }, state: { type: 'state' } },
        },
      },
    },
    tasks: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            title: { type: 'string' },
            state: { type: 'state' },
            satisfies: { type: 'link', rel: 'satisfies', target: 'trial/plan/section/criteria' },
            satisfies_toward: {
              type: 'link',
              rel: 'satisfies-toward',
              target: 'trial/plan/section/criteria',
            },
          },
        },
      },
    },
    done_when: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: { id: { type: 'string' }, state: { type: 'state' } },
        },
      },
    },
  },
};

export function doc(sections: DdDoc['sections']): DdDoc {
  return { dd: { schema: SCHEMA.name }, sections, references: [] };
}

export class FixtureDocLoader implements DocLoader {
  constructor(private readonly docs: ReadonlyMap<string, DdDoc>) {}
  load(path: string): DocLoadResult {
    const found = this.docs.get(path);
    return found
      ? { ok: true, path, doc: found, sha: `sha-${path}`, tracked: null }
      : { ok: false, path, reason: 'missing', message: `missing: ${path}` };
  }
}

export class FixtureSchemaResolver implements SchemaResolver {
  resolve(schemaRef: string): SchemaResolveResult {
    return schemaRef === SCHEMA.name
      ? { ok: true, schema: SCHEMA }
      : { ok: false, message: `no schema: ${schemaRef}` };
  }
}

export const ROOT = '/repo';
export const PLAN_PATH = `${ROOT}/docs/plans/trial/plan.dd.json`;

/** A plan whose only task is CHECKED while the criterion it satisfies is OPEN. */
export function contradictionCorpus(): Map<string, DdDoc> {
  return new Map([
    [
      PLAN_PATH,
      doc([
        {
          name: 'criteria',
          value: [{ id: 'ac-0001', title: 'the criterion', state: 'unchecked' }],
        },
        {
          name: 'tasks',
          value: [
            {
              id: 'tk-0001',
              title: 'the task',
              state: 'checked',
              satisfies: '#criteria/ac-0001',
            },
          ],
        },
      ]),
    ],
  ]);
}

/** The same plan, with the edge moved onto the NON-builtin relation. */
export function nonBuiltinRelCorpus(): Map<string, DdDoc> {
  return new Map([
    [
      PLAN_PATH,
      doc([
        {
          name: 'criteria',
          value: [{ id: 'ac-0001', title: 'the criterion', state: 'unchecked' }],
        },
        {
          name: 'tasks',
          value: [
            {
              id: 'tk-0001',
              title: 'the task',
              state: 'checked',
              satisfies_toward: '#criteria/ac-0001',
            },
          ],
        },
      ]),
    ],
  ]);
}

/** A criterion nothing satisfies — the `--complete` orphan-claim case. */
export function orphanCorpus(): Map<string, DdDoc> {
  return new Map([
    [
      PLAN_PATH,
      doc([
        {
          name: 'criteria',
          value: [{ id: 'ac-0001', title: 'unaccounted for', state: 'unchecked' }],
        },
        { name: 'tasks', value: [{ id: 'tk-0001', title: 'claims nothing', state: 'unchecked' }] },
      ]),
    ],
  ]);
}

/**
 * A container whose doneness is DERIVED from its members — no state of its own.
 *
 * This is the prediction's #5(a) falsifier: `deriveItems`/`deriveRollup` live in
 * dd's non-public `core/derive`, so a re-implementation must reproduce the
 * rollup from public surface or report insufficient.
 */
export function rollupCorpus(): Map<string, DdDoc> {
  return new Map([
    [
      PLAN_PATH,
      doc([
        { name: 'criteria', value: [{ id: 'ac-0001', title: 'the criterion', state: 'checked' }] },
        { name: 'tasks', value: [{ id: 'tk-0001', title: 'the task', state: 'checked' }] },
        {
          name: 'done_when',
          value: [
            { id: 'dw-0001', state: 'checked' },
            { id: 'dw-0002', state: 'unchecked' },
          ],
        },
      ]),
    ],
  ]);
}

export function planDocuments(corpus: ReadonlyMap<string, DdDoc>): ForkPlanDocument[] {
  return [...corpus].map(([path, value]) => ({ path, doc: value, schema: SCHEMA }));
}

export function edgesFor(corpus: ReadonlyMap<string, DdDoc>): DdLinkEdge[] {
  const deps = {
    docLoader: new FixtureDocLoader(corpus),
    schemaResolver: new FixtureSchemaResolver(),
  };
  // Seeded with the corpus paths as an ARRAY, in `direct` mode with `follow:
  // false` — the same call `check.ts` makes. A single-string seed with a depth
  // silently produced ZERO edges, which would have made every edge assertion in
  // the falsifier suite an empty-set comparison (plan 080 phase-2 execution log).
  return traverseCorpus([...corpus.keys()], deps, {
    repoRoot: ROOT,
    mode: 'direct',
    follow: false,
  }).edges;
}

export function itemShape(item: ForkPlanItem) {
  return {
    key: item.key,
    path: item.path,
    interior: item.interior,
    address: item.address,
    location: item.location,
    kind: item.kind,
    state: item.state,
    terminal: item.terminal,
    completable: item.completable,
    derived: item.derived,
    checkable: item.checkable,
    done: item.done,
    label: item.label,
    claim: item.claim,
  };
}

export function edgeShape(edge: ForkPlanEdge) {
  return { from: edge.from, to: edge.to, rel: edge.rel, address: edge.address };
}

export function findingKeys(findings: readonly { class: string; address: string }[]): string[] {
  return findings.map((f) => `${f.class}::${f.address}`).sort();
}

export const SURVEY_UNKNOWN: SurveyDimension = {
  satisfied: null,
  reason: 'no-flight-plan',
  node: null,
  status: null,
  basis: null,
  expected_basis: 'sha-expected',
};

export const SURVEY_OK: SurveyDimension = { ...SURVEY_UNKNOWN, satisfied: true, reason: 'survey-done' };

export function checkDeps(corpus: ReadonlyMap<string, DdDoc>) {
  const resolver = new FixtureSchemaResolver();
  return {
    docLoader: new FixtureDocLoader(corpus),
    schemaResolver: {
      resolve: (ref: string) => resolver.resolve(ref),
      resolveDetailed: (ref: string) => ({
        record:
          ref === SCHEMA.name
            ? { schema: SCHEMA, path: `${ROOT}/.dd/schemas/trial.json` }
            : undefined,
        issues: [],
      }),
    },
  } as unknown as Parameters<typeof forkReadPlanCheck>[1];
}

// ---------------------------------------------------------------------------
// The falsifiers. One `describe` per primitive so a RED run names the primitive.
// ---------------------------------------------------------------------------
