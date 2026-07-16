import { useEffect, useMemo, useState } from 'react';
import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import { posixJoin } from '../../shared/posix-path.js';

export const POLL_MS = 1_000;
export const SPINNER_MS = 120;
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function sensorPollPaths(repoRoot: string, names: readonly string[]): string[] {
  const root = posixJoin(repoRoot, '.harness/temp/sensors');
  return [
    posixJoin(root, 'daemon.json'),
    posixJoin(root, 'snapshot.json'),
    ...names.map((name) => posixJoin(root, `state/${name}.json`)),
  ];
}

/** One mtime scan and at most one data read/update per poll tick. */
export class CoalescedPoller<T> {
  private readonly mtimes = new Map<string, number | null>();

  constructor(
    private readonly fs: FsPort,
    private readonly paths: readonly string[],
    private readonly read: () => T,
  ) {}

  prime(): void {
    for (const path of this.paths) this.mtimes.set(path, this.fs.mtimeMs(path));
  }

  tick(): { changed: false } | { changed: true; value: T } {
    let changed = false;
    for (const path of this.paths) {
      const next = this.fs.mtimeMs(path);
      if (!this.mtimes.has(path)) this.mtimes.set(path, next);
      else if (this.mtimes.get(path) !== next) {
        this.mtimes.set(path, next);
        changed = true;
      }
    }
    return changed ? { changed: true, value: this.read() } : { changed: false };
  }

  async run(clock: Clock, signal: AbortSignal, onUpdate: (value: T) => void): Promise<void> {
    this.prime();
    while (!signal.aborted) {
      await clock.sleep(POLL_MS, signal);
      if (signal.aborted) break;
      const result = this.tick();
      if (result.changed) onUpdate(result.value);
    }
  }
}

export function useSensorPoll<T>(input: {
  initial: T;
  fs: FsPort;
  clock: Clock;
  paths: readonly string[];
  read(): T;
}): T {
  const [value, setValue] = useState(input.initial);
  const pathKey = input.paths.join('\0');
  const poller = useMemo(
    () => new CoalescedPoller(input.fs, input.paths, input.read),
    [input.fs, input.read, pathKey],
  );
  useEffect(() => {
    const controller = new AbortController();
    void poller.run(input.clock, controller.signal, setValue);
    return () => controller.abort();
  }, [input.clock, poller]);
  return value;
}

export function spinnerShouldRun(inFlightCount: number): boolean {
  return inFlightCount > 0;
}

export function useSpinner(active: boolean, clock: Clock): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const controller = new AbortController();
    const spin = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        await clock.sleep(SPINNER_MS, controller.signal);
        if (!controller.signal.aborted) setIndex((current) => (current + 1) % SPINNER_FRAMES.length);
      }
    };
    void spin();
    return () => controller.abort();
  }, [active, clock]);
  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}
