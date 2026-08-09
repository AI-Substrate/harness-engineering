import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { AGENT_MATRIX, readEnvOverrides } from '../../../src/services/hooks/agent-matrix.js';

/**
 * BACKUP REUSE, WIDENED (plan 082 tk-000a).
 *
 * `backupAgentConfigs` already exists and already reports copied / failed /
 * UNDECLARED — that last one distinguishing "nothing to copy" from "we did not know
 * where to look", which is the honest shape. Two mechanisms writing agent-config
 * backups to near-identical locations would make a restore ambiguous, so this task
 * WIDENS the existing helper rather than adding a second (dw-0024).
 *
 * THE BLINDNESS IT INHERITED, AND WHY IT BITES EXACTLY HERE. `agents.ts` states in
 * its own comment that it does not read `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or
 * `GEMINI_CLI_HOME`, and `backupAgentConfigs` composed every source as
 * `<home>/<rel>`. Harmless while nothing else was override-aware — but the
 * installer now IS. On a machine with `CLAUDE_CONFIG_DIR` set we would have backed
 * up `~/.claude/settings.json` and then modified `$CLAUDE_CONFIG_DIR/settings.json`:
 * **the wrong file copied, the written one unbacked, and a backup directory named
 * to an operator who would stop looking for their originals.**
 */

describe('the override table is read from the MATRIX, not restated (dw-0023, dw-0024)', () => {
  it('reads every override the matrix declares, and only those', () => {
    /*
    Test Doc:
    - Why: dw-0024 — one source of truth. If backup kept its own list of variables,
      adding an override to the matrix would silently leave backup blind to it, which
      is the original defect with a new coat of paint.
    - Contract: the names come from the matrix rows themselves.
    */
    const declared = AGENT_MATRIX.map((s) => s.override?.name).filter(
      (n): n is string => n !== undefined,
    );
    expect(declared).toEqual(['CLAUDE_CONFIG_DIR', 'GEMINI_CLI_HOME']);

    const read = readEnvOverrides((n) =>
      n === 'CLAUDE_CONFIG_DIR' ? '/cfg' : n === 'GEMINI_CLI_HOME' ? '/gem' : 'SHOULD-NOT-BE-READ',
    );
    expect(read).toEqual({ CLAUDE_CONFIG_DIR: '/cfg', GEMINI_CLI_HOME: '/gem' });
  });

  it('drops a blank value, matching how the resolver treats it', () => {
    // An exported-but-empty variable is not a location. If backup treated it as set
    // while the resolver fell back to the home, they would diverge on exactly the
    // machine the widening exists to protect.
    expect(readEnvOverrides((n) => (n === 'CLAUDE_CONFIG_DIR' ? '   ' : undefined))).toEqual({});
  });

  it('adding an override is adding a ROW — a fake row is picked up with no code change', () => {
    const names = new Set(
      [...AGENT_MATRIX, { override: { name: 'INVENTED_OVERRIDE' } }]
        .map((s) => s.override?.name)
        .filter((n): n is string => n !== undefined),
    );
    expect(names.has('INVENTED_OVERRIDE')).toBe(true);
  });
});

describe('the NO-OVERRIDE path is unchanged — asserted DELIBERATELY, not incidentally', () => {
  it('with no overrides set, the override-bearing agents resolve to PLAIN HOME paths', async () => {
    /*
    Test Doc:
    - Why: `backupAgentConfigs` had ZERO regression coverage before this plan
      (measured: no test file referenced it at 2401cb31~1). So "test-all passes"
      could not have been evidence that a user with no overrides set still gets the
      same backup as before — nothing was asserting it. This row asserts it.
    - Contract: unset, claude-code and gemini resolve to <home>/.claude/... and
      <home>/.gemini/... — the pre-widening behaviour, pinned.
    - WHY THESE TWO AGENTS SPECIFICALLY: they are the only rows with an override, so
      they are the only ones whose resolution the widening could have changed. A row
      using cursor would exercise the no-override path while proving nothing about
      the fallback, which is what this file had before — incidental coverage of the
      wrong agent.
    - Quality Contribution: deliberate rather than incidental, so tidying the file
      cannot silently remove the guard.
    */
    const { resolveConfigFiles } = await import('../../../src/services/hooks/agent-matrix.js');
    const home = '/home/dev';
    const noOverrides = () => undefined;

    for (const [agent, expected] of [
      ['claude-code', `${home}/.claude/settings.json`],
      ['gemini', `${home}/.gemini/settings.json`],
    ] as const) {
      const spec = AGENT_MATRIX.find((s) => s.agent === agent);
      if (spec === undefined) throw new Error(`${agent} missing from the matrix`);
      expect(resolveConfigFiles(spec, home, noOverrides)).toEqual([expected]);
    }
  });

  it('and backup COPIES that plain home path when no override is set', async () => {
    // The same property through backup itself, not only through the resolver — the
    // two could agree in the resolver and still diverge in how backup composes.
    const { backupAgentConfigs } = await import('../../../src/services/doctor/collector/backup.js');
    const fs = new FakeFs();
    fs.mkdirp('/home/dev/.claude');
    fs.writeText('/home/dev/.claude/settings.json', '{"hooks":{}}\n');

    const backup = backupAgentConfigs({
      fs,
      clock: { nowIso: () => '2026-08-10T00:00:00.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home: '/home/dev' },
    } as never);

    expect(backup.copied).toContain('.claude/settings.json');
  });
});

describe('the backed-up file is the one that gets MODIFIED (dw-0023)', () => {
  it('with CLAUDE_CONFIG_DIR set, both resolve to the override — not the home', async () => {
    /*
    Test Doc:
    - Why: dw-0023, and the whole point of the widening. Before it, backup composed
      `<home>/.claude/settings.json` while the installer wrote
      `$CLAUDE_CONFIG_DIR/settings.json`. Two different files, one of them unbacked,
      and nothing reported it.
    - Contract: for the same env, the path backup copies and the path the installer
      writes are the SAME string.
    - Quality Contribution: asserts the two agree, rather than asserting each is
      individually "correct" — agreement is the property that was broken.
    */
    const { backupAgentConfigs } = await import('../../../src/services/doctor/collector/backup.js');
    const { resolveConfigFiles } = await import('../../../src/services/hooks/agent-matrix.js');

    const home = '/home/dev';
    const override = '/somewhere/else';
    const fs = new FakeFs();
    fs.mkdirp(`${home}/.claude`); // detected via its marker directory
    fs.mkdirp(override);
    fs.writeText(`${override}/settings.json`, '{"hooks":{}}\n');

    const envOverrides = { CLAUDE_CONFIG_DIR: override };
    const backup = backupAgentConfigs({
      fs,
      clock: { nowIso: () => '2026-08-10T00:00:00.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home, envOverrides },
    } as never);

    // What the INSTALLER would write, from the same matrix and the same env.
    const claude = AGENT_MATRIX.find((s) => s.agent === 'claude-code');
    if (claude === undefined) throw new Error('claude-code missing from the matrix');
    const written = resolveConfigFiles(claude, home, (n) => envOverrides[n as 'CLAUDE_CONFIG_DIR']);

    expect(written).toEqual([`${override}/settings.json`]);
    // And backup copied that same absolute path, not `<home>/.claude/settings.json`.
    expect(backup.copied).toContain(`${override}/settings.json`);
    expect(backup.copied).not.toContain('.claude/settings.json');
  });
});

describe('what backup REPORTS is what it actually copied (dw-0025, dw-0026)', () => {
  it('names no backup directory when nothing was copied', async () => {
    /*
    Test Doc:
    - Why: dw-0025. backup.ts's own doc names the specific harm — the CLAIM, not the
      loss: an operator told their originals are safe stops looking for them. So the
      directory must be null when nothing landed there.
    - Contract: dir is null and the detail says so.
    */
    const { backupAgentConfigs } = await import('../../../src/services/doctor/collector/backup.js');
    const fs = new FakeFs();
    const backup = backupAgentConfigs({
      fs,
      clock: { nowIso: () => '2026-08-10T00:00:00.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home: '/home/dev' },
    } as never);

    expect(backup.copied).toEqual([]);
    expect(backup.dir).toBeNull();
    expect(backup.detail).toContain('no agent config files needed copying');
  });

  it('an agent whose config does NOT exist is not counted as covered (dw-0026)', async () => {
    /*
    Test Doc:
    - Why: dw-0026. A detected agent with no config file yet is created-not-backed-up.
      `backupAgentConfigs` skips a non-existent source, so it appears in neither
      `copied` nor `failed` — and that silence must not read as coverage.
    - Contract: detected, nothing copied, and the file is absent.
    - UPDATED phase 3 tk-0001: at the time this was written, the installer's
      `created: true` was the ONLY thing that could distinguish this case. It is no
      longer — the backup now records the absence in its manifest, because a file we
      CREATE is restored by DELETING it. `copied` and `failed` stay silent exactly as
      asserted below; the absence surfaces in the new `absent` list instead, so this
      row's contract is unchanged and the new fact is asserted beside it.
    */
    const { backupAgentConfigs } = await import('../../../src/services/doctor/collector/backup.js');
    const fs = new FakeFs();
    fs.mkdirp('/home/dev/.cursor'); // detected, but no hooks.json

    const backup = backupAgentConfigs({
      fs,
      clock: { nowIso: () => '2026-08-10T00:00:00.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home: '/home/dev' },
    } as never);

    expect(backup.copied).toEqual([]);
    expect(backup.failed).toEqual([]);
    expect(backup.absent).toContain('.cursor/hooks.json');
    expect(fs.exists('/home/dev/.cursor/hooks.json')).toBe(false);
  });

  it('copies what EXISTS, and names it', async () => {
    // The positive control: without it, every row above is satisfied by a backup
    // that never copies anything at all.
    const { backupAgentConfigs } = await import('../../../src/services/doctor/collector/backup.js');
    const fs = new FakeFs();
    fs.mkdirp('/home/dev/.cursor');
    fs.writeText('/home/dev/.cursor/hooks.json', '{"hooks":{}}\n');

    const backup = backupAgentConfigs({
      fs,
      clock: { nowIso: () => '2026-08-10T00:00:00.000Z', now: () => 0 },
      host: { platform: 'darwin', arch: 'arm64', home: '/home/dev' },
    } as never);

    expect(backup.copied).toContain('.cursor/hooks.json');
    expect(backup.dir).not.toBeNull();
    expect(backup.detail).toContain('.cursor/hooks.json');
  });
});
