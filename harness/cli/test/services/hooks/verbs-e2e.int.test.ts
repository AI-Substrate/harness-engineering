import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { backupAgentConfigs } from '../../../src/services/doctor/collector/backup.js';
import { HOOK_MARKER } from '../../../src/services/hooks/hook-marker.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * THE VERBS, THROUGH THE REAL BIN (plan 082).
 *
 * WHY THIS FILE EXISTS. A sweep of the phase asked of each checked task whether its
 * assertions test the DELIVERABLE or the layer beneath it. Three tasks failed that
 * question:
 *
 * - tk-0005 "Implement Strategy A" — asserted by calling `installStrategyA` directly;
 * - tk-0008 "Wire harness hooks install|status|uninstall|list" — asserted by calling
 *   `installHooks` / `listAgents` / `statusHooks` directly, and the subcommands were
 *   not registered AT ALL until it was found by accident;
 * - tk-0006 "Resolve the binary path absolutely… ALWAYS quote it" — the pure
 *   functions were asserted, but `hooksDeps` composes the binary from
 *   `process.argv[1]` and **that expression was asserted nowhere**. The path actually
 *   written into a user's config file had no test at all.
 *
 * A test that exercises the layer beneath a deliverable proves the layer, never the
 * delivery. These rows drive `harness hooks …` as a user does.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

let home: string;

const run = (args: string[]): string =>
  execFileSync(process.execPath, [CLI, 'hooks', ...args], {
    encoding: 'utf8',
    env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
  });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness hooks e2e '));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('`harness hooks list` — the delivered surface', () => {
  it('emits JSON carrying detected / supported / installed per agent', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const rows = JSON.parse(run(['list', '--json'])) as {
      agent: string;
      detected: boolean;
      supported: boolean;
      installed: boolean;
    }[];

    const cursor = rows.find((r) => r.agent === 'cursor');
    expect(cursor).toEqual({
      agent: 'cursor',
      detected: true,
      supported: true,
      installed: false,
    });
    // And the cut line is visible through the real surface, not only in the service.
    expect(rows.find((r) => r.agent === 'amp')?.supported).toBe(false);
  });
});

describe('`harness hooks install` — and the binary it actually writes', () => {
  it('writes a command whose binary path RESOLVES on disk', () => {
    /*
    Test Doc:
    - Why: `hooksDeps` composes the installed command from `process.argv[1]`, and
      that expression had no test. tk-0006 proved embed/extract as pure functions —
      it never proved the verb feeds them the right input. A hook naming a path that
      does not exist is inert, and because hooks exit 0 by design nothing reports it.
    - Contract: install through the real bin, then read the config the real bin
      wrote, and assert the path it named EXISTS.
    - Note the home directory contains SPACES (see beforeEach), so this also exercises
      the quoting end to end rather than in isolation.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    run(['install', '--json']);

    const config = JSON.parse(readFileSync(join(home, '.cursor/hooks.json'), 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    const command = config.hooks.preToolUse[0].command;

    expect(command).toContain(HOOK_MARKER);
    // The binary is quoted, and what it names is a real file.
    expect(command.startsWith('"')).toBe(true);
    const binary = command.slice(1, command.indexOf('"', 1));
    expect(binary.length).toBeGreaterThan(0);
    expect(readFileSync(binary, 'utf8').length).toBeGreaterThan(0);
  });

  it('is idempotent through the REAL bin — a second install changes nothing', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    run(['install', '--json']);
    const first = readFileSync(join(home, '.cursor/hooks.json'), 'utf8');
    run(['install', '--json']);
    expect(readFileSync(join(home, '.cursor/hooks.json'), 'utf8')).toBe(first);
  });

  it('HARNESS_NO_HOOKS is honoured by the real verb, asserted on the filesystem', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    execFileSync(process.execPath, [CLI, 'hooks', 'install', '--json'], {
      encoding: 'utf8',
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home, HARNESS_NO_HOOKS: '1' },
    });
    expect(() => readFileSync(join(home, '.cursor/hooks.json'), 'utf8')).toThrow();
  });
});

describe('`harness hooks status` — the delivered surface', () => {
  it('reports the binary as RESOLVES after a real install', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    run(['install', '--json']);

    const out = JSON.parse(run(['status', '--json'])) as {
      agents: { agent: string; binaryState: string }[];
      fires: { recorded: boolean; total: number };
    };

    expect(out.agents.find((a) => a.agent === 'cursor')?.binaryState).toBe('resolves');
    // And the journal summary is present in the delivered payload, which is what
    // ac-000b actually requires — not merely that a function returns it.
    expect(out.fires).toEqual(expect.objectContaining({ recorded: false, total: 0 }));
  });

  it('reports ABSENT before any install — distinct from resolves', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const out = JSON.parse(run(['status', '--json'])) as {
      agents: { agent: string; binaryState: string }[];
    };
    expect(out.agents.find((a) => a.agent === 'cursor')?.binaryState).toBe('absent');
  });
});

describe('`harness hooks restore` — the recovery verb, through the real bin', () => {
  /*
   * WHY THESE ROWS EXIST. `restoreAgentConfigs` landed with six rows and six red
   * mutations and was STILL not delivered: nobody at a terminal could run it. That
   * is the phase-2 unwired-verb finding wearing different clothes — the finding that
   * produced the registration guard in `app.test.ts`, which this verb is also in.
   *
   * The audience decides the contract. Everyone who reaches for a restore already
   * has a problem, so a refusal must be LOUD: non-zero exit and a named reason,
   * never a clean restore of zero files.
   */

  /** Restore may exit non-zero, so the shared `run` helper (which throws) will not do. */
  const runRestore = (args: string[]): { code: number; stdout: string } => {
    const result = spawnSync(process.execPath, [CLI, 'hooks', 'restore', ...args], {
      encoding: 'utf8',
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
    });
    return { code: result.status ?? -1, stdout: result.stdout };
  };

  /** A real backup, written by the real backup code — never a hand-built fixture. */
  const takeBackup = (): string => {
    const backup = backupAgentConfigs({
      fs: new NodeFs(),
      clock: { nowIso: () => '2026-08-10T01:02:03.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home, envOverrides: {} },
    } as never);
    return backup.dir ?? `${home}/.git-ai/harness-backups/2026-08-10T01-02-03-000Z`;
  };

  it('restores a real backup end to end, chosen as the NEWEST with no --from', () => {
    /*
    Test Doc:
    - Why: the delivered capability. The library round trip was already proven; this
      asserts a person can invoke it, and that the default (newest backup) resolves
      without the operator knowing the directory naming scheme — which is exactly
      what they will not know at three in the morning.
    - Contract: the file on disk is byte-identical to what it was before the damage,
      asserted on the filesystem rather than on the report.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const config = join(home, '.cursor', 'hooks.json');
    const original = Buffer.from('// keep me\r\n{ "hooks": { "afterFileEdit": [] } }  ', 'utf8');
    writeFileSync(config, original);

    takeBackup();
    writeFileSync(config, '{"clobbered":true}');

    const { code, stdout } = runRestore(['--json']);
    const report = JSON.parse(stdout) as { ok: boolean; restored: string[]; from: string };

    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.restored).toContain(config);
    expect(readFileSync(config).equals(original)).toBe(true);
  });

  it('REFUSES a directory with no manifest — non-zero, with the reason named', () => {
    /*
    Test Doc:
    - Why: the assertion the PM added to tk-0001 when the verb was ruled in. The
      library already refuses this (mutation M5 was red), but a refusal the CLI
      swallows is not a refusal — the operator sees a report and walks away. The
      exit-0-and-silent contract binds `fire` ALONE, and this is the verb where
      breaking it would do the most harm.
    - Contract: exit 1 AND the reason in the payload. Both, because either alone is
      survivable by the wrong implementation — a non-zero exit with no reason leaves
      the operator guessing, and a reason with exit 0 is invisible to a script.
    */
    const empty = join(home, 'not-a-backup');
    mkdirSync(empty, { recursive: true });

    const { code, stdout } = runRestore(['--from', empty, '--json']);
    const report = JSON.parse(stdout) as { ok: boolean; failed: string[]; detail: string };

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.failed.join(' ')).toContain('manifest.json');
    expect(report.detail).toContain('refused');
  });

  it('REFUSES when there is no backup at all rather than reporting a clean restore', () => {
    /*
    Test Doc:
    - Why: the empty-success shape this module's own doc names as the harm — an
      operator told their configs are back stops looking for them. A machine that
      has never run an install has no backups, and "restored 0 files, ok" is the
      most dangerous thing this verb could say.
    - Contract: exit 1, and the message names the directory that was searched so the
      operator can check for themselves.
    */
    const { code, stdout } = runRestore(['--json']);
    const report = JSON.parse(stdout) as { ok: boolean; from: string | null; detail: string };

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.from).toBeNull();
    expect(report.detail).toContain('harness-backups');
  });
});
