import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeHash } from '../../src/adapters/hash/fake-hash.js';
import { FakeWatcher } from '../../src/adapters/watcher/fake-watcher.js';
import {
  type SensorScheduleRequest,
  SensorScheduler,
} from '../../src/services/sensors/scheduler.js';

const watched = {
  name: 'lint',
  entryPath: '/repo/.harness/extensions/quality/extension.ts',
  declaration: {
    summary: 'Lint',
    watch: ['src/**/*.ts'],
    trigger: 'watch' as const,
    run: () => ({ state: 'pass' as const }),
  },
};

const manual = {
  name: 'audit',
  entryPath: '/repo/.harness/extensions/quality/extension.ts',
  declaration: {
    summary: 'Audit',
    watch: ['src/**'],
    trigger: 'manual' as const,
    run: () => ({ state: 'pass' as const }),
  },
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

describe('SensorScheduler (workshop 002 S8/S10)', () => {
  it('glob-matches POSIX paths, quiesces a burst for 1000ms, and runs once', async () => {
    const watcher = new FakeWatcher();
    const clock = new FakeClock();
    const hash = new FakeHash();
    const runs: SensorScheduleRequest[] = [];
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched],
      watcher,
      clock,
      hash,
      run: async (request) => {
        runs.push(request);
      },
    });
    scheduler.start();

    watcher.emit({ path: 'src/b.ts', contentHash: 'b1' });
    watcher.emit({ path: 'src/a.ts', contentHash: 'a1' });
    watcher.emit({ path: 'README.md', contentHash: 'readme' });
    await scheduler.idle();

    expect(watcher.subscriptions[0]).toMatchObject({ root: '/repo' });
    expect(watcher.subscriptions[0]?.globs).toEqual(['src/**/*.ts']);
    expect(clock.sleeps).toEqual([1_000]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ sensor: watched, stale: false });
    expect(runs[0]?.triggerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash.calls).toEqual([{ input: 'src/a.ts\0a1\0src/b.ts\0b1' }]);
  });

  it('restarts quiescence when another event arrives during the window', async () => {
    class GatedClock extends FakeClock {
      private readonly releases: Array<() => void> = [];

      override sleep(ms: number): Promise<void> {
        this.sleeps.push(ms);
        return new Promise((resolve) => {
          this.releases.push(() => {
            this.advance(ms);
            resolve();
          });
        });
      }

      release(): void {
        this.releases.shift()?.();
      }
    }

    const watcher = new FakeWatcher();
    const clock = new GatedClock();
    const runs: SensorScheduleRequest[] = [];
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched],
      watcher,
      clock,
      hash: new FakeHash(),
      run: async (request) => {
        runs.push(request);
      },
    });
    scheduler.start();

    watcher.emit({ path: 'src/a.ts', contentHash: 'v1' });
    await settle();
    expect(clock.sleeps).toEqual([1_000]);
    watcher.emit({ path: 'src/a.ts', contentHash: 'v2' });
    clock.release();
    await settle();
    expect(runs).toEqual([]);
    expect(clock.sleeps).toEqual([1_000, 1_000]);
    clock.release();
    await scheduler.idle();
    expect(runs).toHaveLength(1);
  });

  it('deduplicates a no-op save by the persisted content hash', async () => {
    const watcher = new FakeWatcher();
    const runs: SensorScheduleRequest[] = [];
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched],
      watcher,
      clock: new FakeClock(),
      hash: new FakeHash(),
      run: async (request) => {
        runs.push(request);
      },
    });
    scheduler.start();

    watcher.emit({ path: 'src/a.ts', contentHash: 'same-content' });
    await scheduler.idle();
    watcher.emit({ path: 'src/a.ts', contentHash: 'same-content' });
    await scheduler.idle();
    expect(runs).toHaveLength(1);
  });

  it('never watch-fires manual sensors even when their globs match', async () => {
    const watcher = new FakeWatcher();
    const runs: SensorScheduleRequest[] = [];
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched, manual],
      watcher,
      clock: new FakeClock(),
      hash: new FakeHash(),
      run: async (request) => {
        runs.push(request);
      },
    });
    scheduler.start();
    watcher.emit({ path: 'src/a.ts', contentHash: 'a1' });
    await scheduler.idle();

    expect(runs.map((request) => request.sensor.name)).toEqual(['lint']);
  });

  it('serializes each sensor and collapses in-flight changes to one stale rerun', async () => {
    const watcher = new FakeWatcher();
    const runs: SensorScheduleRequest[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched],
      watcher,
      clock: new FakeClock(),
      hash: new FakeHash(),
      run: async (request) => {
        runs.push(request);
        if (runs.length === 1) await firstBlocked;
      },
    });
    scheduler.start();

    watcher.emit({ path: 'src/a.ts', contentHash: 'v1' });
    await settle();
    expect(runs).toHaveLength(1);

    watcher.emit({ path: 'src/a.ts', contentHash: 'v2' });
    watcher.emit({ path: 'src/a.ts', contentHash: 'v3' });
    await settle();
    expect(runs).toHaveLength(1);
    releaseFirst?.();
    await scheduler.idle();

    expect(runs).toHaveLength(2);
    expect(runs[0]?.stale).toBe(false);
    expect(runs[1]?.stale).toBe(true);
    expect(runs[1]?.triggerHash).not.toBe(runs[0]?.triggerHash);
  });

  it('deduplicates a pure A to A no-op while A is still in flight', async () => {
    const watcher = new FakeWatcher();
    const runs: SensorScheduleRequest[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched],
      watcher,
      clock: new FakeClock(),
      hash: new FakeHash(),
      run: async (request) => {
        runs.push(request);
        await firstBlocked;
      },
    });
    scheduler.start();

    watcher.emit({ path: 'src/a.ts', contentHash: 'A' });
    await settle();
    expect(runs).toHaveLength(1);
    watcher.emit({ path: 'src/a.ts', contentHash: 'A' });
    await settle();

    releaseFirst?.();
    await scheduler.idle();
    expect(runs).toHaveLength(1);
  });

  it('lets the latest A burst replace queued B in an in-flight A to B to A sequence', async () => {
    const watcher = new FakeWatcher();
    const runs: SensorScheduleRequest[] = [];
    const releases: Array<() => void> = [];
    let persistedLastTriggerHash: string | null = null;
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched],
      watcher,
      clock: new FakeClock(),
      hash: new FakeHash(),
      run: async (request) => {
        runs.push(request);
        await new Promise<void>((resolve) => releases.push(resolve));
        persistedLastTriggerHash = request.triggerHash;
      },
    });
    scheduler.start();

    watcher.emit({ path: 'src/a.ts', contentHash: 'A' });
    await settle();
    expect(runs).toHaveLength(1);
    const hashA = runs[0]?.triggerHash;

    watcher.emit({ path: 'src/a.ts', contentHash: 'B' });
    await settle();
    watcher.emit({ path: 'src/a.ts', contentHash: 'A' });
    await settle();

    releases.shift()?.();
    await settle();
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ triggerHash: hashA, stale: true });
    releases.shift()?.();
    await scheduler.idle();
    expect(persistedLastTriggerHash).toBe(hashA);
  });

  it('keeps different sensors concurrent while preserving per-sensor serialization', async () => {
    const other = {
      ...watched,
      name: 'types',
      declaration: { ...watched.declaration, summary: 'Types' },
    };
    const watcher = new FakeWatcher();
    const started: string[] = [];
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = new SensorScheduler({
      root: '/repo',
      sensors: [watched, other],
      watcher,
      clock: new FakeClock(),
      hash: new FakeHash(),
      run: async ({ sensor }) => {
        started.push(sensor.name);
        await blocked;
      },
    });
    scheduler.start();
    watcher.emit({ path: 'src/a.ts', contentHash: 'v1' });
    await settle();

    expect(started.sort()).toEqual(['lint', 'types']);
    release?.();
    await scheduler.idle();
  });
});
