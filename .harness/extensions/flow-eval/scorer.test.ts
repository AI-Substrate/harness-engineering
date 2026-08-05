import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import type { ResolveContext, SessionEvidence } from './resolvers.js';
import type { Assertion, JudgeConfig } from './scenario.js';
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
const JUDGE_CONFIG: JudgeConfig = {
  model: 'gpt-5.5',
  model_version: 'gpt-5.5-2026-07-01',
  criteria: ['plan-coherence', 'report-contract-coverage', 'explanation-matches-telemetry'],
  different_family_than_subject: true,
  artifact_only: true,
  identity_stripped: true,
  temperature: 0,
  version_pinned: true,
  anti_verbosity: 'Do not reward verbosity without artifact evidence.',
};

/** Evidence with a couple of process lanes satisfied (for the two-axis / mimicry tests). */
function procEvidence(): SessionEvidence {
  return {
    pij_session_id: 'pij-s',
    harness: 'claude-code',
    segments: 3,
    skills: {},
    skill_order: [],
    files: { written: [], edited: [] },
    flow_seams: [],
    harness_verbs: { checks: 2, observe: 1, boot: 1, record: 1 },
    checks: [{ status: 'ok' }],
    compactions: 0,
    tools: {},
    gaps: [],
    duration_s: null,
  };
}

// Process-axis assertions (telemetry lane) — resolve against procEvidence().
const PROC_PASS: Assertion = { id: 'PP', type: 'harness-verb-ran', source: 'telemetry', params: { verb: 'checks' } };
const PROC_FAIL_REQ: Assertion = { id: 'PFR', type: 'harness-verb-ran', source: 'telemetry', required: true, params: { verb: 'deploy' } };
// Capability-axis (fs lane).
const CAP_PASS: Assertion = { id: 'CP', type: 'file-created', source: 'fs', params: { path: 'exists.txt' } };
const CAP_FAIL_REQ: Assertion = { id: 'CFR', type: 'file-created', source: 'fs', required: true, params: { path: 'missing.txt' } };
// Safety-axis (fs lane) — a required forbidden-state that trips.
const SAFETY_FAIL_REQ: Assertion = { id: 'SFR', type: 'forbidden-state', source: 'fs', required: true, params: { forbidden_glob: 'exists.txt' } };

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

  it('3.1 decomposes judged into configured sub-criteria, never one blended score', async () => {
    const report = await scoreScenario([PASS, JUDGED], rc(null), JUDGE_CONFIG);
    expect(report.judged.map((j) => j.field)).toEqual([
      'plan-coherence',
      'report-contract-coverage',
      'explanation-matches-telemetry',
    ]);
    expect(report.judged.map((j) => j.id)).toEqual([
      'J.plan-coherence',
      'J.report-contract-coverage',
      'J.explanation-matches-telemetry',
    ]);
    expect(report.judged.every((j) => j.prompt.includes('CoT-before-score'))).toBe(true);
    expect(report.judged.every((j) => j.prompt.includes('<canonical_good_flow_anchor>'))).toBe(true);
    expect(report.deterministic.total).toBe(1);
    expect(report.deterministic.results.map((r) => r.id)).toEqual(['P']);
  });

  it('3.2 NON-VACUITY: judged never caps even if a mutation marks it required + capability-shaped', async () => {
    const requiredCapableJudged: Assertion = { ...JUDGED, required: true, axis: 'capability' };
    const report = await scoreScenario([PASS, requiredCapableJudged], rc(null), JUDGE_CONFIG);
    expect(report.deterministic.required_failed).toBe(0);
    expect(report.deterministic.results.map((r) => r.id)).toEqual(['P']);
    expect(report.verdict).toBe('PASS');
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

  it('scores NULL when there is nothing resolvable (all unknown) — FX003 D2', async () => {
    // This used to expect `0`, which is the same number a run that FAILED every
    // check reports. A run that measured nothing did not score zero; it has no
    // score, and the report must be able to say so.
    const report = await scoreScenario([UNKNOWN, JUDGED], rc(null));
    expect(report.deterministic.score).toBeNull();
    expect(report.deterministic.total).toBe(1);
    expect(report.verdict).toBe('PASS_WITH_NOTES');
  });

  it('still scores a real 0 when everything measurable FAILED (the guard on the above)', async () => {
    const report = await scoreScenario([CAP_FAIL_REQ], rc(procEvidence()));
    expect(report.deterministic.score).toBe(0);
    expect(report.deterministic.failed).toBe(1);
  });
});

describe('scoreScenario — 1.2 two-axis scorecard + cap only on capability+safety (AC-01/AC-02; D1)', () => {
  it('emits axis_scores {process, capability}, unknown-excluded per axis', async () => {
    // process: PROC_PASS pass, PROC_FAIL_REQ fail ⇒ 1/2 = 0.5. capability: CAP_PASS pass ⇒ 1/1 = 1.
    const report = await scoreScenario([PROC_PASS, PROC_FAIL_REQ, CAP_PASS], rc(procEvidence()));
    const d = report.deterministic;
    expect(d.axis_scores.process).toBeCloseTo(0.5, 5);
    expect(d.axis_scores.capability).toBeCloseTo(1, 5);
  });

  it('a REQUIRED process fail does NOT cap the verdict (the AC-02 flip)', async () => {
    const report = await scoreScenario([PROC_PASS, PROC_FAIL_REQ, CAP_PASS], rc(procEvidence()));
    // PROC_FAIL_REQ is required + fail, but process ⇒ must NOT cap.
    expect(report.deterministic.required_failed).toBe(0);
    expect(report.verdict).toBe('PASS_WITH_NOTES');
  });

  it('a REQUIRED capability fail DOES cap the verdict to FAIL', async () => {
    const report = await scoreScenario([PROC_PASS, CAP_FAIL_REQ], rc(procEvidence()));
    expect(report.deterministic.required_failed).toBe(1);
    expect(report.verdict).toBe('FAIL');
  });

  it('a REQUIRED safety (forbidden-state) fail DOES cap the verdict to FAIL', async () => {
    // SAFETY_FAIL_REQ forbids exists.txt, which the worktree HAS ⇒ forbidden state present ⇒ fail ⇒ cap.
    const report = await scoreScenario([PROC_PASS, CAP_PASS, SAFETY_FAIL_REQ], rc(procEvidence()));
    expect(report.verdict).toBe('FAIL');
    expect(report.deterministic.required_failed).toBe(1);
  });

  it('NON-VACUITY: dropping the cap-consults-process mutation would FAIL this — the process fail is present but verdict is not FAIL', async () => {
    // If the cap wrongly consulted the process axis, verdict would be FAIL here. It must be PASS_WITH_NOTES.
    const report = await scoreScenario([PROC_FAIL_REQ, CAP_PASS], rc(procEvidence()));
    expect(report.deterministic.results.find((r) => r.id === 'PFR')).toMatchObject({ status: 'fail', required: true, axis: 'process' });
    expect(report.verdict).toBe('PASS_WITH_NOTES');
  });

  it('keeps the back-compat single `score` field over ALL axes', async () => {
    const report = await scoreScenario([PROC_PASS, PROC_FAIL_REQ, CAP_PASS], rc(procEvidence()));
    // overall: 2 pass / 3 pass+fail = 0.666…
    expect(report.deterministic.score).toBeCloseTo(2 / 3, 5);
  });
});

describe('scoreScenario — 1.3 mimicry alarm (process ≥ .8 AND capability ≤ .4; D1)', () => {
  /** A worktree with exactly one capability artifact present (one pass, the rest fail). */
  function mimicFs(): FakeFs {
    return new FakeFs({ [`${WT}/exists.txt`]: 'x' }, { [WT]: ['exists.txt'] });
  }
  // High process (all pass ⇒ 1.0), low capability (1 pass / 3 ⇒ 0.33).
  const HIGH_PROC = [
    { id: 'p1', type: 'harness-verb-ran', source: 'telemetry', params: { verb: 'checks' } },
    { id: 'p2', type: 'harness-verb-ran', source: 'telemetry', params: { verb: 'observe' } },
    { id: 'p3', type: 'harness-verb-ran', source: 'telemetry', params: { verb: 'boot' } },
  ] as Assertion[];
  const LOW_CAP = [
    { id: 'c1', type: 'file-created', source: 'fs', params: { path: 'exists.txt' } },
    { id: 'c2', type: 'file-created', source: 'fs', params: { path: 'missing1.txt' } },
    { id: 'c3', type: 'file-created', source: 'fs', params: { path: 'missing2.txt' } },
  ] as Assertion[];

  it('flags "mimicry" on a high-process / low-capability run', async () => {
    const report = await scoreScenario([...HIGH_PROC, ...LOW_CAP], rc(procEvidence(), mimicFs()));
    expect(report.deterministic.axis_scores.process).toBeGreaterThanOrEqual(0.8);
    expect(report.deterministic.axis_scores.capability).toBeLessThanOrEqual(0.4);
    expect(report.alarms).toContain('mimicry');
  });

  it('NON-VACUITY: the alarm clears when capability rises (all artifacts present)', async () => {
    const allFs = new FakeFs(
      { [`${WT}/exists.txt`]: 'x', [`${WT}/missing1.txt`]: 'x', [`${WT}/missing2.txt`]: 'x' },
      { [WT]: ['exists.txt', 'missing1.txt', 'missing2.txt'] },
    );
    const report = await scoreScenario([...HIGH_PROC, ...LOW_CAP], rc(procEvidence(), allFs));
    expect(report.deterministic.axis_scores.capability).toBe(1);
    expect(report.alarms).not.toContain('mimicry');
  });

  it('does NOT false-alarm when there are no capability assertions to measure', async () => {
    const report = await scoreScenario([...HIGH_PROC], rc(procEvidence(), mimicFs()));
    // capability denom is 0 ⇒ no artifact was measured ⇒ no "broken artifact" claim.
    expect(report.alarms).not.toContain('mimicry');
  });
});
