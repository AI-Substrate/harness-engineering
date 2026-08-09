import { describe, expect, it } from 'vitest';
import {
  cursorSandboxRow,
  permissionsPathFor,
  readCursorSandbox,
} from '../../../../src/services/doctor/collector/cursor-sandbox.js';
import type { HostTarget } from '../../../../src/services/doctor/collector/types.js';
import { FakeCollectorFs } from '../../../support/collector-fakes.js';

/**
 * #144 — the Cursor sandbox allowlist row.
 *
 * The row is DIAGNOSTIC. Two properties matter more than any string in it, and
 * both are pinned below:
 *
 *   - it never claims the collector is unreachable (F-11 observed the socket
 *     reachable from INSIDE a sandbox, so a config-driven verdict would have
 *     called that healthy session blocked)
 *   - it never tells anyone to edit their Cursor config (the acceptance
 *     criterion is telemetry without customising the machine, and `&&`-chained
 *     commands defeat the allowlist anyway)
 */

const HOME = '/home/u';
const host: HostTarget = { platform: 'darwin', arch: 'arm64', home: HOME };
const PERMS = permissionsPathFor(HOME);

/** A Cursor marker plus whatever permissions.json content the case needs. */
function fsWith(permissions?: string, marker = true): FakeCollectorFs {
  const seed: Record<string, string> = {};
  if (permissions !== undefined) seed[PERMS] = permissions;
  const fs = new FakeCollectorFs(seed);
  // `detectAgents` is a marker-path existence test, so the directory is enough.
  if (marker) fs.dirs.add(`${HOME}/.cursor`);
  return fs;
}

const allowlist = (...cmds: string[]) => JSON.stringify({ terminalAllowlist: cmds });

describe('#144 — cursor sandbox allowlist row', () => {
  it('no Cursor marker → NO ROW at all', () => {
    // The question does not apply. Silence, not "cannot tell".
    expect(cursorSandboxRow(fsWith(allowlist('git', 'harness'), false), host)).toBeNull();
  });

  it('git AND harness both allowlisted → NO ROW (silent when healthy)', () => {
    // Asserting the ABSENCE, because a row that is silent when healthy is
    // otherwise indistinguishable from one that never runs.
    expect(cursorSandboxRow(fsWith(allowlist('git', 'harness')), host)).toBeNull();
  });

  it('git missing → names `harness commit`, and never instructs a config edit', () => {
    const row = cursorSandboxRow(fsWith(allowlist('harness', 'ls')), host);
    expect(row).not.toBeNull();
    expect(row?.detail).toContain('`git` is not on');
    expect(row?.next_action).toContain('harness commit');
    // The prohibition, pinned rather than trusted: no instruction to edit the
    // allowlist, permissions.json, or anything under ~/.cursor.
    const text = `${row?.detail} ${row?.next_action}`.toLowerCase();
    expect(text).not.toContain('add `git` to');
    expect(text).not.toContain('edit ');
    expect(text).not.toContain('permissions.json');
  });

  it('harness missing → says the REMEDY ITSELF is degraded', () => {
    // The quieter, worse case: recommending a fix that cannot complete is the
    // failure this row exists to prevent.
    const row = cursorSandboxRow(fsWith(allowlist('git')), host);
    expect(row?.detail).toContain('the remedy');
    expect(row?.detail).toContain('nothing leaves');
    expect(row?.next_action).toContain('UNSANDBOXED');
  });

  it('both missing → reports both, and still degrades the remedy', () => {
    const row = cursorSandboxRow(fsWith(allowlist('ls')), host);
    expect(row?.detail).toContain('`git` is not on');
    expect(row?.detail).toContain('`harness` is not on');
    expect(row?.next_action).toContain('UNSANDBOXED');
  });

  it('permissions.json absent → CANNOT TELL, which is neither green nor alarm', () => {
    const row = cursorSandboxRow(fsWith(undefined), host);
    expect(row?.detail).toContain('cannot-tell');
    expect(row?.detail).toContain('UNKNOWN');
    // Explicitly not an alarm: it says so in words, because a reader who sees a
    // degraded row assumes something is broken.
    expect(row?.detail).toContain('not a report that anything is wrong');
  });

  it('malformed JSON → CANNOT TELL, never a throw and never a green', () => {
    expect(() => cursorSandboxRow(fsWith('{ not json'), host)).not.toThrow();
    const row = cursorSandboxRow(fsWith('{ not json'), host);
    expect(row?.detail).toContain('cannot-tell');
    // A fresh install has no file at all, and a corrupt one tells us nothing —
    // absent is NOT permissive in either shape.
    expect(row?.detail).not.toContain('is not on');
  });

  it('a terminalAllowlist that is not an array → CANNOT TELL', () => {
    const row = cursorSandboxRow(fsWith(JSON.stringify({ terminalAllowlist: 'git' })), host);
    expect(row?.detail).toContain('cannot-tell');
  });

  it('THE F-11 GUARD: a missing entry never claims the collector is unreachable', () => {
    // F-11 measured the socket REACHABLE from inside a sandbox. If this row ever
    // asserts unreachability from config alone, it contradicts a probe that has
    // actually connected — a confident wrong answer in place of a diagnostic.
    for (const list of [allowlist('ls'), allowlist('git'), allowlist('harness')]) {
      const row = cursorSandboxRow(fsWith(list), host);
      const text = `${row?.detail} ${row?.next_action}`;
      expect(text).not.toMatch(/is unreachable|cannot reach|is blocked|not reachable/i);
      // It must stay in the language of permission, not of outcome.
      expect(text).toMatch(/MAY not reach|does not permit/i);
    }
  });

  it('matches the COMMAND head, so `git commit -v` allowlists git', () => {
    const row = cursorSandboxRow(fsWith(allowlist('git commit -v', 'harness')), host);
    expect(row).toBeNull();
  });

  it('reads ~/.cursor/permissions.json — not Application Support settings.json', () => {
    // Two people lost time on the obvious-but-wrong path; pin the real one.
    expect(permissionsPathFor(HOME)).toBe('/home/u/.cursor/permissions.json');
    expect(permissionsPathFor(HOME)).not.toContain('Application Support');
  });

  it('WRITES NOTHING — a diagnostic must not touch ~/.cursor', () => {
    const fs = fsWith(allowlist('ls'));
    cursorSandboxRow(fs, host);
    expect(fs.writes).toEqual([]);
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
  });

  it('readCursorSandbox reports per-command status, with unknown distinct from absent', () => {
    expect(readCursorSandbox(fsWith(allowlist('git')), HOME).status).toEqual({
      git: 'permitted',
      harness: 'absent',
    });
    expect(readCursorSandbox(fsWith(undefined), HOME).status).toEqual({
      git: 'unknown',
      harness: 'unknown',
    });
  });
});
