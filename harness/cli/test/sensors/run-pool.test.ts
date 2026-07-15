import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SENSOR_RUN_CONCURRENCY,
  SensorRunPool,
} from '../../src/services/sensors/run-pool.js';

afterEach(() => vi.useRealTimers());

describe('SensorRunPool', () => {
  it('defaults to four in flight and finishes near the maximum duration, not the sum', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pool = new SensorRunPool();
    const items = [
      { name: 'slowest', delayMs: 40 },
      { name: 'fast', delayMs: 5 },
      { name: 'medium', delayMs: 30 },
      { name: 'quick', delayMs: 10 },
      { name: 'queued', delayMs: 25 },
      { name: 'instant', delayMs: 1 },
    ];
    let active = 0;
    let maxActive = 0;
    const completionOrder: string[] = [];
    const startedAt = Date.now();

    const pending = pool.run(items, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, item.delayMs));
      completionOrder.push(item.name);
      active -= 1;
      return item.name;
    });
    await vi.runAllTimersAsync();

    expect(await pending).toEqual(items.map(({ name }) => name));
    expect(maxActive).toBe(DEFAULT_SENSOR_RUN_CONCURRENCY);
    expect(Date.now() - startedAt).toBe(40);
    expect(Date.now() - startedAt).toBeLessThan(
      items.reduce((sum, { delayMs }) => sum + delayMs, 0),
    );
    expect(completionOrder).not.toEqual(items.map(({ name }) => name));
    expect(completionOrder[0]).toBe('fast');
    expect(completionOrder.at(-1)).toBe('slowest');
  });

  it('serializes the same sensor across overlapping pool calls', async () => {
    vi.useFakeTimers();
    const pool = new SensorRunPool();
    const active = new Map<string, number>();
    const maxActive = new Map<string, number>();
    const events: string[] = [];
    const task = async (item: { name: string; id: number }): Promise<string> => {
      const nextActive = (active.get(item.name) ?? 0) + 1;
      active.set(item.name, nextActive);
      maxActive.set(item.name, Math.max(maxActive.get(item.name) ?? 0, nextActive));
      events.push(`start:${item.name}:${item.id}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      events.push(`end:${item.name}:${item.id}`);
      active.set(item.name, nextActive - 1);
      return `${item.name}:${item.id}`;
    };

    const first = pool.run(
      [
        { name: 'same', id: 1 },
        { name: 'other', id: 1 },
      ],
      task,
      2,
    );
    const second = pool.run([{ name: 'same', id: 2 }], task, 1);
    await vi.runAllTimersAsync();

    expect(await first).toEqual(['same:1', 'other:1']);
    expect(await second).toEqual(['same:2']);
    expect(maxActive.get('same')).toBe(1);
    expect(events.filter((event) => event.includes(':same:'))).toEqual([
      'start:same:1',
      'end:same:1',
      'start:same:2',
      'end:same:2',
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid concurrency %s', async (concurrency) => {
    const pool = new SensorRunPool();
    await expect(pool.run([], async () => undefined, concurrency)).rejects.toThrow(RangeError);
  });
});
