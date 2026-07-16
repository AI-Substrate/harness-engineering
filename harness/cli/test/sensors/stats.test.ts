import { describe, expect, it } from 'vitest';
import { accumulateStats } from '../../src/services/sensors/stats.js';
import type { SensorRunRecord, SensorStats } from '../../src/services/sensors/types.js';

function run(
  runId: number,
  wallclockMs: number,
  runStatus: SensorRunRecord['runStatus'],
  state: 'pass' | 'warn' | 'fail' | 'skip' | null,
): SensorRunRecord {
  return {
    sensor: 'quality',
    runId,
    runStatus,
    reading: state === null ? null : { state },
    error:
      runStatus === 'ok'
        ? null
        : { code: runStatus === 'timeout' ? 'E212' : 'E211', message: 'failed' },
    startedAt: `2026-07-15T02:11:0${runId}.000Z`,
    wallclockMs,
    trigger: 'check',
    stale: false,
    lastTriggerHash: null,
  };
}

describe('sensor stats (workshop 002 S5 and skip semantics)', () => {
  it('accumulates last run, cumulative mean, count, and failure streak', () => {
    let stats: SensorStats | null = null;
    stats = accumulateStats(stats, run(1, 100, 'ok', 'pass'));
    stats = accumulateStats(stats, run(2, 200, 'ok', 'fail'));
    stats = accumulateStats(stats, run(3, 300, 'error', null));

    expect(stats).toEqual({
      runCount: 3,
      lastRunAt: '2026-07-15T02:11:03.000Z',
      lastWallclockMs: 300,
      avgWallclockMs: 200,
      failStreak: 2,
    });
  });

  it('skip increments run/time stats but neither increments nor resets failStreak', () => {
    const prior: SensorStats = {
      runCount: 2,
      lastRunAt: '2026-07-15T02:11:02.000Z',
      lastWallclockMs: 200,
      avgWallclockMs: 150,
      failStreak: 2,
    };
    const skipped = accumulateStats(prior, run(3, 300, 'ok', 'skip'));
    expect(skipped).toMatchObject({ runCount: 3, avgWallclockMs: 200, failStreak: 2 });
    expect(accumulateStats(skipped, run(4, 100, 'ok', 'warn')).failStreak).toBe(0);
  });
});
