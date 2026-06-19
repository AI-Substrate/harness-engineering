import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../harness/cli/src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../harness/cli/src/adapters/env/fake-env.js';
import { FakeExec } from '../../../harness/cli/src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../harness/cli/src/adapters/git/fake-git.js';
import { buildVerbContext } from '../../../harness/cli/src/services/extensions/verb-context.js';
import windowsCheck from './extension.ts';

/*
Test Doc:
- Why: plan 031 AC-04 — `harness windows-check --json` must return a VALID envelope
  in each state: a clean tree → ok/exit 0; an in-scope hazard → degraded/exit 0
  (warn-launch); no git tree → unconfigured/exit 2. The rule logic is unit-tested
  in lib/rules.test.ts; this pins the verb's enumerate → read → envelope wiring.
- Contract: the verb lists tracked files via `git ls-files -z`, filters to the
  extension layer, reads each via ctx.fs, and maps findings → ok/degraded; a
  non-repo short-circuits to unconfigured before any scan.
*/

function ctxFor(opts: {
  isRepo?: boolean;
  files?: string;
  seed?: Record<string, string>;
  options?: Record<string, unknown>;
}) {
  const exec = new FakeExec({ 'git ls-files -z': { code: 0, stdout: opts.files ?? '' } });
  const fs = new FakeFs(opts.seed ?? {});
  return buildVerbContext(
    {
      exec,
      fs,
      fsWrite: fs,
      env: new FakeEnv(),
      git: new FakeGit({ isRepo: opts.isRepo ?? true, branch: 'main' }),
      clock: new FakeClock(),
    },
    { cwd: '/repo', args: {}, options: opts.options ?? {} },
  );
}

describe('windows-check — envelope states (plan 031 AC-04)', () => {
  it('clean in-scope sources → ok with 0 findings', async () => {
    const ctx = ctxFor({
      files: ['harness/cli/src/core.ts', '.harness/extensions/foo/extension.ts'].join('\0'),
      seed: { '/repo/.harness/extensions/foo/extension.ts': "await ctx.exec('git', ['status']);\n" },
    });
    const res = await windowsCheck.run(ctx);
    expect(res.status).toBe('ok');
    expect((res.data as { scanned: number; findingCount: number }).scanned).toBe(1); // only the in-scope file
    expect((res.data as { findingCount: number }).findingCount).toBe(0);
  });

  it('an in-scope hazard → degraded with a finding + next_action (warn-launch)', async () => {
    const ctx = ctxFor({
      files: '.harness/extensions/foo/extension.ts',
      seed: {
        '/repo/.harness/extensions/foo/extension.ts': "await ctx.exec('bash', ['-c', 'x']);\n",
      },
    });
    const res = await windowsCheck.run(ctx);
    expect(res.status).toBe('degraded');
    expect((res.data as { findingCount: number }).findingCount).toBeGreaterThan(0);
    expect(res.next_action ?? '').toMatch(/WIN001|hazard/i);
  });

  it('the core layer is OUT of scope — node:* there is not flagged', async () => {
    const ctx = ctxFor({
      files: 'harness/cli/src/adapters/fs/node-fs.ts',
      seed: { '/repo/harness/cli/src/adapters/fs/node-fs.ts': "import { existsSync } from 'node:fs';\n" },
    });
    const res = await windowsCheck.run(ctx);
    expect(res.status).toBe('ok');
    expect((res.data as { scanned: number }).scanned).toBe(0); // the core file is not scanned
  });

  it('not a git work tree → unconfigured (exit 2)', async () => {
    const ctx = ctxFor({ isRepo: false });
    const res = await windowsCheck.run(ctx);
    expect(res.status).toBe('unconfigured');
    expect(res.next_action ?? '').toMatch(/git work tree|repo root/i);
  });
});
