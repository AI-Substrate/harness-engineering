import { describe, expect, it } from 'vitest';
import {
  buildRetroInsights,
  makeRow,
  N_THRESHOLD,
  suppressLowN,
} from '../../../src/services/retro/insights.js';
import type { RetroEntry, RetroRecord } from '../../../src/services/retro/record-reader.js';

const generatedAt = '2026-07-12T00:00:00.000Z';

function entry(
  id: string,
  kind: string,
  target: string,
  options: Partial<RetroEntry> = {},
): RetroEntry {
  return {
    id,
    kind,
    target,
    description: options.description ?? `${kind} observation ${id} needs deterministic proof`,
    status: options.status ?? 'open',
    first_seen_at: options.first_seen_at ?? '2026-06-20T00:00:00.000Z',
    ...options,
  };
}

function record(
  retroId: string,
  planId: string,
  agent: string,
  entries: RetroEntry[],
  startedAt = '2026-06-20T00:00:00.000Z',
): RetroRecord {
  return {
    schema_version: '1.2',
    retro_id: retroId,
    agent,
    plan_id: planId,
    started_at: startedAt,
    entries,
    source: 'canonical',
    record_path: `.harness/records/retro/${retroId}.md`,
  };
}

describe('retro insights structural epistemics', () => {
  it('makeRow refuses a missing n or empty caveat', () => {
    expect(() =>
      makeRow({ claim: 'bad', measures_used: [], n: Number.NaN, caveat: 'known', values: {} }),
    ).toThrow(/missing n/);
    expect(() =>
      makeRow({ claim: 'bad', measures_used: [], n: 1, caveat: ' ', values: {} }),
    ).toThrow(/caveat/);
  });

  it('folds low-n aggregate rows into a visible other row', () => {
    const result = suppressLowN(
      [
        makeRow({ claim: 'large', measures_used: ['x'], n: 6, caveat: 'c', values: { count: 6 } }),
        makeRow({ claim: 'small', measures_used: ['x'], n: 2, caveat: 'c', values: { count: 2 } }),
      ],
      N_THRESHOLD,
    );
    expect(result.rendered.map((row) => row.claim)).toEqual([
      'large',
      `other (1 row(s) each below n=${N_THRESHOLD})`,
    ]);
    expect(result.suppressed).toEqual({ rows: 1, reason: `n<${N_THRESHOLD}` });
  });
});

describe('buildRetroInsights', () => {
  it('clusters by (kind,target) and carries actionable member provenance', () => {
    const records = [
      record('r1', 'plan-a', 'alpha', [
        entry('DL-001', 'difficulty', 'tooling', { severity: 'degrading' }),
      ]),
      record('r2', 'plan-b', 'beta', [
        entry('DL-002', 'difficulty', 'tooling', { disposition: 'deferred' }),
      ]),
    ];
    const doc = buildRetroInsights(records, { generatedAt });
    const cluster = doc.sections.top_clusters.rows[0];
    expect(cluster).toMatchObject({
      kind: 'difficulty',
      target: 'tooling',
      n: 2,
      caveat: expect.any(String),
      members: [
        {
          record_path: '.harness/records/retro/r1.md',
          retro_id: 'r1',
          entry_id: 'DL-001',
          status: 'open',
        },
        {
          record_path: '.harness/records/retro/r2.md',
          retro_id: 'r2',
          entry_id: 'DL-002',
          status: 'open',
        },
      ],
    });
  });

  it('ranks recurrence → severity → proof leverage → oldest age', () => {
    const records = [
      record('r1', 'p', 'a', [
        entry('A-001', 'difficulty', 'recurring', { severity: 'annoying' }),
        entry('B-001', 'difficulty', 'blocking', { severity: 'blocking' }),
        entry('C-001', 'difficulty', 'schema', { severity: 'annoying' }),
        entry('D-001', 'difficulty', 'older', {
          severity: 'annoying',
          first_seen_at: '2026-05-01T00:00:00.000Z',
        }),
      ]),
      record('r2', 'p', 'b', [
        entry('A-002', 'difficulty', 'recurring', { severity: 'annoying' }),
        entry('B-002', 'difficulty', 'blocking'),
        entry('C-002', 'difficulty', 'schema', { severity: 'annoying' }),
        entry('D-002', 'difficulty', 'older', {
          severity: 'annoying',
          first_seen_at: '2026-05-02T00:00:00.000Z',
        }),
      ]),
      record('r3', 'p', 'c', [entry('A-003', 'difficulty', 'recurring')]),
    ];
    const targets = buildRetroInsights(records, { generatedAt }).sections.top_clusters.rows.map(
      (row) => row.target,
    );
    expect(targets.slice(0, 4)).toEqual(['recurring', 'blocking', 'schema', 'older']);
  });

  it('uses the frozen two-signal proof-gap doctrine', () => {
    const records = [
      record('r1', 'p', 'a', [
        entry('DL-001', 'difficulty', 'schema'),
        entry('MW-001', 'magic-wand', 'project', {
          description: 'Add a diagnostic command for this recurring failure.',
        }),
        entry('DL-002', 'difficulty', 'tooling', {
          description: 'A smoke check and readable log would prove the route.',
        }),
        entry('DL-003', 'difficulty', 'tooling', {
          description: 'The package install is slower than expected.',
        }),
      ]),
    ];
    const clusters = buildRetroInsights(records, { generatedAt }).sections.top_clusters.rows;
    const byId = (target: string, kind = 'difficulty') =>
      clusters.find((row) => row.target === target && row.kind === kind);
    expect(byId('schema')).toMatchObject({ proof_gap: true, proof_gap_signal: 'target' });
    expect(byId('project', 'magic-wand')).toMatchObject({
      proof_gap: true,
      proof_gap_signal: 'target',
    });
    const tooling = clusters.filter((row) => row.target === 'tooling');
    expect(tooling).toHaveLength(1);
    expect(tooling[0]).toMatchObject({ proof_gap: true, proof_gap_signal: 'keyword' });
  });

  it('ranks target proof gaps ahead of older keyword proof gaps', () => {
    const records = [
      record('r1', 'p', 'a', [
        entry('DL-001', 'difficulty', 'tooling', {
          description: 'A smoke check would prove this route.',
          severity: 'annoying',
          first_seen_at: '2026-05-01T00:00:00.000Z',
        }),
        entry('DL-002', 'difficulty', 'schema', {
          description: 'This route needs deterministic proof.',
          severity: 'annoying',
          first_seen_at: '2026-06-01T00:00:00.000Z',
        }),
      ]),
    ];
    const rows = buildRetroInsights(records, { generatedAt }).sections.top_clusters.rows;
    expect(rows.slice(0, 2).map((row) => row.proof_gap_signal)).toEqual(['target', 'keyword']);
  });

  it('flags repeatedly deferred clusters and stale open/suggested entries', () => {
    const records = [
      record('r1', 'p', 'a', [
        entry('DL-001', 'difficulty', 'tooling', {
          disposition: 'declined',
          first_seen_at: '2026-05-01T00:00:00.000Z',
        }),
        entry('DL-002', 'difficulty', 'schema', {
          status: 'suggested',
          first_seen_at: '2026-06-20T00:00:00.000Z',
        }),
      ]),
      record('r2', 'p', 'b', [
        entry('DL-003', 'difficulty', 'tooling', {
          disposition: 'deferred',
          first_seen_at: '2026-05-02T00:00:00.000Z',
        }),
        entry('DL-004', 'difficulty', 'security', {
          status: 'suggested',
          resolved_by: 'plan-123',
          first_seen_at: '2026-06-20T00:00:00.000Z',
        }),
      ]),
    ];
    const doc = buildRetroInsights(records, { generatedAt });
    expect(doc.sections.top_clusters.rows.find((row) => row.target === 'tooling')).toMatchObject({
      repeatedly_deferred: true,
    });
    expect(doc.sections.stale.rows.map((row) => row.values.entry_id)).toEqual([
      'DL-001',
      'DL-003',
      'DL-002',
    ]);
  });

  it('computes honest headline totals, dispositions, and the visible other kind bucket', () => {
    const records = [
      record('r1', 'plan-a', 'alpha', [
        entry('DL-001', 'difficulty', 'tooling', { disposition: 'kept' }),
        entry('WH-001', 'worker-harvest', 'minih', { status: 'encoded' }),
      ]),
      record('r2', 'plan-b', 'beta', [
        entry('SUGG-001', 'improvement-suggestion', 'plan', {
          status: 'suggested',
          disposition: 'task',
        }),
      ]),
    ];
    const doc = buildRetroInsights(records, { generatedAt });
    expect(doc.headline).toMatchObject({
      records: 2,
      entries: 3,
      plans_touched: ['plan-a', 'plan-b'],
      status_counts: { open: 1, suggested: 1, encoded: 1, wontfix: 0, stale: 0, other: 0 },
      kind_counts: { other: 1 },
      disposition_counts: { kept: 1, task: 1, unspecified: 1 },
      open_to_encoded_ratio: '1:1',
    });
    const rows = Object.values(doc.sections).flatMap((section) => section.rows);
    for (const row of rows) {
      expect(Number.isFinite(row.n)).toBe(true);
      expect(row.caveat.trim().length).toBeGreaterThan(0);
    }
  });

  it('is byte-deterministic apart from generated_at', () => {
    const records = [
      record('r2', 'plan-b', 'beta', [entry('DL-002', 'difficulty', 'schema')]),
      record('r1', 'plan-a', 'alpha', [entry('DL-001', 'difficulty', 'tooling')]),
    ];
    const first = buildRetroInsights(records, { generatedAt: '2026-07-12T00:00:00.000Z' });
    const second = buildRetroInsights([...records].reverse(), {
      generatedAt: '2026-07-13T00:00:00.000Z',
    });
    expect({ ...first, generated_at: '<ignored>' }).toEqual({
      ...second,
      generated_at: '<ignored>',
    });
  });
});
