export const DEFAULT_SENSOR_RUN_CONCURRENCY = 4;

export interface SensorRunPoolItem {
  readonly name: string;
}

type RunSlot<TResult> = { ok: true; value: TResult } | { ok: false; error: unknown } | undefined;

/**
 * Bounded run-all coordinator. Work may complete out of order, but results retain
 * declaration order. Persistent per-name tails serialize the same sensor across
 * overlapping run-all and run-one calls in this process.
 */
export class SensorRunPool {
  private readonly sensorTails = new Map<string, Promise<void>>();

  async run<TItem extends SensorRunPoolItem, TResult>(
    items: readonly TItem[],
    task: (item: TItem, index: number) => Promise<TResult>,
    concurrency = DEFAULT_SENSOR_RUN_CONCURRENCY,
  ): Promise<TResult[]> {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new RangeError('Sensor run concurrency must be a positive integer.');
    }
    if (items.length === 0) return [];

    const slots = new Array<RunSlot<TResult>>(items.length);
    const workerCount = Math.min(concurrency, items.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) return;
        try {
          slots[index] = {
            ok: true,
            value: await this.serialized(item.name, () => task(item, index)),
          };
        } catch (error) {
          slots[index] = { ok: false, error };
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, worker));
    const rejected = slots.find((slot) => slot?.ok === false);
    if (rejected?.ok === false) throw rejected.error;
    return slots.map((slot) => {
      if (slot?.ok !== true) throw new Error('Sensor run pool finished without a result.');
      return slot.value;
    });
  }

  async runOne<TItem extends SensorRunPoolItem, TResult>(
    item: TItem,
    task: (item: TItem) => Promise<TResult>,
  ): Promise<TResult> {
    const results = await this.run([item], task, 1);
    const result = results[0];
    if (result === undefined) throw new Error('Sensor run pool finished without a result.');
    return result;
  }

  private async serialized<TResult>(name: string, task: () => Promise<TResult>): Promise<TResult> {
    const previous = this.sensorTails.get(name) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.sensorTails.set(name, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.sensorTails.get(name) === tail) this.sensorTails.delete(name);
    }
  }
}
