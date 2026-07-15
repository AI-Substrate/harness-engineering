import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSensorsAct, type SensorsActDeps } from '../../src/acts/sensors.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeHash } from '../../src/adapters/hash/fake-hash.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { FakeWatcher } from '../../src/adapters/watcher/fake-watcher.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { RegisteredSensor, VerbRegistry } from '../../src/services/extensions/registry.js';
import { SensorSnapshotStore } from '../../src/services/sensors/snapshot.js';
import { SensorStateStore } from '../../src/services/sensors/state-store.js';
import type { SensorRunRecord } from '../../src/services/sensors/types.js';

const AT = '2026-07-15T02:11:04.512Z';

function sensor(
  name: string,
  run: RegisteredSensor['declaration']['run'],
  trigger: 'watch' | 'manual' = 'watch',
): RegisteredSensor {
  return {
    name,
    extension: 'quality',
    entryPath: '/repo/.harness/extensions/quality/extension.ts',
    declaration: {
      summary: `${name} sensor`,
      run,
      trigger,
      timeoutMs: 30_000,
      ...(trigger === 'watch' && { watch: ['src/**/*.ts'] }),
      guidance: `Fix ${name}, then rerun it.`,
    },
  };
}

function registry(sensors: RegisteredSensor[]): VerbRegistry {
  return { verbs: [], records: [], extensions: [], sensors, customItems: [] };
}

function record(overrides: Partial<SensorRunRecord> = {}): SensorRunRecord {
  return {
    sensor: 'lint',
    runId: 1,
    runStatus: 'ok',
    reading: { state: 'pass', score: 8, direction: 'lower' },
    error: null,
    startedAt: AT,
    wallclockMs: 20,
    trigger: 'manual-run',
    stale: false,
    lastTriggerHash: null,
    ...overrides,
  };
}

function io(): { io: CliIo; output: () => string } {
  let output = '';
  const writers: Writers = { out: (text) => (output += text), err: () => undefined };
  return { io: { mode: 'json', writers }, output: () => output };
}

function deps(
  fs = new FakeFs(),
  clock = new FakeClock(AT),
  exec = new FakeExec({}, clock),
  watcher = new FakeWatcher(),
): SensorsActDeps {
  return {
    fs,
    clock,
    exec,
    hash: new FakeHash(),
    watcher,
    proc: new FakeProcess({}, '/repo'),
  };
}

async function invoke(
  args: string[],
  reg: VerbRegistry,
  actDeps: SensorsActDeps,
  runtime: { maxHeartbeatCycles?: number } = {},
): Promise<{ envelope: Envelope; code: number }> {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const streams = io();
  const program = new Command().name('harness').exitOverride();
  registerSensorsAct(program, streams.io, actDeps, reg, {
    version: '0.12.0',
    pid: 41217,
    ...runtime,
  });
  await expect(program.parseAsync(['node', 'harness', 'sensors', ...args])).rejects.toThrow(
    /^exit:/,
  );
  return { envelope: JSON.parse(streams.output()) as Envelope, code };
}

afterEach(() => vi.restoreAllMocks());

describe('harness sensors act (workshop 002 S13 / AC-08/09/13)', () => {
  it('reads state only and degrades with exit 0 when daemon/state are absent', async () => {
    const exec = new FakeExec();
    const result = await invoke(
      [],
      registry([sensor('lint', () => ({ state: 'pass' }))]),
      deps(new FakeFs(), new FakeClock(AT), exec),
    );

    expect(result.envelope).toMatchObject({
      command: 'sensors',
      status: 'degraded',
      data: {
        daemon: { running: false },
        sensors: [{ name: 'lint', runStatus: null, reading: null, stats: null }],
      },
    });
    expect(result.envelope.status).not.toBe('unconfigured');
    expect(result.envelope.next_action).toContain('harness sensors watch');
    expect(result.code).toBe(0);
    expect(exec.calls).toEqual([]);
  });

  it('returns state, age, daemon liveness, and snapshot delta from one truth', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });
    store.write(record());
    store.writeDaemon({ pid: 41217, startedAt: AT, version: '0.12.0' });
    new SensorSnapshotStore({ fs, clock, repoRoot: '/repo' }).write({
      lint: { state: 'pass', score: 10 },
    });
    clock.advance(100);

    const result = await invoke(
      [],
      registry([sensor('lint', () => ({ state: 'pass' }))]),
      deps(fs, clock),
    );
    expect(result.envelope).toMatchObject({
      status: 'ok',
      data: {
        daemon: { running: true, pid: 41217, heartbeatAt: AT },
        snapshot: { takenAt: AT },
        sensors: [
          {
            name: 'lint',
            runStatus: 'ok',
            reading: { state: 'pass', score: 8 },
            ageMs: 100,
            delta: -2,
            trend: 'better',
          },
        ],
      },
    });
    expect(result.code).toBe(0);
  });

  it('runs and atomically persists a failing reading without turning it into a command failure', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const result = await invoke(
      ['run', 'lint'],
      registry([sensor('lint', () => ({ state: 'fail', details: 'lint found problems' }))]),
      deps(fs, clock),
    );

    expect(result.envelope).toMatchObject({
      status: 'ok',
      data: { record: { runStatus: 'ok', reading: { state: 'fail' } } },
    });
    expect(result.code).toBe(0);
    expect(new SensorStateStore({ fs, clock, repoRoot: '/repo' }).read('lint')).toMatchObject({
      ok: true,
      value: { record: { reading: { state: 'fail' } } },
    });
  });

  it('snapshots current readings and reports an unknown requested sensor as E210', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    new SensorStateStore({ fs, clock, repoRoot: '/repo' }).write(record());
    const reg = registry([sensor('lint', () => ({ state: 'pass' }))]);

    const saved = await invoke(['snapshot'], reg, deps(fs, clock));
    expect(saved.envelope).toMatchObject({ status: 'ok', data: { sensors: ['lint'] } });
    expect(saved.code).toBe(0);
    expect(new SensorSnapshotStore({ fs, clock, repoRoot: '/repo' }).read()).toMatchObject({
      ok: true,
      value: { readings: { lint: { state: 'pass', score: 8 } } },
    });

    vi.restoreAllMocks();
    const missing = await invoke(['snapshot', 'missing'], reg, deps(fs, clock));
    expect(missing.envelope).toMatchObject({ status: 'error', error: { code: 'E210' } });
    expect(missing.code).toBe(1);
  });

  it('check alone maps fail/error/timeout to E215 exit 1; skip does not fail it', async () => {
    const failing = registry([
      sensor('pass', () => ({ state: 'pass' })),
      sensor('skip', () => ({ state: 'skip' }), 'manual'),
      sensor('fail', () => ({ state: 'fail', guidance: 'Fix the threshold.' })),
    ]);
    const failed = await invoke(['check'], failing, deps());
    expect(failed.envelope).toMatchObject({
      status: 'error',
      error: { code: 'E215', details: { failures: [{ name: 'fail' }] } },
    });
    expect(failed.envelope.next_action).toContain('fail');
    expect(failed.code).toBe(1);

    vi.restoreAllMocks();
    const advisory = registry([
      sensor('warn', () => ({ state: 'warn' })),
      sensor('skip', () => ({ state: 'skip' }), 'manual'),
    ]);
    const passed = await invoke(['check'], advisory, deps());
    expect(passed.envelope).toMatchObject({ status: 'ok' });
    expect(passed.code).toBe(0);
  });

  it('runs the headless watch loop with atomic heartbeat and exits 0 in bounded test mode', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const watcher = new FakeWatcher();
    const result = await invoke(
      ['watch'],
      registry([sensor('audit', () => ({ state: 'pass' }), 'manual')]),
      deps(fs, clock, new FakeExec({}, clock), watcher),
      { maxHeartbeatCycles: 1 },
    );

    expect(result.envelope).toMatchObject({ status: 'ok', data: { watching: 0, pid: 41217 } });
    expect(result.code).toBe(0);
    expect(clock.sleeps).toEqual([5_000]);
    expect(new SensorStateStore({ fs, clock, repoRoot: '/repo' }).readDaemon()).toMatchObject({
      ok: true,
      value: { running: true, pid: 41217 },
    });
  });
});
