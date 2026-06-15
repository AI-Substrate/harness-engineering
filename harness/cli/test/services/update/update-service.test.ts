import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeVersionLookup } from '../../../src/adapters/version-lookup/fake-version-lookup.js';
import { readCache } from '../../../src/services/update/cache.js';
import {
  bannerFromCache,
  CHECK_WINDOW_MS,
  isDue,
  runCheck,
  toUpdateAvailable,
} from '../../../src/services/update/update-service.js';

const HOME = '/home/u';
const PATH = '/home/u/.harness/update-check.json';
const T0 = '2026-06-15T00:00:00.000Z';

function cacheJson(iso: string, latest: string | null): Record<string, string> {
  return { [PATH]: JSON.stringify({ last_success_iso: iso, latest }) };
}

describe('toUpdateAvailable', () => {
  it('builds the field only when latest is strictly newer, pinning the command', () => {
    expect(toUpdateAvailable('0.2.0', '0.3.0')).toEqual({
      installed: '0.2.0',
      latest: '0.3.0',
      command: 'harness update',
    });
    expect(toUpdateAvailable('0.3.0', '0.3.0')).toBeNull();
    expect(toUpdateAvailable('0.3.0', '0.2.0')).toBeNull();
    expect(toUpdateAvailable('0.2.0', null)).toBeNull();
  });
});

describe('bannerFromCache (sync hot-path source)', () => {
  it('returns the notice from last-known cache without any lookup', () => {
    /*
    Test Doc:
    - Why: every command exit shows the banner from a single SYNC cache read (AC9), no network.
    - Contract: bannerFromCache returns update_available iff cache.latest is newer than installed.
    - Usage Notes: pure FsPort+EnvPort read; the async refresh lives elsewhere.
    - Quality Contribution: guarantees zero hot-path latency / no await.
    - Worked Example: cache latest 0.3.0, installed 0.2.0 ⇒ notice.
    */
    const fs = new FakeFs(cacheJson(T0, '0.3.0'));
    expect(bannerFromCache(fs, new FakeEnv({}, HOME), '0.2.0')).toEqual({
      installed: '0.2.0',
      latest: '0.3.0',
      command: 'harness update',
    });
    expect(bannerFromCache(new FakeFs(), new FakeEnv({}, HOME), '0.2.0')).toBeNull(); // no cache
  });
});

describe('isDue', () => {
  it('throttles to the 24h window, fresh on clock-backwards, due on corrupt ts', () => {
    expect(isDue(T0, T0)).toBe(false); // zero elapsed
    expect(isDue('2026-06-15T23:59:59.000Z', T0)).toBe(false); // just under 24h
    expect(isDue('2026-06-16T00:00:00.000Z', T0)).toBe(true); // exactly 24h
    expect(isDue('2026-06-16T00:00:01.000Z', T0)).toBe(true); // just over
    expect(isDue('2026-06-14T00:00:00.000Z', T0)).toBe(false); // clock backwards ⇒ fresh
    expect(isDue(T0, 'not-a-date')).toBe(true); // corrupt cached ts ⇒ due
    expect(CHECK_WINDOW_MS).toBe(86400000);
  });
});

describe('runCheck', () => {
  const deps = (fs: FakeFs, clockIso: string, lookup: FakeVersionLookup) => ({
    fs,
    env: new FakeEnv({}, HOME),
    clock: new FakeClock(clockIso),
    lookup,
  });

  it('within the window makes ZERO lookups and reports last-known', async () => {
    const fs = new FakeFs(cacheJson(T0, '0.3.0'));
    const lookup = new FakeVersionLookup('0.4.0');
    const result = await runCheck(deps(fs, '2026-06-15T06:00:00.000Z', lookup), '0.2.0');
    expect(lookup.calls).toBe(0);
    expect(result.checked).toBe(false);
    expect(result.latest).toBe('0.3.0');
    expect(result.update_available?.latest).toBe('0.3.0');
  });

  it('past the window does ONE lookup, advancing the cache on success', async () => {
    const fs = new FakeFs(cacheJson(T0, '0.3.0'));
    const lookup = new FakeVersionLookup('0.4.0');
    const result = await runCheck(deps(fs, '2026-06-16T06:00:00.000Z', lookup), '0.2.0');
    expect(lookup.calls).toBe(1);
    expect(result).toMatchObject({ latest: '0.4.0', checked: true, refreshed: true });
    expect(readCache(fs, new FakeEnv({}, HOME))).toEqual({
      last_success_iso: '2026-06-16T06:00:00.000Z',
      latest: '0.4.0',
    });
  });

  it('force ignores the throttle even when the cache is fresh', async () => {
    const fs = new FakeFs(cacheJson(T0, '0.3.0'));
    const lookup = new FakeVersionLookup('0.4.0');
    const result = await runCheck(deps(fs, T0, lookup), '0.2.0', { force: true });
    expect(lookup.calls).toBe(1);
    expect(result.latest).toBe('0.4.0');
  });

  it('first run with no cache is due and looks up', async () => {
    const fs = new FakeFs();
    const lookup = new FakeVersionLookup('0.3.0');
    const result = await runCheck(deps(fs, T0, lookup), '0.2.0');
    expect(lookup.calls).toBe(1);
    expect(result.update_available?.latest).toBe('0.3.0');
  });

  it('a failed lookup keeps the cache and lets a known update survive (AC9)', async () => {
    const fs = new FakeFs(cacheJson(T0, '0.3.0'));
    const lookup = new FakeVersionLookup(null, new Error('E401 Unauthorized'));
    const result = await runCheck(deps(fs, '2026-06-17T00:00:00.000Z', lookup), '0.2.0');
    expect(lookup.calls).toBe(1);
    expect(result).toMatchObject({ latest: '0.3.0', checked: true, refreshed: false });
    expect(result.update_available?.latest).toBe('0.3.0'); // known update still shown
    // cache ts NOT advanced, latest preserved
    expect(readCache(fs, new FakeEnv({}, HOME))).toEqual({ last_success_iso: T0, latest: '0.3.0' });
    expect(fs.writes).toEqual([]);
  });

  it('an empty (null) lookup is treated like a failure — cache preserved', async () => {
    const fs = new FakeFs(cacheJson(T0, '0.3.0'));
    const lookup = new FakeVersionLookup(null);
    const result = await runCheck(deps(fs, '2026-06-17T00:00:00.000Z', lookup), '0.2.0');
    expect(result.refreshed).toBe(false);
    expect(result.latest).toBe('0.3.0');
    expect(fs.writes).toEqual([]);
  });
});
