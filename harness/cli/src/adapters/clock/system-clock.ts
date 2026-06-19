import type { Clock } from './clock-port.js';

/** Real clock — the only place wall-clock time is read. */
export class SystemClock implements Clock {
  nowIso(): string {
    return new Date().toISOString();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
