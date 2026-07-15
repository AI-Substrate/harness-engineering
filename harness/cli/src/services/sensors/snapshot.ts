import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { SensorReading } from '../extensions/contract.js';
import { posixJoin } from '../shared/posix-path.js';
import type {
  SensorServiceError,
  SensorServiceResult,
  SensorSnapshotFile,
  SensorSnapshotReading,
  SensorTrend,
} from './types.js';

const STATE_RANK: Record<Exclude<SensorReading['state'], 'skip'>, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
};

export interface TrendResult {
  delta: number | null;
  trend: SensorTrend;
}

export interface SensorSnapshotStoreDeps {
  fs: FsPort;
  clock: Clock;
  repoRoot: string;
  /** Process-unique suffix so concurrent snapshot writers never share a temp file. */
  writerId?: string;
}

function serviceError(
  code: SensorServiceError['code'],
  path: string,
  message: string,
): SensorServiceError {
  return {
    code,
    message: `${path}: ${message}`,
    next_action:
      code === ErrorCodes.SENSOR_STATE_WRITE_FAILED
        ? 'Check `.harness/temp/` permissions, then retry.'
        : 'Run `harness sensors snapshot` to regenerate the scratch baseline.',
  };
}

/** Pure score/state comparison; skip is deliberately excluded from trends (S2/Q1). */
export function computeTrend(
  current: SensorReading,
  baseline: SensorSnapshotReading | undefined,
): TrendResult {
  if (baseline === undefined || current.state === 'skip' || baseline.state === 'skip') {
    return { delta: null, trend: null };
  }

  if (current.score !== undefined && baseline.score !== undefined) {
    const delta = current.score - baseline.score;
    if (delta === 0) return { delta, trend: 'steady' };
    if (current.direction === 'lower') {
      return { delta, trend: delta < 0 ? 'better' : 'worse' };
    }
    if (current.direction === 'higher') {
      return { delta, trend: delta > 0 ? 'better' : 'worse' };
    }
    return { delta, trend: null };
  }

  const delta = STATE_RANK[current.state] - STATE_RANK[baseline.state];
  return { delta, trend: delta === 0 ? 'steady' : delta < 0 ? 'better' : 'worse' };
}

/** Atomic gitignored working-session baseline store (S7). */
export class SensorSnapshotStore {
  private readonly root: string;
  private readonly path: string;

  constructor(private readonly deps: SensorSnapshotStoreDeps) {
    this.root = posixJoin(deps.repoRoot, '.harness/temp/sensors');
    this.path = posixJoin(this.root, 'snapshot.json');
  }

  write(readings: Record<string, SensorSnapshotReading>): SensorServiceResult<SensorSnapshotFile> {
    const value: SensorSnapshotFile = {
      schema: 1,
      takenAt: this.deps.clock.nowIso(),
      readings: Object.fromEntries(
        Object.entries(readings).map(([name, reading]) => [
          name,
          {
            state: reading.state,
            ...(reading.score !== undefined && { score: reading.score }),
          },
        ]),
      ),
    };
    const temp = this.deps.writerId ? `${this.path}.tmp-${this.deps.writerId}` : `${this.path}.tmp`;
    try {
      this.deps.fs.mkdirp(this.root);
      this.deps.fs.writeText(temp, `${JSON.stringify(value, null, 2)}\n`);
      this.deps.fs.rename(temp, this.path);
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: serviceError(
          ErrorCodes.SENSOR_STATE_WRITE_FAILED,
          this.path,
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }

  read(): SensorServiceResult<SensorSnapshotFile | null> {
    const raw = this.deps.fs.readText(this.path);
    if (raw === null) return { ok: true, value: null };
    try {
      const value = JSON.parse(raw) as Partial<SensorSnapshotFile>;
      const readingsValid =
        value.readings !== null &&
        typeof value.readings === 'object' &&
        !Array.isArray(value.readings) &&
        Object.values(value.readings).every(
          (reading) =>
            reading !== null &&
            typeof reading === 'object' &&
            ['pass', 'warn', 'fail', 'skip'].includes(String(reading.state)) &&
            (reading.score === undefined ||
              (typeof reading.score === 'number' && Number.isFinite(reading.score))),
        );
      if (
        value.schema !== 1 ||
        typeof value.takenAt !== 'string' ||
        !Number.isFinite(Date.parse(value.takenAt)) ||
        !readingsValid
      ) {
        return {
          ok: false,
          error: serviceError(
            ErrorCodes.SENSOR_STATE_UNREADABLE,
            this.path,
            'unsupported or malformed schema',
          ),
        };
      }
      return { ok: true, value: value as SensorSnapshotFile };
    } catch (error) {
      return {
        ok: false,
        error: serviceError(
          ErrorCodes.SENSOR_STATE_UNREADABLE,
          this.path,
          error instanceof Error ? error.message : 'invalid JSON',
        ),
      };
    }
  }
}
