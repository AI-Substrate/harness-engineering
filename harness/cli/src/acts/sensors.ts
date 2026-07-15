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
import { type CliIo, createOutputPort } from '../output/output-port.js';
import type { RegisteredSensor, VerbRegistry } from '../services/extensions/registry.js';
import { executeSensor } from '../services/sensors/runner.js';
import { SensorScheduler } from '../services/sensors/scheduler.js';
import { computeTrend, SensorSnapshotStore } from '../services/sensors/snapshot.js';
import { SensorStateStore } from '../services/sensors/state-store.js';
import type {
  SensorRunRecord,
  SensorRunTrigger,
  SensorRuntimeItem,
  SensorServiceError,
} from '../services/sensors/types.js';

const HEARTBEAT_MS = 5_000;

export interface SensorsActDeps {
  fs: FsPort;
  clock: Clock;
  exec: ExecPort;
  hash: HashPort;
  watcher: WatcherPort;
  proc: ProcessPort;
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

function readerEnvelope(
  registry: VerbRegistry,
  deps: SensorsActDeps,
  store: SensorStateStore,
  snapshots: SensorSnapshotStore,
): Envelope {
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
  const data = {
    daemon,
    snapshot: snapshot === null ? null : { takenAt: snapshot.takenAt },
    sensors,
    ...(errors.length > 0 && { errors }),
  };

  if (!daemon.running || stateCount === 0 || errors.length > 0) {
    const nextAction = !daemon.running
      ? 'Start the watcher: `harness sensors watch` (background: `ctx.background.spawnDetached`).'
      : stateCount === 0
        ? 'Run `harness sensors check` or `harness sensors run <name>` to create state.'
        : (errors[0]?.next_action ?? 'Regenerate unreadable sensor state.');
    return formatDegraded('sensors', data, nextAction, deps.clock);
  }
  return formatOk('sensors', data, deps.clock);
}

/** Register the Phase-2 headless sensor command family; no TTY/Ink branch lives here. */
export function registerSensorsAct(
  program: Command,
  io: CliIo,
  deps: SensorsActDeps,
  registry: VerbRegistry,
  runtime: SensorsActRuntime,
): void {
  const output = createOutputPort(io.mode, io.writers);
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
  const command = program
    .command('sensors')
    .description('Run and inspect deterministic repository sensors.');

  command
    .command('run')
    .description('Run one sensor and atomically persist its reading and stats.')
    .argument('<name>', 'registered sensor name')
    .action(async (name: string) => {
      const sensor = findSensor(registry, name);
      if (sensor === undefined) exitWithEnvelope(sensorNotFound(name, deps.clock), output);
      const result = await runAndWrite(sensor, 'manual-run', false, null, deps, store);
      if (!result.ok) exitWithEnvelope(storeErrorEnvelope(result.error, deps.clock), output);
      const nextAction =
        result.record.runStatus !== 'ok' || result.record.reading?.state === 'fail'
          ? (guidance(sensor, result.record) ??
            (result.record.runStatus === 'timeout'
              ? `Raise timeoutMs or make '${name}' cheaper, then run it again.`
              : `Fix '${name}', then run it again.`))
          : undefined;
      exitWithEnvelope(
        formatOk(
          'sensors',
          { name, record: result.record, stats: result.stats },
          deps.clock,
          nextAction ? { next_action: nextAction } : undefined,
        ),
        output,
      );
    });

  command
    .command('snapshot')
    .description('Store the current reading baseline for this working session.')
    .argument('[name]', 'optional registered sensor name')
    .action((name?: string) => {
      if (name !== undefined && findSensor(registry, name) === undefined) {
        exitWithEnvelope(sensorNotFound(name, deps.clock), output);
      }
      const selected = (registry.sensors ?? []).filter(
        (sensor) => name === undefined || sensor.name === name,
      );
      const readings: Record<string, { state: 'pass' | 'warn' | 'fail' | 'skip'; score?: number }> =
        {};
      const missing: string[] = [];
      for (const sensor of selected) {
        const result = store.read(sensor.name);
        if (!result.ok) exitWithEnvelope(storeErrorEnvelope(result.error, deps.clock), output);
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
        exitWithEnvelope(
          formatDegraded(
            'sensors',
            { sensors: [], missing },
            'Run the requested sensors before taking a snapshot.',
            deps.clock,
          ),
          output,
        );
      }
      const written = snapshots.write(readings);
      if (!written.ok) exitWithEnvelope(storeErrorEnvelope(written.error, deps.clock), output);
      const data = {
        takenAt: written.value.takenAt,
        sensors: Object.keys(readings),
        ...(missing.length > 0 && { missing }),
      };
      exitWithEnvelope(
        missing.length > 0
          ? formatDegraded(
              'sensors',
              data,
              `Run the missing sensors (${missing.join(', ')}), then snapshot again.`,
              deps.clock,
            )
          : formatOk('sensors', data, deps.clock),
        output,
      );
    });

  command
    .command('check')
    .description('Run every sensor once; fail only for fail/error/timeout readings.')
    .action(async () => {
      const registered = registry.sensors ?? [];
      if (registered.length === 0) {
        exitWithEnvelope(
          formatDegraded(
            'sensors',
            { records: [] },
            'Add a v2 `sensors:` declaration, then run `harness sensors check` again.',
            deps.clock,
          ),
          output,
        );
      }
      const records: SensorRunRecord[] = [];
      const failures: Array<{
        name: string;
        runStatus: SensorRunRecord['runStatus'];
        state: string | null;
        guidance: string | null;
      }> = [];
      for (const sensor of registered) {
        const result = await runAndWrite(sensor, 'check', false, null, deps, store);
        if (!result.ok) exitWithEnvelope(storeErrorEnvelope(result.error, deps.clock), output);
        records.push(result.record);
        if (result.record.runStatus !== 'ok' || result.record.reading?.state === 'fail') {
          failures.push({
            name: sensor.name,
            runStatus: result.record.runStatus,
            state: result.record.reading?.state ?? null,
            guidance: guidance(sensor, result.record),
          });
        }
      }
      if (failures.length > 0) {
        const lines = failures
          .map((failure) => failure.guidance ?? `Fix '${failure.name}'.`)
          .join(' ');
        exitWithEnvelope(
          formatError(
            'sensors',
            ErrorCodes.SENSORS_CHECK_FAILED,
            `${failures.length} sensor(s) failed: ${failures.map((failure) => failure.name).join(', ')}`,
            deps.clock,
            {
              details: { failures, records },
              next_action: `Fix failing sensor(s) ${failures.map((failure) => failure.name).join(', ')}: ${lines} Then run \`harness sensors check\` again.`,
            },
          ),
          output,
        );
      }
      exitWithEnvelope(formatOk('sensors', { records }, deps.clock), output);
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

  command.action(() => {
    exitWithEnvelope(readerEnvelope(registry, deps, store, snapshots), output);
  });
}
