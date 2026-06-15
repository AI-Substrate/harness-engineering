import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

/**
 * T006B — the banner-reaches-every-emit-path conformance proof (KF-09).
 *
 * The hazard: human-mode acts build BESPOKE inline `{ emit }` ports that bypass
 * `renderHuman`, so decorating `createOutputPort` would miss them. The fix puts
 * the banner on the exit chokepoint (`exitWithEnvelope`), wired in `buildProgram`.
 * These tests drive the fully-wired program (version 9.9.9) with a cache that
 * knows a newer 9.9.10 and assert the banner appears on:
 *   - a BESPOKE human-port act (`doctor`) — the path the naive fix would miss;
 *   - the SHARED createOutputPort human path (bare `harness` orientation);
 *   - JSON output (the additive field) on those same commands.
 * The negative control proves no banner without a newer cached version.
 */

const HOME = '/home/u';
const CACHE_PATH = '/home/u/.harness/update-check.json';
const BANNER = 'update available to 9.9.10 from 9.9.9 — run: harness update\n';

function depsWith(fs: FakeFs, env: FakeEnv): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env,
    git: new FakeGit(),
    clock: new FakeClock('2026-06-15T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

function run(
  argv: string[],
  mode: OutputMode,
  opts: { cacheLatest?: string } = {},
): { out: string; err: string; code: number } {
  const files = opts.cacheLatest
    ? {
        [CACHE_PATH]: JSON.stringify({
          last_success_iso: '2026-06-15T00:00:00.000Z',
          latest: opts.cacheLatest,
        }),
      }
    : {};
  const fs = new FakeFs(files);
  const env = new FakeEnv({}, HOME);
  let out = '';
  let err = '';
  let code = -1;
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
  };
  const io: CliIo = { mode, writers };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  expect(() =>
    buildProgram('9.9.9', io, depsWith(fs, env), { verbs: [], records: [] }).parse([
      'node',
      'harness',
      ...argv,
    ]),
  ).toThrow(/^exit:/);
  return { out, err, code };
}

describe('update banner reaches every emit path (T006B / KF-09)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appears on a BESPOKE human-port act (doctor) — the path the naive fix would miss', () => {
    const { out, err } = run(['doctor'], 'human', { cacheLatest: '9.9.10' });
    expect(err).toContain(BANNER); // bespoke {emit} writes the report to err; banner precedes it
    expect(out).not.toContain('update available'); // banner is stderr-only, never stdout
  });

  it('appears on the SHARED createOutputPort human path (bare orientation)', () => {
    const { err } = run([], 'human', { cacheLatest: '9.9.10' });
    expect(err).toContain(BANNER);
  });

  it('appears as the additive JSON field on doctor --json (no human line)', () => {
    const { out, err } = run(['doctor'], 'json', { cacheLatest: '9.9.10' });
    const env = JSON.parse(out);
    expect(env.update_available).toEqual({
      installed: '9.9.9',
      latest: '9.9.10',
      command: 'harness update',
    });
    expect(err).not.toContain('update available'); // no human line in json mode
  });

  it('does NOT appear when the cached latest is not newer (negative control)', () => {
    const same = run(['doctor'], 'human', { cacheLatest: '9.9.9' });
    expect(same.err).not.toContain('update available');
    const none = run(['doctor'], 'human'); // no cache at all
    expect(none.err).not.toContain('update available');
    const olderJson = run(['doctor'], 'json', { cacheLatest: '9.9.8' });
    expect(JSON.parse(olderJson.out).update_available).toBeUndefined();
  });
});
