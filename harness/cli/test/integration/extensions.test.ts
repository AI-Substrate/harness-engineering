import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { SystemClock } from '../../src/adapters/clock/system-clock.js';
import { NodeEnv } from '../../src/adapters/env/node-env.js';
import { NodeExec } from '../../src/adapters/exec/node-exec.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { ExecGit } from '../../src/adapters/git/exec-git.js';
import { JitiLoader } from '../../src/adapters/loader/jiti-loader.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { discoverExtensions } from '../../src/services/extensions/discovery.js';
import { buildVerbRegistry, type VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * End-to-end integration through REAL jiti: discover + load on-disk fixture
 * extensions from a fixture repo's `.harness/extensions/`, then drive the
 * fully-wired composition root and assert the Envelope + exit code. We drive
 * `buildProgram(...).parseAsync(...)` directly (not `main`) so the mocked
 * `process.exit` throw propagates straight to the test — exactly ONE envelope is
 * written (avoiding the mocked-exit double-catch that wrapping `main` would
 * cause).
 */
const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, 'fixtures', 'repo');
const REPO_CONFLICT = join(here, 'fixtures', 'repo-conflict');

/** Real adapters, but cwd is the fixture repo (so discovery scans its .harness/). */
function realDeps(cwd: string): VerbActDeps {
  return {
    exec: new NodeExec(),
    fs: new NodeFs(),
    env: new NodeEnv(),
    git: new ExecGit(),
    clock: new SystemClock(),
    proc: new FakeProcess({}, cwd),
  };
}

async function loadFixtureRegistry(deps: VerbActDeps): Promise<VerbRegistry> {
  const candidates = discoverExtensions(deps.fs, deps.proc);
  return buildVerbRegistry(candidates, new JitiLoader());
}

async function run(
  cwd: string,
  argv: string[],
  mode: OutputMode = 'json',
): Promise<{ out: string; err: string; code: number; registry: VerbRegistry }> {
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
  const deps = realDeps(cwd);
  const registry = await loadFixtureRegistry(deps);
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('9.9.9', io, deps, registry).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  return { out, err, code, registry };
}

describe('extension system — end-to-end via real jiti fixtures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads hello + build, isolates the broken extension (E140)', async () => {
    const { registry } = await run(REPO, ['help']);
    const byStatus = (s: string) =>
      registry.records.filter((r) => r.status === s).map((r) => r.entryPath.split('/').pop());
    expect(registry.verbs.map((v) => v.name).sort()).toEqual(['build', 'hello']);
    expect(byStatus('loaded').sort()).toEqual(['build.ts', 'hello.ts']);
    expect(byStatus('failed')).toEqual(['broken.ts']);
    const broken = registry.records.find((r) => r.entryPath.endsWith('broken.ts'));
    expect(broken?.error).toContain('E140');
    expect(broken?.error).toContain('boom');
  });

  it('runs the hello verb → ok envelope, exit 0', async () => {
    const { out, code } = await run(REPO, ['hello', '--name', 'pi']);
    const env = JSON.parse(out);
    expect(env.command).toBe('hello');
    expect(env.status).toBe('ok');
    expect(env.data.greeting).toBe('hello, pi');
    expect(code).toBe(0);
  });

  it('hello --help reflects the verb options', async () => {
    // --help makes commander throw helpDisplayed; buildProgram has exitOverride,
    // so capture via the program directly here.
    const deps = realDeps(REPO);
    const registry = await loadFixtureRegistry(deps);
    let help = '';
    const io: CliIo = { mode: 'json', writers: { out: (t) => (help += t), err: () => {} } };
    const program = buildProgram('9.9.9', io, deps, registry);
    const helloCmd = program.commands.find((c) => c.name() === 'hello');
    expect(helloCmd?.helpInformation()).toContain('--name');
  });

  it('build verb wraps a real command (success) → ok, exit 0', async () => {
    const { out, code } = await run(REPO, ['build']);
    const env = JSON.parse(out);
    expect(env.command).toBe('build');
    expect(env.status).toBe('ok');
    expect(env.data.stdout).toBe('built');
    expect(code).toBe(0);
  });

  it('build verb maps a failing real command → error, exit 1', async () => {
    const { out, code } = await run(REPO, ['build', '--fail']);
    const env = JSON.parse(out);
    expect(env.command).toBe('build');
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E1');
    expect(code).toBe(1);
  });

  it('first-sorted extension wins a verb conflict; the duplicate is recorded (E142)', async () => {
    const { registry } = await run(REPO_CONFLICT, ['help']);
    expect(registry.verbs.map((v) => v.name)).toEqual(['greet']);
    const winner = registry.records.find((r) => r.entryPath.endsWith('alpha.ts'));
    const shadowed = registry.records.find((r) => r.entryPath.endsWith('beta.ts'));
    expect(winner?.status).toBe('loaded');
    expect(shadowed?.status).toBe('conflict');
    expect(shadowed?.shadows).toEqual(['greet']);
    expect(shadowed?.error).toContain('E142');
  });

  it('the winning conflict verb runs (alpha), not the shadowed one (beta)', async () => {
    const { out, code } = await run(REPO_CONFLICT, ['greet']);
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data.from).toBe('alpha');
    expect(code).toBe(0);
  });

  it('doctor enumerates the fixtures (loaded + failed) without invoking them', async () => {
    const { out } = await run(REPO, ['doctor']);
    const env = JSON.parse(out);
    expect(env.command).toBe('doctor');
    const ext = env.data.layers.find((l: { name: string }) => l.name === 'extensions');
    expect(ext.detail).toContain('2 loaded');
    expect(ext.detail).toContain('1 failed');
  });
});
