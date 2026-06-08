import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import type { HarnessVerb } from '../../../src/services/extensions/contract.js';
import {
  buildVerbContext,
  finalizeVerbResult,
  runVerb,
  type VerbContextDeps,
} from '../../../src/services/extensions/verb-context.js';

function deps(overrides: Partial<VerbContextDeps> = {}): VerbContextDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv(),
    git: new FakeGit(),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    ...overrides,
  };
}

describe('buildVerbContext', () => {
  it('exposes_cwd_args_options_ports_and_envelope_helpers', async () => {
    /*
    Test Doc:
    - Why: authors write handlers against ctx alone; ctx must surface the injected ports +
      envelope helpers so a verb never imports the kernel (WS-A Decision 3, AC-3/AC-4).
    - Contract: ctx carries cwd/args/options; ctx.exec wraps ExecPort (cwd defaults to ctx.cwd);
      fs/env/git/clock are the injected ports; ok/degraded/unconfigured/error return VerbResults.
    - Usage Notes: built per-invocation by the composition root from real ports.
    - Quality Contribution: pins the author-facing surface + the exec cwd default.
    - Worked Example: ctx.exec('npm',['run','build']) records cwd = ctx.cwd.
    */
    const exec = new FakeExec({ 'npm run build': { code: 0, stdout: 'ok' } });
    const ctx = buildVerbContext(deps({ exec }), {
      cwd: '/repo',
      args: { target: 'x' },
      options: { name: 'pi' },
    });
    expect(ctx.cwd).toBe('/repo');
    expect(ctx.args).toEqual({ target: 'x' });
    expect(ctx.options).toEqual({ name: 'pi' });

    const result = await ctx.exec('npm', ['run', 'build']);
    expect(result.ok).toBe(true);
    expect(exec.calls[0]).toEqual({ command: 'npm', args: ['run', 'build'], cwd: '/repo' });

    expect(ctx.ok({ a: 1 }).status).toBe('ok');
    expect(ctx.degraded({ a: 1 }, 'do x').next_action).toBe('do x');
    expect(ctx.unconfigured('map it').status).toBe('unconfigured');
    expect(ctx.error('E1', 'boom').error?.code).toBe('E1');
  });

  it('ctx.exec honours an explicit cwd override', async () => {
    const exec = new FakeExec();
    const ctx = buildVerbContext(deps({ exec }), { cwd: '/repo', args: {}, options: {} });
    await ctx.exec('ls', [], { cwd: '/other' });
    expect(exec.calls[0]?.cwd).toBe('/other');
  });

  it('ctx.fs/env/git read through the injected ports', () => {
    const fs = new FakeFs({ '/repo/x': 'hi' }, { '/repo': ['x'] });
    const git = new FakeGit({ isRepo: true, branch: 'main' });
    const ctx = buildVerbContext(deps({ fs, git }), { cwd: '/repo', args: {}, options: {} });
    expect(ctx.fs.readText('/repo/x')).toBe('hi');
    expect(ctx.fs.readdir('/repo')).toEqual(['x']);
    expect(ctx.git.currentBranch()).toBe('main');
  });
});

describe('finalizeVerbResult', () => {
  it('adds command + timestamp for an ok result', () => {
    const env = finalizeVerbResult(
      { status: 'ok', data: { greeting: 'hi' } },
      'hello',
      new FakeClock('2026-06-08T07:20:00.000Z'),
    );
    expect(env.command).toBe('hello');
    expect(env.status).toBe('ok');
    expect(env.timestamp).toBe('2026-06-08T07:20:00.000Z');
    expect(env.data).toEqual({ greeting: 'hi' });
  });

  it('enforces a next_action on a non-ok result that omits one', () => {
    const env = finalizeVerbResult(
      { status: 'error', error: { code: 'E1', message: 'boom' } },
      'x',
      new FakeClock(),
    );
    expect(env.status).toBe('error');
    expect(env.next_action).toBeDefined();
    expect(env.next_action?.length).toBeGreaterThan(0);
  });
});

describe('runVerb', () => {
  it('finalizes a returned VerbResult into a command-stamped envelope', async () => {
    const verb: HarnessVerb = { name: 'hello', summary: 's', run: (ctx) => ctx.ok({ hi: true }) };
    const ctx = buildVerbContext(deps(), { cwd: '/repo', args: {}, options: {} });
    const env = await runVerb(verb, ctx, new FakeClock());
    expect(env.command).toBe('hello');
    expect(env.status).toBe('ok');
  });

  it('isolates a handler throw as an E141 error envelope without a raw stack', async () => {
    const verb: HarnessVerb = {
      name: 'boom',
      summary: 's',
      run: () => {
        throw new Error('kaboom');
      },
    };
    const ctx = buildVerbContext(deps(), { cwd: '/repo', args: {}, options: {} });
    const env = await runVerb(verb, ctx, new FakeClock());
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E141');
    expect(env.command).toBe('boom');
    expect(env.error?.message).toContain('kaboom');
    expect(env.error?.message).not.toContain('    at '); // no stack frames leaked
    expect(env.next_action).toBeDefined();
  });

  it('awaits an async handler', async () => {
    const verb: HarnessVerb = {
      name: 'a',
      summary: 's',
      run: async (ctx) => ctx.ok({ done: true }),
    };
    const env = await runVerb(
      verb,
      buildVerbContext(deps(), { cwd: '/r', args: {}, options: {} }),
      new FakeClock(),
    );
    expect(env.status).toBe('ok');
  });
});
