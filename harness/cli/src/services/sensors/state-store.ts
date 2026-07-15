import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { posixJoin } from '../shared/posix-path.js';
import { accumulateStats } from './stats.js';
import type {
  SensorDaemonFile,
  SensorDaemonView,
  SensorRunRecord,
  SensorServiceError,
  SensorServiceResult,
  SensorStateFile,
  SensorStateView,
} from './types.js';

const LIVENESS_MS = 15_000;

export interface SensorStateStoreDeps {
  fs: FsPort;
  clock: Clock;
  repoRoot: string;
  /** Process-unique suffix so lock-free concurrent writers never share a temp file. */
  writerId?: string;
}

export interface WriteDaemonInput {
  pid: number;
  startedAt: string;
  version: string;
}

function unreadable(path: string, reason: string): SensorServiceError {
  return {
    code: ErrorCodes.SENSOR_STATE_UNREADABLE,
    message: `${path}: ${reason}`,
    next_action: 'Re-run the sensor to regenerate its scratch state.',
  };
}

function writeFailure(path: string, error: unknown): SensorServiceError {
  return {
    code: ErrorCodes.SENSOR_STATE_WRITE_FAILED,
    message: `${path}: ${error instanceof Error ? error.message : String(error)}`,
    next_action: 'Check `.harness/temp/` permissions, then retry.',
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validStateFile(value: unknown): value is SensorStateFile {
  if (!object(value) || value.schema !== 1 || !object(value.record) || !object(value.stats)) {
    return false;
  }
  const record = value.record;
  const stats = value.stats;
  const runStatus = record.runStatus;
  const reading = record.reading;
  const readingValid =
    runStatus === 'ok' &&
    object(reading) &&
    ['pass', 'warn', 'fail', 'skip'].includes(String(reading.state));
  const failureValid =
    (runStatus === 'error' || runStatus === 'timeout') && reading === null && object(record.error);
  return (
    typeof record.sensor === 'string' &&
    typeof record.runId === 'number' &&
    Number.isInteger(record.runId) &&
    (readingValid || failureValid) &&
    typeof record.startedAt === 'string' &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    typeof record.wallclockMs === 'number' &&
    Number.isFinite(record.wallclockMs) &&
    ['watch', 'manual-run', 'check'].includes(String(record.trigger)) &&
    typeof record.stale === 'boolean' &&
    (record.lastTriggerHash === null || typeof record.lastTriggerHash === 'string') &&
    typeof stats.runCount === 'number' &&
    Number.isInteger(stats.runCount) &&
    typeof stats.lastRunAt === 'string' &&
    Number.isFinite(Date.parse(stats.lastRunAt)) &&
    typeof stats.lastWallclockMs === 'number' &&
    Number.isFinite(stats.lastWallclockMs) &&
    typeof stats.avgWallclockMs === 'number' &&
    Number.isFinite(stats.avgWallclockMs) &&
    typeof stats.failStreak === 'number' &&
    Number.isInteger(stats.failStreak)
  );
}

function parseState(raw: string, path: string): SensorServiceResult<SensorStateFile> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!validStateFile(value)) {
      return { ok: false, error: unreadable(path, 'unsupported or malformed schema') };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: unreadable(path, error instanceof Error ? error.message : 'invalid JSON'),
    };
  }
}

function parseDaemon(raw: string, path: string): SensorServiceResult<SensorDaemonFile> {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !object(value) ||
      value.schema !== 1 ||
      typeof value.pid !== 'number' ||
      typeof value.startedAt !== 'string' ||
      typeof value.heartbeatAt !== 'string' ||
      typeof value.version !== 'string' ||
      !Number.isFinite(Date.parse(value.startedAt)) ||
      !Number.isFinite(Date.parse(value.heartbeatAt))
    ) {
      return { ok: false, error: unreadable(path, 'unsupported or malformed schema') };
    }
    return { ok: true, value: value as unknown as SensorDaemonFile };
  } catch (error) {
    return {
      ok: false,
      error: unreadable(path, error instanceof Error ? error.message : 'invalid JSON'),
    };
  }
}

/** Atomic scratch-state reader/writer fixed by workshop 002 S4–S6. */
export class SensorStateStore {
  private readonly root: string;
  private readonly stateDir: string;

  constructor(private readonly deps: SensorStateStoreDeps) {
    this.root = posixJoin(deps.repoRoot, '.harness/temp/sensors');
    this.stateDir = posixJoin(this.root, 'state');
  }

  private statePath(name: string): string {
    return posixJoin(this.stateDir, `${name}.json`);
  }

  write(record: SensorRunRecord): SensorServiceResult<SensorStateFile> {
    const target = this.statePath(record.sensor);
    const previous = this.read(record.sensor);
    const stats = accumulateStats(
      previous.ok && previous.value ? previous.value.stats : null,
      record,
    );
    const value: SensorStateFile = { schema: 1, record, stats };
    const temp = this.deps.writerId
      ? `${target}.tmp-${this.deps.writerId}-${record.runId}`
      : `${target}.tmp-${record.runId}`;
    try {
      this.deps.fs.mkdirp(this.stateDir);
      this.deps.fs.writeText(temp, `${JSON.stringify(value, null, 2)}\n`);
      this.deps.fs.rename(temp, target);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: writeFailure(target, error) };
    }
  }

  read(name: string): SensorServiceResult<SensorStateView | null> {
    const path = this.statePath(name);
    const raw = this.deps.fs.readText(path);
    if (raw === null) return { ok: true, value: null };
    const parsed = parseState(raw, path);
    if (!parsed.ok) return parsed;
    const ageMs = Math.max(
      0,
      Date.parse(this.deps.clock.nowIso()) - Date.parse(parsed.value.stats.lastRunAt),
    );
    return { ok: true, value: { ...parsed.value, ageMs } };
  }

  readMany(names: readonly string[]): SensorServiceResult<SensorStateView[]> {
    const values: SensorStateView[] = [];
    for (const name of names) {
      const result = this.read(name);
      if (!result.ok) return result;
      if (result.value !== null) values.push(result.value);
    }
    return { ok: true, value: values };
  }

  nextRunId(name: string): number {
    const current = this.read(name);
    return current.ok && current.value !== null ? current.value.record.runId + 1 : 1;
  }

  writeDaemon(input: WriteDaemonInput): SensorServiceResult<SensorDaemonFile> {
    const target = posixJoin(this.root, 'daemon.json');
    const value: SensorDaemonFile = {
      schema: 1,
      pid: input.pid,
      startedAt: input.startedAt,
      heartbeatAt: this.deps.clock.nowIso(),
      version: input.version,
    };
    const temp = `${target}.tmp-${input.pid}`;
    try {
      this.deps.fs.mkdirp(this.root);
      this.deps.fs.writeText(temp, `${JSON.stringify(value, null, 2)}\n`);
      this.deps.fs.rename(temp, target);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: writeFailure(target, error) };
    }
  }

  readDaemon(): SensorServiceResult<SensorDaemonView> {
    const path = posixJoin(this.root, 'daemon.json');
    const raw = this.deps.fs.readText(path);
    if (raw === null) {
      return {
        ok: true,
        value: { running: false, pid: null, since: null, heartbeatAt: null, version: null },
      };
    }
    const parsed = parseDaemon(raw, path);
    if (!parsed.ok) return parsed;
    const age = Date.parse(this.deps.clock.nowIso()) - Date.parse(parsed.value.heartbeatAt);
    return {
      ok: true,
      value: {
        running: age >= 0 && age < LIVENESS_MS,
        pid: parsed.value.pid,
        since: parsed.value.startedAt,
        heartbeatAt: parsed.value.heartbeatAt,
        version: parsed.value.version,
      },
    };
  }
}
