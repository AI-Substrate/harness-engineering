import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildPlanIndex as forkBuildPlanIndex,
  readPlanCheck as forkReadPlanCheck,
  readPlanReadiness as forkReadPlanReadiness,
} from '../../src/services/dd/plan/index.js';
import {
  checkDeps,
  contradictionCorpus,
  edgeShape,
  edgesFor,
  itemShape,
  nonBuiltinRelCorpus,
  orphanCorpus,
  planDocuments,
  PLAN_PATH,
  rollupCorpus,
  ROOT,
  SURVEY_OK,
  SURVEY_UNKNOWN,
} from './fixtures/plan-semantics-corpora.js';

/*
Test Doc:
- Why: plan 080 phase-2. The falsifier suite compares a subject against the FORK
  as a live oracle. Under the ratified reshape (dd keeps mechanisms, consumers
  bring vocabulary — dd governance d8950eb) the plan layer becomes HARNESS-OWNED,
  most likely by promoting that very fork. At that moment subject and oracle are
  the same code: every comparison passes trivially and the suite is blind to any
  bug the two share. Phase 3 then DELETES the fork and the oracle disappears
  entirely. Goldens captured while the fork is still alive are what keep the
  suite a real pin across both events — which is why koala cut them as a
  PRECONDITION of the reshape rather than a follow-up.
- Contract: this file is the CAPTURE, and it is itself a test. Run normally it
  asserts the committed goldens still describe the fork exactly (so a fork change
  is caught, not silently re-baselined). Run with `GOLDEN_UPDATE=1` it REWRITES
  them. Regeneration is therefore an explicit, reviewable act with a diff, never
  a side effect of a passing run.
- Usage Notes: `GOLDEN_UPDATE=1 npx vitest run test/integration/plan-semantics-goldens.gen.test.ts`
  from `harness/cli`. The corpora come from the shared fixtures module, never a
  local copy — a drifted fixture would re-baseline the goldens it is supposed to
  be measured against.
- Quality Contribution: without this, "the promoted module behaves like the fork"
  is unfalsifiable the moment the fork stops existing.
- Worked Example: change the fork's rollup rule and run this file without the env
  var. The `rollup` golden mismatches by name and the capture refuses.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, 'fixtures/plan-semantics-goldens.json');

const CORPORA = {
  contradiction: contradictionCorpus,
  nonBuiltinRel: nonBuiltinRelCorpus,
  orphan: orphanCorpus,
  rollup: rollupCorpus,
} as const;

/** `--complete` per corpus, matching the falsifier scenarios exactly. */
const COMPLETE: Record<keyof typeof CORPORA, boolean> = {
  contradiction: false,
  nonBuiltinRel: false,
  orphan: true,
  rollup: true,
};

const READINESS = {
  ready: { corpus: 'contradiction', survey: SURVEY_OK },
  notReady: { corpus: 'orphan', survey: SURVEY_OK },
  cantTell: { corpus: 'contradiction', survey: SURVEY_UNKNOWN },
} as const;

/**
 * Findings are normalised to the fields a re-implementation must reproduce, and
 * SORTED — the goldens pin behaviour, not iteration order, and pinning an
 * incidental ordering would manufacture failures that mean nothing.
 */
function findingShape(finding: {
  class: string;
  severity: string;
  address: string;
  owner: string;
  location: string | null;
  message: string;
  rel?: string;
  counterpart?: string;
}) {
  return {
    class: finding.class,
    severity: finding.severity,
    address: finding.address,
    owner: finding.owner,
    location: finding.location,
    message: finding.message,
    ...(finding.rel !== undefined && { rel: finding.rel }),
    ...(finding.counterpart !== undefined && { counterpart: finding.counterpart }),
  };
}

function captureGoldens() {
  const check: Record<string, unknown> = {};
  const index: Record<string, unknown> = {};

  for (const [name, build] of Object.entries(CORPORA)) {
    const corpus = build();
    const result = forkReadPlanCheck(PLAN_PATH, checkDeps(corpus), {
      repoRoot: ROOT,
      complete: COMPLETE[name as keyof typeof CORPORA],
    });
    check[name] = result.ok
      ? {
          ok: true,
          counts: result.counts,
          findings: result.findings
            .map(findingShape)
            .sort((a, b) => `${a.class}${a.address}`.localeCompare(`${b.class}${b.address}`)),
        }
      : { ok: false, reason: result.reason };

    const built = forkBuildPlanIndex(planDocuments(corpus), edgesFor(corpus), ROOT);
    index[name] = {
      items: built.items.map(itemShape).sort((a, b) => a.key.localeCompare(b.key)),
      edges: built.edges.map(edgeShape).sort((a, b) => a.from.localeCompare(b.from)),
    };
  }

  const readiness: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(READINESS)) {
    const corpus = CORPORA[spec.corpus]();
    const result = forkReadPlanCheck(PLAN_PATH, checkDeps(corpus), {
      repoRoot: ROOT,
      complete: true,
    });
    const reading = forkReadPlanReadiness(result, spec.survey);
    readiness[name] = {
      verdict: reading.verdict,
      reason: reading.reason,
      decided_by: reading.decided_by,
      criteria: reading.criteria,
    };
  }

  return {
    $comment:
      'GENERATED from the fork (services/dd/plan) by plan-semantics-goldens.gen.test.ts. ' +
      'Regenerate with GOLDEN_UPDATE=1. These pin the plan-semantics BEHAVIOUR so it ' +
      'survives the fork being promoted (subject becomes oracle) and then deleted.',
    captured_from: 'harness/cli/src/services/dd/plan',
    check,
    index,
    readiness,
  };
}

describe('plan-semantics goldens — captured from the fork while it still exists', () => {
  it('match the fork exactly (or are rewritten under GOLDEN_UPDATE=1)', async () => {
    const captured = captureGoldens();

    if (process.env.GOLDEN_UPDATE === '1') {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(captured, null, 2)}\n`);
      expect(captured.check).toBeDefined();
      return;
    }

    const committed = (await import('./fixtures/plan-semantics-goldens.json', {
      with: { type: 'json' },
    })) as { default: ReturnType<typeof captureGoldens> };

    expect(captured.check).toStrictEqual(committed.default.check);
    expect(captured.index).toStrictEqual(committed.default.index);
    expect(captured.readiness).toStrictEqual(committed.default.readiness);
  });

  /**
   * Non-vacuity. Goldens that recorded four empty results would "match the fork"
   * forever and pin nothing — the same empty-set-versus-empty-set trap that had
   * already slipped past the contradiction falsifier once in this phase.
   */
  it('are non-vacuous: each corpus contributes the finding shape it was built for', () => {
    const captured = captureGoldens();
    const check = captured.check as Record<
      string,
      { ok: boolean; findings: { class: string }[]; counts: { semantic: { items: number } | null } }
    >;

    expect(check.contradiction.findings.map((f) => f.class)).toStrictEqual(['contradiction']);
    expect(check.nonBuiltinRel.findings).toStrictEqual([]);
    expect(check.orphan.findings.map((f) => f.class)).toContain('orphan-claim');
    expect(check.rollup.findings.map((f) => f.class)).toContain('orphan-claim');

    for (const name of Object.keys(CORPORA)) {
      expect(check[name].ok, `${name} must load cleanly`).toBe(true);
      expect(check[name].counts.semantic, `${name} must reach the semantic read`).not.toBeNull();
    }

    const index = captured.index as Record<
      string,
      { items: { derived: boolean }[]; edges: { rel: string; to: string | null }[] }
    >;
    expect(
      index.rollup.items.some((item) => item.derived),
      'the rollup corpus must contain a derived item or falsifier #8a pins nothing',
    ).toBe(true);

    // The control pair, pinned at the EDGE level. `traverseCorpus` seeded the
    // wrong way returns zero edges silently, which would make every edge
    // assertion an empty-set comparison — the same vacuity that had already
    // slipped past once in this phase, caught here the second time.
    expect(index.contradiction.edges.map((e) => e.rel)).toStrictEqual(['satisfies']);
    expect(index.nonBuiltinRel.edges.map((e) => e.rel)).toStrictEqual(['satisfies-toward']);
    for (const name of ['contradiction', 'nonBuiltinRel']) {
      expect(index[name].edges[0]?.to, `${name} edge must RESOLVE to an item`).not.toBeNull();
    }
  });
});
