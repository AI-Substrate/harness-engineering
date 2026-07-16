import type { Clock } from './clock-port.js';

interface SignalSleepWaiter {
  dueMs: number;
  signal: AbortSignal;
  onAbort: () => void;
  resolve: () => void;
}

/**
 * Deterministic Clock for tests. Returns a fixed instant until advanced/set,
 * and records its call history (fakes over mocks — assert on `calls`).
 */
export class FakeClock implements Clock {
  private current: number;
  private readonly signalSleepWaiters = new Set<SignalSleepWaiter>();
  readonly calls: string[] = [];
  /** Every `sleep(ms)` request, in order (fakes over mocks — assert on history). */
  readonly sleeps: number[] = [];

  constructor(start: string | number | Date = '2026-06-08T07:20:00.000Z') {
    this.current = new Date(start).getTime();
  }

  nowIso(): string {
    const iso = new Date(this.current).toISOString();
    this.calls.push(iso);
    return iso;
  }

  /**
   * Plain sleeps advance on the next event-loop turn, after already-runnable
   * microtasks, then resolve without a real timer delay. A signal marks a
   * deadline sleep; it waits until fake time reaches its due instant, or
   * resolves early on abort without advancing.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    if (signal === undefined) {
      return new Promise((resolve) => {
        setImmediate(() => {
          this.current += ms;
          this.releaseDueSignalSleeps();
          resolve();
        });
      });
    }
    if (signal.aborted) return Promise.resolve();

    const dueMs = this.current + ms;
    return new Promise((resolve) => {
      let waiter: SignalSleepWaiter;
      const onAbort = (): void => this.resolveSignalSleep(waiter);
      waiter = { dueMs, signal, onAbort, resolve };
      this.signalSleepWaiters.add(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted || dueMs <= this.current) this.resolveSignalSleep(waiter);
    });
  }

  /** Advance the fake clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.current += ms;
    this.releaseDueSignalSleeps();
  }

  /** Jump the fake clock to an absolute instant. */
  set(instant: string | number | Date): void {
    this.current = new Date(instant).getTime();
    this.releaseDueSignalSleeps();
  }

  private resolveSignalSleep(waiter: SignalSleepWaiter): void {
    if (!this.signalSleepWaiters.delete(waiter)) return;
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve();
  }

  private releaseDueSignalSleeps(): void {
    for (const waiter of this.signalSleepWaiters) {
      if (waiter.dueMs <= this.current) this.resolveSignalSleep(waiter);
    }
  }
}
