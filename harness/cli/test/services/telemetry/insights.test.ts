import { describe, expect, it } from 'vitest';
import {
  buildInsights,
  type InsightInput,
  type InsightSection,
  makeRow,
  N_THRESHOLD,
} from '../../../src/services/telemetry/insights.js';
import {
  FLOW_STAGE_MAP_VERSION,
  type FlowStageMechanism,
  type Rollup,
  type RollupEntry,
  TELEMETRY_REPORT_SCHEMA_VERSION,
  type TelemetryReport,
  type TimelineMarker,
} from '../../../src/services/telemetry/report.js';

/**
 * Plan 048 Phase 2 — the insights layer (2.1 epistemics, 2.2 seven sections,
 * 2.3 discipline panel). Inputs are hand-built `TelemetryReport`s — the layer's
 * ACTUAL input contract (a saved report.json) — so each generator's n/threshold
 * behaviour is asserted with precise control; the report↔timeline pipeline itself
 * is proven end-to-end in report-control-timeline.test.ts + the act test.
 */

function entry(
  key: string,
  count: number,
  o: { input?: number; output?: number; time_s?: number; semantic?: string } = {},
): RollupEntry {
  const e: RollupEntry = { key, count, tokens: { input: o.input ?? 0, output: o.output ?? 0 } };
  if (o.time_s !== undefined) e.time_s = o.time_s;
  if (o.semantic !== undefined) e.semantic_stage = o.semantic;
  return e;
}

function rollup(dimension: Rollup['dimension'], entries: RollupEntry[]): Rollup {
  const tokens = {
    input: entries.reduce((a, e) => a + e.tokens.input, 0),
    output: entries.reduce((a, e) => a + e.tokens.output, 0),
  };
  return { dimension, entries, total: { count: entries.reduce((a, e) => a + e.count, 0), tokens } };
}

interface MkOpts {
  single?: boolean;
  sessionId?: string;
  branches?: string[];
  active_s?: number;
  sent?: number;
  received?: number;
  from?: string;
  to?: string;
  flow?: RollupEntry[];
  skill?: RollupEntry[];
  bash?: RollupEntry[];
  timeline?: TimelineMarker[];
  measured?: number;
  unmeasured?: number;
  mechanism?: FlowStageMechanism;
}

function mkReport(o: MkOpts = {}): TelemetryReport {
  const single = o.single ?? true;
  const branches = o.branches ?? ['main'];
  const report: TelemetryReport = {
    schema_version: TELEMETRY_REPORT_SCHEMA_VERSION,
    scope: { session_count: single ? 1 : 2, single, session_ids: [o.sessionId ?? 'sess1'] },
    filter: {},
    totals: {
      time_s: o.active_s ?? 0,
      tokens: { input: o.sent ?? 0, output: o.received ?? 0 },
      cache: { read: 0, create: 0 },
      sessions: single ? 1 : 2,
    },
    rollups: {
      flow_stage: rollup('flow_stage', o.flow ?? []),
      skill: rollup('skill', o.skill ?? []),
      tool: rollup('tool', []),
      bash_command: rollup('bash_command', o.bash ?? []),
      harness_command: rollup('harness_command', []),
    },
    attribution: { tokens: '', time: '', exact: ['count'], bash_command_key: '', notes: [] },
    provenance: {
      date_range: { from: o.from ?? '', to: o.to ?? '' },
      repos: [],
      branches,
      harnesses: [],
      models: [],
      session_count: single ? 1 : 2,
      source_paths: [],
      generated_at: '',
      flow_stage_map_version: FLOW_STAGE_MAP_VERSION,
      flow_stage_mechanism: o.mechanism ?? { flow: 0, digit: 0, unlabeled: 0 },
      token_coverage: { measured: o.measured ?? (single ? 1 : 2), unmeasured: o.unmeasured ?? 0 },
    },
  };
  if (o.timeline !== undefined && single) report.control_timeline = o.timeline;
  return report;
}

const input = (report: TelemetryReport, name = 'r'): InsightInput => ({ name, report });
const mk = (kind: TimelineMarker['kind'], key: string, t: string): TimelineMarker => ({
  kind,
  key,
  t,
});
const sectionById = (doc: ReturnType<typeof buildInsights>, id: string): InsightSection =>
  doc.sections.find((s) => s.id === id) as InsightSection;

// ── 2.1 structural epistemics ───────────────────────────────────────────────

describe('2.1 insight row — structural epistemics enforcement', () => {
  it('makeRow REFUSES a row with an empty caveat (mutation: strip the caveat check → RED)', () => {
    expect(() =>
      makeRow({ claim: 'x', measures_used: ['m'], n: 10, caveat: '', values: {} }),
    ).toThrow(/caveat/);
    // whitespace-only is also a refusal
    expect(() =>
      makeRow({ claim: 'x', measures_used: ['m'], n: 10, caveat: '   ', values: {} }),
    ).toThrow(/caveat/);
  });

  it('makeRow REFUSES a row with a non-finite n (mutation: strip the n check → RED)', () => {
    expect(() =>
      makeRow({
        claim: 'x',
        measures_used: ['m'],
        n: Number.NaN,
        caveat: 'c',
        values: {},
      }),
    ).toThrow(/missing n/);
    expect(() =>
      makeRow({
        claim: 'x',
        measures_used: ['m'],
        n: undefined as unknown as number,
        caveat: 'c',
        values: {},
      }),
    ).toThrow(/missing n/);
  });

  it('a well-formed row is built and carries its optional interval', () => {
    const row = makeRow({
      claim: 'ok',
      measures_used: ['m'],
      n: 7,
      interval: '±2',
      caveat: 'c',
      values: { a: 1 },
    });
    expect(row).toMatchObject({ n: 7, caveat: 'c', interval: '±2', values: { a: 1 } });
  });

  it('n-threshold: a below-threshold cohort row FOLDS into a visible "other" row (mutation: skip threshold → RED)', () => {
    // bash: rg(count 10) stands; `git status`(count 3 < 5) must NOT render standalone.
    const report = mkReport({
      bash: [entry('rg', 10, { input: 100 }), entry('git status', 3, { input: 30 })],
    });
    const bash = sectionById(buildInsights([input(report)]), 'bash_commands');
    const keys = bash.rows.map((r) => r.values.command);
    expect(keys).toContain('rg');
    expect(keys).not.toContain('git status'); // folded, not silently dropped
    expect(bash.rows.some((r) => String(r.claim).startsWith('other ('))).toBe(true);
    expect(bash.suppressed).toEqual({ rows: 1, reason: `n<${N_THRESHOLD}` });
  });

  it('every rendered row across every section carries n and a non-empty caveat', () => {
    const report = mkReport({
      flow: [entry('research', 6, { time_s: 60, input: 10, output: 5, semantic: 'research' })],
      skill: [entry('the-flow', 6, { time_s: 30 })],
      bash: [entry('rg', 6, { input: 12 })],
      timeline: [mk('subagent', 'Explore', '2026-06-29T00:00:01Z')],
      from: '2026-06-29T00:00:00Z',
      to: '2026-06-29T02:00:00Z',
      active_s: 3600,
    });
    const doc = buildInsights([input(report)]);
    const all = [...doc.sections.flatMap((s) => s.rows), ...doc.discipline.rows];
    for (const row of all) {
      expect(typeof row.n).toBe('number');
      expect(Number.isFinite(row.n)).toBe(true);
      expect(row.caveat.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── 2.2 sections ────────────────────────────────────────────────────────────

describe('2.2 §1 stage economics', () => {
  it('aggregates flow_stage by semantic stage with sent/received', () => {
    const report = mkReport({
      flow: [
        entry('research', 6, { time_s: 120, input: 100, output: 40, semantic: 'research' }),
        entry('phase-1', 8, { time_s: 300, input: 500, output: 900, semantic: 'implement' }),
      ],
    });
    const s = sectionById(buildInsights([input(report)]), 'stage_economics');
    const research = s.rows.find((r) => r.values.stage === 'research');
    expect(research?.values).toMatchObject({ windows: 6, active_s: 120, sent: 100, received: 40 });
    const implement = s.rows.find((r) => r.values.stage === 'implement');
    expect(implement?.values).toMatchObject({ sent: 500, received: 900 });
  });

  it('explore→ship elapsed carries BOTH active and wall clocks for a spanning work unit', () => {
    const report = mkReport({
      active_s: 3600,
      from: '2026-06-29T00:00:00Z',
      to: '2026-06-29T05:00:00Z', // 5h wall
      flow: [
        entry('research', 6, { time_s: 60, semantic: 'research' }),
        entry('ship', 6, { time_s: 60, semantic: 'ship' }),
      ],
    });
    const s = sectionById(buildInsights([input(report)]), 'stage_economics');
    const span = s.rows.find((r) => String(r.claim).startsWith('explore→ship'));
    expect(span?.values).toMatchObject({ work_units: 1, active_s: 3600, wall_s: 18000 });
  });
});

describe('2.2 §2 skill breakdown', () => {
  it('includes the-flow and carries the non-additive footnote (D4)', () => {
    const report = mkReport({
      skill: [entry('the-flow', 9, { time_s: 100, input: 50, output: 20 })],
    });
    const s = sectionById(buildInsights([input(report)]), 'skill_breakdown');
    expect(s.rows.some((r) => r.values.skill === 'the-flow')).toBe(true);
    expect(s.note).toMatch(/not additive/i);
  });
});

describe('2.2 §3 bash commands', () => {
  it('offers two orderings — by count and by sent', () => {
    const report = mkReport({
      bash: [
        entry('rg', 20, { input: 10 }), // most calls, least sent
        entry('git commit', 6, { input: 900 }), // fewest calls, most sent
      ],
    });
    const s = sectionById(buildInsights([input(report)]), 'bash_commands');
    expect(s.orderings?.by_count[0]).toBe('rg');
    expect(s.orderings?.by_sent[0]).toBe('git commit');
  });
});

describe('2.2 §4 subagents — counts real, tokens honestly unmeasured', () => {
  it('renders counts with tokens as null (never a fabricated zero)', () => {
    const report = mkReport({
      timeline: [
        ...Array.from({ length: 6 }, (_, i) =>
          mk('subagent', 'Explore', `2026-06-29T00:00:0${i}Z`),
        ),
      ],
    });
    const s = sectionById(buildInsights([input(report)]), 'subagents');
    const row = s.rows.find((r) => r.values.subagent === 'Explore');
    expect(row?.values.count).toBe(6);
    expect(row?.values.sent).toBeNull();
    expect(row?.values.received).toBeNull();
    expect(row?.values.sent).not.toBe(0);
  });

  it('is UNAVAILABLE (not zero) when no single-session report carries a timeline', () => {
    const s = sectionById(buildInsights([input(mkReport({ single: false }))]), 'subagents');
    expect(s.available).toBe(false);
    expect(s.note).toMatch(/timeline/);
  });
});

describe('2.2 §5/§6/§7 grain-robustness', () => {
  it('per-session sections DEGRADE to available:false on aggregate-only input', () => {
    const doc = buildInsights([input(mkReport({ single: false }))]);
    for (const id of ['active_wall_ratio', 'outlier_sessions', 'per_work_unit']) {
      const s = sectionById(doc, id);
      expect(s.available).toBe(false);
      expect(s.note).toMatch(/single-session|per-session|branch-keyed/i);
    }
    expect(doc.discipline.available).toBe(false);
    // Aggregate-friendly sections still compute.
    expect(sectionById(doc, 'stage_economics').available).toBe(true);
  });

  it('§6 outliers rank top sessions by sent and by active', () => {
    const big = mkReport({ sessionId: 'big', active_s: 10, sent: 9000, from: 'a', to: 'b' });
    const slow = mkReport({ sessionId: 'slow', active_s: 9000, sent: 10, from: 'a', to: 'b' });
    const s = sectionById(buildInsights([input(big), input(slow)]), 'outlier_sessions');
    expect(s.available).toBe(true);
    expect(s.orderings?.by_sent[0]).toBe('big');
    expect(s.orderings?.by_active[0]).toBe('slow');
  });

  it('§7 per-work-unit is branch-keyed and surfaces a visible `unassigned` row', () => {
    const onBranch = mkReport({ sessionId: 's1', branches: ['feat/x'] });
    const hopper = mkReport({ sessionId: 's2', branches: ['a', 'b'] }); // >1 → unassigned
    const s = sectionById(buildInsights([input(onBranch), input(hopper)]), 'per_work_unit');
    const keys = s.rows.map((r) => r.values.work_unit);
    expect(keys).toContain('feat/x');
    expect(keys).toContain('unassigned');
    expect(s.note).toMatch(/branches\[0\]/);
  });
});

// ── 2.3 discipline panel ────────────────────────────────────────────────────

describe('2.3 discipline panel — sequence joins', () => {
  it('checks-before-push counts ONLY a checks that PRECEDES the push (mutation: count checks-after → RED)', () => {
    // Asymmetric on purpose so flipping `checks.t < push.t` to `>` changes the count:
    //  A = checks BEFORE push (compliant, no checks-after) → correct 1, mutated 0.
    //  B = push with a LATER checks (checks-AFTER → must NOT count) → correct 0, mutated 1.
    const beforeOnly = mkReport({
      sessionId: 'A',
      branches: ['feat/a'],
      timeline: [
        mk('checks', 'ok', '2026-06-29T00:00:01Z'),
        mk('bash', 'git push', '2026-06-29T00:00:02Z'),
      ],
    });
    const afterOnly = mkReport({
      sessionId: 'B',
      branches: ['feat/b'],
      timeline: [
        mk('bash', 'git push', '2026-06-29T00:00:01Z'),
        mk('harness', 'checks', '2026-06-29T00:00:02Z'),
      ],
    });

    // Compliant-only cohort: rate 1.0 correct, 0.0 under the order mutation.
    const only = buildInsights([input(beforeOnly)]).discipline.rows.find((r) =>
      String(r.claim).startsWith('checks-before-push'),
    );
    expect(only?.values).toMatchObject({ pushes: 1, with_prior_checks: 1, rate: 1 });

    // checks-AFTER-push must NOT count: rate 0.0 correct, 1.0 under the order mutation.
    const after = buildInsights([input(afterOnly)]).discipline.rows.find((r) =>
      String(r.claim).startsWith('checks-before-push'),
    );
    expect(after?.values).toMatchObject({ pushes: 1, with_prior_checks: 0, rate: 0 });
  });

  it('observe→drain conversion joins observe → a later record', () => {
    const conv = mkReport({
      sessionId: 'C',
      branches: ['feat/c'],
      timeline: [
        mk('harness', 'observe', '2026-06-29T00:00:01Z'),
        mk('harness', 'record', '2026-06-29T00:00:05Z'),
      ],
    });
    const unconv = mkReport({
      sessionId: 'D',
      branches: ['feat/d'],
      timeline: [mk('harness', 'observe', '2026-06-29T00:00:01Z')],
    });
    const doc = buildInsights([input(conv), input(unconv)]);
    const row = doc.discipline.rows.find((r) => String(r.claim).startsWith('observe→drain'));
    expect(row?.values).toMatchObject({ observes: 2, drained: 1, rate: 0.5 });
  });

  it('discipline is UNAVAILABLE when no timeline is present', () => {
    const doc = buildInsights([input(mkReport({ timeline: undefined }))]);
    expect(doc.discipline.available).toBe(false);
  });
});

// ── D-A active>wall honesty (dogfood 2026-06 defect) ────────────────────────

describe('§5 active-vs-wall — D-A active>wall honesty', () => {
  it('a session whose active exceeds its calendar span is EXCLUDED from the cohort + carries a data-quality caveat (mutation: exclusion-dropped, impossible row folded into cohort → RED)', () => {
    // Valid: 10s active over a 100s calendar span (ratio 0.1).
    const good = mkReport({
      sessionId: 'good',
      branches: ['feat/good'],
      active_s: 10,
      from: '2026-06-24T00:00:00.000Z',
      to: '2026-06-24T00:01:40.000Z', // 100s wall
    });
    // The real dogfood defect: 222s active over a ~14s span (ratio ~15.9) — impossible.
    const bad = mkReport({
      sessionId: 'bad',
      branches: ['feat/bad'],
      active_s: 222,
      from: '2026-06-24T21:45:16.387Z',
      to: '2026-06-24T21:45:30.322Z', // ~13.9s wall
    });

    const doc = buildInsights([input(good), input(bad)]);
    const s = sectionById(doc, 'active_wall_ratio');

    // The cohort row sums ONLY the valid session — the impossible one is excluded, declared.
    const cohort = s.rows.find((r) => r.values.scope === 'cohort');
    expect(cohort?.values).toMatchObject({ active_s: 10, wall_s: 100, excluded: 1 });
    expect(cohort?.n).toBe(1);
    expect(cohort?.caveat).toMatch(/exclud/i);

    // The impossible per-session row still renders honestly, flagged as a data-quality artifact.
    const badRow = s.rows.find((r) => r.values.session === 'bad');
    expect(badRow?.values.data_quality).toBe('active-exceeds-wall');
    expect(badRow?.caveat).toMatch(/exceeds (the )?calendar span|timestamp-precision/i);

    // The valid per-session row is untouched (no data-quality flag).
    const goodRow = s.rows.find((r) => r.values.session === 'good');
    expect(goodRow?.values.data_quality).toBeUndefined();
  });

  it('with NO impossible session the cohort excludes nothing (excluded: 0)', () => {
    const a = mkReport({
      sessionId: 'a',
      active_s: 30,
      from: '2026-06-24T00:00:00.000Z',
      to: '2026-06-24T00:02:00.000Z', // 120s wall
    });
    const doc = buildInsights([input(a)]);
    const cohort = sectionById(doc, 'active_wall_ratio').rows.find(
      (r) => r.values.scope === 'cohort',
    );
    expect(cohort?.values).toMatchObject({ active_s: 30, wall_s: 120, excluded: 0 });
    expect(cohort?.n).toBe(1);
  });
});

// ── D-B era/mechanism coverage (dogfood 2026-06 defect) ─────────────────────

describe('§1/§2.3 — D-B era/mechanism coverage declaration', () => {
  it('declares push-signature + stage-label coverage and marks checks-before-push UNMEASURABLE (not a plain 0/0) when bash calls exist but no signature markers (mutation: coverage-declaration-dropped → RED)', () => {
    // Pre-FX001-era session: bash CALLS present, but the timeline carries NO bash-signature
    // markers (only an `observe` so the panel is available); stages unlabeled (mechanism all 0).
    const preEra = mkReport({
      sessionId: 'pre',
      branches: ['feat/pre'],
      bash: [entry('git', 3)],
      timeline: [mk('harness', 'observe', '2026-06-01T00:00:01Z')],
      mechanism: { flow: 0, digit: 0, unlabeled: 4 },
    });
    const doc = buildInsights([input(preEra)]);

    // Coverage is surfaced in section provenance for BOTH the discipline panel and stage economics.
    expect(doc.discipline.coverage).toMatchObject({ sessions: 1, push_signatures_unavailable: 1 });
    const stage = sectionById(doc, 'stage_economics');
    expect(stage.coverage).toMatchObject({ sessions: 1, stage_labels_unavailable: 1 });

    // checks-before-push distinguishes UNMEASURABLE from a true zero.
    const cbp = doc.discipline.rows.find((r) => String(r.claim).startsWith('checks-before-push'));
    expect(cbp?.values).toMatchObject({ pushes: 0 });
    expect(cbp?.caveat).toMatch(/unmeasurable/i);
    expect(cbp?.caveat).toMatch(/1\/1/);

    // CONTRAST: a session WITH a real bash-signature marker is measurable — no "unmeasurable" caveat.
    const post = mkReport({
      sessionId: 'post',
      branches: ['feat/post'],
      bash: [entry('git', 1)],
      timeline: [
        mk('checks', 'ok', '2026-07-01T00:00:01Z'),
        mk('bash', 'git push', '2026-07-01T00:00:02Z'),
      ],
      mechanism: { flow: 3, digit: 0, unlabeled: 0 },
    });
    const doc2 = buildInsights([input(post)]);
    expect(doc2.discipline.coverage).toMatchObject({ push_signatures_unavailable: 0 });
    expect(sectionById(doc2, 'stage_economics').coverage).toMatchObject({
      stage_labels_unavailable: 0,
    });
    const cbp2 = doc2.discipline.rows.find((r) => String(r.claim).startsWith('checks-before-push'));
    expect(cbp2?.values).toMatchObject({ pushes: 1, with_prior_checks: 1 });
    expect(cbp2?.caveat).not.toMatch(/unmeasurable/i);
  });
});

// ── provenance (2.4 seeds) ──────────────────────────────────────────────────

describe('provenance', () => {
  it('records input reports, single/aggregate split, n-threshold, keying rule and declared caveats', () => {
    const doc = buildInsights(
      [input(mkReport({ single: true }), 'single'), input(mkReport({ single: false }), 'agg')],
      {
        skipped: [{ path: 'bad.json', reason: 'ENOENT' }],
        generatedAt: '2026-07-02T00:00:00Z',
      },
    );
    expect(doc.provenance.single_session_reports).toBe(1);
    expect(doc.provenance.aggregate_reports).toBe(1);
    expect(doc.provenance.n_threshold).toBe(N_THRESHOLD);
    expect(doc.provenance.keying_rule).toMatch(/branch/);
    expect(doc.provenance.skipped_inputs).toEqual([{ path: 'bad.json', reason: 'ENOENT' }]);
    expect(doc.provenance.caveats.join(' ')).toMatch(/tail-capture/i);
    expect(doc.provenance.flow_stage_map_versions).toContain(FLOW_STAGE_MAP_VERSION);
    expect(doc.provenance.generated_at).toBe('2026-07-02T00:00:00Z');
  });
});
