import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { cachePath, readCache, writeCache } from '../../../src/services/update/cache.js';

const HOME = '/home/u';
const PATH = '/home/u/.harness/update-check.json';

describe('cachePath', () => {
  it('places the cache under <home>/.harness, never the repo cwd', () => {
    /*
    Test Doc:
    - Why: the update cache is user-global (AC6) — one shared file, not per-repo.
    - Contract: cachePath = <home>/.harness/update-check.json; null if home unresolved.
    - Usage Notes: home comes from EnvPort.home(), never os.homedir().
    - Quality Contribution: pins the cache location so it can't drift into cwd/.harness.
    - Worked Example: home '/home/u' ⇒ '/home/u/.harness/update-check.json'.
    */
    expect(cachePath(new FakeEnv({}, HOME))).toBe(PATH);
    expect(cachePath(new FakeEnv())).toBeNull();
  });
});

describe('readCache', () => {
  it('returns null when the file is missing', () => {
    expect(readCache(new FakeFs(), new FakeEnv({}, HOME))).toBeNull();
  });

  it('returns null when home is unresolved (and does not read fs)', () => {
    const fs = new FakeFs();
    expect(readCache(fs, new FakeEnv())).toBeNull();
    expect(fs.reads).toEqual([]);
  });

  it('parses a valid cache record', () => {
    const fs = new FakeFs({
      [PATH]: '{"last_success_iso":"2026-06-15T00:00:00.000Z","latest":"0.3.0"}',
    });
    expect(readCache(fs, new FakeEnv({}, HOME))).toEqual({
      last_success_iso: '2026-06-15T00:00:00.000Z',
      latest: '0.3.0',
    });
  });

  it('accepts a null latest (registry returned none)', () => {
    const fs = new FakeFs({
      [PATH]: '{"last_success_iso":"2026-06-15T00:00:00.000Z","latest":null}',
    });
    expect(readCache(fs, new FakeEnv({}, HOME))?.latest).toBeNull();
  });

  it('returns null on corrupt JSON or wrong shape — never throws', () => {
    const env = new FakeEnv({}, HOME);
    expect(readCache(new FakeFs({ [PATH]: 'not json' }), env)).toBeNull();
    expect(readCache(new FakeFs({ [PATH]: '{"latest":"0.3.0"}' }), env)).toBeNull(); // missing ts
    expect(readCache(new FakeFs({ [PATH]: '"a string"' }), env)).toBeNull();
    expect(
      readCache(new FakeFs({ [PATH]: '{"last_success_iso":1,"latest":"x"}' }), env),
    ).toBeNull();
  });
});

describe('writeCache', () => {
  it('writes JSON under <home>/.harness and round-trips via readCache', () => {
    const fs = new FakeFs();
    const env = new FakeEnv({}, HOME);
    writeCache(fs, env, { last_success_iso: '2026-06-15T00:00:00.000Z', latest: '0.3.0' });
    expect(fs.mkdirs).toContain('/home/u/.harness');
    expect(fs.writes).toEqual([PATH]);
    expect(readCache(fs, env)).toEqual({
      last_success_iso: '2026-06-15T00:00:00.000Z',
      latest: '0.3.0',
    });
  });

  it('is a no-op when home is unresolved', () => {
    const fs = new FakeFs();
    writeCache(fs, new FakeEnv(), {
      last_success_iso: '2026-06-15T00:00:00.000Z',
      latest: '0.3.0',
    });
    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
  });
});
