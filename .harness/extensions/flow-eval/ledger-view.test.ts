import { describe, expect, it } from 'vitest';
import type { LaneOutcome, RunRecord, TelemetrySummary } from './ledger.js';
import { compareModels, mcnemar, renderLedgerList, seedKey, wilson } from './ledger-view.js';

/*
Test Doc (plan 046 Phase 2, tasks 2.4 + 2.5):
- Why: the ledger READ views turn raw records into drift + comparison signal.
  2.4 must surface a FLIPPED lane (within one seed_tuple only). 2.5 must group by
  model, derive pass^k + Wilson + McNemar, REFUSE a mismatched scenario_hash/
  base_ref (a refusal, not a fallback), and average cost ONLY over runs that
  carry a summary (a null-summary run is counted + excluded, never zero-filled).
  Each rule ships a named non-vacuity mutation.
*/

const SUMMARY: TelemetrySummary = {
  active_time_s: 1000,
  tokens: { input: 4000, output: 1000 },
  cache: { read: 500000, create: 20000 },
  turns: 30,
};

let seq = 0;
function lane(assertion_id: string, verdict: LaneOutcome['verdict'], axis: LaneOutcome['axis'] = 'process', required = false): LaneOutcome {
  return { lane: `lane-${assertion_id}`, assertion_id, verdict, required, axis };
}

function mkRecord(over: Partial<RunRecord> & { model?: string; scenario_hash?: string; prompt_hash?: string } = {}): RunRecord {
  const model = over.model ?? 'sonnet-5';
  const scenarioHash = over.scenario_hash ?? 'fnv1a:same';
  const promptHash = over.prompt_hash ?? 'fnv1a:p';
  seq += 1;
  return {
    schema_version: 1,
    run_id: over.run_id ?? `run-${seq}`,
    ts: over.ts ?? `2026-07-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    scenario: 'md-to-pdf',
    subject: { model, harness: 'claude', ...(over.subject?.effort && { effort: over.subject.effort }) },
    base_ref: over.base_ref ?? 'base-A',
    seed_tuple: {
      model,
      harness: 'claude',
      base_ref: over.base_ref ?? 'base-A',
      scenario_hash: scenarioHash,
      prompt_hash: promptHash,
      ...(over.subject?.effort && { effort: over.subject.effort }),
    },
    lanes: over.lanes ?? [lane('A2', 'pass'), lane('A8', 'pass', 'capability', true)],
    axis_scores: over.axis_scores ?? { capability: 1, process: 1 },
    verdict: over.verdict ?? 'PASS',
    telemetry_available: over.telemetry_available ?? true,
    duration_s: over.duration_s ?? 900,
    session_export: over.session_export ?? null,
    telemetry_summary: over.telemetry_summary ?? null,
  };
}

describe('stats primitives', () => {
  it('wilson: null at n=0, sensible interval otherwise', () => {
    expect(wilson(0, 0)).toBeNull();
    const w = wilson(9, 10);
    expect(w?.p).toBeCloseTo(0.9, 5);
    expect((w?.lo ?? 0)).toBeGreaterThan(0.5);
    expect((w?.hi ?? 1)).toBeLessThanOrEqual(1);
  });

  it('mcnemar: not significant with no discordant pairs; significant when strongly one-sided', () => {
    expect(mcnemar(0, 0).significant).toBe(false);
    expect(mcnemar(10, 0).significant).toBe(true); // χ² = (|10|-1)²/10 = 8.1 > 3.841
    expect(mcnemar(1, 1).significant).toBe(false);
  });
});

describe('renderLedgerList — 2.4 runs over time + per-lane flips', () => {
  it('lists every run and derives run rows in order', () => {
    const { data, board } = renderLedgerList('md-to-pdf', [
      mkRecord({ run_id: 'r1' }),
      mkRecord({ run_id: 'r2' }),
    ]);
    expect(data.run_count).toBe(2);
    expect(data.runs.map((r) => r.run_id)).toEqual(['r1', 'r2']);
    expect(board).toContain('md-to-pdf · 2 run(s)');
  });

  it('marks a lane FLIPPED when its verdict changes across two runs of the SAME seed_tuple', () => {
    const a2Pass = mkRecord({ run_id: 'r1', lanes: [lane('A2', 'pass')] });
    const a2Fail = mkRecord({ run_id: 'r2', lanes: [lane('A2', 'fail')] });
    const { data } = renderLedgerList('md-to-pdf', [a2Pass, a2Fail]);
    expect(data.flipped_lanes).toContain('A2');
    expect(data.lanes.find((l) => l.assertion_id === 'A2')?.flipped).toBe(true);
  });

  it('NON-VACUITY: two runs with the SAME verdict do NOT flip', () => {
    const { data } = renderLedgerList('md-to-pdf', [
      mkRecord({ run_id: 'r1', lanes: [lane('A2', 'pass')] }),
      mkRecord({ run_id: 'r2', lanes: [lane('A2', 'pass')] }),
    ]);
    expect(data.flipped_lanes).not.toContain('A2');
  });

  it('a verdict difference across DIFFERENT models is NOT a flip (model difference, not drift)', () => {
    const sonnet = mkRecord({ run_id: 'r1', model: 'sonnet-5', lanes: [lane('A2', 'pass')] });
    const gpt = mkRecord({ run_id: 'r2', model: 'gpt-5.5', lanes: [lane('A2', 'fail')] });
    expect(seedKey(sonnet)).not.toBe(seedKey(gpt));
    const { data } = renderLedgerList('md-to-pdf', [sonnet, gpt]);
    expect(data.flipped_lanes).not.toContain('A2');
  });

  it('F3: a verdict difference across a DIFFERENT prompt_hash is NOT a flip (a new subject packet, not drift)', () => {
    const v1 = mkRecord({ run_id: 'r1', prompt_hash: 'fnv1a:promptV1', lanes: [lane('A2', 'pass')] });
    const v2 = mkRecord({ run_id: 'r2', prompt_hash: 'fnv1a:promptV2', lanes: [lane('A2', 'fail')] });
    // The seed key must SEPARATE on prompt_hash — else a changed packet reads as within-seed drift.
    expect(seedKey(v1)).not.toBe(seedKey(v2));
    const { data } = renderLedgerList('md-to-pdf', [v1, v2]);
    expect(data.flipped_lanes).not.toContain('A2');
    // NON-VACUITY: the SAME prompt_hash with a changed verdict DOES flip.
    const same1 = mkRecord({ run_id: 'r3', prompt_hash: 'fnv1a:promptV1', lanes: [lane('A2', 'pass')] });
    const same2 = mkRecord({ run_id: 'r4', prompt_hash: 'fnv1a:promptV1', lanes: [lane('A2', 'fail')] });
    expect(renderLedgerList('md-to-pdf', [same1, same2]).data.flipped_lanes).toContain('A2');
  });
});

describe('compareModels — 2.5 model-vs-model board', () => {
  it('REFUSES a comparison across a mismatched scenario_hash (a refusal, not a fallback)', () => {
    const res = compareModels('md-to-pdf', [
      mkRecord({ model: 'sonnet-5', scenario_hash: 'fnv1a:v1' }),
      mkRecord({ model: 'gpt-5.5', scenario_hash: 'fnv1a:v2' }),
    ], ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/rubric\/base change|scenario_hash/);
  });

  it('REFUSES across a mismatched base_ref', () => {
    const res = compareModels('md-to-pdf', [
      mkRecord({ model: 'sonnet-5', base_ref: 'base-A' }),
      mkRecord({ model: 'gpt-5.5', base_ref: 'base-B' }),
    ], ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(false);
  });

  it('NON-VACUITY: a MATCHED scenario_hash + base_ref computes the board (proves the refusal is real)', () => {
    const res = compareModels('md-to-pdf', [
      mkRecord({ model: 'sonnet-5', scenario_hash: 'fnv1a:v1', base_ref: 'base-A' }),
      mkRecord({ model: 'gpt-5.5', scenario_hash: 'fnv1a:v1', base_ref: 'base-A' }),
    ], ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.scenario_hash).toBe('fnv1a:v1');
      expect(res.data.models).toEqual(['sonnet-5', 'gpt-5.5']);
    }
  });

  it('errors when fewer than two --compare groups are given', () => {
    const res = compareModels('md-to-pdf', [mkRecord({ model: 'sonnet-5' })], ['sonnet-5']);
    expect(res.ok).toBe(false);
  });

  it('computes pass^1 + pass^k per model + a McNemar (trial-key paired) on a one-sided lane', () => {
    // sonnet passes A2 on all 3 runs; gpt fails A2 on all 3 → 3 discordant b-pairs.
    const recs: RunRecord[] = [
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'fail', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'fail', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'fail', 'process', true)] }),
    ];
    const res = compareModels('md-to-pdf', recs, ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a2 = res.data.lanes.find((l) => l.assertion_id === 'A2');
    // All-pass sonnet: mean=1 AND observed all-k=1. All-fail gpt: mean=0 AND all-k=0.
    expect(a2?.by_model['sonnet-5']).toMatchObject({ passes: 3, k: 3, pass_1: 1, pass_k: 1, pass_k_est: 1 });
    expect(a2?.by_model['gpt-5.5']).toMatchObject({ passes: 0, k: 3, pass_1: 0, pass_k: 0, pass_k_est: 0 });
    // McNemar: b=3, c=0 → χ² = (|3|-1)²/3 = 1.33 → NOT significant at 3 pairs.
    expect(a2?.mcnemar?.b_count).toBe(3);
    expect(a2?.mcnemar?.c_count).toBe(0);
    expect(a2?.mcnemar?.pairs).toBe(3);
  });

  it('F1: a 2-of-3 lane renders pass^1=0.67 AND pass^k=0 — the mean can NEVER masquerade as reliability', () => {
    const recs: RunRecord[] = [
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'fail', 'process', true)] }),
      // A second model so the comparison is valid (≥2 groups sharing one seed set).
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'pass', 'process', true)] }),
    ];
    const res = compareModels('md-to-pdf', recs, ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rel = res.data.lanes.find((l) => l.assertion_id === 'A2')?.by_model['sonnet-5'];
    expect(rel?.pass_1).toBeCloseTo(2 / 3, 5);
    // NON-VACUITY: one failure in K forces pass^k to 0 — NOT the mean (0.67) nor the estimator.
    expect(rel?.pass_k).toBe(0);
    expect(rel?.pass_k).not.toBe(rel?.pass_1);
    expect(rel?.pass_k_est).toBeCloseTo((2 / 3) ** 3, 5); // the est curve, carried separately + labeled
    expect(res.board).toMatch(/pass\^1/);
    expect(res.board).toMatch(/pass\^k/);
  });

  it('F2: McNemar is OMITTED (never index-paired) when the two groups do not align 1:1 on trial key', () => {
    // sonnet has 3 runs of the trial; gpt has only 2 → counts differ → no 1:1 pairing.
    const recs: RunRecord[] = [
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'pass', 'process', true)] }),
      mkRecord({ model: 'sonnet-5', lanes: [lane('A2', 'fail', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'fail', 'process', true)] }),
      mkRecord({ model: 'gpt-5.5', lanes: [lane('A2', 'fail', 'process', true)] }),
    ];
    const res = compareModels('md-to-pdf', recs, ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a2 = res.data.lanes.find((l) => l.assertion_id === 'A2');
    // NON-VACUITY: index-pairing would have returned a McNemar over min(3,2)=2 pairs.
    expect(a2?.mcnemar).toBeNull();
    expect(a2?.mcnemar_omitted).toMatch(/align 1:1/);
    // pass^1 / pass^k are still computed per model (only the paired test is omitted).
    expect(a2?.by_model['sonnet-5'].k).toBe(3);
    expect(a2?.by_model['gpt-5.5'].k).toBe(2);
  });

  it('cost: averages ONLY over runs WITH a summary; a null-summary run is counted + excluded (never zero-filled)', () => {
    const recs: RunRecord[] = [
      mkRecord({ model: 'sonnet-5', telemetry_summary: SUMMARY }),
      mkRecord({ model: 'sonnet-5', telemetry_summary: null }), // counted, excluded from the avg
      mkRecord({ model: 'gpt-5.5', telemetry_summary: null }), // no summary at all
      mkRecord({ model: 'gpt-5.5', telemetry_summary: null }),
    ];
    const res = compareModels('md-to-pdf', recs, ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sonnet = res.data.cost.find((c) => c.model === 'sonnet-5');
    // NON-VACUITY: avg is 1000 (the ONE real summary), NOT 500 (a zero-filled 2nd run).
    expect(sonnet?.avg_active_time_s).toBe(1000);
    expect(sonnet?.with_summary).toBe(1);
    expect(sonnet?.runs).toBe(2);
    const gpt = res.data.cost.find((c) => c.model === 'gpt-5.5');
    // No summary anywhere → honest null, not 0.
    expect(gpt?.avg_active_time_s).toBeNull();
    expect(gpt?.avg_tokens).toBeNull();
    expect(gpt?.with_summary).toBe(0);
  });

  it('per-axis Wilson: separated CIs flag ✱ when one model dominates', () => {
    // sonnet: 10 capability passes; gpt: 10 capability fails → CIs separated.
    const recs: RunRecord[] = [];
    for (let i = 0; i < 10; i++) recs.push(mkRecord({ model: 'sonnet-5', lanes: [lane('A8', 'pass', 'capability', true)] }));
    for (let i = 0; i < 10; i++) recs.push(mkRecord({ model: 'gpt-5.5', lanes: [lane('A8', 'fail', 'capability', true)] }));
    const res = compareModels('md-to-pdf', recs, ['sonnet-5', 'gpt-5.5']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const cap = res.data.axes.find((a) => a.axis === 'capability');
    expect(cap?.by_model['sonnet-5'].wilson?.p).toBe(1);
    expect(cap?.by_model['gpt-5.5'].wilson?.p).toBe(0);
    expect(cap?.separated).toBe(true);
  });
});
