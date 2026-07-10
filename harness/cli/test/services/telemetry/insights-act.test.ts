import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../../src/output/output-port.js';
import {
  FLOW_STAGE_MAP_VERSION,
  TELEMETRY_REPORT_SCHEMA_VERSION,
  type TelemetryReport,
  type TimelineMarker,
} from '../../../src/services/telemetry/report.js';

/**
 * Plan 048 Phase 2.4 — `harness telemetry insights <report.json…>` act wiring +
 * the error contract: 1 valid + 1 missing/corrupt input → the envelope ERRORS
 * NAMING the bad input, while the partial run still writes insights.json recording
 * the omission in `provenance.skipped_inputs` (never a silent drop).
 */

function reportJson(o: {
  sessionId: string;
  single?: boolean;
  bashCount?: number;
  timeline?: TimelineMarker[];
}): string {
  const single = o.single ?? true;
  const report: TelemetryReport = {
    schema_version: TELEMETRY_REPORT_SCHEMA_VERSION,
    scope: { session_count: single ? 1 : 2, single, session_ids: [o.sessionId] },
    filter: {},
    totals: {
      time_s: 100,
      tokens: { input: 200, output: 80 },
      cache: { read: 0, create: 0 },
      sessions: single ? 1 : 2,
    },
    rollups: {
      flow_stage: {
        dimension: 'flow_stage',
        entries: [],
        total: { count: 0, tokens: { input: 0, output: 0 } },
      },
      skill: {
        dimension: 'skill',
        entries: [],
        total: { count: 0, tokens: { input: 0, output: 0 } },
      },
      tool: {
        dimension: 'tool',
        entries: [],
        total: { count: 0, tokens: { input: 0, output: 0 } },
      },
      bash_command: {
        dimension: 'bash_command',
        entries: [{ key: 'rg', count: o.bashCount ?? 8, tokens: { input: 500, output: 0 } }],
        total: { count: o.bashCount ?? 8, tokens: { input: 500, output: 0 } },
      },
      harness_command: {
        dimension: 'harness_command',
        entries: [],
        total: { count: 0, tokens: { input: 0, output: 0 } },
      },
    },
    attribution: { tokens: '', time: '', exact: ['count'], bash_command_key: '', notes: [] },
    provenance: {
      date_range: { from: '2026-06-29T00:00:00Z', to: '2026-06-29T02:00:00Z' },
      repos: [],
      branches: ['main'],
      harnesses: [],
      models: [],
      session_count: single ? 1 : 2,
      source_paths: [],
      generated_at: '',
      flow_stage_map_version: FLOW_STAGE_MAP_VERSION,
      flow_stage_mechanism: { flow: 0, digit: 0, unlabeled: 0 },
      token_coverage: { measured: 1, unmeasured: 0 },
    },
  };
  if (o.timeline !== undefined && single) report.control_timeline = o.timeline;
  return `${JSON.stringify(report, null, 2)}\n`;
}

function ioFor(mode: OutputMode): { io: CliIo; out: () => string; err: () => string } {
  let o = '';
  let e = '';
  const writers: Writers = { out: (t) => (o += t), err: (t) => (e += t) };
  return { io: { mode, writers }, out: () => o, err: () => e };
}

function run(args: string[], io: CliIo, fs: FakeFs): number {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerTelemetryAct(program, io, {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-07-02T00:00:00.000Z'),
    env: new FakeEnv(),
    gitWrite: new FakeGitWrite(),
  });
  expect(() => program.parse(['node', 'harness', 'telemetry', 'insights', ...args])).toThrow(
    /^exit:/,
  );
  return code;
}

describe('registerTelemetryAct — telemetry insights', () => {
  afterEach(() => vi.restoreAllMocks());

  it('computes insights over N single-session reports → ok envelope (exit 0) + json + html', () => {
    const fs = new FakeFs({
      '/repo/in/a.report.json': reportJson({ sessionId: 'A', bashCount: 8 }),
      '/repo/in/b.report.json': reportJson({ sessionId: 'B', bashCount: 6 }),
    });
    const { io, out } = ioFor('json');
    const code = run(
      ['/repo/in/a.report.json', '/repo/in/b.report.json', '--out', '/repo/out'],
      io,
      fs,
    );
    const env = JSON.parse(out());
    expect(code).toBe(0);
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({ single_session_reports: 2, aggregate_reports: 0 });

    const doc = JSON.parse(fs.readText('/repo/out/insights.json') ?? 'null');
    expect(doc.schema_version).toBe('harness.telemetry-insights/v1');
    // 7 original sections + observe_conversion + disposition_mix (plan 056 T005).
    expect(doc.sections).toHaveLength(9);
    expect(doc.discipline).toBeDefined();
    expect(fs.readText('/repo/out/index.html')?.startsWith('<!doctype html>')).toBe(true);
    // next_action documents the Phase-3 pipeline (sweep → report → insights).
    expect(env.next_action).toMatch(/sweep/i);
    expect(env.next_action).toMatch(/report/i);
    expect(env.next_action).toMatch(/insights/i);
  });

  it('ERROR CONTRACT: 1 valid + 1 missing → errors NAMING the bad input, partial run records the omission', () => {
    const fs = new FakeFs({ '/repo/in/a.report.json': reportJson({ sessionId: 'A' }) });
    const { io, out } = ioFor('json');
    const code = run(
      ['/repo/in/a.report.json', '/repo/in/missing.report.json', '--out', '/repo/out'],
      io,
      fs,
    );
    const env = JSON.parse(out());

    // Envelope errors, naming the bad input.
    expect(code).toBe(1);
    expect(env.status).toBe('error');
    expect(env.error.message).toMatch(/missing\.report\.json/);

    // The partial run STILL wrote insights.json, recording the omission in provenance.
    const doc = JSON.parse(fs.readText('/repo/out/insights.json') ?? 'null');
    expect(doc.provenance.skipped_inputs).toEqual([
      { path: './in/missing.report.json', reason: 'not found or unreadable' },
    ]);
    // ...over the ONE valid report.
    expect(doc.provenance.single_session_reports).toBe(1);
  });

  it('ERROR CONTRACT: a corrupt JSON input is NAMED as skipped (invalid JSON)', () => {
    const fs = new FakeFs({
      '/repo/in/a.report.json': reportJson({ sessionId: 'A' }),
      '/repo/in/bad.report.json': '{ not valid json',
    });
    const { io, out } = ioFor('json');
    const code = run(
      ['/repo/in/a.report.json', '/repo/in/bad.report.json', '--out', '/repo/out'],
      io,
      fs,
    );
    const env = JSON.parse(out());
    expect(code).toBe(1);
    expect(env.error.message).toMatch(/bad\.report\.json.*invalid JSON/);
    const doc = JSON.parse(fs.readText('/repo/out/insights.json') ?? 'null');
    expect(doc.provenance.skipped_inputs[0]).toMatchObject({ reason: 'invalid JSON' });
  });

  it('loads DISTINCT reports that share a file stem (dedup by path, not name)', () => {
    // Both default to the stem `report` (the `report` verb's default) in different
    // folders — a name-keyed dedup would wrongly collapse them to one.
    const fs = new FakeFs({
      '/repo/r1/report.report.json': reportJson({ sessionId: 'A' }),
      '/repo/r2/report.report.json': reportJson({ sessionId: 'B' }),
    });
    const { io, out } = ioFor('json');
    const code = run(
      ['/repo/r1/report.report.json', '/repo/r2/report.report.json', '--out', '/repo/out'],
      io,
      fs,
    );
    expect(code).toBe(0);
    expect(JSON.parse(out()).data.single_session_reports).toBe(2);
    const doc = JSON.parse(fs.readText('/repo/out/insights.json') ?? 'null');
    expect(doc.provenance.input_reports.map((r: { name: string }) => r.name)).toEqual([
      'report',
      'report-2',
    ]);
  });

  it('no valid report at all → hard error (exit 1), nothing written', () => {
    const fs = new FakeFs({});
    const { io, out } = ioFor('json');
    const code = run(['/repo/in/missing.report.json', '--out', '/repo/out'], io, fs);
    const env = JSON.parse(out());
    expect(code).toBe(1);
    expect(env.status).toBe('error');
    expect(env.error.message).toMatch(/no valid TelemetryReport/);
    expect(fs.exists('/repo/out/insights.json')).toBe(false);
  });

  it('degrades honestly on aggregate-only input (per-session sections unavailable, still exit 0)', () => {
    const fs = new FakeFs({
      '/repo/in/agg.report.json': reportJson({ sessionId: 'X', single: false }),
    });
    const { io, out } = ioFor('json');
    const code = run(['/repo/in/agg.report.json', '--out', '/repo/out'], io, fs);
    expect(code).toBe(0);
    expect(JSON.parse(out()).data).toMatchObject({
      single_session_reports: 0,
      aggregate_reports: 1,
    });
    const doc = JSON.parse(fs.readText('/repo/out/insights.json') ?? 'null');
    const outliers = doc.sections.find((s: { id: string }) => s.id === 'outlier_sessions');
    expect(outliers.available).toBe(false);
    expect(doc.discipline.available).toBe(false);
  });
});
