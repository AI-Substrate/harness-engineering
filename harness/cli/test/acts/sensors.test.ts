import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerSensorsAct,
  type SensorsActDeps,
  type SensorsTuiPort,
} from '../../src/acts/sensors.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeHash } from '../../src/adapters/hash/fake-hash.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { FakeWatcher } from '../../src/adapters/watcher/fake-watcher.js';
import type { Envelope } from '../../src/output/envelope.js';
import { type CliIo, resolveInteractive, type Writers } from '../../src/output/output-port.js';
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

function io(
  mode: CliIo['mode'] = 'json',
  interactive = false,
): { io: CliIo; output: () => string } {
  let output = '';
  const writers: Writers = { out: (text) => (output += text), err: () => undefined };
  return { io: { mode, writers, interactive }, output: () => output };
}

function deps(
  fs = new FakeFs(),
  clock = new FakeClock(AT),
  exec = new FakeExec({}, clock),
  watcher = new FakeWatcher(),
  proc = new FakeProcess({}, '/repo'),
): SensorsActDeps {
  return {
    fs,
    clock,
    exec,
    hash: new FakeHash(),
    watcher,
    proc,
  };
}

async function invoke(
  args: string[],
  reg: VerbRegistry,
  actDeps: SensorsActDeps,
  runtime: { maxHeartbeatCycles?: number } = {},
  ioOptions: { mode?: CliIo['mode']; interactive?: boolean } = {},
): Promise<{ envelope: Envelope; code: number; raw: string }> {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const streams = io(ioOptions.mode ?? 'json', ioOptions.interactive ?? false);
  const program = new Command().name('harness').exitOverride();
  registerSensorsAct(program, streams.io, actDeps, reg, {
    version: '0.12.0',
    pid: 41217,
    ...runtime,
  });
  await expect(program.parseAsync(['node', 'harness', 'sensors', ...args])).rejects.toThrow(
    /^exit:/,
  );
  return { envelope: JSON.parse(streams.output()) as Envelope, code, raw: streams.output() };
}

afterEach(() => vi.restoreAllMocks());

describe('harness sensors act (workshop 002 S13 / AC-08/09/13)', () => {
  it('resolves the interactive carrier once from TTY and TERM', () => {
    expect(resolveInteractive(true, { TERM: 'xterm-256color' })).toBe(true);
    expect(resolveInteractive(false, { TERM: 'xterm-256color' })).toBe(false);
    expect(resolveInteractive(true, { TERM: 'dumb' })).toBe(false);
  });

  it('keeps non-TTY bare output byte-equal to forced JSON and never launches the TUI', async () => {
    let launches = 0;
    const tui: SensorsTuiPort = {
      launch: async () => {
        launches += 1;
      },
    };
    const reg = registry([sensor('lint', () => ({ state: 'pass' }))]);
    const bare = await invoke([], reg, { ...deps(), tui }, {}, { interactive: false });

    vi.restoreAllMocks();
    const forcedJson = await invoke([], reg, { ...deps(), tui }, {}, { interactive: true });
    expect(forcedJson.raw).toBe(bare.raw);
    expect(launches).toBe(0);
  });

  it('launches an injected TUI on the interactive human path without loading real Ink', async () => {
    let launchedWith: unknown;
    const tui: SensorsTuiPort = {
      launch: async (input) => {
        launchedWith = input;
      },
    };
    const streams = io('human', true);
    const program = new Command().name('harness').exitOverride();
    registerSensorsAct(
      program,
      streams.io,
      { ...deps(), tui },
      registry([sensor('lint', () => ({ state: 'pass' }))]),
      { version: '0.12.0', pid: 41217 },
    );

    await program.parseAsync(['node', 'harness', 'sensors']);
    expect(launchedWith).toMatchObject({
      initialEnvelope: { command: 'sensors', status: 'degraded' },
      data: { sensors: [{ name: 'lint', record: null }] },
    });
    expect(streams.output()).toBe('');
  });
  it('routes TUI rerun, run-all, snapshot, clear, and watcher-stop actions through shared services', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const proc = new FakeProcess({}, '/repo', '22.0.0', [41217]);
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });
    store.write(record());
    store.writeDaemon({ pid: 41217, startedAt: AT, version: '0.12.0' });
    new SensorSnapshotStore({ fs, clock, repoRoot: '/repo' }).write({
      lint: { state: 'pass', score: 8 },
    });
    const outcomes: Envelope[] = [];
    const tui: SensorsTuiPort = {
      launch: async (input) => {
        outcomes.push(await input.actions.rerun('lint'));
        outcomes.push(input.actions.snapshot());
        outcomes.push(await input.actions.rerunAll());
        expect(outcomes[2]).toMatchObject({
          status: 'ok',
          data: { records: [{ trigger: 'manual-run' }] },
        });
        expect(fs.removedDirs).toEqual([]);
        outcomes.push(await input.actions.clearAndRun());
        outcomes.push(input.actions.stopWatcher());
        outcomes.push(input.actions.stopWatcher());
      },
    };
    const streams = io('human', true);
    const program = new Command().name('harness').exitOverride();
    registerSensorsAct(
      program,
      streams.io,
      { ...deps(fs, clock, new FakeExec({}, clock), new FakeWatcher(), proc), tui },
      registry([sensor('lint', () => ({ state: 'pass', score: 9, direction: 'higher' }))]),
      { version: '0.12.0', pid: 41217 },
    );

    await program.parseAsync(['node', 'harness', 'sensors']);
    expect(outcomes.map(({ status }) => status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'degraded',
    ]);
    expect(outcomes[5]?.next_action).toContain('already gone');
    expect(proc.kills).toEqual([
      { pid: 41217, signal: 'SIGTERM' },
      { pid: 41217, signal: 'SIGTERM' },
    ]);
    expect(fs.removedDirs).toEqual([
      '/repo/.harness/temp/sensors/state',
      '/repo/.harness/temp/sensors/history',
    ]);
    expect(new SensorSnapshotStore({ fs, clock, repoRoot: '/repo' }).read()).toMatchObject({
      ok: true,
      value: { readings: { lint: { score: 9 } } },
    });
    expect(store.read('lint')).toMatchObject({
      ok: true,
      value: { record: { trigger: 'check', reading: { score: 9 } } },
    });
  });

  it('keeps TUI run-all advisory and preserves existing state/history', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });
    store.write(record());
    let outcome: Envelope | undefined;
    const tui: SensorsTuiPort = {
      launch: async (input) => {
        outcome = await input.actions.rerunAll();
      },
    };
    const streams = io('human', true);
    const program = new Command().name('harness').exitOverride();
    registerSensorsAct(
      program,
      streams.io,
      { ...deps(fs, clock), tui },
      registry([sensor('lint', () => ({ state: 'fail', guidance: 'Fix lint.' }))]),
      { version: '0.12.0', pid: 41217 },
    );

    await program.parseAsync(['node', 'harness', 'sensors']);
    expect(outcome).toMatchObject({
      status: 'ok',
      data: { records: [{ trigger: 'manual-run', reading: { state: 'fail' } }] },
      next_action: expect.stringContaining('Fix lint.'),
    });
    expect(store.readHistory('lint').records).toHaveLength(2);
    expect(fs.removedDirs).toEqual([]);
  });

  it('serializes overlapping TUI run-all calls without corrupting state or history', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const active = new Map<string, number>();
    const maxActive = new Map<string, number>();
    const measured = (name: string, delayMs: number) => async () => {
      const nextActive = (active.get(name) ?? 0) + 1;
      active.set(name, nextActive);
      maxActive.set(name, Math.max(maxActive.get(name) ?? 0, nextActive));
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      active.set(name, nextActive - 1);
      return { state: 'pass' as const };
    };
    let outcomes: Envelope[] = [];
    const tui: SensorsTuiPort = {
      launch: async (input) => {
        outcomes = await Promise.all([input.actions.rerunAll(), input.actions.rerunAll()]);
      },
    };
    const streams = io('human', true);
    const program = new Command().name('harness').exitOverride();
    registerSensorsAct(
      program,
      streams.io,
      { ...deps(fs, clock), tui },
      registry([sensor('alpha', measured('alpha', 4)), sensor('beta', measured('beta', 2))]),
      { version: '0.12.0', pid: 41217 },
    );

    await program.parseAsync(['node', 'harness', 'sensors']);
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(
        ((outcome.data as { records: SensorRunRecord[] }).records ?? []).map(
          ({ sensor: name }) => name,
        ),
      ).toEqual(['alpha', 'beta']);
    }
    expect(maxActive).toEqual(
      new Map([
        ['alpha', 1],
        ['beta', 1],
      ]),
    );
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });
    for (const name of ['alpha', 'beta']) {
      expect(store.read(name)).toMatchObject({
        ok: true,
        value: { record: { sensor: name, runId: 2 } },
      });
      const history = store.readHistory(name);
      expect(history).toMatchObject({
        degraded: false,
        records: [
          { sensor: name, runId: 2 },
          { sensor: name, runId: 1 },
        ],
      });
      const raw = fs.readText(`/repo/.harness/temp/sensors/history/${name}.jsonl`);
      expect(
        raw
          ?.trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toMatchObject([
        { sensor: name, runId: 1 },
        { sensor: name, runId: 2 },
      ]);
    }
  });

  it('returns the snapshot no-readings next action to the TUI without inventing an E-code', async () => {
    let outcome: Envelope | undefined;
    const tui: SensorsTuiPort = {
      launch: async (input) => {
        outcome = input.actions.snapshot();
      },
    };
    const streams = io('human', true);
    const program = new Command().name('harness').exitOverride();
    registerSensorsAct(
      program,
      streams.io,
      { ...deps(), tui },
      registry([sensor('lint', () => ({ state: 'pass' }))]),
      { version: '0.12.0', pid: 41217 },
    );

    await program.parseAsync(['node', 'harness', 'sensors']);
    expect(outcome).toMatchObject({
      status: 'degraded',
      next_action: 'Run the requested sensors before taking a snapshot.',
    });
    expect(outcome?.error).toBeUndefined();
  });

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

  it('round-trips details and report through run, state, and the JSON reader', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const reg = registry([
      sensor('lint', () => ({
        state: 'fail',
        details: 'lint found problems',
        report: 'src/a.ts: unused symbol\nsrc/b.ts: unreachable branch',
      })),
    ]);
    const result = await invoke(['run', 'lint'], reg, deps(fs, clock));

    expect(result.envelope).toMatchObject({
      status: 'ok',
      data: {
        record: {
          runStatus: 'ok',
          reading: {
            state: 'fail',
            details: 'lint found problems',
            report: 'src/a.ts: unused symbol\nsrc/b.ts: unreachable branch',
          },
        },
      },
    });
    expect(result.code).toBe(0);
    expect(new SensorStateStore({ fs, clock, repoRoot: '/repo' }).read('lint')).toMatchObject({
      ok: true,
      value: { record: { reading: { report: expect.stringContaining('src/a.ts') } } },
    });

    vi.restoreAllMocks();
    const reader = await invoke([], reg, deps(fs, clock));
    expect(reader.envelope).toMatchObject({
      data: {
        sensors: [{ reading: { details: 'lint found problems', report: expect.any(String) } }],
      },
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

  it('runs check at default concurrency four while retaining order and valid files', async () => {
    const fs = new FakeFs();
    const clock = new FakeClock(AT);
    const names = ['one', 'two', 'three', 'four', 'five', 'six'];
    const completionOrder: string[] = [];
    let active = 0;
    let maxActive = 0;
    const reg = registry(
      names.map((name, index) =>
        sensor(name, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, (names.length - index) * 2));
          completionOrder.push(name);
          active -= 1;
          return { state: 'pass' };
        }),
      ),
    );

    const result = await invoke(['check'], reg, deps(fs, clock));
    const records = (result.envelope.data as { records: SensorRunRecord[] }).records;
    expect(records.map(({ sensor: name }) => name)).toEqual(names);
    expect(completionOrder).not.toEqual(names);
    expect(maxActive).toBe(4);
    expect(result.code).toBe(0);
    const store = new SensorStateStore({ fs, clock, repoRoot: '/repo' });
    for (const name of names) {
      expect(store.read(name)).toMatchObject({
        ok: true,
        value: { record: { sensor: name, runId: 1 } },
      });
      expect(store.readHistory(name)).toMatchObject({
        degraded: false,
        records: [{ sensor: name, runId: 1 }],
      });
      const raw = fs.readText(`/repo/.harness/temp/sensors/history/${name}.jsonl`);
      expect(() =>
        raw
          ?.trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).not.toThrow();
    }
  });

  it.each([
    '0',
    'garbage',
    '1.5',
  ])('rejects invalid check concurrency %s as E216 without running sensors', async (value) => {
    let runs = 0;
    const result = await invoke(
      ['check', '--concurrency', value],
      registry([
        sensor('lint', () => {
          runs += 1;
          return { state: 'pass' };
        }),
      ]),
      deps(),
    );
    expect(result.envelope).toMatchObject({
      status: 'error',
      error: { code: 'E216', message: expect.stringContaining('--concurrency') },
    });
    expect(result.code).toBe(1);
    expect(runs).toBe(0);
  });

  it('keeps --concurrency 1 byte-equal to prior sequential human check output', async () => {
    const clock = new FakeClock(AT);
    const streams = io('human');
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
      code = value ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness').exitOverride();
    registerSensorsAct(
      program,
      streams.io,
      deps(new FakeFs(), clock),
      registry([
        sensor('tests', () => {
          clock.advance(1_250);
          return { state: 'pass' };
        }),
        sensor('lint', () => {
          clock.advance(42);
          return { state: 'warn' };
        }),
      ]),
      { version: '0.12.0', pid: 41217 },
    );

    await expect(
      program.parseAsync(['node', 'harness', 'sensors', 'check', '--concurrency', '1']),
    ).rejects.toThrow('exit:0');
    expect(streams.output()).toBe('tests: pass · 1.3s\nlint: warn · 42ms\nsensors: ok\n');
    expect(code).toBe(0);
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
