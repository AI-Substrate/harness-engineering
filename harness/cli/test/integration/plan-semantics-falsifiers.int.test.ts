import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConventionSchemaResolver, FsDocLoader } from '@ai-substrate/dd';
import { NodeSchemaFs } from '@ai-substrate/dd/node';
import { describe, expect, it } from 'vitest';
import { NodeHash } from '../../src/adapters/hash/node-hash.js';
import type { DdDoc } from '../../src/services/dd/core/model.js';
import { indexDocument } from '../../src/services/dd/links/map.js';
import type { DdLinkEdge } from '../../src/services/dd/links/model.js';
import {
  type PlanDocument as ForkPlanDocument,
  type PlanIndex as ForkPlanIndex,
  type PlanItem as ForkPlanItem,
  type ReadyReading as ForkReadyReading,
  itemKey as forkItemKey,
  readPlanCheck as forkReadPlanCheck,
} from '../../src/services/dd/plan/index.js';
import {
  checkDeps,
  contradictionCorpus,
  edgeShape,
  edgesFor,
  findingKeys,
  itemShape,
  nonBuiltinRelCorpus,
  orphanCorpus,
  PLAN_PATH,
  planDocuments,
  ROOT,
  rollupCorpus,
  SCHEMA,
  SURVEY_OK,
  SURVEY_UNKNOWN,
} from './fixtures/plan-semantics-corpora.js';
import GOLDENS from './fixtures/plan-semantics-goldens.json' with { type: 'json' };

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
// The falsifiers. One `describe` per primitive so a RED run names the primitive.
//
// The bar is the GOLDENS, not a live fork. Under the ratified reshape the plan
// layer becomes harness-owned — most likely by promoting this very fork — at
// which point a subject-versus-fork comparison is the same code on both sides:
// trivially green and blind to any shared bug. Phase 3 then deletes the fork
// outright. The goldens were captured from the fork while it was still alive
// (plan-semantics-goldens.gen.test.ts) precisely so this suite stays a real pin
// across both events. The ONE exception is the live-corpus test at the bottom,
// which cannot have literal goldens because plan 080's own documents change
// every time a task closes.
// ---------------------------------------------------------------------------

const GOLDEN_ITEMS = (name: keyof typeof GOLDENS.index) => GOLDENS.index[name].items;
const GOLDEN_EDGES = (name: keyof typeof GOLDENS.index) => GOLDENS.index[name].edges;

function sortedItems(items: readonly ForkPlanItem[]) {
  return items.map(itemShape).sort((a, b) => a.key.localeCompare(b.key));
}

function sortedEdges(edges: ForkPlanIndex['edges']) {
  return edges.map(edgeShape).sort((a, b) => a.from.localeCompare(b.from));
}

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
    expect(subject.itemKey(posix, ['tasks', 'tk-0001'])).toBe(
      'C:/repo/docs/p.dd.json#tasks/tk-0001',
    );
  });

  it('reproduces every key the goldens recorded, and agrees with public indexDocument', async () => {
    const subject = await loadSubject();
    const corpus = contradictionCorpus();
    const index = indexDocument(PLAN_PATH, corpus.get(PLAN_PATH) as DdDoc, SCHEMA);

    // Agreement with dd's PUBLIC addressing — the half that must hold whatever
    // the route, because it is dd that owns the address grammar.
    const fromPublic = index.entries.map((entry) => subject.itemKey(PLAN_PATH, entry.interior));
    expect(fromPublic).toStrictEqual(
      index.entries.map((entry) => forkItemKey(PLAN_PATH, entry.interior)),
    );

    // Agreement with the recorded behaviour — the half that survives the fork.
    expect([...fromPublic].sort()).toStrictEqual(
      GOLDEN_ITEMS('contradiction')
        .map((item) => item.key)
        .sort(),
    );
  });
});

describe('OQ-2 falsifier · #2 PlanDocument / #3 PlanItem / #4 PlanEdge / #5 PlanIndex', () => {
  /**
   * Prediction: SUFFICIENT (types over public `DdDoc` + `ResolvedDdSchema`).
   * Falsifier: a value built ENTIRELY from public loader/resolver outputs must
   * populate every field. A field only obtainable from `core/derive` internals
   * refutes it and converts the row into #8's gap.
   *
   * NOTE for the trial report: the prediction also names "strict `tsc` of the
   * re-declared type". That half CANNOT live here — the repo's only tsconfig is
   * `include: ["src"]` and `harness checks` typechecks exactly that, so a
   * type-level assertion in a test file is inert. It lands when the subject
   * module reaches `src/` and `acts/plan/*` consumes it. What this test carries
   * is the RUNTIME half: every field, compared value-by-value.
   */
  it('fills every PlanItem and PlanEdge field exactly as the goldens recorded', async () => {
    const subject = await loadSubject();
    const corpus = contradictionCorpus();
    const documents: ForkPlanDocument[] = planDocuments(corpus);
    const edges: DdLinkEdge[] = edgesFor(corpus);

    const mine = subject.buildPlanIndex(documents, edges, ROOT);

    expect(sortedItems(mine.items)).toStrictEqual(GOLDEN_ITEMS('contradiction'));
    expect(sortedEdges(mine.edges)).toStrictEqual(GOLDEN_EDGES('contradiction'));
    expect([...mine.byKey.keys()].sort()).toStrictEqual(
      GOLDEN_ITEMS('contradiction')
        .map((item) => item.key)
        .sort(),
    );
  });
});

describe('OQ-2 falsifier · #6 ReadyReading / #7 readPlanReadiness', () => {
  /**
   * Prediction: SUFFICIENT (pure function over `PlanCheckResult` + survey).
   * Falsifier: three fixtures — ready, not-ready (unclaimed criterion),
   * cant-tell. Any verdict flip refutes. The three goldens are DISTINCT
   * verdicts, so a subject that hard-codes one answer fails two of them.
   */
  const cases = [
    { name: 'ready', corpus: contradictionCorpus, survey: SURVEY_OK, golden: 'ready' },
    {
      name: 'not-ready (unclaimed criterion)',
      corpus: orphanCorpus,
      survey: SURVEY_OK,
      golden: 'notReady',
    },
    {
      name: 'cant-tell (survey unreadable)',
      corpus: contradictionCorpus,
      survey: SURVEY_UNKNOWN,
      golden: 'cantTell',
    },
  ] as const;

  it('the three goldens are three DIFFERENT verdicts, or this suite pins nothing', () => {
    const verdicts = cases.map((c) => GOLDENS.readiness[c.golden].verdict);
    expect(new Set(verdicts).size).toBe(3);
  });

  for (const scenario of cases) {
    it(`reproduces the recorded verdict: ${scenario.name}`, async () => {
      const subject = await loadSubject();
      const corpus = scenario.corpus();
      const check = subject.readPlanCheck(PLAN_PATH, checkDeps(corpus), {
        repoRoot: ROOT,
        complete: true,
      });
      const mine: ForkReadyReading = subject.readPlanReadiness(check, scenario.survey);
      const golden = GOLDENS.readiness[scenario.golden];

      expect({
        verdict: mine.verdict,
        reason: mine.reason,
        decided_by: mine.decided_by,
      }).toStrictEqual({
        verdict: golden.verdict,
        reason: golden.reason,
        decided_by: golden.decided_by,
      });
      expect(mine.criteria).toStrictEqual(golden.criteria);
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
    const mine = subject.buildPlanIndex(planDocuments(corpus), edgesFor(corpus), ROOT);

    const goldenRollups = GOLDEN_ITEMS('rollup').filter((item) => item.derived);
    expect(goldenRollups.length, 'goldens must contain a derived item').toBeGreaterThan(0);

    expect(sortedItems(mine.items).filter((item) => item.derived)).toStrictEqual(goldenRollups);
  });

  /**
   * Falsifier (b): a schema declaring a NON-builtin relation — the live
   * `satisfies-toward`. dd's namespace is open, so it must behave as `ref` and
   * attach no extra meaning. Reproducing that WITHOUT re-declaring
   * `BUILTIN_RELS` is the vocabulary test.
   */
  it('(b) treats a non-builtin relation exactly as recorded, without a local vocabulary', async () => {
    const subject = await loadSubject();
    const corpus = nonBuiltinRelCorpus();
    const mine = subject.buildPlanIndex(planDocuments(corpus), edgesFor(corpus), ROOT);

    expect(sortedEdges(mine.edges)).toStrictEqual(GOLDEN_EDGES('nonBuiltinRel'));
    expect(sortedItems(mine.items)).toStrictEqual(GOLDEN_ITEMS('nonBuiltinRel'));
    // The control: the SAME document under a builtin relation produces a
    // contradiction, and under this one it must not.
    expect(GOLDEN_EDGES('nonBuiltinRel')[0]?.rel).toBe('satisfies-toward');
    expect(GOLDENS.check.nonBuiltinRel.findings).toStrictEqual([]);
    expect(GOLDENS.check.contradiction.findings.map((f) => f.class)).toStrictEqual([
      'contradiction',
    ]);
  });
});

describe('OQ-2 falsifier · #9 readPlanCheck', () => {
  /**
   * Prediction: AT RISK — inherits #8, plus `readPlanSemantics` needs
   * `CLAIMING_RELS` + `effectiveRel` (vocabulary again; the fork's
   * `semantics.ts` is FROZEN and must not be edited).
   * Falsifier: the findings SET and the counts must equal what the fork
   * produced, on a constructed contradiction, a non-builtin relation, a
   * `--complete` orphan-claim, and a rollup corpus.
   */
  const scenarios = [
    {
      name: 'constructed contradiction (checked task, open criterion)',
      corpus: contradictionCorpus,
      complete: false,
      golden: 'contradiction',
    },
    {
      name: 'non-builtin relation makes NO contradiction',
      corpus: nonBuiltinRelCorpus,
      complete: false,
      golden: 'nonBuiltinRel',
    },
    {
      name: 'orphan-claim under --complete',
      corpus: orphanCorpus,
      complete: true,
      golden: 'orphan',
    },
    {
      name: 'rollup corpus, per-row accounting',
      corpus: rollupCorpus,
      complete: true,
      golden: 'rollup',
    },
  ] as const;

  for (const scenario of scenarios) {
    it(`produces the recorded findings set: ${scenario.name}`, async () => {
      const subject = await loadSubject();
      const corpus = scenario.corpus();
      const golden = GOLDENS.check[scenario.golden];

      const mine = subject.readPlanCheck(PLAN_PATH, checkDeps(corpus), {
        repoRoot: ROOT,
        complete: scenario.complete,
      });

      expect(mine.ok).toBe(golden.ok);
      if (!mine.ok) return;

      expect(findingKeys(mine.findings)).toStrictEqual(findingKeys(golden.findings));
      expect(mine.counts).toStrictEqual(golden.counts);
      expect(mine.findings.map((f) => f.message).sort()).toStrictEqual(
        golden.findings.map((f) => f.message).sort(),
      );
    });
  }

  /**
   * The corpus-level bar the prediction names explicitly: drive THIS plan's own
   * documents. It has no literal golden ON PURPOSE — plan 080's documents change
   * every time a task closes, so a pinned findings set would churn and teach
   * everyone to re-baseline it. While the fork exists it is the oracle; when
   * phase 3 deletes it, this converts to structural invariants (zero errors,
   * non-vacuous item count) rather than a literal.
   */
  it('agrees with the fork on plan 080 own documents', async () => {
    const subject = await loadSubject();
    const planPath = join(REPO_ROOT, 'docs/plans/080-dd-consume-upgrade/plan.dd.json');
    const deps = realDeps();
    const options = { repoRoot: REPO_ROOT, complete: true, depth: 3 };

    const theirs = forkReadPlanCheck(planPath, deps, options);
    expect(theirs.ok, 'the live plan must load, or this proves nothing').toBe(true);
    if (!theirs.ok) return;
    expect(theirs.counts.semantic?.items ?? 0).toBeGreaterThan(100);

    const mine = subject.readPlanCheck(planPath, deps, options);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
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
  // Static ESM imports, NOT `require`: the package's "." export declares only
  // `types` and `import` conditions — no `require` — so a CJS require of the
  // barrel fails with "No exports main defined".
  const fs = new NodeSchemaFs();
  return {
    schemaResolver: new ConventionSchemaResolver({ fs, repoRoot: REPO_ROOT }),
    docLoader: new FsDocLoader(fs, new NodeHash(), null),
  } as Parameters<typeof forkReadPlanCheck>[1];
}

describe('OQ-2 trial · the subject module', () => {
  /**
   * Always runs, and it is the reason the falsifiers above cannot quietly become
   * decoration. Every one of them loads the subject through a RUNTIME specifier;
   * if that module vanished, each would fail with a module-not-found rather than
   * an assertion — readable, but it would no longer be measuring anything. This
   * states the precondition once, by name.
   *
   * It was inverted at tk-0008 (it previously asserted ABSENCE while the reshape
   * was parked), which is the whole point: the suite has to say out loud which
   * side of the promotion it is on.
   */
  it('exists, so the thirteen falsifiers above measured a real subject', () => {
    expect(subjectPresent()).toBe(true);
  });
});
