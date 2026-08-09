import { describe, expect, it } from 'vitest';
import {
  cursorSandboxRow,
  permissionsPathFor,
  readCursorSandbox,
  readSandboxNetwork,
  sandboxPathsFor,
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

/**
 * The `networkPolicy` half — added after a measured session (plan 082 dossier
 * §3, §6) established that the ALLOWLIST IS NOT THE DECIDING SETTING.
 *
 * Three measurements drive every case below:
 *
 *   - a sandboxed Cursor shell got EPERM on both git-ai daemon sockets
 *   - `git` was ALREADY allowlisted and the commit still ran sandboxed, because
 *     the agent wrote a compound `git add -A && git commit …` chain unprompted
 *   - `networkPolicy.allow` takes hosts/wildcards/CIDR, and a unix socket has no
 *     domain — so ONLY `default: "allow"` can ever reach it
 *
 * Reading the allowlist alone was therefore wrong in BOTH directions, and both
 * directions are pinned here.
 */
const SANDBOX_HOME = `${HOME}/.cursor/sandbox.json`;
const WORKSPACE = '/repo';
const SANDBOX_REPO = `${WORKSPACE}/.cursor/sandbox.json`;
const netPolicy = (dflt: string) => JSON.stringify({ networkPolicy: { default: dflt } });

/** Cursor marker + optional permissions.json + optional sandbox.json files. */
function fsWithSandbox(seed: Record<string, string>): FakeCollectorFs {
  const fs = new FakeCollectorFs(seed);
  fs.dirs.add(`${HOME}/.cursor`);
  return fs;
}

describe('#144 — networkPolicy is the deciding setting', () => {
  it('THE FALSE ALARM: default "allow" → NO ROW even with nothing allowlisted', () => {
    // Auto-Run Network Access = Allow All was MEASURED to connect both sockets.
    // Warning about the allowlist here would report a risk the config lifted.
    const fs = fsWithSandbox({ [PERMS]: allowlist('ls'), [SANDBOX_HOME]: netPolicy('allow') });
    expect(cursorSandboxRow(fs, host)).toBeNull();
  });

  it('THE FALSE SILENCE: a restrictive policy rows EVEN WITH git+harness allowlisted', () => {
    // This is the case the first cut of #144 could not see at all: it read the
    // allowlist, found both commands, and went silent on a machine whose network
    // policy does not permit the socket.
    const fs = fsWithSandbox({
      [PERMS]: allowlist('git', 'harness'),
      [SANDBOX_HOME]: netPolicy('deny'),
    });
    const row = cursorSandboxRow(fs, host);
    expect(row).not.toBeNull();
    expect(row?.detail).toMatch(/networkPolicy\.default/);
  });

  it('says a unix socket has no domain, so no allowlist entry can ever match it', () => {
    // The reason the remedy is `harness commit` and not "add an entry".
    const fs = fsWithSandbox({ [PERMS]: allowlist('ls'), [SANDBOX_HOME]: netPolicy('deny') });
    expect(cursorSandboxRow(fs, host)?.detail).toMatch(/unix socket has no domain/i);
  });

  it('a restrictive policy degrades the REMEDY, because harness is sandboxed too', () => {
    const fs = fsWithSandbox({
      [PERMS]: allowlist('git', 'harness'),
      [SANDBOX_HOME]: netPolicy('deny'),
    });
    expect(cursorSandboxRow(fs, host)?.next_action).toMatch(/UNSANDBOXED/);
  });

  it('PER-REPO PRIORITY: the workspace file outranks the user file', () => {
    // Nothing is allowlisted, so the ONLY thing that can produce silence here is
    // the network policy — otherwise this passes via the allowlist and asserts
    // nothing about priority at all. (A first cut did exactly that: it survived
    // a mutant that deleted the policy short-circuit outright.)
    const fs = fsWithSandbox({
      [PERMS]: allowlist('ls'),
      [SANDBOX_HOME]: netPolicy('allow'),
      [SANDBOX_REPO]: netPolicy('deny'),
    });
    // Repo says deny and outranks home's allow → a row.
    expect(cursorSandboxRow(fs, host, WORKSPACE)).not.toBeNull();
    // …same tree, no workspace passed → only the user file is read → allow → silent.
    expect(cursorSandboxRow(fs, host)).toBeNull();
  });

  it('a per-repo file stating NO default falls through to the user file', () => {
    // Deliberately assumes least: a file that expressed no opinion does not get
    // to decide, and we have not measured whether Cursor inherits or resets.
    // Again nothing is allowlisted, so silence can only come from reaching the
    // user file's `allow` — which is precisely the fall-through under test.
    const fs = fsWithSandbox({
      [PERMS]: allowlist('ls'),
      [SANDBOX_HOME]: netPolicy('allow'),
      [SANDBOX_REPO]: JSON.stringify({ somethingElse: true }),
    });
    expect(cursorSandboxRow(fs, host, WORKSPACE)).toBeNull();
  });

  it('ABSENT IS NOT PERMISSIVE: no sandbox.json is `unknown`, never `allow`', () => {
    // If absent read as permissive, the row would go silent on every machine
    // that has never written the file — i.e. almost all of them.
    expect(readSandboxNetwork(fsWithSandbox({}), HOME).policy).toBe('unknown');
    expect(readSandboxNetwork(fsWithSandbox({}), HOME).unreadable).toMatch(/does not exist/);
  });

  it('an unknown policy alongside a missing entry SAYS the deciding setting went unread', () => {
    // Otherwise the allowlist prose implies it is the whole story.
    const fs = fsWithSandbox({ [PERMS]: allowlist('ls') });
    expect(cursorSandboxRow(fs, host)?.detail).toMatch(/not the whole picture/);
  });

  it('malformed sandbox.json is `unknown` — never a throw, never a verdict', () => {
    const fs = fsWithSandbox({
      [PERMS]: allowlist('git', 'harness'),
      [SANDBOX_HOME]: '{ not json',
    });
    expect(readSandboxNetwork(fs, HOME).policy).toBe('unknown');
    // …and an unreadable deciding setting with a clean allowlist stays SILENT
    // rather than inventing an alarm from a file it could not parse.
    expect(cursorSandboxRow(fs, host)).toBeNull();
  });

  it('the path carries the .cursor/ SUBDIR the settings UI omits', () => {
    // Writing it one level too high cost a measured attempt on 2026-08-09.
    expect(sandboxPathsFor(HOME)).toEqual([`${HOME}/.cursor/sandbox.json`]);
    expect(sandboxPathsFor(HOME, WORKSPACE)).toEqual([
      SANDBOX_REPO,
      `${HOME}/.cursor/sandbox.json`,
    ]);
  });

  it('a repo checked out AT $HOME reads one file, not two agreeing sources', () => {
    expect(sandboxPathsFor(HOME, HOME)).toEqual([`${HOME}/.cursor/sandbox.json`]);
  });

  it('THE F-11 GUARD, network half: a restrictive policy never claims unreachable', () => {
    // F-11 observed the socket REACHABLE from inside a sandbox. So even the
    // strongest config signal we can read must say PERMITS, never GUARANTEES —
    // a connected probe outranks this row always.
    const fs = fsWithSandbox({ [PERMS]: allowlist('ls'), [SANDBOX_HOME]: netPolicy('deny') });
    const row = cursorSandboxRow(fs, host);
    expect(row?.detail).not.toMatch(/is unreachable|cannot reach|is blocked|will fail/i);
    expect(row?.detail).toMatch(/does not PERMIT/);
    expect(row?.next_action).toMatch(/only what the config PERMITS/);
  });

  it('WRITES NOTHING to ~/.cursor, sandbox.json included', () => {
    const fs = fsWithSandbox({ [PERMS]: allowlist('ls'), [SANDBOX_HOME]: netPolicy('deny') });
    cursorSandboxRow(fs, host, WORKSPACE);
    expect(fs.writes).toEqual([]);
    expect(fs.renames).toEqual([]);
    expect(fs.deletes).toEqual([]);
  });
});
