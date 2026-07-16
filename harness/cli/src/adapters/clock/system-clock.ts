import type { Clock } from './clock-port.js';

/** Real clock — the only place wall-clock time is read. */
export class SystemClock implements Clock {
  nowIso(): string {
    return new Date().toISOString();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      timer = setTimeout(finish, ms);
      signal?.addEventListener('abort', finish, { once: true });
      if (signal?.aborted) finish();
    });
  }
}
