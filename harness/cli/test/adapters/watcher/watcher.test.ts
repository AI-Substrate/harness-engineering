import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeWatcher } from '../../../src/adapters/watcher/fake-watcher.js';
import { NodeWatcher, type WatchFactory } from '../../../src/adapters/watcher/node-watcher.js';

describe('watcher adapters', () => {
  it('records, replays, normalizes Windows separators, and stops a fake subscription', () => {
    const watcher = new FakeWatcher();
    const seen: string[] = [];
    const subscription = watcher.subscribe('/repo', ['src/**/*.ts'], (event) => {
      seen.push(event.path);
    });
    watcher.replay([
      { path: '.\\src\\a.ts', contentHash: 'a' },
      { path: 'src/b.ts', contentHash: 'b' },
    ]);
    subscription.close();
    watcher.emit({ path: 'src/c.ts', contentHash: 'c' });

    expect(watcher.subscriptions[0]).toMatchObject({
      root: '/repo',
      globs: ['src/**/*.ts'],
      closed: true,
    });
    expect(seen).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('smoke-covers recursive Node wiring, content hashing, POSIX paths, and close', () => {
    let nativeListener: Parameters<WatchFactory>[2] | undefined;
    let recursive = false;
    let closed = false;
    const watcher = new NodeWatcher({
      watch: (_root, options, listener) => {
        recursive = options.recursive;
        nativeListener = listener;
        return {
          close: () => {
            closed = true;
          },
        };
      },
      readFile: () => Buffer.from('typed source'),
    });
    const seen: Array<{ path: string; contentHash: string }> = [];
    const subscription = watcher.subscribe('/repo', ['src/**/*.ts'], (event) => seen.push(event));
    nativeListener?.('change', 'src\\a.ts');

    expect(recursive).toBe(true);
    expect(seen).toEqual([
      {
        path: 'src/a.ts',
        contentHash: createHash('sha256').update('typed source').digest('hex'),
      },
    ]);
    subscription.close();
    expect(closed).toBe(true);
  });
});
