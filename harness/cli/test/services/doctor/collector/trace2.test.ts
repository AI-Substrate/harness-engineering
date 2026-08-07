import { describe, expect, it } from 'vitest';
import { FakeExec } from '../../../../src/adapters/exec/fake-exec.js';
import {
  manualHookInstructions,
  mayInstallHooks,
  readGlobalTrace2,
  verifyInstalledTrace2,
} from '../../../../src/services/doctor/collector/trace2.js';

/**
 * Plan 073 · ac-0008 — the trace2 guard, per o-prime's ruling of 2026-08-06.
 *
 * git-ai's `install-hooks` opens by deleting the entire global `trace2` section
 * — machine-wide, every repo — and re-applies that on EVERY invocation. Harness
 * never performs that deletion and never asks permission to, because it does not
 * offer to do it: a non-empty trace2 config means the hooks are simply not
 * installed, and the operator is told exactly why.
 */

const NOW = '2026-08-06T10:00:00.000Z';
const GET = 'git config --global --get-regexp ^trace2\\.';

describe('readGlobalTrace2 — the three readings', () => {
  it('git exit 1 with no output → EMPTY, and empty is the only thing that proceeds', async () => {
    const exec = new FakeExec({ [GET]: { code: 1, stdout: '' } });

    const reading = await readGlobalTrace2({ exec, cwd: '/repo' }, NOW);

    expect(reading.status).toBe('empty');
    expect(reading.entries).toEqual([]);
    expect(reading.observedAt).toBe(NOW);
    expect(mayInstallHooks(reading)).toBe(true);
  });

  it('git exit 0 with keys → PRESENT, naming exactly what is there', async () => {
    const exec = new FakeExec({
      [GET]: {
        code: 0,
        stdout: 'trace2.eventTarget /Users/x/.trace2\ntrace2.eventNesting 2\n',
      },
    });

    const reading = await readGlobalTrace2({ exec, cwd: '/repo' }, NOW);

    expect(reading.status).toBe('present');
    expect(reading.entries).toEqual([
      'trace2.eventTarget /Users/x/.trace2',
      'trace2.eventNesting 2',
    ]);
    expect(reading.detail).toContain('machine-wide');
    expect(mayInstallHooks(reading)).toBe(false);
  });

  it('an unreadable config → UNKNOWN, which is treated as present (fails closed)', async () => {
    const exec = new FakeExec({ [GET]: { code: 128, stderr: 'fatal: not a git repository' } });

    const reading = await readGlobalTrace2({ exec, cwd: '/repo' }, NOW);

    expect(reading.status).toBe('unknown');
    expect(mayInstallHooks(reading)).toBe(false);
    expect(reading.detail).toContain('treating as PRESENT');
  });

  it('an exec that throws → UNKNOWN rather than an exception into doctor', async () => {
    const exploding = {
      run: async () => {
        throw new Error('git not found');
      },
    };

    const reading = await readGlobalTrace2({ exec: exploding, cwd: '/repo' }, NOW);

    expect(reading.status).toBe('unknown');
    expect(mayInstallHooks(reading)).toBe(false);
  });
});

describe('readGlobalTrace2 — the read itself is non-destructive', () => {
  it('invokes exactly one read-only git config command', async () => {
    const exec = new FakeExec({ [GET]: { code: 1, stdout: '' } });

    await readGlobalTrace2({ exec, cwd: '/repo' }, NOW);

    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]?.args).toEqual(['config', '--global', '--get-regexp', '^trace2\\.']);
    // Nothing that could write: no --unset, no --remove-section, no --replace-all.
    const line = [exec.calls[0]?.command, ...(exec.calls[0]?.args ?? [])].join(' ');
    expect(line).not.toMatch(/--unset|--remove-section|--replace-all|--add/);
  });

  it('never deletes a trace2 config — the module contains no destructive git verb', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../src/services/doctor/collector/trace2.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(/'--unset'|'--remove-section'|'--replace-all'/);
  });
});

describe('mayInstallHooks — observed-empty is the SOLE automatic path', () => {
  const reading = (entries: string[]) =>
    ({
      status: 'present',
      entries,
      detail: 'present',
      observedAt: NOW,
    }) as const;

  /**
   * The reverted exception (phase-1 review, round 2 P0). It let a re-check
   * overwrite a trace2 config made only of git-ai's OWN key names, on the
   * strength of a gitignored workspace JSON file saying we had installed before.
   * Two failures: that file is forgeable by copying, and — with no bad actor at
   * all — an operator who sets their own `trace2.eventTarget` after our install
   * would have had the whole section deleted on the next re-check.
   */
  it("git-ai's OWN keys do not unlock a re-install, however the state file reads", () => {
    expect(
      mayInstallHooks(
        reading([
          'trace2.eventTarget af_unix:/home/u/.git-ai/internal/daemon/trace2.sock',
          'trace2.eventNesting 5',
        ]),
      ),
    ).toBe(false);
  });

  it('ignores any "we installed before" hint a caller might still pass', () => {
    // The old signature took `{ priorInstallVerified }` and returned TRUE here.
    const guard = mayInstallHooks as (r: unknown, o?: unknown) => boolean;
    expect(guard(reading(['trace2.eventTarget /tmp/t']), { priorInstallVerified: true })).toBe(
      false,
    );
  });
});

describe('verifyInstalledTrace2 — the key, not a prefix of it', () => {
  const present = (entries: string[]) =>
    ({ status: 'present', entries, detail: 'present', observedAt: NOW }) as const;

  it("git-ai's key, space-delimited as git prints it → verified", () => {
    expect(
      verifyInstalledTrace2(
        present(['trace2.eventtarget af_unix:/home/u/.git-ai/internal/daemon/trace2.sock']),
      ).status,
    ).toBe('verified');
  });

  it('the key in git’s other spellings — `=` delimited, mixed case → verified', () => {
    expect(verifyInstalledTrace2(present(['trace2.eventTarget=/tmp/t'])).status).toBe('verified');
  });

  /**
   * The round-2 P1 regression. `startsWith('trace2.eventtarget')` accepted these
   * as proof git-ai had installed hooks, so a stray near-prefix key after a
   * zero-exit no-op recorded `installed`.
   */
  it('a NEAR-PREFIX key is not proof of anything', () => {
    for (const near of [
      'trace2.eventtarget_custom /tmp/t',
      'trace2.eventtargetanything /tmp/t',
      'trace2.eventTargetX=/tmp/t',
    ]) {
      const verdict = verifyInstalledTrace2(present([near]));
      expect(verdict.status, near).toBe('absent');
      expect(verdict.detail).toContain('did NOT write');
    }
  });

  it('an empty post-install config → absent; an unreadable one → unreadable', () => {
    expect(
      verifyInstalledTrace2({ status: 'empty', entries: [], detail: '', observedAt: NOW }).status,
    ).toBe('absent');
    expect(
      verifyInstalledTrace2({ status: 'unknown', entries: [], detail: 'x', observedAt: NOW })
        .status,
    ).toBe('unreadable');
  });
});

describe('manualHookInstructions — the operator keeps the destructive step', () => {
  it('tells them to back up first, then run install-hooks themselves', () => {
    const lines = manualHookInstructions('/home/u/.git-ai/bin/git-ai', [
      'trace2.eventTarget /Users/x/.trace2',
    ]);

    expect(lines.join('\n')).toContain('trace2.eventTarget /Users/x/.trace2');
    expect(lines.join('\n')).toContain('git config --global --get-regexp');
    expect(lines.join('\n')).toContain('/home/u/.git-ai/bin/git-ai install-hooks');
  });
});
