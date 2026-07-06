import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUpdateAct, type UpdateActDeps } from '../../src/acts/update.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { type ExecScript, FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { LEGACY_SKILL_SLUGS, PACKAGED_SKILLS_SOURCE } from '../../src/services/skills/contract.js';
import { serializeSkillsLock } from '../../src/services/skills/skills-lock.js';
import {
  buildInstallArgv,
  buildRemoveArgv,
  resolvePackagedSkillsDir,
} from '../../src/services/skills/skills-service.js';

const PKG = '@ai-substrate/engineering-harness';
const VIEW = `npm view ${PKG} version --json`;
const INSTALL = (spec: string) => `npm i -g ${PKG}@${spec}`;

interface RunOpts {
  scripts?: Record<string, ExecScript>;
  installed?: string;
  fs?: FakeFs;
}

async function run(
  argv: string[],
  mode: OutputMode,
  opts: RunOpts = {},
): Promise<{ out: string; err: string; code: number; exec: FakeExec; fs: FakeFs }> {
  const exec = new FakeExec(opts.scripts ?? {});
  const fs = opts.fs ?? fakeSkillsFs();
  const deps: UpdateActDeps = {
    exec,
    fs,
    env: new FakeEnv({}, '/home/u'),
    clock: new FakeClock('2026-06-15T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
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
  const program = new Command().exitOverride();
  registerUpdateAct(program, io, deps, opts.installed ?? '0.2.0');
  await expect(program.parseAsync(['node', 'harness', ...argv])).rejects.toThrow(/^exit:/);
  return { out, err, code, exec, fs };
}

const execLine = (c: { command: string; args: string[] }) => `${c.command} ${c.args.join(' ')}`;
const packagedDir = resolvePackagedSkillsDir();

function fakeSkillsFs(extraFiles: Record<string, string> = {}): FakeFs {
  return new FakeFs(
    {
      [`${packagedDir}/eng-harness-flow/SKILL.md`]: '---\nname: eng-harness-flow\n---\n',
      [`${packagedDir}/README.md`]: '# skills\n',
      ...extraFiles,
    },
    {
      [packagedDir]: ['README.md', 'eng-harness-flow'],
      [`${packagedDir}/eng-harness-flow`]: ['SKILL.md'],
    },
  );
}

describe('harness update --check (report-only)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports an available update from a fresh lookup, exit 0, NO install (AC2)', async () => {
    const { out, code, exec } = await run(['update', '--check'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.3.0"' } },
    });
    const env = JSON.parse(out);
    expect(env.command).toBe('update');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({ installed: '0.2.0', latest: '0.3.0', update_available: true });
    expect(env.data.skills.reconciled).toBe(false); // report-only without --target
    expect(code).toBe(0);
    // only the lookup ran — never an install or a skills mutation
    expect(exec.calls.map(execLine)).toEqual([VIEW]);
  });

  it('reports no update when already latest', async () => {
    const { out } = await run(['update', '--check'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.2.0"' } },
    });
    expect(JSON.parse(out).data).toMatchObject({
      installed: '0.2.0',
      latest: '0.2.0',
      update_available: false,
    });
  });

  it('degrades gracefully when the registry lookup fails (latest null, exit 0)', async () => {
    const { out, code } = await run(['update', '--check'], 'json', {
      scripts: { [VIEW]: { code: 1, stderr: 'E401 Unauthorized' } },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({ installed: '0.2.0', latest: null, update_available: false });
    expect(code).toBe(0);
  });

  it('human mode prints the check summary to stdout', async () => {
    const { out, err } = await run(['update', '--check'], 'human', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.3.0"' } },
    });
    expect(out).toContain('update --check: installed 0.2.0, latest 0.3.0 — update available');
    expect(err).toContain('Run `harness update` to upgrade');
  });
});

describe('harness update --pin', () => {
  afterEach(() => vi.restoreAllMocks());

  it('installs the exact (v-stripped) version, exit 0 (AC3)', async () => {
    const { out, code, exec } = await run(['update', '--pin', 'v0.3.0'], 'json', {
      scripts: { [INSTALL('0.3.0')]: { code: 0 } },
    });
    const env = JSON.parse(out);
    expect(env.data).toMatchObject({
      installed_before: '0.2.0',
      installed_after: '0.3.0',
      command: 'npm i -g @ai-substrate/engineering-harness@0.3.0',
    });
    expect(env.data.skills.reconciled).toBe(false);
    expect(code).toBe(0);
    expect(exec.calls.map(execLine)).toEqual([INSTALL('0.3.0')]); // no lookup, exact install
  });

  it('rejects a dist-tag pin (latest/canary) with E108, no install (companion F005/AC3)', async () => {
    const { out, code, exec } = await run(['update', '--pin', 'latest'], 'json');
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E108');
    expect(env.next_action).toContain('--pin');
    expect(code).toBe(1);
    expect(exec.calls.length).toBe(0); // never shelled out
  });

  it('maps a not-in-registry pin to E204 + actionable next_action (AC3)', async () => {
    const { out, code } = await run(['update', '--pin', '9.9.9'], 'json', {
      scripts: {
        [INSTALL('9.9.9')]: { code: 1, stderr: 'npm ERR! 404 No matching version found for ...' },
      },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E204');
    expect(env.next_action).toContain('--pin');
    expect(code).toBe(1);
  });

  it('surfaces a permission-denied install as E202 (AC10)', async () => {
    const { out, code } = await run(['update', '--pin', '0.3.0'], 'json', {
      scripts: {
        [INSTALL('0.3.0')]: { code: 1, stderr: 'npm ERR! Error: EACCES: permission denied' },
      },
    });
    const env = JSON.parse(out);
    expect(env.error.code).toBe('E202');
    expect(code).toBe(1);
  });

  it('surfaces a missing npm (exit 127) as E203 (AC10)', async () => {
    const { out, code } = await run(['update', '--pin', '0.3.0'], 'json', {
      scripts: { [INSTALL('0.3.0')]: { code: 127, stderr: 'spawn npm ENOENT' } },
    });
    const env = JSON.parse(out);
    expect(env.error.code).toBe('E203');
    expect(code).toBe(1);
  });
});

describe('harness update (bare)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('installs @latest when newer, reporting before/after (AC1)', async () => {
    const { out, code, exec } = await run(['update'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.3.0"' }, [INSTALL('latest')]: { code: 0 } },
    });
    const env = JSON.parse(out);
    expect(env.data).toMatchObject({
      installed_before: '0.2.0',
      installed_after: '0.3.0',
      command: 'npm i -g @ai-substrate/engineering-harness@latest',
    });
    expect(code).toBe(0);
    expect(exec.calls.map(execLine)).toEqual([VIEW, INSTALL('latest')]);
  });

  it('is a no-op (before==after) when already latest — not an error (AC1)', async () => {
    const { out, code, exec } = await run(['update'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.2.0"' } },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data.installed_before).toBe('0.2.0');
    expect(env.data.installed_after).toBe('0.2.0');
    expect(env.data.already_latest).toBe(true);
    expect(code).toBe(0);
    expect(exec.calls.map(execLine)).toEqual([VIEW]); // never installed
  });
});

describe('harness self-install', () => {
  afterEach(() => vi.restoreAllMocks());

  it('installs @latest globally, exit 0 (AC4)', async () => {
    const { out, code, exec } = await run(['self-install'], 'json', {
      scripts: { [INSTALL('latest')]: { code: 0 } },
    });
    const env = JSON.parse(out);
    expect(env.command).toBe('self-install');
    expect(env.data).toEqual({
      installed_before: '0.2.0',
      installed_after: null,
      command: 'npm i -g @ai-substrate/engineering-harness@latest',
    });
    expect(code).toBe(0);
    expect(exec.calls.map(execLine)).toEqual([INSTALL('latest')]);
  });

  it('maps an unexpected 401 to a registry error with a registry next_action (AC4/AC10)', async () => {
    const { out, code } = await run(['self-install'], 'json', {
      scripts: {
        [INSTALL('latest')]: { code: 1, stderr: 'npm ERR! code E401\nnpm ERR! 401 Unauthorized' },
      },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E201');
    expect(env.next_action).toMatch(/registry/i);
    expect(code).toBe(1);
  });
});

describe('harness update — skills reconcile (--target)', () => {
  afterEach(() => vi.restoreAllMocks());

  const refreshKey = (t: string[], g = false) =>
    `npx ${buildInstallArgv({ source: '/tmp/harness-skills-0', targets: t, global: g }).join(' ')}`;
  const pruneKey = (t: string[], g = false) =>
    `npx ${buildRemoveArgv({ slugs: [...LEGACY_SKILL_SLUGS], targets: t, global: g }).join(' ')}`;

  it('reconciles (refresh + prune) and folds skills into the envelope (AC14)', async () => {
    // bare update, already latest ⇒ no binary install; skills refresh+prune succeed (unscripted npx ⇒ ok)
    const { out, code, exec } = await run(['update', '--target', 'github-copilot'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.2.0"' } },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('ok');
    expect(env.data.skills).toMatchObject({
      reconciled: true,
      refreshed: true,
      pruned: true,
      targets: ['github-copilot'],
    });
    expect(code).toBe(0);
    const npx = exec.calls.filter((c) => c.command === 'npx');
    expect(npx.map((c) => c.args[1])).toEqual(['add', 'remove']); // refresh then prune
    expect(npx[0]?.args[2]).toBe('/tmp/harness-skills-0');
  });

  it('refresh succeeds but prune fails ⇒ degraded, exit 0 (AC14)', async () => {
    const { out, code } = await run(['update', '--target', 'github-copilot'], 'json', {
      scripts: {
        [VIEW]: { code: 0, stdout: '"0.2.0"' },
        [pruneKey(['github-copilot'])]: { code: 1, stderr: 'remove failed' },
      },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('degraded');
    expect(env.data.skills).toMatchObject({ refreshed: true, pruned: false });
    expect(code).toBe(0);
  });

  it('refresh fails ⇒ error, exit 1 (AC14)', async () => {
    const { out, code } = await run(['update', '--target', 'github-copilot'], 'json', {
      scripts: {
        [VIEW]: { code: 0, stdout: '"0.2.0"' },
        [refreshKey(['github-copilot'])]: { code: 1, stderr: 'add failed' },
      },
    });
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E170');
    expect(code).toBe(1);
  });

  it('--check --target stays report-only (no skills mutation)', async () => {
    const { out, exec } = await run(['update', '--check', '--target', 'github-copilot'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.3.0"' } },
    });
    expect(JSON.parse(out).data.skills.reconciled).toBe(false);
    expect(exec.calls.some((c) => c.command === 'npx')).toBe(false);
  });

  it('no --target reports prune candidates without mutating (AC13)', async () => {
    const { out, exec } = await run(['update', '--check'], 'json', {
      scripts: { [VIEW]: { code: 0, stdout: '"0.3.0"' } },
    });
    const env = JSON.parse(out);
    expect(env.data.skills.reconciled).toBe(false);
    expect(env.data.skills.prune_candidates.length).toBeGreaterThan(0);
    expect(env.data.skills.suggested_command).toContain('harness skills update --target');
    expect(exec.calls.some((c) => c.command === 'npx')).toBe(false);
  });

  it('bare update reads the project skills lock and reconciles its targets when already latest', async () => {
    const fs = fakeSkillsFs({
      '/repo/.harness/skills.lock.json': serializeSkillsLock({
        lockfile_version: 1,
        installs: [{ scope: 'project', source: PACKAGED_SKILLS_SOURCE, targets: ['codex'] }],
      }),
    });
    const { out, code, exec } = await run(['update'], 'json', {
      fs,
      scripts: { [VIEW]: { code: 0, stdout: '"0.2.0"' } },
    });

    expect(code).toBe(0);
    const env = JSON.parse(out);
    expect(env.data.skills).toMatchObject({
      reconciled: true,
      targets: ['codex'],
      source: PACKAGED_SKILLS_SOURCE,
    });
    expect(exec.calls.map(execLine)).toEqual([
      VIEW,
      'npx skills@latest add /tmp/harness-skills-0 -a codex -y',
      pruneKey(['codex']),
    ]);
  });

  it('after a binary upgrade, bare update re-execs the fresh harness skills update child instead of reconciling in-process', async () => {
    const fs = fakeSkillsFs({
      '/repo/.harness/skills.lock.json': serializeSkillsLock({
        lockfile_version: 1,
        installs: [{ scope: 'project', source: PACKAGED_SKILLS_SOURCE, targets: ['codex'] }],
      }),
    });
    const { out, code, exec } = await run(['update'], 'json', {
      fs,
      scripts: { [VIEW]: { code: 0, stdout: '"0.3.0"' }, [INSTALL('latest')]: { code: 0 } },
    });

    expect(code).toBe(0);
    expect(JSON.parse(out).data.skills).toMatchObject({
      reconciled: true,
      reexec: true,
      targets: ['codex'],
    });
    expect(exec.calls.map(execLine)).toEqual([
      VIEW,
      INSTALL('latest'),
      'harness skills update --target codex',
    ]);
  });

  // U-1 (review 055): a registry-lookup MISS (latest=null) still installs & upgrades;
  // the binary is now fresh, so skills must reconcile via the re-exec child, NOT
  // in-process (which would stage stale skills from the pre-upgrade package).
  it('re-execs the fresh child even when the registry lookup failed (latest null but install ran)', async () => {
    const fs = fakeSkillsFs({
      '/repo/.harness/skills.lock.json': serializeSkillsLock({
        lockfile_version: 1,
        installs: [{ scope: 'project', source: PACKAGED_SKILLS_SOURCE, targets: ['codex'] }],
      }),
    });
    const { out, code, exec } = await run(['update'], 'json', {
      fs,
      // VIEW fails ⇒ result.latest === null ⇒ installed_after === null; INSTALL still succeeds.
      scripts: {
        [VIEW]: { code: 1, stderr: 'E401 Unauthorized' },
        [INSTALL('latest')]: { code: 0 },
      },
    });

    expect(code).toBe(0);
    expect(JSON.parse(out).data.skills).toMatchObject({
      reconciled: true,
      reexec: true,
      targets: ['codex'],
    });
    expect(exec.calls.map(execLine)).toEqual([
      VIEW,
      INSTALL('latest'),
      'harness skills update --target codex',
    ]);
  });
});
