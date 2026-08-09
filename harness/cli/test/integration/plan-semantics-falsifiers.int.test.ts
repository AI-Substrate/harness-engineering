import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeHash } from '../../src/adapters/hash/node-hash.js';
import type { DdDoc, ResolvedDdSchema } from '../../src/services/dd/core/model.js';
import type { SchemaResolveResult, SchemaResolver } from '../../src/services/dd/core/validate.js';
import type { DocLoader, DocLoadResult } from '../../src/services/dd/core/walk.js';
import { indexDocument } from '../../src/services/dd/links/map.js';
import type { DdLinkEdge } from '../../src/services/dd/links/model.js';
import { traverseCorpus } from '../../src/services/dd/links/traverse.js';
import {
  type PlanDocument as ForkPlanDocument,
  type PlanEdge as ForkPlanEdge,
  type PlanIndex as ForkPlanIndex,
  type PlanItem as ForkPlanItem,
  type ReadyReading as ForkReadyReading,
  buildPlanIndex as forkBuildPlanIndex,
  itemKey as forkItemKey,
  readPlanCheck as forkReadPlanCheck,
  readPlanReadiness as forkReadPlanReadiness,
  type SurveyDimension,
} from '../../src/services/dd/plan/index.js';

/*
Test Doc:
- Why: plan 080 phase 2 (tk-0007 / dw-000c / bp-000d). This phase is the deciding
  round for upstream OQ-2: are dd's PUBLIC primitives at the pin sufficient to
  re-implement harness's plan semantics? The answer is only worth having if the
  test that produces it was written BEFORE the implementation and is capable of
  failing — so this file is authored and run RED first, against the absent
  subject module, and the RED run is recorded per primitive in the phase-2
  execution log. Commit order is the evidence (hard rule 4, ratified TDD).
- Contract: for each of the NINE plan-semantics symbols the two surviving
  consumers still import from the fork, the prediction (assets/tasks/phase-2/
  prediction.md, committed 51558dbc BEFORE any trial work) pre-commits a call and
  the falsifier case that would refute it. This file is that falsifier set. The
  bar is BEHAVIOURAL, not nominal: hard rule 5 requires the re-implementation to
  produce a findings set EQUAL to the fork's on the same input. Symbol-set
  equality is explicitly NOT sufficiency — the recon found dd already ships a
  `dist/plan` whose barrel matches the fork's name-for-name, and this suite is
  what would catch such a module exporting the right names while behaving
  differently.
- Usage Notes: the FORK (`src/services/dd/plan`) is the ORACLE here, deliberately
  imported. That is not a hard-rule-2 violation: rule 2 constrains the new MODULE
  to public subpaths, and dw-000e greps the module, not this test. Proving
  behavioural equality requires both sides in one process. The SUBJECT is loaded
  through a non-literal specifier with `@vite-ignore` so its absence is a runtime
  failure this file controls, one clean RED per primitive — a literal `import()`
  of a missing module is resolved by Vite at TRANSFORM time and fails the whole
  file to load, which would collapse nine falsifiers into one unreadable error
  (the trap that cost phase 1 ~10 minutes; see phase-1 execution log).
- Quality Contribution: the failure mode this guards is a false SUFFICIENT
  verdict on OQ-2 — a re-implementation that compiles, exports the right names,
  and quietly disagrees with the fork on a rollup, an unknown relation, or a
  contradiction. That class is invisible to a type checker and to any test that
  only asks "does it import?".
- Worked Example: point SUBJECT at a module that re-declares BUILTIN_RELS instead
  of resolving the relation through dd, then run this file. The `satisfies-toward`
  falsifier fails by name, because a hand-copied vocabulary cannot track a
  relation dd added after the copy was made.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');

/**
 * The module tk-0008 will create. It does not exist yet — that ABSENCE is the
 * sanctioned RED control for dw-000c ("run RED against a deliberately-broken
 * control or the absent surface"), and it is currently blocked on the D-3 export
 * gap reported at recon: every route into dd's semantic core
 * (`core/derive`, `core/rel`, `core/constants`) is ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
const SUBJECT_SPECIFIER = '../../src/services/plan-semantics/index.js';
const SUBJECT_PATH = resolve(HERE, SUBJECT_SPECIFIER);

/** The nine symbols under trial, as the subject must expose them. */
interface Subject {
  itemKey(path: string, interior: readonly string[]): string;
  buildPlanIndex(
    documents: readonly ForkPlanDocument[],
    edges: readonly DdLinkEdge[],
    repoRoot: string,
  ): ForkPlanIndex;
  readPlanCheck: typeof forkReadPlanCheck;
  readPlanReadiness: typeof forkReadPlanReadiness;
}

const require_ = createRequire(import.meta.url);

function subjectPresent(): boolean {
  try {
    require_.resolve(SUBJECT_PATH.replace(/\.js$/, '.ts'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the subject, or fails the CALLING test by name.
 *
 * The specifier is a variable and marked `@vite-ignore` on purpose: that is what
 * defers resolution to runtime so a missing subject produces nine readable REDs
 * instead of one transform-time file-load crash.
 */
async function loadSubject(): Promise<Subject> {
  return (await import(/* @vite-ignore */ SUBJECT_SPECIFIER)) as Subject;
}

// ---------------------------------------------------------------------------
// Fixtures — consumer-owned fakes (constitution P3: fakes over mocks, no
// `vi.mock`/`spyOn`). Both sides of every comparison are handed the SAME ones.
// ---------------------------------------------------------------------------

/**
 * A plan-shaped schema carrying a builtin `satisfies` relation AND a
 * deliberately NON-builtin `satisfies-toward` one.
 *
 * `satisfies-toward` is not invented for this test — it is live in this very
 * plan (prime's `57d8bd1f` moved phase-1's cross-phase edges onto it to clear
 * contradiction noise). dd's namespace is open by design: an unknown relation is
 * legal and behaves as `ref`, which means it must NOT produce a contradiction.
 * Reproducing that without re-declaring dd's frozen five is exactly the
 * prediction's #5(b) falsifier.
 */
const SCHEMA: ResolvedDdSchema = {
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

function doc(sections: DdDoc['sections']): DdDoc {
  return { dd: { schema: SCHEMA.name }, sections, references: [] };
}

class FixtureDocLoader implements DocLoader {
  constructor(private readonly docs: ReadonlyMap<string, DdDoc>) {}
  load(path: string): DocLoadResult {
    const found = this.docs.get(path);
    return found
      ? { ok: true, path, doc: found, sha: `sha-${path}`, tracked: null }
      : { ok: false, path, reason: 'missing', message: `missing: ${path}` };
  }
}

class FixtureSchemaResolver implements SchemaResolver {
  resolve(schemaRef: string): SchemaResolveResult {
    return schemaRef === SCHEMA.name
      ? { ok: true, schema: SCHEMA }
      : { ok: false, message: `no schema: ${schemaRef}` };
  }
}

const ROOT = '/repo';
const PLAN_PATH = `${ROOT}/docs/plans/trial/plan.dd.json`;

/** A plan whose only task is CHECKED while the criterion it satisfies is OPEN. */
function contradictionCorpus(): Map<string, DdDoc> {
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
function nonBuiltinRelCorpus(): Map<string, DdDoc> {
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
function orphanCorpus(): Map<string, DdDoc> {
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
function rollupCorpus(): Map<string, DdDoc> {
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

function planDocuments(corpus: ReadonlyMap<string, DdDoc>): ForkPlanDocument[] {
  return [...corpus].map(([path, value]) => ({ path, doc: value, schema: SCHEMA }));
}

function edgesFor(corpus: ReadonlyMap<string, DdDoc>) {
  const loader = new FixtureDocLoader(corpus);
  const resolver = new FixtureSchemaResolver();
  return traverseCorpus(
    PLAN_PATH,
    { docLoader: loader, schemaResolver: resolver },
    {
      repoRoot: ROOT,
      depth: 3,
    },
  ).edges;
}

/** Item fields compared verbatim — every field the model declares. */
function itemShape(item: ForkPlanItem) {
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

function edgeShape(edge: ForkPlanEdge) {
  return { from: edge.from, to: edge.to, rel: edge.rel, address: edge.address };
}

function findingKeys(findings: readonly { class: string; address: string }[]): string[] {
  return findings.map((f) => `${f.class}::${f.address}`).sort();
}

const SURVEY_UNKNOWN: SurveyDimension = {
  satisfied: null,
  reason: 'no-flight-plan',
  node: null,
  status: null,
  basis: null,
  expected_basis: 'sha-expected',
};

const SURVEY_OK: SurveyDimension = { ...SURVEY_UNKNOWN, satisfied: true, reason: 'survey-done' };

function checkDeps(corpus: ReadonlyMap<string, DdDoc>) {
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

describe('OQ-2 falsifier · #1 itemKey', () => {
  /**
   * Prediction: SUFFICIENT (algorithm-class, `toPosix(path)#interior.join('/')`).
   * Falsifier: the same document spelled with native separators and spelled as a
   * parsed dd address must collapse to ONE key, and that key must agree with the
   * addressing the PUBLIC `indexDocument` produces for the same node. Two
   * grammars = refuted.
   */
  it('collapses a native-separator spelling and a POSIX spelling to one key', async () => {
    const subject = await loadSubject();
    const windows = 'C:\\repo\\docs\\p.dd.json';
    const posix = 'C:/repo/docs/p.dd.json';

    expect(subject.itemKey(windows, ['tasks', 'tk-0001'])).toBe(
      subject.itemKey(posix, ['tasks', 'tk-0001']),
    );
    expect(subject.itemKey(windows, ['tasks', 'tk-0001'])).toBe(
      forkItemKey(windows, ['tasks', 'tk-0001']),
    );
  });

  it('agrees with the public indexDocument addressing for every indexed node', async () => {
    const subject = await loadSubject();
    const corpus = contradictionCorpus();
    const index = indexDocument(PLAN_PATH, corpus.get(PLAN_PATH) as DdDoc, SCHEMA);

    for (const entry of index.entries) {
      expect(subject.itemKey(PLAN_PATH, entry.interior)).toBe(
        forkItemKey(PLAN_PATH, entry.interior),
      );
    }
    expect(index.entries.length).toBeGreaterThan(0);
  });
});

describe('OQ-2 falsifier · #2 PlanDocument / #3 PlanItem / #4 PlanEdge / #5 PlanIndex', () => {
  /**
   * Prediction: SUFFICIENT (types over public `DdDoc` + `ResolvedDdSchema`).
   * Falsifier: a value built ENTIRELY from public loader/resolver outputs must
   * populate every field. A field only obtainable from `core/derive` internals
   * refutes it and converts the row into #8's gap.
   */
  it('fills every PlanItem and PlanEdge field from the same public inputs as the fork', async () => {
    const subject = await loadSubject();
    const corpus = contradictionCorpus();
    const documents = planDocuments(corpus);
    const edges = edgesFor(corpus);

    const mine = subject.buildPlanIndex(documents, edges, ROOT);
    const theirs: ForkPlanIndex = forkBuildPlanIndex(documents, edges, ROOT);

    expect(mine.items.map(itemShape)).toStrictEqual(theirs.items.map(itemShape));
    expect(mine.edges.map(edgeShape)).toStrictEqual(theirs.edges.map(edgeShape));
    expect([...mine.byKey.keys()].sort()).toStrictEqual([...theirs.byKey.keys()].sort());
  });
});

describe('OQ-2 falsifier · #6 ReadyReading / #7 readPlanReadiness', () => {
  /**
   * Prediction: SUFFICIENT (pure function over `PlanCheckResult` + survey).
   * Falsifier: three fixtures — ready, not-ready (unclaimed criterion),
   * cant-tell. Any verdict flip refutes.
   */
  const cases: {
    name: string;
    corpus: () => Map<string, DdDoc>;
    survey: SurveyDimension;
    /** Pinned so a fixture that drifted into producing one verdict three times fails HERE. */
    oracle: { verdict: string; reason: string; decided_by: string | null };
  }[] = [
    {
      name: 'ready',
      corpus: contradictionCorpus,
      survey: SURVEY_OK,
      oracle: { verdict: 'ready', reason: 'ready', decided_by: null },
    },
    {
      name: 'not-ready (unclaimed criterion)',
      corpus: orphanCorpus,
      survey: SURVEY_OK,
      oracle: { verdict: 'not-ready', reason: 'unclaimed-criteria', decided_by: 'criteria' },
    },
    {
      name: 'cant-tell (survey unreadable)',
      corpus: contradictionCorpus,
      survey: SURVEY_UNKNOWN,
      oracle: { verdict: 'cant-tell', reason: 'no-flight-plan', decided_by: 'survey' },
    },
  ];

  for (const scenario of cases) {
    it(`reproduces the fork verdict: ${scenario.name}`, async () => {
      const subject = await loadSubject();
      const corpus = scenario.corpus();
      const options = { repoRoot: ROOT, complete: true };

      const mineCheck = subject.readPlanCheck(PLAN_PATH, checkDeps(corpus), options);
      const theirsCheck = forkReadPlanCheck(PLAN_PATH, checkDeps(corpus), options);

      const mine: ForkReadyReading = subject.readPlanReadiness(mineCheck, scenario.survey);
      const theirs: ForkReadyReading = forkReadPlanReadiness(theirsCheck, scenario.survey);

      // The oracle must still say what this fixture was built to make it say.
      expect({
        verdict: theirs.verdict,
        reason: theirs.reason,
        decided_by: theirs.decided_by,
      }).toStrictEqual(scenario.oracle);

      expect(mine.verdict).toBe(theirs.verdict);
      expect(mine.reason).toBe(theirs.reason);
      expect(mine.decided_by).toBe(theirs.decided_by);
      expect(mine.criteria).toStrictEqual(theirs.criteria);
    });
  }
});

describe('OQ-2 falsifier · #8 buildPlanIndex', () => {
  /**
   * Prediction: AT RISK, leaning INSUFFICIENT — needs `deriveItems` (state
   * derivation + rollup) from dd's non-public `core/derive`.
   * Falsifier (a): a container whose state is derived from its members. If no
   * public primitive reproduces the rollup, insufficient is CONFIRMED.
   */
  it('(a) reproduces derived rollup state for a container with no state of its own', async () => {
    const subject = await loadSubject();
    const corpus = rollupCorpus();
    const documents = planDocuments(corpus);
    const edges = edgesFor(corpus);

    const mine = subject.buildPlanIndex(documents, edges, ROOT);
    const theirs = forkBuildPlanIndex(documents, edges, ROOT);

    const rollups = theirs.items.filter((item) => item.derived);
    expect(rollups.length).toBeGreaterThan(0);

    for (const expected of rollups) {
      const actual = mine.byKey.get(expected.key);
      expect(actual, `no rollup item at ${expected.key}`).toBeDefined();
      expect(itemShape(actual as ForkPlanItem)).toStrictEqual(itemShape(expected));
    }
  });

  /**
   * Falsifier (b): a schema declaring a NON-builtin relation — the live
   * `satisfies-toward`. dd's namespace is open, so it must behave as `ref` and
   * attach no extra meaning. Reproducing that WITHOUT re-declaring
   * `BUILTIN_RELS` is the vocabulary test; if it cannot be done, insufficient
   * per the prediction's pre-committed scoring rule.
   */
  it('(b) treats a non-builtin relation exactly as the fork does, without a local vocabulary', async () => {
    const subject = await loadSubject();
    const corpus = nonBuiltinRelCorpus();
    const documents = planDocuments(corpus);
    const edges = edgesFor(corpus);

    const mine = subject.buildPlanIndex(documents, edges, ROOT);
    const theirs = forkBuildPlanIndex(documents, edges, ROOT);

    expect(mine.edges.map(edgeShape)).toStrictEqual(theirs.edges.map(edgeShape));
    expect(mine.items.map(itemShape)).toStrictEqual(theirs.items.map(itemShape));
  });
});

describe('OQ-2 falsifier · #9 readPlanCheck', () => {
  /**
   * Prediction: AT RISK — inherits #8, plus `readPlanSemantics` needs
   * `CLAIMING_RELS` + `effectiveRel` (vocabulary again; the fork's
   * `semantics.ts` is FROZEN and must not be edited).
   * Falsifier: the findings SET must equal the fork's on the same input —
   * including a constructed contradiction and a `--complete` orphan-claim.
   * Any finding-set diff refutes SUFFICIENT.
   */
  const scenarios: {
    name: string;
    corpus: () => Map<string, DdDoc>;
    complete: boolean;
    /**
     * The finding classes the ORACLE must produce. Pinned because a falsifier
     * that compares two empty sets proves nothing: scenarios 1 and 2 are the
     * same document with only the RELATION changed, so the contradiction
     * appearing in one and not the other is the control that makes the
     * vocabulary question testable at all.
     */
    oracleClasses: string[];
  }[] = [
    {
      name: 'constructed contradiction (checked task, open criterion)',
      corpus: contradictionCorpus,
      complete: false,
      oracleClasses: ['contradiction'],
    },
    {
      name: 'non-builtin relation makes NO contradiction',
      corpus: nonBuiltinRelCorpus,
      complete: false,
      oracleClasses: [],
    },
    {
      name: 'orphan-claim under --complete',
      corpus: orphanCorpus,
      complete: true,
      oracleClasses: ['open-completable', 'open-completable', 'orphan-claim'],
    },
    {
      name: 'rollup corpus, per-row accounting',
      corpus: rollupCorpus,
      complete: true,
      oracleClasses: ['open-completable', 'orphan-claim'],
    },
  ];

  for (const scenario of scenarios) {
    it(`produces a findings set equal to the fork: ${scenario.name}`, async () => {
      const subject = await loadSubject();
      const corpus = scenario.corpus();
      const options = { repoRoot: ROOT, complete: scenario.complete };

      const mine = subject.readPlanCheck(PLAN_PATH, checkDeps(corpus), options);
      const theirs = forkReadPlanCheck(PLAN_PATH, checkDeps(corpus), options);

      expect(theirs.ok, 'oracle must load the fixture cleanly').toBe(true);
      if (!theirs.ok) return;
      // Non-vacuity: the oracle produced the finding shape this fixture exists
      // to produce, so an equal-but-empty comparison cannot pass for agreement.
      expect(theirs.findings.map((f) => f.class).sort()).toStrictEqual(
        [...scenario.oracleClasses].sort(),
      );

      expect(mine.ok).toBe(theirs.ok);
      if (!mine.ok) return;

      expect(findingKeys(mine.findings)).toStrictEqual(findingKeys(theirs.findings));
      expect(mine.counts).toStrictEqual(theirs.counts);
      expect(mine.findings.map((f) => f.message).sort()).toStrictEqual(
        theirs.findings.map((f) => f.message).sort(),
      );
    });
  }

  /**
   * The corpus-level bar the prediction names explicitly: drive THIS plan's own
   * documents. A synthetic fixture cannot catch a disagreement that only appears
   * at real scale (436 items, 11 orphans, a live non-builtin relation).
   */
  it('agrees with the fork on plan 080 own documents', async () => {
    const subject = await loadSubject();
    const planPath = join(REPO_ROOT, 'docs/plans/080-dd-consume-upgrade/plan.dd.json');
    const deps = realDeps();
    const options = { repoRoot: REPO_ROOT, complete: true, depth: 3 };

    const mine = subject.readPlanCheck(planPath, deps, options);
    const theirs = forkReadPlanCheck(planPath, deps, options);

    expect(mine.ok).toBe(theirs.ok);
    if (!mine.ok || !theirs.ok) return;
    expect(findingKeys(mine.findings)).toStrictEqual(findingKeys(theirs.findings));
    expect(mine.counts).toStrictEqual(theirs.counts);
  });
});

/**
 * Real composition for the corpus-level falsifier — the SAME construction
 * `acts/plan/index.ts` uses, so the test cannot pass against a composition the
 * product never performs.
 */
function realDeps(): Parameters<typeof forkReadPlanCheck>[1] {
  // Imported lazily so the synthetic falsifiers above stay filesystem-free.
  const { ConventionSchemaResolver, FsDocLoader } = require_('@ai-substrate/dd');
  const { NodeSchemaFs } = require_('@ai-substrate/dd/node');
  const fs = new NodeSchemaFs();
  return {
    schemaResolver: new ConventionSchemaResolver({ fs, repoRoot: REPO_ROOT }),
    docLoader: new FsDocLoader(fs, new NodeHash(), null),
  } as Parameters<typeof forkReadPlanCheck>[1];
}

describe('OQ-2 trial · the subject module', () => {
  /**
   * Always runs. While the D-3 export gap is open this is the one assertion that
   * states, in the suite itself, that the trial has not been run to green — so
   * "the falsifiers are in the tree" can never be mistaken for "the falsifiers
   * pass".
   */
  it('is absent until tk-0008 lands, and tk-0008 is blocked on the dd export gap', () => {
    expect(subjectPresent()).toBe(false);
  });
});
