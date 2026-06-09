import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../src/acts/verb.js';
import { FakeClock } from '../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../src/adapters/env/fake-env.js';
import { type ExecScript, FakeExec } from '../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../src/adapters/git/fake-git.js';
import { FakeProcess } from '../src/adapters/process/fake-process.js';
import { buildProgram } from '../src/app.js';
import type { CliIo, OutputMode, Writers } from '../src/output/output-port.js';
import type { VerbRegistry } from '../src/services/extensions/registry.js';
import { DEFAULT_SKILLS_SOURCE } from '../src/services/skills/contract.js';
import { buildInstallArgv, formatInstallCommand } from '../src/services/skills/skills-service.js';

/**
 * Test Doc:
 * - Why: `harness skills install` is a pass-through to `npx skills add`; the contract
 *   is the EXACT argv it shells out with (always -y so the picker never blocks, repeated
 *   -a per target, -g iff global) and a clean envelope (Principle 4 — JSON stdout stays parseable).
 * - Contract: `buildInstallArgv` is pure; the act shells out only through the injected ExecPort.
 * - Usage Notes: drive the fully-wired program with FakeExec (fakes over mocks, Principle 3).
 */

describe('buildInstallArgv (pure)', () => {
  it('builds the canonical argv: skills@latest add <source> -a <t> -y', () => {
    expect(
      buildInstallArgv({
        source: DEFAULT_SKILLS_SOURCE,
        targets: ['github-copilot'],
        global: false,
      }),
    ).toEqual([
      'skills@latest',
      'add',
      'AI-Substrate/harness-engineering',
      '-a',
      'github-copilot',
      '-y',
    ]);
  });

  it('always appends -y (no blocking picker) and pins skills@latest', () => {
    const argv = buildInstallArgv({ source: 's', targets: ['codex'], global: false });
    expect(argv[0]).toBe('skills@latest');
    expect(argv.at(-1)).toBe('-y');
  });

  it('fans out one -a per target, in order', () => {
    expect(
      buildInstallArgv({ source: 's', targets: ['claude-code', 'codex', 'cursor'], global: false }),
    ).toEqual([
      'skills@latest',
      'add',
      's',
      '-a',
      'claude-code',
      '-a',
      'codex',
      '-a',
      'cursor',
      '-y',
    ]);
  });

  it('adds -g iff global', () => {
    expect(buildInstallArgv({ source: 's', targets: ['pi'], global: true })).toContain('-g');
    expect(buildInstallArgv({ source: 's', targets: ['pi'], global: false })).not.toContain('-g');
  });

  it('adds -s per skill filter', () => {
    expect(
      buildInstallArgv({
        source: 's',
        targets: ['codex'],
        global: false,
        skills: ['eng-harness-1-boot'],
      }),
    ).toEqual(['skills@latest', 'add', 's', '-a', 'codex', '-s', 'eng-harness-1-boot', '-y']);
  });

  it('appends -y unconditionally — the builder cannot construct a blocking invocation (AC3)', () => {
    // No `yes` opt-out exists on the contract; -y is always present.
    expect(buildInstallArgv({ source: 's', targets: ['codex'], global: true })).toContain('-y');
    expect(buildInstallArgv({ source: 's', targets: ['a', 'b'], global: false })).toContain('-y');
  });

  it('formatInstallCommand prefixes npx', () => {
    expect(formatInstallCommand(['skills@latest', 'add', 's', '-a', 'codex', '-y'])).toBe(
      'npx skills@latest add s -a codex -y',
    );
  });
});

function deps(exec: FakeExec): VerbActDeps {
  return {
    exec,
    fs: new FakeFs(),
    env: new FakeEnv(),
    git: new FakeGit(),
    clock: new FakeClock('2026-06-09T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runSkills(
  argv: string[],
  mode: OutputMode,
  scripts: Record<string, ExecScript> = {},
): Promise<{ out: string; err: string; code: number; exec: FakeExec }> {
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
  const exec = new FakeExec(scripts);
  const registry: VerbRegistry = { verbs: [], records: [] };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('9.9.9', io, deps(exec), registry).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  return { out, err, code, exec };
}

describe('harness skills install (pass-through act)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shells out to npx with the exact argv via the ExecPort, exit 0', async () => {
    const { out, code, exec } = await runSkills(
      ['skills', 'install', '--target', 'github-copilot'],
      'json',
    );
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]).toEqual({
      command: 'npx',
      args: [
        'skills@latest',
        'add',
        'AI-Substrate/harness-engineering',
        '-a',
        'github-copilot',
        '-y',
      ],
      cwd: '/repo',
    });
    expect(code).toBe(0);
    const env = JSON.parse(out);
    expect(env.command).toBe('skills');
    expect(env.status).toBe('ok');
    expect(env.data.command).toBe(
      'npx skills@latest add AI-Substrate/harness-engineering -a github-copilot -y',
    );
  });

  it('fans out multiple targets and adds -g for --global', async () => {
    const { exec, code } = await runSkills(
      ['skills', 'install', '--target', 'claude-code', '--target', 'codex', '--global'],
      'json',
    );
    expect(code).toBe(0);
    expect(exec.calls[0]?.args).toEqual([
      'skills@latest',
      'add',
      'AI-Substrate/harness-engineering',
      '-a',
      'claude-code',
      '-a',
      'codex',
      '-g',
      '-y',
    ]);
  });

  it('missing --target → E108, exit 1, no exec call (non-blocking, agent-first)', async () => {
    const { out, code, exec } = await runSkills(['skills', 'install'], 'json');
    expect(exec.calls).toHaveLength(0);
    expect(code).toBe(1);
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E108');
  });

  it('npx failure → E170 envelope, exit 1', async () => {
    const { out, code } = await runSkills(['skills', 'install', '--target', 'codex'], 'json', {
      npx: { code: 1, stderr: 'network down' },
    });
    expect(code).toBe(1);
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E170');
    expect(env.next_action).toContain('npx skills@latest add');
  });

  it('human mode announces the exact npx command on stderr BEFORE running', async () => {
    const { err, out } = await runSkills(['skills', 'install', '--target', 'codex'], 'human');
    expect(err).toContain('about to run:');
    expect(err).toContain('npx skills@latest add AI-Substrate/harness-engineering -a codex -y');
    expect(err).toContain('vercel-labs/skills');
    // human stdout must NOT carry a JSON envelope
    expect(out).not.toContain('"command":"skills"');
  });

  it('--source overrides the default repo', async () => {
    const { exec } = await runSkills(
      ['skills', 'install', '--target', 'codex', '--source', 'owner/repo/skills/eng-harness-loop'],
      'json',
    );
    expect(exec.calls[0]?.args).toContain('owner/repo/skills/eng-harness-loop');
  });
});
