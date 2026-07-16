import { createHash } from 'node:crypto';
import { watch as nodeWatch, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { WatchChange, WatcherPort, WatchSubscription } from './watcher-port.js';

export type WatchFactory = (
  root: string,
  options: { recursive: true },
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => { close(): void };

export interface NodeWatcherDeps {
  watch: WatchFactory;
  readFile(path: string): Buffer;
}

const DEFAULT_DEPS: NodeWatcherDeps = {
  watch: nodeWatch as unknown as WatchFactory,
  readFile: (path) => readFileSync(path),
};

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Thin recursive Node fs.watch adapter; matching/debounce remain in the service. */
export class NodeWatcher implements WatcherPort {
  constructor(private readonly deps: NodeWatcherDeps = DEFAULT_DEPS) {}

  subscribe(
    root: string,
    globs: readonly string[],
    listener: (change: WatchChange) => void,
  ): WatchSubscription {
    // The port records interest globs, but one matcher implementation lives in
    // SensorScheduler. Native events are hints and may be coalesced on win32.
    void globs;
    const watcher = this.deps.watch(root, { recursive: true }, (_eventType, filename) => {
      if (filename === null) return;
      const nativeName = String(filename);
      const absolute = isAbsolute(nativeName) ? nativeName : resolve(root, nativeName);
      const relativePath = relative(root, absolute).replace(/\\/g, '/');
      if (relativePath === '..' || relativePath.startsWith('../')) return;
      let contentHash: string;
      try {
        contentHash = sha256(this.deps.readFile(absolute));
      } catch {
        contentHash = sha256('<missing>');
      }
      listener({ path: relativePath, contentHash });
    });
    return { close: () => watcher.close() };
  }
}
