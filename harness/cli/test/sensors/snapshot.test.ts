import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { computeTrend, SensorSnapshotStore } from '../../src/services/sensors/snapshot.js';

describe('sensor snapshot and trend (workshop 002 S7)', () => {
  it.each([
    [
      { state: 'pass' as const, score: 8, direction: 'lower' as const },
      { state: 'pass' as const, score: 10 },
      { delta: -2, trend: 'better' },
    ],
    [
      { state: 'pass' as const, score: 70, direction: 'higher' as const },
      { state: 'pass' as const, score: 80 },
      { delta: -10, trend: 'worse' },
    ],
    [{ state: 'warn' as const }, { state: 'fail' as const }, { delta: -1, trend: 'better' }],
    [{ state: 'skip' as const }, { state: 'fail' as const }, { delta: null, trend: null }],
  ])('computes direction-aware and skip-safe delta %#', (current, baseline, expected) => {
    expect(computeTrend(current, baseline)).toEqual(expected);
  });

  it('writes one atomic gitignored session baseline and reads it back', () => {
    const at = '2026-07-15T01:00:00.000Z';
    const fs = new FakeFs();
    const store = new SensorSnapshotStore({ fs, clock: new FakeClock(at), repoRoot: '/repo' });
    const readings = {
      lint: { state: 'pass' as const, score: 0 },
      mutation: { state: 'pass' as const, score: 87 },
    };

    expect(store.write(readings)).toMatchObject({ ok: true, value: { schema: 1, takenAt: at } });
    expect(fs.writes).toEqual(['/repo/.harness/temp/sensors/snapshot.json.tmp']);
    expect(fs.renames).toEqual([
      '/repo/.harness/temp/sensors/snapshot.json.tmp->/repo/.harness/temp/sensors/snapshot.json',
    ]);
    expect(store.read()).toMatchObject({ ok: true, value: { readings } });
  });
});
