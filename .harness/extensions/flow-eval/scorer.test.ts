import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import type { ResolveContext, SessionEvidence } from './resolvers.js';
import type { Assertion } from './scenario.js';
import { scoreScenario } from './scorer.js';

/*
Test Doc:
- Why: the scorer is the AC-06 contract — score must EXCLUDE unknown from the denominator,
  a required FAIL must cap the verdict to FAIL, and `judged` assertions must be surfaced as
  fields (never scored). These pin the three-valued math + the verdict rule + the split.
- Contract: score = Σ(weight pass)/Σ(weight pass+fail); required_failed>0 ⇒ verdict FAIL;
  judged routed to `judged[]` with null verdict/by; all-pass ⇒ PASS; any unknown/fail (no
  required fail) ⇒ PASS_WITH_NOTES.
*/

const WT = '/wt';

/** A worktree with exactly one file, so file-created path:exists ⇒ pass, others ⇒ fail. */
function fsWithExisting(): FakeFs {
  return new FakeFs({ [`${WT}/exists.txt`]: 'x' }, { [WT]: ['exists.txt'] });
}

function rc(evidence: SessionEvidence | null, fs: FakeFs = fsWithExisting()): ResolveContext {
  const exec = new FakeExec();
  return { evidence, worktree: WT, fs, exec: (c, a, o) => exec.run(c, a, o) };
}

const PASS: Assertion = { id: 'P', type: 'file-created', source: 'fs', params: { path: 'exists.txt' }, weight: 2 };
const FAIL_REQ: Assertion = { id: 'F', type: 'file-created', source: 'fs', required: true, params: { path: 'missing.txt' }, weight: 1 };
const UNKNOWN: Assertion = { id: 'U', type: 'skill-called', source: 'telemetry', params: { skill: 'x' } };
const JUDGED: Assertion = { id: 'J', type: 'judged', source: 'judged', params: { field: 'quality', prompt: 'good?' }, describe: 'q' };

describe('scoreScenario — three-valued score + required-fail cap + judged split (AC-06)', () => {
  it('excludes unknown from the denominator and caps the verdict to FAIL on a required fail', async () => {
    const report = await scoreScenario([PASS, FAIL_REQ, UNKNOWN, JUDGED], rc(null));
    const d = report.deterministic;
    expect(d.passed).toBe(1);
    expect(d.failed).toBe(1);
    expect(d.unknown).toBe(1);
    expect(d.total).toBe(3); // judged excluded from the deterministic total
    expect(d.required_failed).toBe(1);
    // weighted: passWeight 2 / (pass 2 + fail 1) = 0.666… — the unknown does NOT dilute it.
    expect(d.score).toBeCloseTo(2 / 3, 5);
    expect(report.verdict).toBe('FAIL');
  });

  it('surfaces judged assertions as fields with a null (orchestrator-pending) verdict', async () => {
    const report = await scoreScenario([PASS, JUDGED], rc(null));
    expect(report.judged).toHaveLength(1);
    expect(report.judged[0]).toMatchObject({
      id: 'J',
      field: 'quality',
      prompt: 'good?',
      verdict: null,
      rationale: null,
      by: null,
    });
    // judged never appears in the deterministic results.
    expect(report.deterministic.results.map((r) => r.id)).toEqual(['P']);
  });

  it('is PASS when every deterministic assertion passes', async () => {
    const report = await scoreScenario([PASS], rc(null));
    expect(report.verdict).toBe('PASS');
    expect(report.deterministic.score).toBe(1);
  });

  it('is PASS_WITH_NOTES when an unknown is present but nothing required failed', async () => {
    const report = await scoreScenario([PASS, UNKNOWN], rc(null));
    expect(report.deterministic.required_failed).toBe(0);
    expect(report.deterministic.unknown).toBe(1);
    expect(report.verdict).toBe('PASS_WITH_NOTES');
  });

  it('is PASS_WITH_NOTES (not FAIL) when a NON-required assertion fails', async () => {
    const failOptional: Assertion = { id: 'fo', type: 'file-created', source: 'fs', params: { path: 'missing.txt' } };
    const report = await scoreScenario([PASS, failOptional], rc(null));
    expect(report.deterministic.required_failed).toBe(0);
    expect(report.verdict).toBe('PASS_WITH_NOTES');
  });

  it('scores 0 when there is nothing resolvable (all unknown)', async () => {
    const report = await scoreScenario([UNKNOWN, JUDGED], rc(null));
    expect(report.deterministic.score).toBe(0);
    expect(report.deterministic.total).toBe(1);
    expect(report.verdict).toBe('PASS_WITH_NOTES');
  });
});
