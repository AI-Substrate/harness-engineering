import { dirname, join, posix } from 'node:path';
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
import {
  buildExtensionRegistry,
  type VerbRegistry,
} from '../../src/services/extensions/registry.js';

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
const REPO_CORE_CONFLICT = join(here, 'fixtures', 'repo-core-conflict');

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
  const discovery = discoverExtensions(deps.fs, deps.proc);
  return buildExtensionRegistry(discovery.candidates, new JitiLoader(), {
    rejected: discovery.rejected,
  });
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

  it('loads the hello/build/greetjs/subby packages, isolates broken (E140), rejects flat-legacy (E143)', async () => {
    const { registry } = await run(REPO, ['help']);
    // Two-segment form via posix basename/dirname — entryPath is a POSIX
    // logical path on every OS (plan 017 AC-5), never re-split on raw '/'.
    const byStatus = (s: string) =>
      registry.records
        .filter((r) => r.status === s)
        .map((r) =>
          posix.join(posix.basename(posix.dirname(r.entryPath)), posix.basename(r.entryPath)),
        );
    expect(registry.verbs.map((v) => v.name).sort()).toEqual([
      'build',
      'greetjs',
      'hello',
      'subby',
    ]);
    expect(byStatus('loaded').sort()).toEqual([
      'build/extension.ts',
      'greetjs/extension.js',
      'hello/extension.ts',
      'subby/extension.ts',
    ]);
    expect(byStatus('failed').sort()).toEqual(['broken/extension.ts', 'extensions/flat-legacy.ts']);
    const broken = registry.records.find((r) => r.entryPath.endsWith('broken/extension.ts'));
    expect(broken?.error).toContain('E140');
    expect(broken?.error).toContain('boom');
  });

  it('the flat-legacy fixture is REJECTED with E143 and its verb never registers (AC-6, permanent)', async () => {
    const { registry } = await run(REPO, ['help']);
    expect(registry.verbs.map((v) => v.name)).not.toContain('flat-legacy');
    const flat = registry.records.find((r) => r.entryPath.endsWith('flat-legacy.ts'));
    expect(flat?.status).toBe('failed');
    expect(flat?.error).toContain('E143');
    expect(flat?.error).toContain('unsupported flat layout — move to flat-legacy/extension.ts');
  });

  it('subby runs — its entry imports ./lib/helper.ts from a subfolder via real jiti (AC-14)', async () => {
    /*
    Test Doc:
    - Why: extensions are little packages — free-form internals imported relatively must load
      through the REAL jiti loader (plan 014 AC-14; Finding 05 said this was unproven).
    - Contract: subby/extension.ts imports craftGreeting from ./lib/helper.ts and runs to ok.
    - Quality Contribution: the early sensor for the T012 production split (lib/worker-io.ts).
    */
    const { out, code } = await run(REPO, ['subby']);
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data.greeting).toBe('hello from the subfolder helper');
    expect(code).toBe(0);
  });

  it('help --json marks hello has_instructions:true (briefing fixture) and build false', async () => {
    const { out } = await run(REPO, ['help']);
    const verbs = JSON.parse(out).data.verbs as { name: string; has_instructions: boolean }[];
    expect(verbs.find((v) => v.name === 'hello')?.has_instructions).toBe(true);
    expect(verbs.find((v) => v.name === 'build')?.has_instructions).toBe(false);
  });

  it('harness instructions hello serves the fixture briefing end-to-end', async () => {
    const { out, code } = await run(REPO, ['instructions', 'hello']);
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data.instructions).toContain('Fixture briefing');
    expect(code).toBe(0);
  });

  it('runs the hello verb → ok envelope, exit 0', async () => {
    const { out, code } = await run(REPO, ['hello', '--name', 'pi']);
    const env = JSON.parse(out);
    expect(env.command).toBe('hello');
    expect(env.status).toBe('ok');
    expect(env.data.greeting).toBe('hello, pi');
    expect(code).toBe(0);
  });

  it('runs a plain .js extension (JSDoc contract, no runtime import) → ok, exit 0 (D4)', async () => {
    /*
    Test Doc:
    - Why: plan D4 promises a plain-.js author can extend the harness with NO runtime dependency on
      the core — referencing the contract via a JSDoc @type only. This proves that end-to-end via the
      native import() fast path (not jiti), closing the validation evidence gap.
    - Contract: a .js default-export HarnessVerb loads, registers, and runs to an ok Envelope, exit 0.
    - Quality Contribution: pins the .js authoring path the docs/contract claim but no other test proved.
    - Worked Example: `harness greetjs` → { greeting: 'hi from a .js extension' }, exit 0.
    */
    const { out, code } = await run(REPO, ['greetjs']);
    const env = JSON.parse(out);
    expect(env.command).toBe('greetjs');
    expect(env.status).toBe('ok');
    expect(env.data.greeting).toBe('hi from a .js extension');
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
    const winner = registry.records.find((r) => r.entryPath.endsWith('alpha/extension.ts'));
    const shadowed = registry.records.find((r) => r.entryPath.endsWith('beta/extension.ts'));
    if (shadowed === undefined) throw new Error('missing beta collision record');
    expect(winner?.status).toBe('loaded');
    expect(shadowed?.status).toBe('conflict');
    expect(shadowed?.shadows).toEqual(['greet']);
    expect(shadowed?.error).toContain('E142');
    expect(shadowed?.error).toContain('earlier extension registration');
    expect(shadowed?.error).toContain(posix.dirname(shadowed.entryPath));
  });

  it('the winning conflict verb runs (alpha), not the shadowed one (beta)', async () => {
    const { out, code } = await run(REPO_CONFLICT, ['greet']);
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data.from).toBe('alpha');
    expect(code).toBe(0);
  });

  it('skips a core-name collision, keeps the CLI usable, and names both inspected sides', async () => {
    /*
    Test Doc:
    - Why: a repo extension named after a newly-added core verb must not make every CLI command
      fail while Commander assembles the command tree.
    - Contract: core `convo` wins; the losing extension directory is reported as an E142 conflict;
      the healthy sibling extension and every core command remain registered.
    - Quality Contribution: pins the live failure mode with a real on-disk fixture and jiti loader.
    - Worked Example: `harness doctor` is degraded but usable, then `harness healthy` still succeeds.
    */
    const doctor = await run(REPO_CORE_CONFLICT, ['doctor']);
    const env = JSON.parse(doctor.out);
    const collision = env.data.extensions.find((extension: { entryPath: string }) =>
      extension.entryPath.endsWith('/convo/extension.ts'),
    );

    expect(doctor.code).toBe(0);
    expect(env.status).toBe('degraded');
    expect(collision.status).toBe('conflict');
    expect(collision.shadows).toEqual(['convo']);
    expect(collision.error).toContain("core command 'convo'");
    expect(collision.error).toContain(posix.dirname(collision.entryPath));
    expect(collision.error).toContain('skipped colliding registration');
    expect(doctor.registry.verbs.map((verb) => verb.name)).toEqual(['healthy']);

    const program = buildProgram(
      '9.9.9',
      { mode: 'json', writers: { out: () => {}, err: () => {} } },
      realDeps(REPO_CORE_CONFLICT),
      doctor.registry,
    );
    expect(program.commands.map((command) => command.name())).toContain('convo');

    const healthy = await run(REPO_CORE_CONFLICT, ['healthy']);
    expect(healthy.code).toBe(0);
    expect(JSON.parse(healthy.out).data.from).toBe('healthy-extension');
  });

  it('doctor enumerates the fixtures (loaded + failed + convention wails) without invoking them', async () => {
    const { out } = await run(REPO, ['doctor']);
    const env = JSON.parse(out);
    expect(env.command).toBe('doctor');
    const ext = env.data.layers.find((l: { name: string }) => l.name === 'extensions');
    expect(ext.detail).toContain('4 loaded');
    expect(ext.detail).toContain('2 failed');
    // hello carries a briefing; build/greetjs/subby do not → 3 convention wails (D2).
    expect(ext.detail).toContain('3 missing instructions.md');
    const folders = (env.data.conventions as { folder: string }[]).map((c) =>
      posix.basename(c.folder),
    );
    expect(folders?.sort()).toEqual(['build', 'greetjs', 'subby']);
    expect(env.status).toBe('degraded');
  });
});
