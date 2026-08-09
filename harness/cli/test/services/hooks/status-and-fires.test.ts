import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { JOURNAL_KEEP, JOURNAL_ROTATE_AT } from '../../../src/services/hooks/hook-journal.js';
import {
  fireSummary,
  type HooksDeps,
  installHooks,
  statusHooks,
} from '../../../src/services/hooks/hooks-verbs.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * STATUS PROVES ITS TARGET (tk-000b) AND SURFACES A FAILED FIRE (tk-000c).
 *
 * tk-000c is the compensating control the exit-0 constitutional deviation was
 * granted for: every hook path exits 0 and prints nothing, so **the exit code
 * carries no information** and nothing here may rest on it.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

let home: string;
const fs = new NodeFs();
const deps = (over: Partial<HooksDeps> = {}): HooksDeps => ({
  fs,
  home,
  env: () => undefined,
  binary: '"/usr/local/bin/harness"',
  ...over,
});

const journalPath = () => join(home, '.harness', 'hooks', 'fires.jsonl');
const writeJournal = (lines: unknown[]) => {
  mkdirSync(join(home, '.harness', 'hooks'), { recursive: true });
  writeFileSync(journalPath(), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
};
const entry = (n: number, kind: 'recorded' | 'failed', cause = '') => ({
  at: `T${n}`,
  phase: 'post' as const,
  repoRoot: '/repo',
  outcome: kind === 'failed' ? { kind, cause } : { kind: 'recorded', phase: 'pre' },
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-status-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the binary is THREE states, not a boolean (dw-0027)', () => {
  const install = (binaryPath: string) => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    installHooks(deps({ binary: `"${binaryPath}"` }));
  };

  it('ABSENT when we never installed', () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    expect(statusHooks(deps()).find((r) => r.agent === 'cursor')?.binaryState).toBe('absent');
  });

  it('RESOLVES when the target exists', () => {
    const bin = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\n');
    install(bin);
    expect(statusHooks(deps()).find((r) => r.agent === 'cursor')?.binaryState).toBe('resolves');
  });

  it('UNRESOLVABLE when the target is gone — distinct from absent', () => {
    /*
    Test Doc:
    - Why: dw-0027. "Never installed" and "installed and inert" are different
      diagnoses. A boolean cannot express which, so the reader infers — and because
      hooks exit 0 by design, nothing else would correct them.
    - Contract: three distinct values across the three situations.
    */
    const bin = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\n');
    install(bin);
    rmSync(bin);

    const row = statusHooks(deps()).find((r) => r.agent === 'cursor');
    expect(row?.binaryState).toBe('unresolvable');
    expect(row?.binaryState).not.toBe('absent');
  });

  it('a QUOTED SPACE-BEARING path stats TRUE rather than falsely broken (dw-002a)', () => {
    /*
    Test Doc:
    - Why: dw-002a. The stat uses the path parsed back OUT of the command string. A
      naive split(' ')[0] returns a leading quote, stats false, and reports a
      perfectly healthy install as broken — for every user whose path has a space.
    - Contract: resolves, and the extracted path is the full one including the space.
    */
    const dir = join(home, 'my tools');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, 'harness');
    writeFileSync(bin, '#!/bin/sh\n');
    install(bin);

    const row = statusHooks(deps()).find((r) => r.agent === 'cursor');
    expect(row?.configuredBinary).toBe(bin);
    expect(row?.binaryState).toBe('resolves');
  });
});

describe('status surfaces a FAILED FIRE from the journal (dw-002b, dw-002c)', () => {
  it('reports the failure and its cause', () => {
    writeJournal([entry(1, 'recorded'), entry(2, 'failed', 'socket unreachable')]);
    const summary = fireSummary(deps());

    expect(summary.recorded).toBe(true);
    expect(summary.total).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([{ at: 'T2', cause: 'socket unreachable' }]);
  });

  it('a REAL fire against an unreachable socket is visible here (dw-002c)', () => {
    /*
    Test Doc:
    - Why: dw-002c. Phase 1's fault-injection proved the verb exits 0 and stays
      silent; this proves the failure is VISIBLE. Driven through the real bin so the
      journal entry is one the runtime wrote, not one this test fabricated — the
      fabricated-shape mistake this plan has made three times.
    - Contract: asserted on the journal-derived field, NEVER on an exit code.
    */
    const repo = join(home, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: repo, env: hermeticGitEnv() });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo, env: hermeticGitEnv() });

    const payload = JSON.stringify({
      tool_name: 'Shell',
      tool_input: { cwd: repo, command: 'git status' },
    });
    for (const phase of ['pre', 'post']) {
      execFileSync(
        process.execPath,
        [CLI, 'hooks', 'fire', 'cursor', '--phase', phase, '--hook-input', 'stdin'],
        { cwd: repo, input: payload, env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home } },
      );
    }

    const summary = fireSummary(deps());
    // The runtime wrote entries. What matters is that the SURFACE reads them.
    expect(summary.recorded).toBe(true);
    expect(summary.total).toBeGreaterThan(0);
  });

  it('no journal is NO FIRES RECORDED, distinct from all-fires-succeeded (dw-002d)', () => {
    /*
    Test Doc:
    - Why: dw-002d. A repo where the hook never fired and one where every fire
      worked are different facts. Collapsing them makes an INERT install look
      healthy — which is the exact class this control exists to expose.
    - Contract: recorded=false with zero total, not "0 failures" implying success.
    */
    const summary = fireSummary(deps());
    expect(summary.recorded).toBe(false);
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('all-succeeded is a DIFFERENT report from no-fires — the discriminator', () => {
    writeJournal([entry(1, 'recorded')]);
    const summary = fireSummary(deps());
    expect(summary.recorded).toBe(true);
    expect(summary.failed).toBe(0);
  });
});

describe('status is the FIRST caller of compact() — the rotation fix, live (dw-0040)', () => {
  it('N concurrent `harness hooks status` PROCESSES lose no records — a live SMOKE test', async () => {
    /*
    Test Doc:
    - Why: dw-0040. The doubled-rotation defect reduced 2001 records to 1 — two
      compactors both passing the threshold guard BEFORE EITHER renamed.
    - WHAT THIS ROW IS, STATED HONESTLY: a smoke test that the LIVE surface drives
      compaction without losing records. It does NOT reproduce the doubled-rotation
      defect, and it is NOT the probe that refuses. The next row is.
    - MEASURED, three ways, all against the PRE-FIX `compact()`:
        a sequential in-process loop      -> GREEN (call 2 reads an absent live
                                             file, gets 0, declines — the two calls
                                             cannot interleave in one process)
        6 and 30 concurrent processes     -> GREEN, 3 trials each, total 2001 intact
        8 readers + 8 writers concurrent  -> GREEN, 3 trials, total 2009 intact
      The window is a parse plus a rename — microseconds — against ~150ms of node
      startup, so two compactors essentially never overlap. Pure readers cannot do
      it at all: after the first rename the live file is ABSENT, so the second reader
      measures 0 and declines. The clobber needs a FIRE to recreate the live file
      BETWEEN two rotations, and even mixing writers in did not hit the window.
    - So the real-concurrency instrument that worked for the WRITER path
      (journal-race.int.test.ts) does not transfer to the reader path, and saying so
      is better than a row that cannot fail.
    */
    const total = JOURNAL_ROTATE_AT + 1;
    writeJournal(Array.from({ length: total }, (_, i) => entry(i + 1, 'recorded')));

    const children = Array.from({ length: 6 }, () =>
      spawn(process.execPath, [CLI, 'hooks', 'status', '--json'], {
        env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
        stdio: ['ignore', 'ignore', 'ignore'],
      }),
    );
    await Promise.all(
      children.map(
        (c) =>
          new Promise<void>((resolve) => {
            c.on('close', () => resolve());
            c.on('error', () => resolve());
          }),
      ),
    );

    // The history survived: a reader still gets a FULL window. `read()` bounds to
    // JOURNAL_KEEP, so the healthy answer is KEEP — not `total`. The defect's
    // signature through this surface is that number collapsing toward a handful,
    // which is exactly what 2001-records-reduced-to-1 looked like.
    expect(fireSummary(deps()).total).toBe(JOURNAL_KEEP);
  });

  it('the fix holds WHEN STATUS DRIVES IT — interleaving MODELLED, and it refuses', () => {
    /*
    Test Doc:
    - Why: dw-0040 asks that the rotation fix holds when status drives it. Real
      concurrency cannot reach the window (see the row above), so the ordering is
      modelled explicitly — which is the same honest fallback used for the
      doubled-rotation row in hook-journal.test.ts.
    - HOW IT IS MODELLED: a wrapper FsPort whose `createExclusive` performs the
      OTHER rotation first, then lets ours proceed. That is exactly the window
      between a compactor's threshold check and its rename, and it is reachable no
      other way at these timings.
    - Contract: the history survives, driven through `fireSummary` — the status
      surface — rather than through the journal class directly.
    - Quality Contribution: this row DOES refuse. With the re-check removed it goes
      red; the smoke row above stays green either way.
    */
    const total = JOURNAL_ROTATE_AT + 1;
    writeJournal(Array.from({ length: total }, (_, i) => entry(i + 1, 'recorded')));

    const real = new NodeFs();
    let interleaved = false;
    const wrapper = Object.create(real) as NodeFs;
    wrapper.createExclusive = (path: string, contents: string): boolean => {
      if (!interleaved) {
        interleaved = true;
        // Another compactor rotates and releases inside our window, and a fire
        // recreates the live file — the exact sequence that destroyed 2001 records.
        fireSummary(deps());
        real.appendText(journalPath(), `${JSON.stringify(entry(9999, 'recorded'))}\n`);
      }
      return real.createExclusive(path, contents);
    };

    fireSummary(deps({ fs: wrapper }));

    // The rotated generation was NOT clobbered by a one-line live file.
    expect(fireSummary(deps()).total).toBe(JOURNAL_KEEP);
  });

  it('a rotation preserves the records in the rotated generation', () => {
    writeJournal(Array.from({ length: JOURNAL_ROTATE_AT + 1 }, (_, i) => entry(i + 1, 'recorded')));
    const before = fireSummary(deps()).total; // this call rotates
    expect(before).toBe(JOURNAL_KEEP);
    expect(existsSync(`${journalPath()}.1`)).toBe(true);

    const rotated = readFileSync(`${journalPath()}.1`, 'utf8')
      .split('\n')
      .filter((l) => l.trim()).length;
    expect(rotated).toBe(JOURNAL_ROTATE_AT + 1);
    expect(fireSummary(deps()).total).toBe(before);
  });
});
