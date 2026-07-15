import picomatch, { type PicomatchMatcher } from 'picomatch';
import type { Clock } from '../../adapters/clock/clock-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';
import type {
  WatchChange,
  WatcherPort,
  WatchSubscription,
} from '../../adapters/watcher/watcher-port.js';
import type { SensorRuntimeItem } from './types.js';

export const SENSOR_QUIESCENCE_MS = 1_000;

export interface ScheduledSensor extends SensorRuntimeItem {
  entryPath: string;
}

export interface SensorScheduleRequest {
  sensor: ScheduledSensor;
  triggerHash: string;
  stale: boolean;
}

export interface SensorSchedulerOptions {
  root: string;
  sensors: readonly ScheduledSensor[];
  watcher: WatcherPort;
  clock: Clock;
  hash: HashPort;
  run(request: SensorScheduleRequest): Promise<unknown>;
  /** Persisted hashes from state files, used after watcher restart. */
  lastTriggerHashes?: Readonly<Record<string, string>>;
}

interface SensorQueueState {
  running: boolean;
  currentHash?: string;
  queuedHash?: string;
}

function triggerHash(changes: readonly WatchChange[], hash: HashPort): string {
  const canonical = [...changes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((change) => `${change.path}\0${change.contentHash}`)
    .join('\0');
  return hash.sha256Hex(canonical);
}

/**
 * Fake-clock scheduler: glob → one-second quiescence → content dedup →
 * per-sensor serialization. A busy sensor retains only the latest queued hash.
 */
export class SensorScheduler {
  readonly failures: Array<{ sensor: string; message: string }> = [];
  private readonly watchedSensors: ScheduledSensor[];
  private readonly matchers = new Map<string, PicomatchMatcher>();
  private readonly pending = new Map<string, WatchChange>();
  private readonly queue = new Map<string, SensorQueueState>();
  private readonly lastHashes = new Map<string, string>();
  private readonly active = new Set<Promise<void>>();
  private debounceTask: Promise<void> | null = null;
  private changeGeneration = 0;
  private subscription: WatchSubscription | null = null;

  constructor(private readonly options: SensorSchedulerOptions) {
    this.watchedSensors = options.sensors.filter(
      (sensor) =>
        sensor.declaration.trigger !== 'manual' && (sensor.declaration.watch?.length ?? 0) > 0,
    );
    for (const sensor of this.watchedSensors) {
      this.matchers.set(
        sensor.name,
        picomatch([...(sensor.declaration.watch ?? [])], { dot: true }),
      );
      this.queue.set(sensor.name, { running: false });
    }
    for (const [name, hash] of Object.entries(options.lastTriggerHashes ?? {})) {
      this.lastHashes.set(name, hash);
    }
  }

  start(): void {
    if (this.subscription !== null) return;
    const globs = [
      ...new Set(this.watchedSensors.flatMap((sensor) => sensor.declaration.watch ?? [])),
    ];
    this.subscription = this.options.watcher.subscribe(this.options.root, globs, (change) => {
      this.accept(change);
    });
  }

  stop(): void {
    this.subscription?.close();
    this.subscription = null;
  }

  private accept(change: WatchChange): void {
    const path = change.path.replace(/\\/g, '/').replace(/^\.\//, '');
    this.pending.set(path, { ...change, path });
    this.changeGeneration += 1;
    this.ensureDebounce();
  }

  private ensureDebounce(): void {
    if (this.debounceTask !== null) return;
    const task = (async () => {
      // Let a synchronous editor burst coalesce before starting the first window.
      await Promise.resolve();
      while (true) {
        const observedGeneration = this.changeGeneration;
        await this.options.clock.sleep(SENSOR_QUIESCENCE_MS);
        if (observedGeneration === this.changeGeneration) break;
      }
      this.flushPending();
    })();
    this.debounceTask = task;
    void task.finally(() => {
      if (this.debounceTask === task) this.debounceTask = null;
      if (this.pending.size > 0) this.ensureDebounce();
    });
  }

  private flushPending(): void {
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const sensor of this.watchedSensors) {
      const matches = this.matchers.get(sensor.name);
      const changed = matches ? batch.filter((change) => matches(change.path)) : [];
      if (changed.length === 0) continue;
      this.enqueue(sensor, triggerHash(changed, this.options.hash));
    }
  }

  private enqueue(sensor: ScheduledSensor, hash: string): void {
    const state = this.queue.get(sensor.name) ?? { running: false };
    this.queue.set(sensor.name, state);
    if (state.running) {
      if (state.queuedHash === hash) return;
      if (state.currentHash === hash && state.queuedHash === undefined) return;
      // A distinct newest burst replaces the depth-one slot. Matching current
      // content can replace an older queued hash (A→B→A), but a pure A→A is inert.
      state.queuedHash = hash;
      return;
    }
    if (
      this.lastHashes.get(sensor.name) === hash ||
      state.currentHash === hash ||
      state.queuedHash === hash
    ) {
      return;
    }
    this.startRun(sensor, hash, false);
  }

  private startRun(sensor: ScheduledSensor, hash: string, stale: boolean): void {
    const state = this.queue.get(sensor.name) ?? { running: false };
    this.queue.set(sensor.name, state);
    state.running = true;
    state.currentHash = hash;
    const task = (async () => {
      try {
        await this.options.run({ sensor, triggerHash: hash, stale });
      } catch (error) {
        // Watch is advisory: one sensor failure never exits or stops other sensors.
        this.failures.push({
          sensor: sensor.name,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.lastHashes.set(sensor.name, hash);
        state.running = false;
        state.currentHash = undefined;
        const queuedHash = state.queuedHash;
        state.queuedHash = undefined;
        if (queuedHash !== undefined) {
          this.startRun(sensor, queuedHash, true);
        }
      }
    })();
    this.active.add(task);
    void task.finally(() => this.active.delete(task));
  }

  /** Await all fake-clock debounce and run work; production watch loops need not call this. */
  async idle(): Promise<void> {
    while (true) {
      if (this.pending.size > 0 && this.debounceTask === null) this.ensureDebounce();
      const tasks = [...(this.debounceTask === null ? [] : [this.debounceTask]), ...this.active];
      if (tasks.length === 0) return;
      await Promise.allSettled(tasks);
    }
  }
}
