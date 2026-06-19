import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../harness/cli/src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../harness/cli/src/adapters/env/fake-env.js';
import { FakeBackground } from '../../../harness/cli/src/adapters/exec/fake-background.js';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../harness/cli/src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../harness/cli/src/services/extensions/verb-context.js';
import vha from './extension.ts';

/*
Test Doc:
- Why: plan 031 AC-01/AC-02 end-to-end for the ported verb — it must fire the
  detached worker via ctx.background (never a shell), and when the run-id capture
  times out it must still return `degraded` with a `next_action` (not hang, not
  error). Proven with fakes on ubuntu (no real minih/git/process).
- Contract: run(ctx) → degraded; next_action names the timed-out repo; the
  background port was called once with `minih run <slug> -p targetRepo=…`; and
  NOT ONE ctx.exec call is a POSIX shell/coreutil.
*/

const SLUG = 'validate-harnessability-assessment-skill';

function buildCtx(
  execScripts: Record<string, { code: number; stdout?: string }>,
  repos: string[] = ['https://github.com/x/solo.git'],
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
    { cwd: '/repo', args: {}, options: { repo: repos } },
  );
  return { ctx, exec, background, fs };
}

describe('validate-harnessability — portable detached fire + capture timeout (plan 031)', () => {
  it('fires via ctx.background and returns degraded when the run-id capture times out', async () => {
    const { ctx, exec, background } = buildCtx({
      'minih --version': { code: 0 },
      // minih keeps returning the SAME id as `before` ⇒ capture never sees a new run.
      [`minih last-run ${SLUG}`]: { code: 0, stdout: '{"data":{"runId":"SAME"}}' },
    });

    const res = await vha.run(ctx);

    expect(res.status).toBe('degraded');
    expect(res.next_action ?? '').toMatch(/run-id capture timed out/i);

    // The detached worker was launched through the background PORT (no shell).
    expect(background.calls).toHaveLength(1);
    expect(background.calls[0].command).toBe('minih');
    expect(background.calls[0].args.slice(0, 4)).toEqual([
      'run',
      SLUG,
      '-p',
      'targetRepo=/tmp/harnessability-selftest-0/solo',
    ]);
    expect(background.calls[0].cwd).toBe('/repo'); // repo root so path:skills resolves

    // AC-01: not one ctx.exec was a POSIX shell / coreutil (the regression we guard).
    const coreutils = new Set(['bash', 'sh', 'mkdir', 'cp', 'mv', 'rm', 'sleep', 'realpath', 'nohup']);
    expect(exec.calls.filter((c) => coreutils.has(c.command))).toEqual([]);
    // git clone carried the longpaths flag.
    const clone = exec.calls.find((c) => c.command === 'git' && c.args.includes('clone'));
    expect(clone?.args).toEqual(expect.arrayContaining(['-c', 'core.longpaths=true']));
  });

  it('repoName yields a clean basename from a backslash Windows URL (AC-06 / F001)', async () => {
    const { ctx, background } = buildCtx(
      {
        'minih --version': { code: 0 },
        [`minih last-run ${SLUG}`]: { code: 0, stdout: '{"data":{"runId":"SAME"}}' },
      },
      ['C:\\work\\acme-repo.git'],
    );
    await vha.run(ctx);
    // repoName splits on /[/\\]/ → a backslash path yields the clean basename
    // `acme-repo` (not the whole drive path) — AC-06's Windows-shaped input proof.
    expect(background.calls).toHaveLength(1);
    expect(background.calls[0].args).toContain(
      'targetRepo=/tmp/harnessability-selftest-0/acme-repo',
    );
  });

  it('errors honestly (E_CORE_TOO_OLD) on a core missing the new ports', async () => {
    const exec = new FakeExec({ 'minih --version': { code: 0 } });
    // No fsWrite / background ⇒ the capability guard fires.
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
    const res = await vha.run(ctx);
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('E_CORE_TOO_OLD');
  });
});
