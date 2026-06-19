import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../harness/cli/src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../harness/cli/src/adapters/env/fake-env.js';
import { FakeBackground } from '../../../harness/cli/src/adapters/exec/fake-background.js';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../harness/cli/src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../harness/cli/src/services/extensions/verb-context.js';
import vhf from './extension.ts';

/*
Test Doc:
- Why: plan 031 F006 — the flow verb previously had only pure lib/worker-io.ts
  tests; its E_CORE_TOO_OLD guard, the detached fire via ctx.background, and the
  capture-timeout → degraded envelope mapping were proven only by parity with the
  sibling verb. This is the whole-verb proof, on fakes, on ubuntu.
- Contract: run(ctx) fires `minih run <slug>` via the background PORT (no shell),
  returns degraded when the run-id capture times out, and refuses (E_CORE_TOO_OLD)
  when the core lacks the new ports.
*/

const SLUG = 'validate-harness-flow';

function buildCtx(
  execScripts: Record<string, { code: number; stdout?: string }>,
  options: Record<string, unknown> = { repo: ['https://github.com/x/solo.git'] },
) {
  const exec = new FakeExec(execScripts);
  const fs = new FakeFs();
  const background = new FakeBackground();
  const ctx = buildVerbContext(
    {
      exec,
      fs,
      fsWrite: fs,
      background,
      env: new FakeEnv(),
      git: new FakeGit({ isRepo: true, branch: 'main' }),
      clock: new FakeClock('2026-06-19T00:00:00.000Z'),
    },
    { cwd: '/repo', args: {}, options },
  );
  return { ctx, exec, background, fs };
}

describe('validate-harness-flow — portable detached fire + capture timeout (plan 031)', () => {
  it('fires via ctx.background and returns degraded when the run-id capture times out', async () => {
    const { ctx, exec, background } = buildCtx({
      'minih --version': { code: 0 },
      [`minih last-run ${SLUG}`]: { code: 0, stdout: '{"data":{"runId":"SAME"}}' },
    });

    const res = await vhf.run(ctx);

    expect(res.status).toBe('degraded');
    expect(res.next_action ?? '').toMatch(/run-id capture timed out/i);

    expect(background.calls).toHaveLength(1);
    expect(background.calls[0].command).toBe('minih');
    expect(background.calls[0].args.slice(0, 4)).toEqual([
      'run',
      SLUG,
      '-p',
      'targetRepo=/tmp/harness-flow-selftest-0/solo',
    ]);
    expect(background.calls[0].cwd).toBe('/repo');

    const coreutils = new Set(['bash', 'sh', 'mkdir', 'cp', 'mv', 'rm', 'sleep', 'realpath', 'nohup']);
    expect(exec.calls.filter((c) => coreutils.has(c.command))).toEqual([]);
    const clone = exec.calls.find((c) => c.command === 'git' && c.args.includes('clone'));
    expect(clone?.args).toEqual(expect.arrayContaining(['-c', 'core.longpaths=true']));
  });

  it('--global flips harnessSource into the worker params', async () => {
    const { ctx, background } = buildCtx(
      {
        'minih --version': { code: 0 },
        [`minih last-run ${SLUG}`]: { code: 0, stdout: '{"data":{"runId":"SAME"}}' },
      },
      { repo: ['https://github.com/x/solo.git'], global: true },
    );
    await vhf.run(ctx);
    expect(background.calls[0].args).toEqual(
      expect.arrayContaining(['-p', 'harnessSource=global']),
    );
  });

  it('errors honestly (E_CORE_TOO_OLD) on a core missing the new ports', async () => {
    const exec = new FakeExec({ 'minih --version': { code: 0 } });
    const ctx = buildVerbContext(
      {
        exec,
        fs: new FakeFs(),
        env: new FakeEnv(),
        git: new FakeGit({ isRepo: true, branch: 'main' }),
        clock: new FakeClock(),
      },
      { cwd: '/repo', args: {}, options: {} },
    );
    const res = await vhf.run(ctx);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_CORE_TOO_OLD');
  });
});
