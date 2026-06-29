import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { buildReportMd, type ReportInput, writeReport } from './report.js';
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
    passed: 1,
    failed: 1,
    unknown: 1,
    total: 3,
    required_failed: 0,
    results: [
      { id: 'A1', type: 'skill-called', source: 'telemetry', status: 'pass', required: true, weight: 1, describe: 'drove the-flow' },
      { id: 'A8', type: 'file-created', source: 'fs', status: 'fail', required: false, weight: 1, describe: 'made the file' },
      { id: 'A4', type: 'harness-verb-ran', source: 'telemetry', status: 'unknown', required: false, weight: 1 },
    ],
  },
  judged: [
    { id: 'A13', field: 'backpressure_quality', prompt: 'proper checker?', describe: 'quality', verdict: null, rationale: null, by: null },
  ],
  verdict: 'PASS_WITH_NOTES',
};

const input: ReportInput = {
  scenario: 'md-to-pdf',
  run_id: '20260623-110000Z-pijfix',
  subject: { harness: 'claude', model: 'opus', pij_session_id: 'pij-fix', effort: 'high' },
  base_ref: 'v0.6.0',
  started_at: '2026-06-23T11:00:00.000Z',
  finished_at: '2026-06-23T11:00:05.000Z',
  scored,
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
    expect(json.judged[0]).toMatchObject({ field: 'backpressure_quality', verdict: null });
  });

  it('renders the MD with a glyph table, judged section, verdict and subject/base_ref', () => {
    const md = buildReportMd(input);
    expect(md).toContain('# flow-eval report — md-to-pdf');
    expect(md).toContain('**Verdict**: PASS_WITH_NOTES');
    expect(md).toContain('**Base ref**: v0.6.0');
    expect(md).toContain('session `pij-fix`');
    // glyphs: pass ✓, fail ✗, unknown ?
    expect(md).toContain('| ✓ | A1 |');
    expect(md).toContain('| ✗ | A8 |');
    expect(md).toContain('| ? | A4 |');
    expect(md).toContain('backpressure_quality');
  });

  it('returns an honest error when the core provides no fsWrite (feature-detect)', () => {
    const res = writeReport(input, '/repo', undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fsWrite/);
  });
});
