import type { Clock } from './clock-port.js';

/**
 * Deterministic Clock for tests. Returns a fixed instant until advanced/set,
 * and records its call history (fakes over mocks — assert on `calls`).
 */
export class FakeClock implements Clock {
  private current: number;
  readonly calls: string[] = [];

  constructor(start: string | number | Date = '2026-06-08T07:20:00.000Z') {
    this.current = new Date(start).getTime();
  }

  nowIso(): string {
    const iso = new Date(this.current).toISOString();
    this.calls.push(iso);
    return iso;
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
