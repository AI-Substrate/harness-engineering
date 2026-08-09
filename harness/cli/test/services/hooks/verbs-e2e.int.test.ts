import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
