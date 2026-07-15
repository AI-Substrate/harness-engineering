import type { Clock } from '../../adapters/clock/clock-port.js';
import type { ExecPort, ExecResult } from '../../adapters/exec/exec-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { SensorReading, SensorRunContext } from '../extensions/contract.js';
import type { SensorRunRecord, SensorRunTrigger, SensorRuntimeItem } from './types.js';

export interface SensorRunnerDeps {
  cwd: string;
  exec: ExecPort;
  clock: Clock;
}

export interface SensorRunOptions {
  runId: number;
  trigger: SensorRunTrigger;
  stale: boolean;
  lastTriggerHash?: string | null;
}

const READING_STATES = new Set(['pass', 'warn', 'fail', 'skip']);

function elapsedMs(clock: Clock, startedMs: number): number {
  return Math.max(0, Date.parse(clock.nowIso()) - startedMs);
}

function promiseLike(value: unknown): value is PromiseLike<SensorReading> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function validReading(value: unknown): value is SensorReading {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const reading = value as Record<string, unknown>;
  if (!READING_STATES.has(String(reading.state))) return false;
  if (
    reading.score !== undefined &&
    (typeof reading.score !== 'number' || !Number.isFinite(reading.score))
  ) {
    return false;
  }
  if (
    reading.score !== undefined &&
    reading.direction !== 'lower' &&
    reading.direction !== 'higher'
  ) {
    return false;
  }
  if (
    reading.direction !== undefined &&
    reading.direction !== 'lower' &&
    reading.direction !== 'higher'
  ) {
    return false;
  }
  if (
    reading.threshold !== undefined &&
    (typeof reading.threshold !== 'number' || !Number.isFinite(reading.threshold))
  ) {
    return false;
  }
  if (reading.details !== undefined && typeof reading.details !== 'string') return false;
  if (reading.guidance !== undefined && typeof reading.guidance !== 'string') return false;
  return true;
}

function failedRecord(
  sensor: SensorRuntimeItem,
  options: SensorRunOptions,
  startedAt: string,
  wallclockMs: number,
  status: 'error' | 'timeout',
  message: string,
): SensorRunRecord {
  return {
    sensor: sensor.name,
    runId: options.runId,
    runStatus: status,
    reading: null,
    error: {
      code: status === 'timeout' ? ErrorCodes.SENSOR_TIMEOUT : ErrorCodes.SENSOR_RUN_FAILED,
      message,
    },
    startedAt,
    wallclockMs,
    trigger: options.trigger,
    stale: options.stale,
    lastTriggerHash: options.lastTriggerHash ?? null,
  };
}

/**
 * Execute one deterministic sensor. The whole handler races the injected-clock
 * deadline; child commands are also capped to the remaining budget, and both
 * FakeExec and NodeExec turn deadline kills into 124. Raw stdout/stderr never
 * crosses this boundary into a record (S12).
 */
export async function executeSensor(
  sensor: SensorRuntimeItem,
  deps: SensorRunnerDeps,
  options: SensorRunOptions,
): Promise<SensorRunRecord> {
  const startedAt = deps.clock.nowIso();
  const startedMs = Date.parse(startedAt);
  const budgetMs = sensor.declaration.timeoutMs ?? 30_000;
  let timedOut = false;

  const context: SensorRunContext = {
    cwd: deps.cwd,
    exec: async (command, args = [], execOptions): Promise<ExecResult> => {
      const remaining = Math.max(0, budgetMs - elapsedMs(deps.clock, startedMs));
      const requested = execOptions?.timeoutMs ?? remaining;
      const result = await deps.exec.run(command, args, {
        cwd: execOptions?.cwd ?? deps.cwd,
        timeoutMs: Math.min(requested, remaining),
        ...(execOptions?.env !== undefined && { env: execOptions.env }),
      });
      if (result.code === 124) timedOut = true;
      return result;
    },
  };

  try {
    const returned = sensor.declaration.run(context);
    let reading: SensorReading;
    if (promiseLike(returned)) {
      const deadline = new AbortController();
      const runSettlement = Promise.resolve(returned).then(
        (value) => ({ kind: 'reading' as const, value }),
        (error: unknown) => ({ kind: 'rejection' as const, error }),
      );
      const remaining = Math.max(0, budgetMs - elapsedMs(deps.clock, startedMs));
      const timeoutSettlement = deps.clock
        .sleep(remaining, deadline.signal)
        .then(() => ({ kind: 'timeout' as const }));
      const settlement = await Promise.race([runSettlement, timeoutSettlement]);
      deadline.abort();
      if (settlement.kind === 'timeout') {
        return failedRecord(
          sensor,
          options,
          startedAt,
          Math.max(budgetMs, elapsedMs(deps.clock, startedMs)),
          'timeout',
          `timed out after ${budgetMs}ms`,
        );
      }
      if (settlement.kind === 'rejection') throw settlement.error;
      reading = settlement.value;
    } else {
      reading = returned;
    }
    const wallclockMs = elapsedMs(deps.clock, startedMs);
    if (timedOut || wallclockMs > budgetMs) {
      return failedRecord(
        sensor,
        options,
        startedAt,
        wallclockMs,
        'timeout',
        `timed out after ${budgetMs}ms`,
      );
    }
    if (!validReading(reading)) {
      return failedRecord(
        sensor,
        options,
        startedAt,
        wallclockMs,
        'error',
        'sensor returned an invalid SensorReading',
      );
    }
    return {
      sensor: sensor.name,
      runId: options.runId,
      runStatus: 'ok',
      reading,
      error: null,
      startedAt,
      wallclockMs,
      trigger: options.trigger,
      stale: options.stale,
      lastTriggerHash: options.lastTriggerHash ?? null,
    };
  } catch (error) {
    const wallclockMs = elapsedMs(deps.clock, startedMs);
    const exceededBudget = timedOut || wallclockMs > budgetMs;
    return failedRecord(
      sensor,
      options,
      startedAt,
      wallclockMs,
      exceededBudget ? 'timeout' : 'error',
      exceededBudget
        ? `timed out after ${budgetMs}ms`
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
}
