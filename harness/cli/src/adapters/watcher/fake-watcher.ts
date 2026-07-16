import type { WatchChange, WatcherPort, WatchSubscription } from './watcher-port.js';

export interface FakeWatcherSubscription {
  root: string;
  globs: string[];
  closed: boolean;
  listener: (change: WatchChange) => void;
}

/** Recording + replayable watcher fake; no real filesystem or timer. */
export class FakeWatcher implements WatcherPort {
  readonly subscriptions: FakeWatcherSubscription[] = [];
  readonly events: WatchChange[] = [];

  subscribe(
    root: string,
    globs: readonly string[],
    listener: (change: WatchChange) => void,
  ): WatchSubscription {
    const subscription: FakeWatcherSubscription = {
      root,
      globs: [...globs],
      closed: false,
      listener,
    };
    this.subscriptions.push(subscription);
    return {
      close: () => {
        subscription.closed = true;
      },
    };
  }

  emit(change: WatchChange): void {
    const normalized = {
      ...change,
      path: change.path.replace(/\\/g, '/').replace(/^\.\//, ''),
    };
    this.events.push(normalized);
    for (const subscription of this.subscriptions) {
      if (!subscription.closed) subscription.listener(normalized);
    }
  }

  replay(changes: readonly WatchChange[]): void {
    for (const change of changes) this.emit(change);
  }
}
