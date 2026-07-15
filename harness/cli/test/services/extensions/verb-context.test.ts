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

  it('ctx.exec forwards timeout and environment options through the port', async () => {
    const exec = new FakeExec();
    const ctx = buildVerbContext(deps({ exec }), { cwd: '/repo', args: {}, options: {} });
    await ctx.exec('node', ['task.js'], {
      timeoutMs: 500,
      env: { FEATURE_FLAG: '1', REMOVE_ME: undefined },
    });
    expect(exec.calls[0]).toEqual({
      command: 'node',
      args: ['task.js'],
      cwd: '/repo',
      timeoutMs: 500,
      env: { FEATURE_FLAG: '1', REMOVE_ME: undefined },
    });
  });

  it('ctx.steps times every step and aggregates fail() without aborting the run', async () => {
    const clock = new FakeClock('2026-07-14T00:00:00.000Z');
    const ctx = buildVerbContext(deps({ clock }), { cwd: '/repo', args: {}, options: {} });
    const steps = ctx.steps?.();
    expect(steps).toBeDefined();
    if (steps === undefined) throw new Error('steps capability missing');

    await steps.run('migrate', () => clock.advance(25));
    await steps.run('seed', () => {
      clock.advance(10);
      steps.fail('seed command failed', { code: 7 });
    });
    await steps.run('verify', async () => {
      await clock.sleep(5);
      return 'verified';
    });

    const result = steps.finish({
      errorCode: 'E_DB_RESET',
      next_action: 'Fix the seed and run db reset again.',
    });
    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'E_DB_RESET',
        details: {
          passed: 2,
          failed: 1,
          summary: '✅ 2 passed · ❌ 1 failed',
          steps: [
            { name: 'migrate', status: 'passed', mark: '✅', durationMs: 25 },
            {
              name: 'seed',
              status: 'failed',
              mark: '❌',
              durationMs: 10,
              message: 'seed command failed',
              details: { code: 7 },
            },
            { name: 'verify', status: 'passed', mark: '✅', durationMs: 5 },
          ],
        },
      },
      next_action: 'Fix the seed and run db reset again.',
    });
  });

  it('ctx.steps finish returns an ok rollup when every step passes', async () => {
    const ctx = buildVerbContext(deps(), { cwd: '/repo', args: {}, options: {} });
    const steps = ctx.steps?.();
    if (steps === undefined) throw new Error('steps capability missing');
    await steps.run('ready', () => true);
    expect(steps.finish()).toMatchObject({
      status: 'ok',
      data: { passed: 1, failed: 0, summary: '✅ 1 passed · ❌ 0 failed' },
    });
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

  it('treats a blank/whitespace next_action as missing on a non-ok result (P5)', () => {
    /*
    Test Doc:
    - Why: P5 guarantees every non-ok envelope tells an agent what to do next; a blank or
      whitespace-only next_action from an author must NOT satisfy that (F007).
    - Contract: degraded/unconfigured/error fall back to the kernel default when next_action is
      blank; the error path also defaults a blank error.message before deriving next_action.
    - Quality Contribution: pins the non-blank enforcement so a degraded result can't ship "  ".
    - Worked Example: degraded with next_action:'   ' → a real default next_action.
    */
    const degraded = finalizeVerbResult(
      { status: 'degraded', data: {}, next_action: '   ' },
      'd',
      new FakeClock(),
    );
    expect(degraded.next_action?.trim().length).toBeGreaterThan(0);

    const unconfigured = finalizeVerbResult(
      { status: 'unconfigured', next_action: '' },
      'u',
      new FakeClock(),
    );
    expect(unconfigured.next_action?.trim().length).toBeGreaterThan(0);

    const blankError = finalizeVerbResult(
      { status: 'error', error: { code: 'E1', message: '' }, next_action: '  ' },
      'e',
      new FakeClock(),
    );
    expect(blankError.next_action?.trim().length).toBeGreaterThan(0);
  });

  it('maps an invalid runtime status to an E141 error envelope (never undefined) (F006)', () => {
    /*
    Test Doc:
    - Why: a plain JS extension can return any string for status; an unhandled status must not
      fall through to `undefined` (which would crash exitWithEnvelope outside runVerb's catch).
    - Contract: finalizeVerbResult maps an out-of-union status → an E141 error Envelope.
    - Quality Contribution: closes the catastrophic-E100 crash path the companion flagged (F006).
    - Worked Example: { status: 'bogus' } → status 'error', code 'E141', with a next_action.
    */
    const env = finalizeVerbResult(
      { status: 'bogus' } as unknown as Parameters<typeof finalizeVerbResult>[0],
      'weird',
      new FakeClock(),
    );
    expect(env).toBeDefined();
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E141');
    expect(env.error?.message).toContain('invalid status');
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
