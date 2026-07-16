import type { SensorRunRecord, SensorStats } from './types.js';

/** Cumulative, allocation-free stats update fixed by workshop 002 S5. */
export function accumulateStats(
  previous: SensorStats | null,
  record: SensorRunRecord,
): SensorStats {
  const runCount = (previous?.runCount ?? 0) + 1;
  const previousAverage = previous?.avgWallclockMs ?? 0;
  const avgWallclockMs = previousAverage + (record.wallclockMs - previousAverage) / runCount;

  let failStreak = previous?.failStreak ?? 0;
  const state = record.reading?.state;
  if (record.runStatus !== 'ok' || state === 'fail') {
    failStreak += 1;
  } else if (state === 'pass' || state === 'warn') {
    failStreak = 0;
  }
  // A successful skip means "not measured": it neither increments nor resets.

  return {
    runCount,
    lastRunAt: record.startedAt,
    lastWallclockMs: record.wallclockMs,
    avgWallclockMs,
    failStreak,
  };
}
