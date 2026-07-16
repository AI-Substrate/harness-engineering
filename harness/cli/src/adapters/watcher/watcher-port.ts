/** One watcher event; paths are repo-relative POSIX and bytes never leave the adapter. */
export interface WatchChange {
  path: string;
  /** SHA-256 of current bytes, or a stable missing-file marker for deletes. */
  contentHash: string;
}

export interface WatchSubscription {
  close(): void;
}

/**
 * Native watch boundary. `globs` describe caller interest but filtering remains
 * scheduler-owned so every adapter has identical picomatch semantics.
 *
 * Windows note: recursive availability, event coalescing, and rename ordering
 * are properties of Node/fs.watch. Adapters normalize `\\` to `/`; consumers
 * must treat events as hints and rely on content hashes, never event counts.
 */
export interface WatcherPort {
  subscribe(
    root: string,
    globs: readonly string[],
    listener: (change: WatchChange) => void,
  ): WatchSubscription;
}
