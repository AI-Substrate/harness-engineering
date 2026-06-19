import type { Clock } from './clock-port.js';

/**
 * Deterministic Clock for tests. Returns a fixed instant until advanced/set,
 * and records its call history (fakes over mocks — assert on `calls`).
 */
export class FakeClock implements Clock {
  private current: number;
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
   * Resolve IMMEDIATELY (no real timer) while recording the request and
   * advancing the fake clock by `ms` — so a poll loop that interleaves
   * `sleep` + `nowIso` sees time pass deterministically and finishes instantly.
   */
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
    return Promise.resolve();
  }

  /** Advance the fake clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.current += ms;
  }

  /** Jump the fake clock to an absolute instant. */
  set(instant: string | number | Date): void {
    this.current = new Date(instant).getTime();
  }
}
