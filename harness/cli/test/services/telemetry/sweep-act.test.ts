import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import type { ShardBlob } from '../../../src/adapters/git/git-read-port.js';
import { telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../../src/output/output-port.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import type { TelemetryReport } from '../../../src/services/telemetry/report.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * 048 Phase 1 · T1.6 (AC-01/AC-04) — `telemetry sweep --month` act wiring, from
 * committed refs alone. Fixtures are REAL committed-shard shapes (the OTLP pair a
 * `sync` publishes), built via the SAME `segmentToOtlpLogs`/`rollupToOtlpMetrics`
 * the capture path uses — one v2.2-style shard (token-bearing turns) and one
 * v2.0-style thin shard (a turn with NO usage attrs, dossier F-08).
 *
 * Named mutations: `v2.0-shard-fabricates-tokens` (the thin shard is counted as
 * measured / contributes phantom tokens) ⇒ RED; `re-sweep-re-exports-unchanged-ref`
 * (a second sweep re-exports instead of reusing the cache) ⇒ RED.
 */

const V22_SID = '11111111-1111-4111-8111-111111111111';
const V20_SID = '22222222-2222-4222-8222-222222222222';
const DATE = '2026/07/01';

function seg(sessionId: string, events: Event[], over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: sessionId,
      timecode: '2026-07-01T09:05:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

/** A committed shard = the OTLP logs+metrics pair (NO `<seq>.json`), like a real sync. */
function committedShard(sessionId: string, events: Event[]): ShardBlob[] {
  const s = seg(sessionId, events);
  return [
    { name: '0.logs.jsonl', content: `${JSON.stringify(segmentToOtlpLogs(s))}\n` },
    { name: '0.metrics.jsonl', content: `${JSON.stringify(rollupToOtlpMetrics(s))}\n` },
  ];
}

/** Like {@link committedShard} but at an explicit `<seq>` — lets one session own
 *  distinct-seq shards across two months (so a cross-month leak is VISIBLE, not
 *  masked by a `0.logs.jsonl` name collision). */
function committedShardSeq(sessionId: string, events: Event[], seq: number): ShardBlob[] {
  const s = seg(sessionId, events);
  return [
    { name: `${seq}.logs.jsonl`, content: `${JSON.stringify(segmentToOtlpLogs(s))}\n` },
    { name: `${seq}.metrics.jsonl`, content: `${JSON.stringify(rollupToOtlpMetrics(s))}\n` },
  ];
}

const T = (n: number): string => `2026-07-01T09:${String(n).padStart(2, '0')}:00Z`;

// v2.2-style: turns carrying real usage (gen_ai.usage.* survive the round-trip).
const V22_EVENTS: Event[] = [
  { t: T(0), kind: 'prompt', words: 5 } as Event,
  { t: T(1), kind: 'turn', dur_s: 40, in: 1200, out: 800, cache_read: 5000 } as Event,
  { t: T(2), kind: 'turn', dur_s: 30, in: 600, out: 400 } as Event,
];
// v2.0-style thin: a turn with ONLY dur_s — no usage attrs (the real token gap).
const V20_EVENTS: Event[] = [{ t: T(0), kind: 'turn', dur_s: 0 } as Event];
// A DIFFERENT month's shard for the SAME session — its tokens must never leak into
// a July sweep (distinctive 9000/7000 so any leak is unmistakable in totals).
const JUNE_EVENTS: Event[] = [
  { t: '2026-06-15T09:00:00Z', kind: 'turn', dur_s: 20, in: 9000, out: 7000 } as Event,
];

function ioFor(mode: OutputMode): { io: CliIo; out: () => string; err: () => string } {
  let o = '';
  let e = '';
  const writers: Writers = { out: (t) => (o += t), err: (t) => (e += t) };
  return { io: { mode, writers }, out: () => o, err: () => e };
}

function runSweep(args: string[], io: CliIo, fs: FakeFs, gitRead: FakeGitRead): number {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerTelemetryAct(program, io, {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-08-01T00:00:00.000Z'),
    env: new FakeEnv(),
    gitWrite: new FakeGitWrite(),
    gitRead,
  });
  expect(() => program.parse(['node', 'harness', 'telemetry', 'sweep', ...args])).toThrow(/^exit:/);
  return code;
}

const bothSessions = (): FakeGitRead =>
  new FakeGitRead({
    [telemetryRefFor(DATE, V22_SID)]: committedShard(V22_SID, V22_EVENTS),
    [telemetryRefFor(DATE, V20_SID)]: committedShard(V20_SID, V20_EVENTS),
    // A different-month ref that must NOT be swept:
    [telemetryRefFor('2026/06/24', '33333333-3333-4333-8333-333333333333')]: committedShard(
      '33333333-3333-4333-8333-333333333333',
      V22_EVENTS,
    ),
  });

const readReport = (fs: FakeFs, path: string): TelemetryReport =>
  JSON.parse(fs.readText(path) as string) as TelemetryReport;

describe('telemetry sweep --month — act wiring (T1.6)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sweeps a month from refs alone → report + HTML, only in-month sessions', () => {
    const { io } = ioFor('json');
    const fs = new FakeFs();
    const code = runSweep(['--month', '2026-07', '--out', '/out'], io, fs, bothSessions());
    expect(code).toBe(0);
    const report = readReport(fs, '/out/2026-07.report.json');
    expect(report.scope.session_count).toBe(2); // the June ref is excluded
    expect(report.scope.session_ids.sort()).toEqual([V22_SID, V20_SID].sort());
    expect(fs.readText('/out/index.html')).toContain('<!doctype html>');
    // Per-session exports were written for reuse.
    expect(fs.readText(`/out/sessions/${V22_SID}.session.json`)).not.toBeNull();
  });

  it('AC-04: a v2.0 thin shard is DECLARED as a token gap, never fabricated', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    runSweep(['--month', '2026-07', '--out', '/out'], io, fs, bothSessions());
    const envelope = JSON.parse(out());
    expect(envelope.status).toBe('degraded');
    expect(envelope.next_action).toContain('partial/unavailable');
    const report = readReport(fs, '/out/2026-07.report.json');
    // MUTATION v2.0-shard-fabricates-tokens: counting the thin shard as measured ⇒ RED.
    expect(report.provenance.token_coverage).toEqual({
      measured: 1,
      partial: 0,
      unavailable: 1,
      unmeasured: 1,
      reasons: { no_observation: 1 },
      causes: { unknown: 2 },
    });
    // Sweeping ONLY the thin session proves no fabricated tokens (measured 0, totals 0).
    const only20 = new FakeGitRead({
      [telemetryRefFor(DATE, V20_SID)]: committedShard(V20_SID, V20_EVENTS),
    });
    const fs2 = new FakeFs();
    runSweep(['--month', '2026-07', '--out', '/out2', '--no-html'], ioFor('json').io, fs2, only20);
    const r2 = readReport(fs2, '/out2/2026-07.report.json');
    expect(r2.provenance.token_coverage).toEqual({
      measured: 0,
      partial: 0,
      unavailable: 1,
      unmeasured: 1,
      reasons: { no_observation: 1 },
      causes: { unknown: 1 },
    });
    expect(r2.totals.tokens).toEqual({ input: 0, output: 0 });
  });

  it('re-sweep reuses unchanged sessions from the cache (no re-export)', () => {
    const gr = bothSessions();
    const fs = new FakeFs();
    // First sweep populates the export cache.
    const { io: io1, out: out1 } = ioFor('json');
    runSweep(['--month', '2026-07', '--out', '/out', '--no-html'], io1, fs, gr);
    expect(JSON.parse(out1()).data.exported).toBe(2);
    expect(JSON.parse(out1()).data.reused).toBe(0);
    // A cache file now exists.
    expect(fs.readText('/out/.sweep-cache.json')).not.toBeNull();
    // Second sweep, identical shards → MUTATION re-sweep-re-exports-unchanged-ref ⇒ RED.
    const { io: io2, out: out2 } = ioFor('json');
    runSweep(['--month', '2026-07', '--out', '/out', '--no-html'], io2, fs, gr);
    expect(JSON.parse(out2()).data.reused).toBe(2);
    expect(JSON.parse(out2()).data.exported).toBe(0);
    // The report is still produced on the cached path.
    expect(readReport(fs, '/out/2026-07.report.json').scope.session_count).toBe(2);
  });

  it('a malformed --month is an honest error (exit 1), never a silent empty sweep', () => {
    const { io } = ioFor('json');
    const code = runSweep(['--month', '2026-7', '--out', '/out'], io, new FakeFs(), bothSessions());
    expect(code).toBe(1);
  });

  it('an empty month sweeps to an empty (non-crashing) report', () => {
    const { io } = ioFor('json');
    const fs = new FakeFs();
    const code = runSweep(
      ['--month', '2026-05', '--out', '/out', '--no-html'],
      io,
      fs,
      bothSessions(),
    );
    expect(code).toBe(0);
    expect(readReport(fs, '/out/2026-05.report.json').scope.session_count).toBe(0);
  });

  it('F1/AC-01: a session with June+July refs folds ONLY July shards into a July sweep', () => {
    // The SAME session id owns a July ref (seq 1) AND a June ref (seq 0). A July
    // sweep must combine exactly the PLANNED July ref — never re-glob both months.
    const gr = new FakeGitRead({
      [telemetryRefFor(DATE, V22_SID)]: committedShardSeq(V22_SID, V22_EVENTS, 1),
      [telemetryRefFor('2026/06/15', V22_SID)]: committedShardSeq(V22_SID, JUNE_EVENTS, 0),
    });
    const fs = new FakeFs();
    const code = runSweep(
      ['--month', '2026-07', '--out', '/out', '--no-html'],
      ioFor('json').io,
      fs,
      gr,
    );
    expect(code).toBe(0);
    const report = readReport(fs, '/out/2026-07.report.json');
    // Only the July shard's tokens (1800/1200) — June's 9000/7000 MUST be absent.
    // MUTATION re-glob-instead-of-planned-refs: June leaks in ⇒ input 10800 ⇒ RED.
    expect(report.totals.tokens).toEqual({ input: 1800, output: 1200 });
    // The export read ONLY the in-month July ref, never the out-of-month June ref.
    expect(gr.readRefs).not.toContain(telemetryRefFor('2026/06/15', V22_SID));
    // The exported session folds a single (July) segment — not the two-month union.
    const exp = JSON.parse(fs.readText(`/out/sessions/${V22_SID}.session.json`) as string) as {
      source: { segment_count: number };
    };
    expect(exp.source.segment_count).toBe(1);
  });

  it('F1: the export cache is month-scoped — a later June sweep re-exports, never reuses July', () => {
    // Both months of the same session share one --out (so one .sweep-cache.json).
    const gr = new FakeGitRead({
      [telemetryRefFor(DATE, V22_SID)]: committedShardSeq(V22_SID, V22_EVENTS, 1),
      [telemetryRefFor('2026/06/15', V22_SID)]: committedShardSeq(V22_SID, JUNE_EVENTS, 0),
    });
    const fs = new FakeFs();
    const { io: ioJul, out: outJul } = ioFor('json');
    runSweep(['--month', '2026-07', '--out', '/out', '--no-html'], ioJul, fs, gr);
    expect(JSON.parse(outJul()).data.exported).toBe(1);
    // June sweep of the SAME session must NOT reuse July's artifact (different refs).
    const { io: ioJun, out: outJun } = ioFor('json');
    runSweep(['--month', '2026-06', '--out', '/out', '--no-html'], ioJun, fs, gr);
    expect(JSON.parse(outJun()).data.reused).toBe(0);
    expect(JSON.parse(outJun()).data.exported).toBe(1);
    // And the June report carries June's tokens (9000/7000), not July's.
    expect(readReport(fs, '/out/2026-06.report.json').totals.tokens).toEqual({
      input: 9000,
      output: 7000,
    });
  });
});
