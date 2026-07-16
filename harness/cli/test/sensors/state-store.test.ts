import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { executeSensor } from '../../src/services/sensors/runner.js';
import { SensorStateStore } from '../../src/services/sensors/state-store.js';
import type { SensorRunRecord } from '../../src/services/sensors/types.js';

const startedAt = '2026-07-15T02:11:04.512Z';

function record(overrides: Partial<SensorRunRecord> = {}): SensorRunRecord {
  return {
    sensor: 'lint-count',
    runId: 1,
    runStatus: 'ok',
    reading: { state: 'pass', score: 0, direction: 'lower' },
    error: null,
    startedAt,
    wallclockMs: 120,
    trigger: 'manual-run',
    stale: false,
    lastTriggerHash: null,
    ...overrides,
  };
}

describe('sensor runner separation (workshop 002 S2/S3/S10-S12)', () => {
  it('distinguishes a successful failing reading from a crashed sensor', async () => {
    const clock = new FakeClock(startedAt);
    const exec = new FakeExec({}, clock);
    const failing = await executeSensor(
      { name: 'lint', declaration: { summary: 'Lint', run: () => ({ state: 'fail' }) } },
      { cwd: '/repo', exec, clock },
      { runId: 1, trigger: 'manual-run', stale: false },
    );
    const crashed = await executeSensor(
      {
        name: 'crash',
        declaration: {
          summary: 'Crash',
          run: () => {
            throw new Error('tool configuration broke');
          },
        },
      },
      { cwd: '/repo', exec, clock },
      { runId: 1, trigger: 'manual-run', stale: false },
    );

    expect(failing).toMatchObject({ runStatus: 'ok', reading: { state: 'fail' }, error: null });
    expect(crashed).toMatchObject({
      runStatus: 'error',
      reading: null,
      error: { code: 'E211', message: 'tool configuration broke' },
    });
  });

  it('marks a handler that exceeds its total declaration budget as timed out', async () => {
    const clock = new FakeClock(startedAt);
    const result = await executeSensor(
      {
        name: 'slow',
        declaration: {
          summary: 'Slow calculation',
          timeoutMs: 50,
          run: () => {
            clock.advance(51);
            return { state: 'pass' };
          },
        },
      },
      { cwd: '/repo', exec: new FakeExec({}, clock), clock },
      { runId: 1, trigger: 'check', stale: false },
    );
    expect(result).toMatchObject({
      runStatus: 'timeout',
      reading: null,
      error: { code: 'E212' },
      wallclockMs: 51,
    });
  });

  it('keeps truthful time when quick async work is composed with a plain fake sleep', async () => {
    const clock = new FakeClock(startedAt);
    const execution = executeSensor(
      {
        name: 'quick-async',
        declaration: {
          summary: 'Resolves immediately',
          timeoutMs: 10,
          run: async () => ({ state: 'pass' }),
        },
      },
      { cwd: '/repo', exec: new FakeExec({}, clock), clock },
      { runId: 1, trigger: 'check', stale: false },
    );
    await clock.sleep(1_000);
    const result = await execution;

    expect(result).toMatchObject({
      runStatus: 'ok',
      reading: { state: 'pass' },
      wallclockMs: 0,
    });
  });

  it('does not let a composed plain sleep beat a runnable async handler microtask', async () => {
    const clock = new FakeClock(startedAt);
    const execution = executeSensor(
      {
        name: 'one-await',
        declaration: {
          summary: 'Yields once',
          timeoutMs: 10,
          run: async () => {
            await Promise.resolve();
            return { state: 'pass' };
          },
        },
      },
      { cwd: '/repo', exec: new FakeExec({}, clock), clock },
      { runId: 1, trigger: 'check', stale: false },
    );
    await clock.sleep(1_000);
    const result = await execution;

    expect(result).toMatchObject({
      runStatus: 'ok',
      reading: { state: 'pass' },
      wallclockMs: 0,
    });
  });

  it('does not let a composed plain sleep beat an immediate ctx.exec continuation', async () => {
    const clock = new FakeClock(startedAt);
    const exec = new FakeExec({ 'tool check': { code: 0 } }, clock);
    const execution = executeSensor(
      {
        name: 'exec-await',
        declaration: {
          summary: 'Awaits an immediate child',
          timeoutMs: 10,
          run: async (ctx) => {
            const child = await ctx.exec('tool', ['check']);
            return { state: child.ok ? 'pass' : 'fail' };
          },
        },
      },
      { cwd: '/repo', exec, clock },
      { runId: 1, trigger: 'check', stale: false },
    );
    await clock.sleep(1_000);
    const result = await execution;

    expect(exec.calls).toHaveLength(1);
    expect(result).toMatchObject({
      runStatus: 'ok',
      reading: { state: 'pass' },
      wallclockMs: 0,
    });
  });

  it('times out a non-settling handler at the injected fake-clock deadline', async () => {
    const clock = new FakeClock(startedAt);
    const execution = executeSensor(
      {
        name: 'hung',
        declaration: {
          summary: 'Never settles',
          timeoutMs: 10,
          run: () => new Promise(() => {}),
        },
      },
      { cwd: '/repo', exec: new FakeExec({}, clock), clock },
      { runId: 1, trigger: 'check', stale: false },
    );
    clock.advance(10);
    const result = await execution;

    expect(result).toMatchObject({
      runStatus: 'timeout',
      reading: null,
      error: { code: 'E212', message: 'timed out after 10ms' },
      wallclockMs: 10,
    });
  }, 250);

  it('still times out pending work when a composed plain sleep crosses its deadline', async () => {
    const clock = new FakeClock(startedAt);
    const execution = executeSensor(
      {
        name: 'composed-hung',
        declaration: {
          summary: 'Never settles while another consumer sleeps',
          timeoutMs: 10,
          run: () => new Promise(() => {}),
        },
      },
      { cwd: '/repo', exec: new FakeExec({}, clock), clock },
      { runId: 1, trigger: 'check', stale: false },
    );
    await clock.sleep(1_000);
    const result = await execution;

    expect(result).toMatchObject({
      runStatus: 'timeout',
      reading: null,
      error: { code: 'E212', message: 'timed out after 10ms' },
      wallclockMs: 1_000,
    });
  }, 250);

  it('defuses a late rejection after the fake-clock deadline without changing the timeout record', async () => {
    const clock = new FakeClock(startedAt);
    let rejectLate: ((reason?: unknown) => void) | undefined;
    const handler = new Promise<never>((_resolve, reject) => {
      rejectLate = reject;
    });
    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', captureUnhandled);

    try {
      const execution = executeSensor(
        {
          name: 'late-reject',
          declaration: {
            summary: 'Rejects after its deadline',
            timeoutMs: 10,
            run: () => handler,
          },
        },
        { cwd: '/repo', exec: new FakeExec({}, clock), clock },
        { runId: 1, trigger: 'check', stale: false },
      );
      clock.advance(10);
      const result = await execution;
      expect(result).toMatchObject({
        runStatus: 'timeout',
        error: { code: 'E212', message: 'timed out after 10ms' },
      });
      const unchanged = JSON.stringify(result);
      rejectLate?.(new Error('late rejection'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(JSON.stringify(result)).toBe(unchanged);
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }
  }, 250);

  it('caps ctx.exec at the declaration budget and maps exit 124 to timeout without persisting output', async () => {
    const clock = new FakeClock(startedAt);
    const exec = new FakeExec(
      {
        'npm run audit': { code: 1, stdout: 'SECRET stdout', stderr: 'SECRET stderr', hang: true },
      },
      clock,
    );
    const result = await executeSensor(
      {
        name: 'audit',
        declaration: {
          summary: 'Audit',
          timeoutMs: 50,
          run: async (ctx) => {
            await ctx.exec('npm', ['run', 'audit'], { timeoutMs: 5_000 });
            return { state: 'fail', details: 'audit command did not complete' };
          },
        },
      },
      { cwd: '/repo', exec, clock },
      { runId: 2, trigger: 'check', stale: false },
    );

    expect(exec.calls[0]?.timeoutMs).toBe(50);
    expect(exec.kills).toHaveLength(1);
    expect(result).toMatchObject({
      runStatus: 'timeout',
      reading: null,
      error: { code: 'E212' },
      wallclockMs: 50,
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('SensorStateStore (workshop 002 S4-S6)', () => {
  it('commits record and accumulated stats with one temp write + atomic rename and computes age', () => {
    const fs = new FakeFs();
    const clock = new FakeClock(startedAt);
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });

    const written = store.write(record());
    expect(written).toMatchObject({ ok: true, value: { schema: 1 } });
    expect(fs.writes).toEqual([
      '/repo/.harness/temp/sensors/state/lint-count.json.tmp-1',
      '/repo/.harness/temp/sensors/history/lint-count.jsonl.tmp-1',
    ]);
    expect(fs.renames).toEqual([
      '/repo/.harness/temp/sensors/state/lint-count.json.tmp-1->/repo/.harness/temp/sensors/state/lint-count.json',
      '/repo/.harness/temp/sensors/history/lint-count.jsonl.tmp-1->/repo/.harness/temp/sensors/history/lint-count.jsonl',
    ]);

    clock.advance(5_000);
    const read = store.read('lint-count');
    expect(read).toMatchObject({
      ok: true,
      value: {
        ageMs: 5_000,
        record: { runStatus: 'ok', reading: { state: 'pass' } },
        stats: {
          runCount: 1,
          lastRunAt: startedAt,
          lastWallclockMs: 120,
          avgWallclockMs: 120,
          failStreak: 0,
        },
      },
    });
  });

  it('uses process-unique temp files so concurrent last-writer-wins commits do not collide', () => {
    const fs = new FakeFs();
    const clock = new FakeClock(startedAt);
    const first = new SensorStateStore({ fs, clock, repoRoot: '/repo', writerId: '101' });
    const second = new SensorStateStore({ fs, clock, repoRoot: '/repo', writerId: '202' });

    expect(first.write(record())).toMatchObject({ ok: true });
    expect(second.write(record({ reading: { state: 'fail' }, wallclockMs: 200 }))).toMatchObject({
      ok: true,
    });
    expect(fs.renames).toEqual([
      '/repo/.harness/temp/sensors/state/lint-count.json.tmp-101-1->/repo/.harness/temp/sensors/state/lint-count.json',
      '/repo/.harness/temp/sensors/history/lint-count.jsonl.tmp-101-1->/repo/.harness/temp/sensors/history/lint-count.jsonl',
      '/repo/.harness/temp/sensors/state/lint-count.json.tmp-202-1->/repo/.harness/temp/sensors/state/lint-count.json',
      '/repo/.harness/temp/sensors/history/lint-count.jsonl.tmp-202-1->/repo/.harness/temp/sensors/history/lint-count.jsonl',
    ]);
    expect(second.read('lint-count')).toMatchObject({
      ok: true,
      value: { record: { reading: { state: 'fail' } } },
    });
  });

  it('never exposes a torn target when rename fails', () => {
    const old = JSON.stringify({
      schema: 1,
      record: record(),
      stats: {
        runCount: 1,
        lastRunAt: startedAt,
        lastWallclockMs: 120,
        avgWallclockMs: 120,
        failStreak: 0,
      },
    });
    class RenameFailureFs extends FakeFs {
      override rename(): void {
        throw new Error('rename denied');
      }
    }
    const fs = new RenameFailureFs({
      '/repo/.harness/temp/sensors/state/lint-count.json': old,
    });
    const store = new SensorStateStore({ fs, clock: new FakeClock(startedAt), repoRoot: '/repo' });

    expect(store.write(record({ runId: 2, wallclockMs: 300 }))).toMatchObject({
      ok: false,
      error: { code: 'E214' },
    });
    expect(fs.readText('/repo/.harness/temp/sensors/state/lint-count.json')).toBe(old);
  });

  it('reports unreadable schema as E213 and missing state as an honest empty read', () => {
    const fs = new FakeFs({
      '/repo/.harness/temp/sensors/state/bad.json': JSON.stringify({ schema: 99 }),
      '/repo/.harness/temp/sensors/state/malformed.json': JSON.stringify({
        schema: 1,
        record: {},
        stats: {},
      }),
    });
    const store = new SensorStateStore({ fs, clock: new FakeClock(startedAt), repoRoot: '/repo' });
    expect(store.read('bad')).toMatchObject({ ok: false, error: { code: 'E213' } });
    expect(store.read('malformed')).toMatchObject({ ok: false, error: { code: 'E213' } });
    expect(store.read('never-run')).toEqual({ ok: true, value: null });
  });

  it('appends ok, error, and timeout records newest-last on disk and reads newest-first', () => {
    const fs = new FakeFs();
    const store = new SensorStateStore({ fs, clock: new FakeClock(startedAt), repoRoot: '/repo' });

    expect(store.write(record({ runId: 1 }))).toMatchObject({ ok: true });
    expect(
      store.write(
        record({
          runId: 2,
          runStatus: 'error',
          reading: null,
          error: { code: 'E211', message: 'sensor crashed' },
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      store.write(
        record({
          runId: 3,
          runStatus: 'timeout',
          reading: null,
          error: { code: 'E212', message: 'timed out' },
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(store.readHistory('lint-count')).toMatchObject({
      degraded: false,
      note: null,
      records: [
        { runId: 3, runStatus: 'timeout' },
        { runId: 2, runStatus: 'error' },
        { runId: 1, runStatus: 'ok' },
      ],
    });
    const raw = fs.readText('/repo/.harness/temp/sensors/history/lint-count.jsonl') ?? '';
    expect(
      raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).runId),
    ).toEqual([1, 2, 3]);
  });

  it('caps history at 50 records and trims the oldest entries', () => {
    const store = new SensorStateStore({
      fs: new FakeFs(),
      clock: new FakeClock(startedAt),
      repoRoot: '/repo',
    });
    for (let runId = 1; runId <= 55; runId += 1) {
      expect(store.write(record({ runId }))).toMatchObject({ ok: true });
    }
    const history = store.readHistory('lint-count');
    expect(history.records).toHaveLength(50);
    expect(history.records.map(({ runId }) => runId)).toEqual(
      Array.from({ length: 50 }, (_, index) => 55 - index),
    );
  });

  it('keeps valid history when individual JSONL lines are corrupt and degrades honestly', () => {
    const historyPath = '/repo/.harness/temp/sensors/history/lint-count.jsonl';
    const fs = new FakeFs({
      [historyPath]: `${JSON.stringify(record())}\nnot-json\n${JSON.stringify({ sensor: 'broken' })}\n`,
    });
    const store = new SensorStateStore({ fs, clock: new FakeClock(startedAt), repoRoot: '/repo' });

    expect(store.readHistory('lint-count')).toMatchObject({
      degraded: true,
      note: expect.stringContaining('ignored 2 malformed history line(s)'),
      records: [{ runId: 1 }],
    });
    expect(store.readHistory('missing')).toMatchObject({
      degraded: true,
      note: expect.stringContaining('history unavailable'),
      records: [],
    });
  });

  it('never exposes a torn history target when its atomic rename fails', () => {
    const historyPath = '/repo/.harness/temp/sensors/history/lint-count.jsonl';
    const old = `${JSON.stringify(record({ runId: 1 }))}\n`;
    class HistoryRenameFailureFs extends FakeFs {
      override rename(from: string, to: string): void {
        if (to === historyPath) {
          this.renames.push(`${from}->${to}`);
          throw new Error('history rename denied');
        }
        super.rename(from, to);
      }
    }
    const fs = new HistoryRenameFailureFs({ [historyPath]: old });
    const store = new SensorStateStore({ fs, clock: new FakeClock(startedAt), repoRoot: '/repo' });

    expect(store.write(record({ runId: 2 }))).toMatchObject({
      ok: false,
      error: { code: 'E214', message: expect.stringContaining('history rename denied') },
    });
    expect(fs.readText(historyPath)).toBe(old);
  });

  it('clearAll removes state and history but preserves the chosen snapshot', () => {
    const fs = new FakeFs({
      '/repo/.harness/temp/sensors/snapshot.json': '{"schema":1,"takenAt":"kept","readings":{}}\n',
    });
    const store = new SensorStateStore({ fs, clock: new FakeClock(startedAt), repoRoot: '/repo' });
    expect(store.write(record())).toMatchObject({ ok: true });

    expect(store.clearAll()).toEqual({ ok: true, value: { state: true, history: true } });
    expect(store.read('lint-count')).toEqual({ ok: true, value: null });
    expect(store.readHistory('lint-count').records).toEqual([]);
    expect(fs.readText('/repo/.harness/temp/sensors/snapshot.json')).toContain('"takenAt":"kept"');
    expect(fs.removedDirs).toEqual([
      '/repo/.harness/temp/sensors/state',
      '/repo/.harness/temp/sensors/history',
    ]);
  });

  it('FakeFs records mtime probes and returns null for a missing path', () => {
    const fs = new FakeFs({ '/repo/state.json': '{}' });
    expect(fs.mtimeMs('/repo/missing.json')).toBeNull();
    expect(fs.mtimeMs('/repo/state.json')).toBe(0);
    fs.setMtime('/repo/state.json', 42);
    expect(fs.mtimeMs('/repo/state.json')).toBe(42);
    expect(fs.mtimeReads).toEqual(['/repo/missing.json', '/repo/state.json', '/repo/state.json']);
  });

  it('writes heartbeat atomically and computes daemon liveness without pid probing', () => {
    const clock = new FakeClock(startedAt);
    const fs = new FakeFs();
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });
    expect(store.writeDaemon({ pid: 41217, startedAt, version: '0.12.0' })).toMatchObject({
      ok: true,
    });
    expect(store.readDaemon()).toMatchObject({
      ok: true,
      value: { running: true, pid: 41217, heartbeatAt: startedAt },
    });
    clock.advance(15_000);
    expect(store.readDaemon()).toMatchObject({ ok: true, value: { running: false } });
  });
});
