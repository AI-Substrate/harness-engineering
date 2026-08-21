import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../../src/adapters/fs/node-fs.js';
import {
  BACKUP_MANIFEST_NAME,
  backupAgentConfigs,
  type ConfigBackup,
  restoreAgentConfigs,
} from '../../../../src/services/doctor/collector/backup.js';

/*
File Doc — plan 082 phase 3, tk-0001. THE RESTORE POINT, PROVEN BEFORE THE FENCE
COMES DOWN.

WHY THIS FILE IS AN INT TEST AND NOT A UNIT ONE (dw-0002). This is the path whose
entire purpose is to work when something has already gone wrong. A FakeFs restore
proves the bookkeeping and nothing about the filesystem — and the defect this task
exists to close was a real-path defect: the `__` flatten was measured
non-invertible against the REAL fs, with an override directory whose own name
carried the separator. So every row here runs against NodeFs in a real temp tree.

WHAT WAS MEASURED, before any of this was written (2026-08-10, macOS arm64):

  source  /var/…/cfg__a/settings.json
  stored  __var__…__cfg__a__settings.json
  inverse /var/…/cfg/a/settings.json      <- a DIFFERENT file

and — the part that matters for how this file is built — `.cursor/hooks.json`
flattened to `.cursor__hooks.json` and inverted back PERFECTLY. A demonstration
using only the paths we expect on this machine would have gone green against a
mapping that cannot restore. That is why dw-0003 exists and why it is not
optional.

THE HOME IS ALWAYS A TEMP DIR. No row here reads or writes the real home; the
whole point of task one is that it runs BEFORE anything does.
*/

const NOW = '2026-08-10T00:00:00.000Z';

/** Bytes chosen so "byte-identical" means more than "same JSON". */
const CURSOR_BYTES = Buffer.from(
  '// a JSONC comment git-ai would discard\r\n{ "hooks": { "afterFileEdit": [] } }\t\r\n  ',
  'utf8',
);
const CLAUDE_BYTES = Buffer.from('{\n  "note": "café ☕",\n  "hooks": {}\n}', 'utf8');

/**
 * The LOGICAL spelling of a native path — the shape the backup surfaces.
 *
 * `backup.copied`, the manifest `source`, and therefore `outcome.restored` /
 * `outcome.deleted` are all paths this service SURFACES, and a surfaced path is
 * forward-slashed on every OS by rule (`services/shared/posix-path.ts`), with the
 * native `home` converted once at the boundary. Comparing against a native
 * `path.join` asserts a shape the surface does not promise — invisibly, because the
 * two spellings coincide on macOS. These rows failed only on Windows (plan 083).
 */
const logical = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^([a-z]):/, (_m, drive: string) => `${drive.toUpperCase()}:`);

function makeDeps(home: string, envOverrides: Record<string, string> = {}) {
  return {
    fs: new NodeFs(),
    clock: { nowIso: () => NOW, now: () => 0 },
    host: { platform: 'darwin', arch: 'arm64', home, envOverrides },
  } as never;
}

describe('the backup is a restore point, and the restore is DEMONSTRATED (tk-0001)', () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-restore-'));
    home = join(root, 'home');
    mkdirSync(home, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function backupOf(envOverrides: Record<string, string> = {}): ConfigBackup {
    return backupAgentConfigs(makeDeps(home, envOverrides));
  }

  it('capture, MUTATE, restore — the file comes back byte-identical (dw-0001, dw-0002)', () => {
    /*
    Test Doc:
    - Why: dw-0001 and dw-0002. Before task one there was no code path anywhere that
      put a backed-up file back. "We take a backup first" was reassurance doing no
      work. This is the row that makes it do work, and it runs on the real fs.
    - Contract: after a destructive rewrite, restore returns the ORIGINAL BYTES —
      compared as a Buffer, not as parsed JSON, so a lost comment, a changed line
      ending or a dropped trailing space each turn it red.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const config = join(home, '.cursor', 'hooks.json');
    writeFileSync(config, CURSOR_BYTES);

    const backup = backupOf();
    expect(backup.failed).toEqual([]);
    expect(backup.copied).toContain('.cursor/hooks.json');
    expect(backup.dir).not.toBeNull();

    // Destroy it the way git-ai does: valid JSON, reformatted, comment gone.
    writeFileSync(config, '{"hooks":{"afterFileEdit":[{"command":"other"}]}}\n');
    expect(readFileSync(config).equals(CURSOR_BYTES)).toBe(false);

    const outcome = restoreAgentConfigs(new NodeFs(), backup.dir as string);
    expect(outcome.failed).toEqual([]);
    expect(outcome.restored).toContain(logical(config));
    expect(readFileSync(config).equals(CURSOR_BYTES)).toBe(true);
  });

  it('a path with __ IN ITS OWN NAME round-trips — the case the old flatten broke (dw-0003)', () => {
    /*
    Test Doc:
    - Why: dw-0003, and it is the row that decided the design. The old mapping
      substituted `__` for `/`, which is not injective: an override directory named
      `cfg__a` inverted to `cfg/a`. MEASURED against the real function on the real
      filesystem before this was rewritten — see the file doc for the exact strings.
      The fix is not a cleverer encoding; it is not encoding at all. The manifest
      records the absolute source, and the copy keeps the path verbatim.
    - Contract: a source whose directory name contains the old separator restores to
      ITSELF. Asserted on the path as well as the bytes, because the failure mode is
      writing correct bytes to the wrong file — which leaves the damaged original
      untouched and looks like success.
    */
    mkdirSync(join(home, '.claude'), { recursive: true }); // detection marker
    const overrideDir = join(root, 'cfg__a');
    mkdirSync(overrideDir, { recursive: true });
    const config = join(overrideDir, 'settings.json');
    writeFileSync(config, CLAUDE_BYTES);

    const backup = backupOf({ CLAUDE_CONFIG_DIR: overrideDir });
    expect(backup.failed).toEqual([]);
    expect(backup.copied).toContain(logical(config));

    writeFileSync(config, '{"clobbered":true}');
    const outcome = restoreAgentConfigs(new NodeFs(), backup.dir as string);

    expect(outcome.failed).toEqual([]);
    expect(outcome.restored).toEqual([logical(config)]);
    expect(readFileSync(config).equals(CLAUDE_BYTES)).toBe(true);
    // The wrong path the old inverse would have produced must NOT have been created.
    expect(existsSync(join(root, 'cfg', 'a', 'settings.json'))).toBe(false);
  });

  it('restoring a file that did NOT exist means DELETING it (dw-0004)', () => {
    /*
    Test Doc:
    - Why: dw-0004. Our installer CREATES a config when a detected agent has none
      (`install-strategy-a`, phase 2 tk-0005). For that file the original state is
      ABSENCE, so a restore that only ever rewrites bytes leaves our entry on the
      machine forever and reports success. Phase 2 could only see this case through
      the installer's own `created: true`; the backup now records it.
    - Contract: the absence is in the manifest, and the restore removes the file the
      install created — asserted on the filesystem, not on the outcome alone.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true }); // detected, no hooks.json
    const config = join(home, '.cursor', 'hooks.json');
    expect(existsSync(config)).toBe(false);

    const backup = backupOf();
    expect(backup.absent).toContain('.cursor/hooks.json');
    expect(backup.copied).toEqual([]);
    expect(backup.failed).toEqual([]);
    // `dir` stays null when nothing was COPIED — the phase 2 claim contract, kept —
    // so the manifest is found from the deterministic location instead.
    const dir = join(home, '.git-ai', 'harness-backups', NOW.replace(/[:.]/g, '-'));
    expect(existsSync(join(dir, BACKUP_MANIFEST_NAME))).toBe(true);

    writeFileSync(config, '{"hooks":{"afterFileEdit":[{"command":"harness hooks fire"}]}}\n');

    const outcome = restoreAgentConfigs(new NodeFs(), dir);
    expect(outcome.failed).toEqual([]);
    expect(outcome.deleted).toEqual([logical(config)]);
    expect(existsSync(config)).toBe(false);
  });

  it('a second restore of the same backup is a no-op, not a failure', () => {
    /*
    Test Doc:
    - Why: an operator who is already in trouble runs the recovery twice. The
      recorded-absent file is gone after the first pass, and a restore that reported
      that as a failure would send someone looking for a problem that is not there.
    - Contract: rerunning restores the same bytes and reports the absence as
      already-absent rather than as an error.
    */
    mkdirSync(join(home, '.cursor'), { recursive: true });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'hooks.json'), CURSOR_BYTES);

    const backup = backupOf();
    const dir = backup.dir as string;
    restoreAgentConfigs(new NodeFs(), dir);
    const second = restoreAgentConfigs(new NodeFs(), dir);

    expect(second.failed).toEqual([]);
    expect(readFileSync(join(home, '.cursor', 'hooks.json')).equals(CURSOR_BYTES)).toBe(true);
    expect(second.alreadyAbsent.length).toBeGreaterThan(0);
    expect(second.deleted).toEqual([]);
  });

  it('a directory with no manifest is REFUSED rather than reported as a clean restore', () => {
    /*
    Test Doc:
    - Why: the harm this module's own doc names is the CLAIM, not the loss — an
      operator told their originals are safe stops looking for them. A restore that
      finds nothing to do and says "restored 0 files" is that same harm on the way
      out.
    - Contract: a missing manifest is a failure with a reason, never an empty success.
    */
    const empty = join(root, 'not-a-backup');
    mkdirSync(empty, { recursive: true });

    const outcome = restoreAgentConfigs(new NodeFs(), empty);
    expect(outcome.failed.length).toBe(1);
    expect(outcome.failed[0]).toContain(BACKUP_MANIFEST_NAME);
    expect(outcome.detail).toContain('refused');
  });

  it('a manifest from a layout this build does not understand is REFUSED', () => {
    /*
    Test Doc:
    - Why: the stored tree is human-readable on purpose, which means a future layout
      change would leave old directories on disk that LOOK restorable. Restoring one
      through the wrong reader is how you write the right bytes to the wrong path —
      the exact failure the flatten had.
    - Contract: an unrecognised version refuses and names the mismatch.
    */
    const dir = join(root, 'old-layout');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, BACKUP_MANIFEST_NAME),
      JSON.stringify({ version: 99, takenAt: NOW, home, entries: [] }),
    );

    const outcome = restoreAgentConfigs(new NodeFs(), dir);
    expect(outcome.failed[0]).toContain('99');
    expect(outcome.restored).toEqual([]);
  });
});
