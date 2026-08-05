import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { buildReportMd, type ReportInput, writeReport } from './report.js';
import { buildJudgeProvenance, type JudgeConfig } from './scenario.js';
import type { ScoredReport } from './scorer.js';

/*
Test Doc:
- Why: AC-07 — reports land at .harness/live-testing/<slug>/<run-id>/report.{json,md} via
  ctx.fsWrite, carry the deterministic table + judged section + verdict + subject/base_ref,
  and an absent fsWrite degrades to an honest error (never a silent no-op).
- Contract: writeReport(fsWrite) → both files written + parseable JSON + glyph table;
  writeReport(undefined) → { ok:false, error }.
*/

const scored: ScoredReport = {
  deterministic: {
    score: 0.5,
    axis_scores: { process: 1, capability: 0 },
    passed: 1,
    failed: 1,
    unknown: 1,
    total: 3,
    required_failed: 0,
    results: [
      { id: 'A1', type: 'skill-called', source: 'telemetry', axis: 'process', status: 'pass', required: true, weight: 1, describe: 'drove the-flow' },
      { id: 'A8', type: 'file-created', source: 'fs', axis: 'capability', status: 'fail', required: false, weight: 1, describe: 'made the file' },
      { id: 'A4', type: 'harness-verb-ran', source: 'telemetry', axis: 'process', status: 'unknown', required: false, weight: 1 },
    ],
  },
  judged: [
    {
      id: 'A13.plan-coherence',
      criterion: 'plan-coherence',
      field: 'plan-coherence',
      prompt: 'CoT-before-score: proper checker?',
      rubric: 'evidence anchored',
      describe: 'plan quality',
      verdict: null,
      rationale: null,
      by: null,
    },
    {
      id: 'A13.report-contract-coverage',
      criterion: 'report-contract-coverage',
      field: 'report-contract-coverage',
      prompt: 'CoT-before-score: report contract?',
      rubric: 'contract anchored',
      verdict: null,
      rationale: null,
      by: null,
    },
  ],
  alarms: [],
  verdict: 'PASS_WITH_NOTES',
};

const judgeConfig: JudgeConfig = {
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

const input: ReportInput = {
  scenario: 'md-to-pdf',
  run_id: '20260623-110000Z-pijfix',
  subject: { harness: 'claude', model: 'opus', pij_session_id: 'pij-fix', effort: 'high' },
  base_ref: 'v0.6.0',
  started_at: '2026-06-23T11:00:00.000Z',
  finished_at: '2026-06-23T11:00:05.000Z',
  scored,
  provenance: { judge: buildJudgeProvenance(judgeConfig, 'opus') },
};

describe('writeReport — writes report.{json,md} via ctx.fsWrite (AC-07)', () => {
  it('writes both files to the run dir with a parseable, complete JSON report', () => {
    const fs = new FakeFs();
    const res = writeReport(input, '/repo', fs);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const expectedDir = '/repo/.harness/live-testing/md-to-pdf/20260623-110000Z-pijfix';
    expect(res.dir).toBe(expectedDir);
    expect(fs.writes).toContain(`${expectedDir}/report.json`);
    expect(fs.writes).toContain(`${expectedDir}/report.md`);
    expect(fs.mkdirs).toContain(expectedDir);

    const json = JSON.parse(fs.readText(`${expectedDir}/report.json`) as string);
    expect(json).toMatchObject({
      scenario: 'md-to-pdf',
      run_id: '20260623-110000Z-pijfix',
      base_ref: 'v0.6.0',
      verdict: 'PASS_WITH_NOTES',
      subject: { harness: 'claude', model: 'opus', pij_session_id: 'pij-fix', effort: 'high' },
      deterministic: { score: 0.5, passed: 1, failed: 1, unknown: 1, total: 3, required_failed: 0 },
    });
    expect(json.deterministic.results).toHaveLength(3);
    expect(json.deterministic.axis_scores).toEqual({ process: 1, capability: 0 });
    expect(json.deterministic.results[0]).toMatchObject({ id: 'A1', axis: 'process' });
    expect(json.alarms).toEqual([]);
    expect(json.judged).toHaveLength(2);
    expect(json.judged[0]).toMatchObject({ field: 'plan-coherence', criterion: 'plan-coherence', verdict: null });
    expect(json.judged[1]).toMatchObject({
      field: 'report-contract-coverage',
      criterion: 'report-contract-coverage',
      verdict: null,
    });
    expect(json.provenance.judge).toMatchObject({
      model: 'gpt-5.5',
      model_version: 'gpt-5.5-2026-07-01',
      different_family_than_subject: true,
      artifact_only: true,
      temperature: 0,
      version_pinned: true,
    });
    expect(json.provenance.judge.prompt_scaffold).toMatchObject({
      cot_before_score: true,
      canonical_good_flow_anchor: null,
      calibration_set: 'human-gold-calibration-set-deferred',
    });
  });

  it('renders the MD with a glyph table, judged section, verdict and subject/base_ref', () => {
    const md = buildReportMd(input);
    expect(md).toContain('# flow-eval report — md-to-pdf');
    expect(md).toContain('**Verdict**: PASS_WITH_NOTES');
    expect(md).toContain('**Axis scores**: process 1.00 · capability 0.00');
    expect(md).toContain('**Base ref**: v0.6.0');
    expect(md).toContain('session `pij-fix`');
    // glyphs: pass ✓, fail ✗, unknown ?
    expect(md).toContain('| ✓ | A1 |');
    expect(md).toContain('| ✗ | A8 |');
    expect(md).toContain('| ? | A4 |');
    expect(md).toContain('plan-coherence');
    expect(md).toContain('report-contract-coverage');
    expect(md).toContain('## Judge provenance');
    expect(md).toContain('canonical good-flow anchor: present, content deferred');
  });

  it('3.2 renders a visible warning when judge and subject are same family, without crashing', () => {
    const sameFamily = {
      ...input,
      subject: { ...input.subject, model: 'gpt-5.5' },
      provenance: { judge: buildJudgeProvenance(judgeConfig, 'gpt-5.5') },
    };
    const md = buildReportMd(sameFamily);
    expect(sameFamily.provenance.judge?.warnings).toEqual(['judge-same-family-as-subject']);
    expect(md).toContain('**Judge warnings**: judge-same-family-as-subject');
  });

  it('F-B: a null/unmeasured axis renders `unmeasured`, NEVER `0.00` (dogfood run-1)', () => {
    // Process axis has ONLY an unknown lane → no scorable (pass|fail) lane → unmeasured.
    // Capability axis has a real `fail` → measured, and legitimately scores 0.00.
    const unmeasuredProcess: ScoredReport = {
      ...scored,
      deterministic: {
        ...scored.deterministic,
        // FX003 D2: `null` is what the scorer now emits for an axis with no scorable
        // lane, and the renderer READS it rather than re-deriving measured-ness from
        // the rows below (one source of truth, not three).
        axis_scores: { process: null, capability: 0 },
        results: [
          { id: 'P1', type: 'skill-called', source: 'telemetry', axis: 'process', status: 'unknown', required: false, weight: 1 },
          { id: 'C1', type: 'file-created', source: 'fs', axis: 'capability', status: 'fail', required: false, weight: 1 },
        ],
      },
    };
    const md = buildReportMd({ ...input, scored: unmeasuredProcess });
    // NON-VACUITY (null-axis-as-"0.00" → RED): the all-unknown process axis must not read 0.00.
    expect(md).toContain('process unmeasured');
    expect(md).not.toContain('process 0.00');
    // A genuinely measured zero (capability: one fail, no pass) STILL renders 0.00.
    expect(md).toContain('capability 0.00');
  });

  it('renders an Alarms line + Axis cells when the scored report carries a mimicry flag', () => {
    const md = buildReportMd({ ...input, scored: { ...scored, alarms: ['mimicry'] } });
    expect(md).toContain('**Alarms**: mimicry');
    // the Axis column is present and carries each row's axis.
    expect(md).toContain('| process |');
    expect(md).toContain('| capability |');
  });

  it('returns an honest error when the core provides no fsWrite (feature-detect)', () => {
    const res = writeReport(input, '/repo', undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fsWrite/);
  });

  it('appends ONE ledger line to the scenario-level path when ledger inputs are supplied (2.2)', () => {
    const fs = new FakeFs();
    const withLedger: ReportInput = {
      ...input,
      ledger: {
        seed: { scenario_hash: 'fnv1a:aa', prompt_hash: 'fnv1a:bb' },
        telemetry_available: true,
        duration_s: 900,
        session_export: null,
        telemetry_summary: null,
        provenance: input.provenance,
      },
    };
    const res = writeReport(withLedger, '/repo', fs);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ledgerLine = '/repo/.harness/live-testing/md-to-pdf/ledger.jsonl';
    expect(res.ledger).toBe(ledgerLine);
    const parsed = JSON.parse((fs.readText(ledgerLine) as string).trim());
    expect(parsed).toMatchObject({ run_id: input.run_id, verdict: 'PARTIAL', base_ref: 'v0.6.0' });
    expect(parsed.seed_tuple.scenario_hash).toBe('fnv1a:aa');
    expect(parsed.provenance.judge.model).toBe('gpt-5.5');
  });

  it('does NOT append a ledger line on the report-only path (no ledger input)', () => {
    const fs = new FakeFs();
    const res = writeReport(input, '/repo', fs);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.ledger).toBeUndefined();
    expect(fs.writes.some((p) => p.endsWith('ledger.jsonl'))).toBe(false);
  });
});
