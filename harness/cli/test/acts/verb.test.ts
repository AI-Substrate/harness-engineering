import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerVerbAct, type VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo } from '../../src/output/output-port.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';

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

async function invoke(
  verb: HarnessVerb,
  argv: string[],
  actDeps: VerbActDeps = deps(),
): Promise<{ out: string; code: number }> {
  let out = '';
  let code = -1;
  const writers = {
    out: (t: string) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness').exitOverride();
  registerVerbAct(program, verb, actDeps, io);
  await expect(program.parseAsync(['node', 'harness', ...argv])).rejects.toThrow(/^exit:/);
  return { out, code };
}

describe('registerVerbAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a subcommand whose --help reflects summary, options, and args', () => {
    /*
    Test Doc:
    - Why: each extension verb becomes a first-class `harness <verb>` with its own --help
      (AC-1/AC-2); the act is the thin bridge from a HarnessVerb to a commander subcommand.
    - Contract: registerVerbAct adds program.command(verb.name) with the verb's description,
      options, and args; the action builds ctx, awaits run, finalizes, and exits via the kernel.
    - Usage Notes: returns the created Command so help/usage is inspectable.
    - Quality Contribution: pins registration + --help surface + exit mapping.
    - Worked Example: a 'greet <name>' verb with a --loud option shows both in helpInformation().
    */
    const verb: HarnessVerb = {
      name: 'greet',
      summary: 'Greet someone.',
      description: 'Print a greeting for the named person.',
      args: [{ name: '<name>', description: 'who to greet' }],
      options: [{ flags: '--loud', description: 'shout it' }],
      run: (ctx) => ctx.ok({ name: ctx.args.name }),
    };
    const program = new Command().name('harness').exitOverride();
    const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };
    const cmd = registerVerbAct(program, verb, deps(), io);
    const help = cmd.helpInformation();
    expect(help).toContain('--loud');
    expect(help).toContain('shout it');
    expect(help).toContain('name');
    expect(help).toContain('Print a greeting');
  });

  it('groups the verb under the `Extensions:` help heading (separate from core)', () => {
    /*
    Test Doc:
    - Why: contributed verbs must read as a distinct `--help` section, not intermixed with the
      fixed core commands — the core/extension split is the whole legibility win.
    - Contract: registerVerbAct sets command.helpGroup('Extensions:') on every verb it registers.
    - Quality Contribution: pins the grouping so a future refactor can't silently re-flatten it.
    */
    const verb: HarnessVerb = { name: 'greet', summary: 'Greet.', run: () => ({ status: 'ok' }) };
    const program = new Command().name('harness').exitOverride();
    const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };
    const cmd = registerVerbAct(program, verb, deps(), io);
    expect(cmd.helpGroup()).toBe('Extensions:');
  });

  it('parses options + args and passes them to the handler via ctx', async () => {
    const seen: { args?: unknown; options?: unknown } = {};
    const verb: HarnessVerb = {
      name: 'greet',
      summary: 's',
      args: [{ name: '<name>', description: 'who' }],
      options: [{ flags: '--loud', description: 'shout' }],
      run: (ctx) => {
        seen.args = ctx.args;
        seen.options = ctx.options;
        return ctx.ok({ ok: true });
      },
    };
    const { out, code } = await invoke(verb, ['greet', 'world', '--loud']);
    expect(seen.args).toEqual({ name: 'world' });
    expect(seen.options).toEqual({ loud: true });
    expect(JSON.parse(out).command).toBe('greet');
    expect(code).toBe(0);
  });

  it('maps status → exit code (ok/degraded 0, unconfigured 2, error 1)', async () => {
    const mk = (status: 'ok' | 'degraded' | 'unconfigured' | 'error'): HarnessVerb => ({
      name: 'v',
      summary: 's',
      run: (ctx) => {
        if (status === 'ok') return ctx.ok({});
        if (status === 'degraded') return ctx.degraded({}, 'caveat');
        if (status === 'unconfigured') return ctx.unconfigured('map it');
        return ctx.error('E1', 'boom');
      },
    });
    expect((await invoke(mk('ok'), ['v'])).code).toBe(0);
    expect((await invoke(mk('degraded'), ['v'])).code).toBe(0);
    expect((await invoke(mk('unconfigured'), ['v'])).code).toBe(2);
    expect((await invoke(mk('error'), ['v'])).code).toBe(1);
  });

  it('runs the handler with the process cwd and awaits async work', async () => {
    const exec = new FakeExec({ 'npm run build': { code: 0 } });
    const verb: HarnessVerb = {
      name: 'build',
      summary: 's',
      run: async (ctx) => {
        const r = await ctx.exec('npm', ['run', 'build']);
        return r.ok ? ctx.ok({ built: true }) : ctx.error('E1', 'fail');
      },
    };
    const { out, code } = await invoke(verb, ['build'], deps({ exec }));
    expect(JSON.parse(out).status).toBe('ok');
    expect(exec.calls[0]?.cwd).toBe('/repo');
    expect(code).toBe(0);
  });
});
