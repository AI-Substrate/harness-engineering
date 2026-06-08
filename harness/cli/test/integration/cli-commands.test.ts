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
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * Integration: drive the fully-wired composition root (every act registered
 * together) and assert the envelope + exit code for the core commands. Output is
 * captured via injected writers; the single exit point (exit.ts) is spied.
 * (Extension-verb end-to-end behaviour with real jiti fixtures lives in
 * extensions.test.ts — T026.)
 */
function deps(overrides: Partial<VerbActDeps> = {}): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv(),
    git: new FakeGit(),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
    ...overrides,
  };
}

function harness(
  argv: string[],
  mode: OutputMode,
  registry: VerbRegistry = { verbs: [], records: [] },
): { out: string; err: string; code: number } {
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
    buildProgram('9.9.9', io, deps(), registry).parse(['node', 'harness', ...argv]),
  ).toThrow(/^exit:/);
  return { out, err, code };
}

describe('CLI integration (core commands)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('help --json → ok envelope, exit 0', () => {
    const { out, code } = harness(['help'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('help');
    expect(env.status).toBe('ok');
    expect(code).toBe(0);
  });

  it('doctor → degraded/ok layered report, exit 0', () => {
    const { out, code } = harness(['doctor'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('doctor');
    expect(['degraded', 'ok']).toContain(env.status);
    expect(code).toBe(0);
  });

  it('bare harness → orientation ok envelope, exit 0', () => {
    const { out, code } = harness([], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('harness');
    expect(env.status).toBe('ok');
    expect(env.data.version).toBe('9.9.9');
    expect(code).toBe(0);
  });

  it('doctor (human) → layered report on stderr, summary on stdout, exit 0', () => {
    const { out, err, code } = harness(['doctor'], 'human');
    expect(err).toContain('toolchain');
    expect(out).toContain('doctor:');
    expect(code).toBe(0);
  });
});
