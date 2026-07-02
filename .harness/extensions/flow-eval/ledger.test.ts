import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import {
  appendRunRecord,
  buildRunRecord,
  type BuildRunRecordInput,
  contentHash,
  ledgerPath,
  readLedger,
  RUN_RECORD_SCHEMA,
  RUN_RECORD_SCHEMA_VERSION,
  runRecordLine,
  type TelemetrySummary,
  validateRunRecord,
} from './ledger.js';
import { buildJudgeProvenance, type JudgeConfig } from './scenario.js';
import type { ScoredReport } from './scorer.js';

/*
Test Doc (plan 046 Phase 2, tasks 2.1 + 2.2):
- Why: the RunRecord is the eval's durable memory + the `--compare` key. It must
  (2.1) round-trip a scored run into a SCHEMA-VALID record, carry real cost totals
  when an export exists AND honest `null` when it doesn't (never zero-filled), and
  (2.2) append to the scenario-level ledger.jsonl append-only — prior lines
  byte-stable. Each rule ships a named non-vacuity mutation.
*/

/** A two-axis scored report: capability all-pass, one process unknown, one process fail. */
function scored(overrides: Partial<ScoredReport['deterministic']> = {}): ScoredReport {
  return {
    deterministic: {
      score: 0.75,
      axis_scores: { process: 0.5, capability: 1 },
      passed: 2,
      failed: 1,
      unknown: 1,
      total: 4,
      required_failed: 0,
      results: [
        { id: 'A8', type: 'file-content-matches', source: 'fs', axis: 'capability', status: 'pass', required: true, weight: 1 },
        { id: 'A2', type: 'skill-sequence', source: 'telemetry', axis: 'process', status: 'pass', required: true, weight: 1 },
        { id: 'A5', type: 'checks-ran', source: 'telemetry', axis: 'process', status: 'fail', required: false, weight: 1 },
        { id: 'A4', type: 'harness-verb-ran', source: 'telemetry', axis: 'process', status: 'unknown', required: false, weight: 1 },
      ],
      ...overrides,
    },
    judged: [],
    alarms: [],
    verdict: 'PASS_WITH_NOTES',
  };
}

const SUMMARY: TelemetrySummary = {
  active_time_s: 1234,
  tokens: { input: 5000, output: 2000 },
  cache: { read: 900000, create: 40000 },
  turns: 42,
};

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

function input(over: Partial<BuildRunRecordInput> = {}): BuildRunRecordInput {
  return {
    scenario: 'md-to-pdf',
    run_id: 'pij-abc123',
    ts: '2026-07-01T00:14:00.000Z',
    subject: { model: 'claude-sonnet-5', harness: 'claude', effort: 'xhigh' },
    base_ref: 'c3e6b778',
    scored: scored(),
    seed: { scenario_hash: 'fnv1a:aaaa', prompt_hash: 'fnv1a:bbbb' },
    telemetry_available: true,
    duration_s: 900,
    session_export: null,
    telemetry_summary: null,
    ...over,
  };
}

describe('buildRunRecord — 2.1 round-trips a scored run into a schema-valid record', () => {
  it('produces a record that passes validateRunRecord + carries the seed tuple + mapped lanes', () => {
    const rec = buildRunRecord(input());
    expect(validateRunRecord(rec)).toEqual([]);
    expect(rec.schema_version).toBe(RUN_RECORD_SCHEMA_VERSION);
    expect(rec.seed_tuple).toMatchObject({
      model: 'claude-sonnet-5',
      harness: 'claude',
      effort: 'xhigh',
      base_ref: 'c3e6b778',
      scenario_hash: 'fnv1a:aaaa',
      prompt_hash: 'fnv1a:bbbb',
    });
    // lanes align by assertion_id, carrying axis + verdict.
    expect(rec.lanes).toContainEqual({ lane: 'file-content-matches', assertion_id: 'A8', verdict: 'pass', required: true, axis: 'capability' });
    expect(rec.lanes.find((l) => l.assertion_id === 'A4')?.verdict).toBe('unknown');
  });

  it('maps PASS_WITH_NOTES → PARTIAL (and PASS→PASS, FAIL→FAIL)', () => {
    expect(buildRunRecord(input()).verdict).toBe('PARTIAL');
    expect(buildRunRecord(input({ scored: { ...scored(), verdict: 'PASS' } })).verdict).toBe('PASS');
    expect(buildRunRecord(input({ scored: { ...scored(), verdict: 'FAIL' } })).verdict).toBe('FAIL');
  });

  it('carries REAL totals when an export exists, and honest null when it does not (never zero-filled)', () => {
    const withExport = buildRunRecord(input({ session_export: '.harness/x.session.json', telemetry_summary: SUMMARY }));
    expect(withExport.session_export).toBe('.harness/x.session.json');
    expect(withExport.telemetry_summary).toEqual(SUMMARY);

    const without = buildRunRecord(input());
    // NON-VACUITY: an absent summary is null — NOT { active_time_s: 0, ... }.
    expect(without.telemetry_summary).toBeNull();
    expect(without.session_export).toBeNull();
  });

  it('axis_scores is null on an axis with NO scorable lane — an honest "not measured", never 0', () => {
    // A capability lane that is `unknown` (no pass|fail) ⇒ capability not scorable.
    const s = scored({
      results: [
        { id: 'A8', type: 'file-created', source: 'fs', axis: 'capability', status: 'unknown', required: true, weight: 1 },
        { id: 'A2', type: 'skill-sequence', source: 'telemetry', axis: 'process', status: 'pass', required: false, weight: 1 },
      ],
      axis_scores: { process: 1, capability: 0 },
    });
    const rec = buildRunRecord(input({ scored: s }));
    // NON-VACUITY: capability has only an `unknown` lane → null (NOT the scorer's 0).
    expect(rec.axis_scores.capability).toBeNull();
    expect(rec.axis_scores.process).toBe(1);
    expect(rec.unknown_rate_by_axis).toEqual({ capability: 1, process: 0 });
  });

  it('omits optional seed fields when absent, includes them when supplied', () => {
    expect(buildRunRecord(input()).seed_tuple.orchestrator_id).toBeUndefined();
    const rec = buildRunRecord(input({ seed: { scenario_hash: 'h', prompt_hash: 'p', model_version: '5.1', orchestrator_id: 'pij-drv' } }));
    expect(rec.seed_tuple.orchestrator_id).toBe('pij-drv');
    expect(rec.seed_tuple.model_version).toBe('5.1');
  });

  it('3.2 carries judge config provenance as additive run provenance', () => {
    const rec = buildRunRecord(input({ provenance: { judge: buildJudgeProvenance(JUDGE_CONFIG, 'opus') } }));
    expect(rec.provenance?.judge).toMatchObject({
      model: 'gpt-5.5',
      model_version: 'gpt-5.5-2026-07-01',
      different_family_than_subject: true,
      artifact_only: true,
      temperature: 0,
      version_pinned: true,
    });
    expect(rec.provenance?.judge?.prompt_scaffold).toMatchObject({
      cot_before_score: true,
      canonical_good_flow_anchor: null,
      calibration_set: 'human-gold-calibration-set-deferred',
    });
    expect(validateRunRecord(rec)).toEqual([]);
  });
});

describe('RUN_RECORD_SCHEMA + validateRunRecord — the reader gate', () => {
  it('required-key set is derived from the schema (they cannot drift)', () => {
    const bad = { ...buildRunRecord(input()) } as Record<string, unknown>;
    delete bad.telemetry_summary; // a schema-required key
    expect(validateRunRecord(bad)).toContain('missing required key: telemetry_summary');
    expect(RUN_RECORD_SCHEMA.required).toContain('telemetry_summary');
  });

  it('rejects a future schema_version rather than mis-parsing it (migration safety)', () => {
    const future = { ...buildRunRecord(input()), schema_version: 999 };
    expect(validateRunRecord(future).some((p) => p.includes('schema_version'))).toBe(true);
  });

  it('rejects an out-of-enum verdict', () => {
    const bad = { ...buildRunRecord(input()), verdict: 'MAYBE' };
    expect(validateRunRecord(bad).some((p) => p.includes('verdict'))).toBe(true);
  });
});

describe('contentHash — a stable, drift-sensitive digest', () => {
  it('is stable for identical bytes and changes on a one-byte edit', () => {
    expect(contentHash('scenario', 'assertions')).toBe(contentHash('scenario', 'assertions'));
    expect(contentHash('scenario', 'assertions')).not.toBe(contentHash('scenario', 'assertionX'));
    // field boundary matters: (a,b) ≠ (ab,'') — a NUL separator, not concatenation.
    expect(contentHash('a', 'b')).not.toBe(contentHash('ab', ''));
  });
});

describe('appendRunRecord — 2.2 append-only, prior lines byte-stable (AC-05)', () => {
  const CWD = '/repo';

  it('writes N runs → N lines at the scenario-level path (NOT the per-run subdir)', () => {
    const fs = new FakeFs();
    const r1 = buildRunRecord(input({ run_id: 'run-1' }));
    const r2 = buildRunRecord(input({ run_id: 'run-2' }));
    const r3 = buildRunRecord(input({ run_id: 'run-3' }));

    const a1 = appendRunRecord(r1, CWD, fs);
    const a2 = appendRunRecord(r2, CWD, fs);
    const a3 = appendRunRecord(r3, CWD, fs);
    expect(a1.ok && a2.ok && a3.ok).toBe(true);

    const path = ledgerPath(CWD, 'md-to-pdf');
    expect(path).toBe('/repo/.harness/live-testing/md-to-pdf/ledger.jsonl');
    // scenario-level parent — never `.../md-to-pdf/<run-id>/ledger.jsonl`.
    expect(path).not.toMatch(/run-\d\//);

    const lines = (fs.readText(path) as string).split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l).run_id)).toEqual(['run-1', 'run-2', 'run-3']);
  });

  it('leaves EVERY prior line byte-identical after each append (non-vacuity: exact-prefix)', () => {
    const fs = new FakeFs();
    const path = ledgerPath(CWD, 'md-to-pdf');

    appendRunRecord(buildRunRecord(input({ run_id: 'run-1' })), CWD, fs);
    const afterFirst = fs.readText(path) as string;
    // The single line is EXACTLY the serialized record (newline-terminated).
    expect(afterFirst).toBe(runRecordLine(buildRunRecord(input({ run_id: 'run-1' }))));

    appendRunRecord(buildRunRecord(input({ run_id: 'run-2' })), CWD, fs);
    const afterSecond = fs.readText(path) as string;
    // NON-VACUITY: the file after the 2nd append STARTS WITH the exact bytes it
    // had after the 1st — a rewrite that re-serialized line 1 would break this.
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });

  it('repairs a prior file missing its trailing newline so lines never fuse', () => {
    const path = ledgerPath(CWD, 'md-to-pdf');
    const fs = new FakeFs({ [path]: '{"run_id":"legacy"}' }); // no trailing \n
    appendRunRecord(buildRunRecord(input({ run_id: 'run-1' })), CWD, fs);
    const lines = (fs.readText(path) as string).split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).run_id).toBe('legacy');
    expect(JSON.parse(lines[1]).run_id).toBe('run-1');
  });
});

describe('readLedger — parses records in order, skips corrupt / future-version lines', () => {
  const CWD = '/repo';

  it('returns valid records in file order and surfaces skips with a reason', () => {
    const path = ledgerPath(CWD, 'md-to-pdf');
    const good1 = runRecordLine(buildRunRecord(input({ run_id: 'g1' })));
    const good2 = runRecordLine(buildRunRecord(input({ run_id: 'g2' })));
    const future = `${JSON.stringify({ ...buildRunRecord(input({ run_id: 'fut' })), schema_version: 2 })}\n`;
    const fs = new FakeFs({ [path]: `${good1}not-json\n${future}\n${good2}` });

    const { records, skipped } = readLedger(CWD, 'md-to-pdf', fs);
    expect(records.map((r) => r.run_id)).toEqual(['g1', 'g2']);
    expect(skipped.map((s) => s.reason)).toContain('invalid JSON');
    expect(skipped.some((s) => s.reason.includes('schema_version'))).toBe(true);
  });

  it('returns empty (no throw) when the ledger file is absent', () => {
    expect(readLedger(CWD, 'never-run', new FakeFs())).toEqual({ records: [], skipped: [] });
  });
});
