import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { ExecPort } from '../adapters/exec/exec-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { HashPort } from '../adapters/hash/hash-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import type { WatcherPort } from '../adapters/watcher/watcher-port.js';
import { type Envelope, formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import {
  type CliIo,
  createOutputPort,
  type OutputPort,
  renderHuman,
} from '../output/output-port.js';
import type { RegisteredSensor, VerbRegistry } from '../services/extensions/registry.js';
import { DEFAULT_SENSOR_RUN_CONCURRENCY, SensorRunPool } from '../services/sensors/run-pool.js';
import { executeSensor } from '../services/sensors/runner.js';
import { SensorScheduler } from '../services/sensors/scheduler.js';
import { computeTrend, SensorSnapshotStore } from '../services/sensors/snapshot.js';
import { SensorStateStore } from '../services/sensors/state-store.js';
import type {
  SensorsTuiLaunchInput,
  SensorsTuiPort,
  SensorsTuiTerminal,
} from '../services/sensors/tui/types.js';
import { formatDuration } from '../services/sensors/tui/view-model.js';
import type {
  SensorRunRecord,
  SensorRunTrigger,
  SensorRuntimeItem,
  SensorServiceError,
  SensorStatusRead,
} from '../services/sensors/types.js';

export type { SensorsTuiPort } from '../services/sensors/tui/types.js';

const HEARTBEAT_MS = 5_000;

export class SensorsTuiUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SensorsTuiUnavailableError';
  }
}

export interface SensorsActDeps {
  fs: FsPort;
  clock: Clock;
  exec: ExecPort;
  hash: HashPort;
  watcher: WatcherPort;
  proc: ProcessPort;
  /** Test seam; production omits it and uses the lazy ESM launcher. */
  tui?: SensorsTuiPort;
  /** Composition-root terminal carrier; acts never inspect global process streams. */
  terminal?: SensorsTuiTerminal;
}

export interface SensorsActRuntime {
  version: string;
  pid: number;
  /** Test-only finite loop; production omits it and watches until terminated. */
  maxHeartbeatCycles?: number;
}

function storeErrorEnvelope(error: SensorServiceError, clock: Clock): Envelope {
  return formatError('sensors', error.code, error.message, clock, {
    next_action: error.next_action,
  });
}

function sensorNotFound(name: string, clock: Clock): Envelope {
  return formatError(
    'sensors',
    ErrorCodes.SENSOR_NOT_FOUND,
    `Sensor '${name}' is not registered.`,
    clock,
    {
      next_action: 'Run `harness sensors --json` to list registered sensors.',
    },
  );
}

function findSensor(registry: VerbRegistry, name: string): RegisteredSensor | undefined {
  return (registry.sensors ?? []).find((sensor) => sensor.name === name);
}

function parseSensorConcurrency(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function invalidConcurrency(raw: string, clock: Clock): Envelope {
  return formatError(
    'sensors',
    ErrorCodes.SENSOR_DECL_INVALID,
    `Invalid --concurrency '${raw}'; expected a positive integer.`,
    clock,
    { next_action: 'Use `harness sensors check --concurrency 1` or another integer >= 1.' },
  );
}

function recordsFrom(value: unknown): SensorRunRecord[] {
  if (typeof value !== 'object' || value === null) return [];
  const records = (value as { records?: unknown }).records;
  return Array.isArray(records) ? (records as SensorRunRecord[]) : [];
}

export function sensorCheckHumanLines(envelope: Envelope): string[] {
  const records = recordsFrom(envelope.data);
  const checked = records.length > 0 ? records : recordsFrom(envelope.error?.details);
  return checked.map((record) => {
    const result = record.runStatus === 'ok' ? (record.reading?.state ?? 'ok') : record.runStatus;
    return `${record.sensor}: ${result} · ${formatDuration(record.wallclockMs)}`;
  });
}

async function runAndWrite(
  sensor: SensorRuntimeItem,
  trigger: SensorRunTrigger,
  stale: boolean,
  lastTriggerHash: string | null,
  deps: SensorsActDeps,
  store: SensorStateStore,
): Promise<
  | { ok: true; record: SensorRunRecord; stats: { runCount: number; failStreak: number } }
  | { ok: false; error: SensorServiceError }
> {
  const record = await executeSensor(
    sensor,
    { cwd: deps.proc.cwd(), exec: deps.exec, clock: deps.clock },
    {
      runId: store.nextRunId(sensor.name),
      trigger,
      stale,
      lastTriggerHash,
    },
  );
  const written = store.write(record);
  if (!written.ok) return written;
  return { ok: true, record, stats: written.value.stats };
}

function guidance(sensor: RegisteredSensor, record: SensorRunRecord): string | null {
  return record.reading?.guidance ?? sensor.declaration.guidance ?? null;
}

/** Assemble the one status truth consumed by JSON and the interactive renderer. */
export function readSensorStatus(
  registry: VerbRegistry,
  store: SensorStateStore,
  snapshots: SensorSnapshotStore,
): SensorStatusRead {
  const errors: SensorServiceError[] = [];
  const daemonResult = store.readDaemon();
  if (!daemonResult.ok) errors.push(daemonResult.error);
  const daemon = daemonResult.ok
    ? daemonResult.value
    : { running: false, pid: null, since: null, heartbeatAt: null, version: null };

  const snapshotResult = snapshots.read();
  if (!snapshotResult.ok) errors.push(snapshotResult.error);
  const snapshot = snapshotResult.ok ? snapshotResult.value : null;
  let stateCount = 0;
  const sensors = (registry.sensors ?? []).map((sensor) => {
    const stateResult = store.read(sensor.name);
    if (!stateResult.ok) errors.push(stateResult.error);
    const state = stateResult.ok ? stateResult.value : null;
    if (state !== null) stateCount += 1;
    const trend =
      state?.record.reading !== null && state?.record.reading !== undefined
        ? computeTrend(state.record.reading, snapshot?.readings[sensor.name])
        : { delta: null, trend: null };
    return {
      name: sensor.name,
      summary: sensor.declaration.summary,
      trigger: sensor.declaration.trigger ?? 'watch',
      watch: [...(sensor.declaration.watch ?? [])],
      timeoutMs: sensor.declaration.timeoutMs ?? 30_000,
      record: state?.record ?? null,
      runStatus: state?.record.runStatus ?? null,
      reading: state?.record.reading ?? null,
      error: state?.record.error ?? null,
      stats: state?.stats ?? null,
      ageMs: state?.ageMs ?? null,
      stale: state?.record.stale ?? false,
      delta: trend.delta,
      trend: trend.trend,
      guidance: state ? guidance(sensor, state.record) : (sensor.declaration.guidance ?? null),
    };
  });
  return {
    stateCount,
    data: {
      daemon,
      snapshot: snapshot === null ? null : { takenAt: snapshot.takenAt },
      sensors,
      ...(errors.length > 0 && { errors }),
    },
  };
}

export function sensorStatusEnvelope(read: SensorStatusRead, clock: Clock): Envelope {
  const { data, stateCount } = read;
  if (!data.daemon.running || stateCount === 0 || (data.errors?.length ?? 0) > 0) {
    const nextAction = !data.daemon.running
      ? 'Start the watcher: `harness sensors watch` (background: `ctx.background.spawnDetached`).'
      : stateCount === 0
        ? 'Run `harness sensors check` or `harness sensors run <name>` to create state.'
        : (data.errors?.[0]?.next_action ?? 'Regenerate unreadable sensor state.');
    return formatDegraded('sensors', data, nextAction, clock);
  }
  return formatOk('sensors', data, clock);
}

async function lazyLaunchSensorsTui(input: SensorsTuiLaunchInput): Promise<void> {
  const modulePath = '../services/sensors/tui/launch.js';
  try {
    const module = (await import(modulePath)) as {
      launchSensorsTui(value: SensorsTuiLaunchInput): Promise<void>;
    };
    await module.launchSensorsTui(input);
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (
      candidate.code === 'ERR_MODULE_NOT_FOUND' &&
      /(?:ink|react|sensors\/tui\/launch)/i.test(candidate.message)
    ) {
      throw new SensorsTuiUnavailableError(candidate.message, { cause: error });
    }
    throw error;
  }
}

/** Register the sensor family; the optional TUI remains behind the bare-command lazy branch. */
export function registerSensorsAct(
  program: Command,
  io: CliIo,
  deps: SensorsActDeps,
  registry: VerbRegistry,
  runtime: SensorsActRuntime,
): void {
  const output = createOutputPort(io.mode, io.writers);
  const checkOutput: OutputPort =
    io.mode === 'human'
      ? {
          emit(envelope): void {
            for (const line of sensorCheckHumanLines(envelope)) io.writers.out(`${line}\n`);
            renderHuman(envelope, io.writers);
          },
        }
      : output;
  const writerId = String(runtime.pid);
  const store = new SensorStateStore({
    fs: deps.fs,
    clock: deps.clock,
    repoRoot: deps.proc.cwd(),
    writerId,
  });
  const snapshots = new SensorSnapshotStore({
    fs: deps.fs,
    clock: deps.clock,
    repoRoot: deps.proc.cwd(),
    writerId,
  });
  const runPool = new SensorRunPool();
  const runNamed = async (name: string): Promise<Envelope> => {
    const sensor = findSensor(registry, name);
    if (sensor === undefined) return sensorNotFound(name, deps.clock);
    const result = await runPool.runOne(sensor, (item) =>
      runAndWrite(item, 'manual-run', false, null, deps, store),
    );
    if (!result.ok) return storeErrorEnvelope(result.error, deps.clock);
    const nextAction =
      result.record.runStatus !== 'ok' || result.record.reading?.state === 'fail'
        ? (guidance(sensor, result.record) ??
          (result.record.runStatus === 'timeout'
            ? `Raise timeoutMs or make '${name}' cheaper, then run it again.`
            : `Fix '${name}', then run it again.`))
        : undefined;
    return formatOk(
      'sensors',
      { name, record: result.record, stats: result.stats },
      deps.clock,
      nextAction ? { next_action: nextAction } : undefined,
    );
  };

  const takeSnapshot = (name?: string): Envelope => {
    if (name !== undefined && findSensor(registry, name) === undefined) {
      return sensorNotFound(name, deps.clock);
    }
    const selected = (registry.sensors ?? []).filter(
      (sensor) => name === undefined || sensor.name === name,
    );
    const readings: Record<string, { state: 'pass' | 'warn' | 'fail' | 'skip'; score?: number }> =
      {};
    const missing: string[] = [];
    for (const sensor of selected) {
      const result = store.read(sensor.name);
      if (!result.ok) return storeErrorEnvelope(result.error, deps.clock);
      if (result.value?.record.reading === null || result.value === null) {
        missing.push(sensor.name);
        continue;
      }
      const reading = result.value.record.reading;
      readings[sensor.name] = {
        state: reading.state,
        ...(reading.score !== undefined && { score: reading.score }),
      };
    }
    if (Object.keys(readings).length === 0) {
      return formatDegraded(
        'sensors',
        { sensors: [], missing },
        'Run the requested sensors before taking a snapshot.',
        deps.clock,
      );
    }
    const written = snapshots.write(readings);
    if (!written.ok) return storeErrorEnvelope(written.error, deps.clock);
    const data = {
      takenAt: written.value.takenAt,
      sensors: Object.keys(readings),
      ...(missing.length > 0 && { missing }),
    };
    return missing.length > 0
      ? formatDegraded(
          'sensors',
          data,
          `Run the missing sensors (${missing.join(', ')}), then snapshot again.`,
          deps.clock,
        )
      : formatOk('sensors', data, deps.clock);
  };

  const runAll = async (
    trigger: 'check' | 'manual-run',
    enforceCheck: boolean,
    concurrency = DEFAULT_SENSOR_RUN_CONCURRENCY,
  ): Promise<Envelope> => {
    const registered = registry.sensors ?? [];
    if (registered.length === 0) {
      return formatDegraded(
        'sensors',
        { records: [] },
        'Add a v2 `sensors:` declaration, then run `harness sensors check` again.',
        deps.clock,
      );
    }
    const results = await runPool.run(
      registered,
      (sensor) => runAndWrite(sensor, trigger, false, null, deps, store),
      concurrency,
    );
    const writeFailure = results.find((result) => !result.ok);
    if (writeFailure?.ok === false) return storeErrorEnvelope(writeFailure.error, deps.clock);
    const completed = results.flatMap((result, index) => {
      const sensor = registered[index];
      return result.ok && sensor !== undefined ? [{ sensor, record: result.record }] : [];
    });
    const records = completed.map(({ record }) => record);
    const failures = completed.flatMap(({ sensor, record }) =>
      record.runStatus !== 'ok' || record.reading?.state === 'fail'
        ? [
            {
              name: sensor.name,
              runStatus: record.runStatus,
              state: record.reading?.state ?? null,
              guidance: guidance(sensor, record),
            },
          ]
        : [],
    );
    const lines = failures.map((failure) => failure.guidance ?? `Fix '${failure.name}'.`).join(' ');
    if (enforceCheck && failures.length > 0) {
      return formatError(
        'sensors',
        ErrorCodes.SENSORS_CHECK_FAILED,
        `${failures.length} sensor(s) failed: ${failures.map((failure) => failure.name).join(', ')}`,
        deps.clock,
        {
          details: { failures, records },
          next_action: `Fix failing sensor(s) ${failures.map((failure) => failure.name).join(', ')}: ${lines} Then run \`harness sensors check\` again.`,
        },
      );
    }
    const nextAction =
      failures.length === 0
        ? undefined
        : `Fix failing sensor(s) ${failures.map((failure) => failure.name).join(', ')}: ${lines}`;
    return formatOk(
      'sensors',
      { records },
      deps.clock,
      nextAction ? { next_action: nextAction } : undefined,
    );
  };
  const checkAll = async (concurrency = DEFAULT_SENSOR_RUN_CONCURRENCY): Promise<Envelope> =>
    runAll('check', true, concurrency);
  const rerunAll = async (): Promise<Envelope> => runAll('manual-run', false);

  const clearAndRun = async (): Promise<Envelope> => {
    const cleared = store.clearAll();
    if (!cleared.ok) return storeErrorEnvelope(cleared.error, deps.clock);
    return checkAll();
  };

  const stopWatcher = (): Envelope => {
    const daemon = store.readDaemon();
    if (!daemon.ok) return storeErrorEnvelope(daemon.error, deps.clock);
    if (daemon.value.pid === null || !deps.proc.kill(daemon.value.pid, 'SIGTERM')) {
      return formatDegraded(
        'sensors',
        { pid: daemon.value.pid, stopped: false },
        'The watcher pid is already gone; close the viewer or start a new watcher.',
        deps.clock,
      );
    }
    return formatOk('sensors', { pid: daemon.value.pid, stopped: true }, deps.clock);
  };

  const command = program
    .command('sensors')
    .description('Run and inspect deterministic repository sensors.');

  command
    .command('run')
    .description('Run one sensor and atomically persist its reading and stats.')
    .argument('<name>', 'registered sensor name')
    .action(async (name: string) => {
      exitWithEnvelope(await runNamed(name), output);
    });

  command
    .command('snapshot')
    .description('Store the current reading baseline for this working session.')
    .argument('[name]', 'optional registered sensor name')
    .action((name?: string) => {
      exitWithEnvelope(takeSnapshot(name), output);
    });

  command
    .command('check')
    .description('Run every sensor once; fail only for fail/error/timeout readings.')
    .option(
      '--concurrency <n>',
      'maximum sensors to run at once',
      String(DEFAULT_SENSOR_RUN_CONCURRENCY),
    )
    .action(async (options: { concurrency: string }) => {
      const concurrency = parseSensorConcurrency(options.concurrency);
      if (concurrency === null) {
        exitWithEnvelope(invalidConcurrency(options.concurrency, deps.clock), checkOutput);
      }
      exitWithEnvelope(await checkAll(concurrency), checkOutput);
    });

  command
    .command('watch')
    .description('Run the headless watcher loop and atomically publish heartbeat/state.')
    .action(async () => {
      const startedAt = deps.clock.nowIso();
      const initialHashes = Object.fromEntries(
        (registry.sensors ?? []).flatMap((sensor) => {
          const state = store.read(sensor.name);
          const hash = state.ok ? state.value?.record.lastTriggerHash : null;
          return hash ? [[sensor.name, hash]] : [];
        }),
      );
      const scheduler = new SensorScheduler({
        root: deps.proc.cwd(),
        sensors: registry.sensors ?? [],
        watcher: deps.watcher,
        clock: deps.clock,
        hash: deps.hash,
        lastTriggerHashes: initialHashes,
        run: async ({ sensor, stale, triggerHash }) => {
          const result = await runAndWrite(sensor, 'watch', stale, triggerHash, deps, store);
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        },
      });
      const beat = (): SensorServiceError | null => {
        const result = store.writeDaemon({
          pid: runtime.pid,
          startedAt,
          version: runtime.version,
        });
        return result.ok ? null : result.error;
      };
      scheduler.start();
      const initialError = beat();
      if (initialError) {
        scheduler.stop();
        exitWithEnvelope(storeErrorEnvelope(initialError, deps.clock), output);
      }

      let cycles = 0;
      while (runtime.maxHeartbeatCycles === undefined || cycles < runtime.maxHeartbeatCycles) {
        await deps.clock.sleep(HEARTBEAT_MS);
        const error = beat();
        if (error) {
          scheduler.stop();
          exitWithEnvelope(storeErrorEnvelope(error, deps.clock), output);
        }
        cycles += 1;
      }

      await scheduler.idle();
      scheduler.stop();
      const watching = (registry.sensors ?? []).filter(
        (sensor) =>
          sensor.declaration.trigger !== 'manual' && (sensor.declaration.watch?.length ?? 0) > 0,
      ).length;
      exitWithEnvelope(
        formatOk(
          'sensors',
          { watching, pid: runtime.pid, failures: scheduler.failures },
          deps.clock,
        ),
        output,
      );
    });

  command.action(async () => {
    const read = readSensorStatus(registry, store, snapshots);
    const envelope = sensorStatusEnvelope(read, deps.clock);
    if (io.interactive === true && io.mode === 'human') {
      try {
        await (deps.tui?.launch ?? lazyLaunchSensorsTui)({
          initialEnvelope: envelope,
          data: read.data,
          noColor: io.useColor !== true,
          ascii: io.ascii === true,
          fs: deps.fs,
          clock: deps.clock,
          repoRoot: deps.proc.cwd(),
          terminal: deps.terminal,
          readStatus: () => readSensorStatus(registry, store, snapshots),
          readHistory: (name) => store.readHistory(name),
          actions: {
            rerun: runNamed,
            rerunAll,
            snapshot: () => takeSnapshot(),
            clearAndRun,
            stopWatcher,
          },
        });
        return;
      } catch (error) {
        if (!(error instanceof SensorsTuiUnavailableError)) throw error;
        exitWithEnvelope(
          formatDegraded(
            'sensors',
            read.data,
            'Install the optional TUI: `npm install ink react`; or run `harness sensors --json`.',
            deps.clock,
          ),
          output,
        );
      }
    }
    exitWithEnvelope(envelope, output);
  });
}
