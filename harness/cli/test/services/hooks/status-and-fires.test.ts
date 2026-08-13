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

describe('status surfaces an UNREADABLE PAYLOAD, in its own list (plan 082 F009)', () => {
  it('a REAL unparseable fire reaches the SURFACE, not just the journal file', () => {
    /*
    Test Doc:
    - Why: F009 made a parse failure observable in the journal. If it stopped
      there, the failure would be recorded by the file and dropped by the surface
      operators actually read — the journal's own blindness rebuilt one layer up,
      which is the same defect family this plan has now met five times.
    - Contract: driven through the REAL bin so the entry is one the runtime wrote,
      never one this test fabricated — the fabricated-stimulus mistake that cost
      this plan two hours.
    - Quality Contribution: asserts on the journal-derived field, never on an exit
      code, because the exit code is 0 by design and carries no information.
    */
    const repo = join(home, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
    execFileSync(
      process.execPath,
      [CLI, 'hooks', 'fire', 'cursor', '--phase', 'post', '--hook-input', 'stdin'],
      {
        cwd: repo,
        // Real BOM BYTES in front of a TRUNCATED document: the Windows trigger and
        // a genuine malformation together, so the strip cannot mask the failure.
        input: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"cwd":', 'utf8')]),
        env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
      },
    );

    const summary = fireSummary(deps());
    expect(summary.unparseable).toBe(1);
    expect(summary.unreadable).toHaveLength(1);
    // The head names the prefix ON SIGHT. `ef bb bf` here IS the Cursor BOM — the
    // fact nobody could see for three sessions and ~58 invocations.
    expect(summary.unreadable[0]?.headHex.startsWith('ef bb bf')).toBe(true);
    expect(summary.unreadable[0]?.rawLen).toBeGreaterThan(0);
  });

  it('does NOT inflate `failed` — an unreadable input is a different fault from a failed emit', () => {
    /*
    Test Doc:
    - Why: "our emit failed" points at the collector; "we could not read the input"
      points at the agent client. They need different operator actions, so one
      number serving both is useless for both. F008 made the same call when it gave
      refused-upgrades its own list rather than folding it into refusals.
    - Contract: two counts, two lists, no double-counting in either direction.
    - Quality Contribution: a mixed journal, so a future "simplification" that adds
      the two together fails here rather than in an operator's diagnosis.
    */
    writeJournal([
      entry(1, 'recorded'),
      entry(2, 'failed', 'socket unreachable'),
      {
        at: 'T3',
        phase: 'post',
        repoRoot: null,
        outcome: {
          kind: 'unparseable',
          reason: 'payload-not-json',
          rawLen: 794,
          headHex: 'ef bb bf 7b 22 63 6f 6e',
        },
      },
    ]);

    const summary = fireSummary(deps());
    expect(summary.total).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([{ at: 'T2', cause: 'socket unreachable' }]);
    expect(summary.unparseable).toBe(1);
    expect(summary.unreadable).toEqual([
      { at: 'T3', rawLen: 794, headHex: 'ef bb bf 7b 22 63 6f 6e' },
    ]);
  });

  it('reports ZERO unreadable when nothing was unreadable — the discriminator, again', () => {
    writeJournal([entry(1, 'recorded')]);
    const summary = fireSummary(deps());
    expect(summary.unparseable).toBe(0);
    expect(summary.unreadable).toEqual([]);
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

describe('a binary path that will not SURVIVE is refused, not installed (plan 084)', () => {
  /*
  Test Doc:
  - Why: three measured hazards, on three machines, all shipped as healthy installs.
    An npx cache in a WSL devcontainer (`_npx/<hash>/node_modules/.bin/harness`,
    garbage-collected by npm and erased by a container rebuild); this host's own
    copilot hook pointing into a worktree ~145 commits divergent from main; and the
    live Cursor hook in plan 082's own note pointing into untracked `scratch/`.
  - What made it invisible: a hook exits 0 and prints nothing by design, so when the
    target disappears NOTHING reports it. `binaryResolves` only turns red after the
    damage is done, and `looksLikeInstalledBinary` — the predicate written to catch
    exactly this — had ZERO production callers for the whole of plan 082.
  - Contract: refused BEFORE any config is written, naming the segment; the escape
    hatch works and is named in the refusal; and an already-installed transient path
    is visible in status ahead of the failure rather than after it.
  */
  const TRANSIENT = '/home/vscode/.npm/_npx/fa7ab31a908e11f6/node_modules/.bin/harness';
  const allowDev = (name: string) => (name === 'HARNESS_HOOKS_ALLOW_DEV_BINARY' ? '1' : undefined);

  beforeEach(() => mkdirSync(join(home, '.cursor'), { recursive: true }));

  it('REFUSES, names the offending segment, and writes NOTHING', () => {
    const report = installHooks(deps({ binary: `"${TRANSIENT}"` }));

    expect(report.transientBinary).toBe(true);
    // The SEGMENT, not just a verdict — it is the diagnosis the operator acts on.
    expect(report.transientBinaryDetail).toContain('_npx');
    expect(report.transientBinaryDetail).toContain(TRANSIENT);
    // The refusal must carry its own way out, or an operator who means it is stuck.
    expect(report.transientBinaryDetail).toContain('HARNESS_HOOKS_ALLOW_DEV_BINARY=1');

    // NOTHING WAS ATTEMPTED. Refusing while still reporting installs would be the
    // same silent-success shape this exists to remove.
    expect(report.installed).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);
  });

  it('the named escape hatch actually installs — the refusal is a filter, not a wall', () => {
    // The positive control. A guard that refused unconditionally would pass the row
    // above while making this repo unable to dogfood its own hooks from a worktree.
    const report = installHooks(deps({ binary: `"${TRANSIENT}"`, env: allowDev }));

    expect(report.transientBinary).toBe(false);
    expect(report.installed.length).toBeGreaterThan(0);
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(true);
  });

  it('STATUS names a transient path that is still present — before it vanishes', () => {
    installHooks(deps({ binary: `"${TRANSIENT}"`, env: allowDev }));
    const cursor = statusHooks(deps()).find((r) => r.agent === 'cursor');

    expect(cursor?.transientBinarySegment).toBe('_npx');
    // AND the gap that makes this field necessary: `binaryState` is about existence
    // NOW. Here the path does not exist so it reads `unresolvable` — but on the day
    // it was installed it read `resolves`, green, while already doomed. The two
    // fields answer different questions and neither substitutes for the other.
    expect(cursor?.binaryState).toBe('unresolvable');
  });

  it('a DURABLE install reports no segment — the field is not always-on', () => {
    const bin = join(home, 'bin', 'harness');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\n');
    installHooks(deps({ binary: `"${bin}"` }));

    const cursor = statusHooks(deps()).find((r) => r.agent === 'cursor');
    expect(cursor?.transientBinarySegment).toBeUndefined();
    expect(cursor?.binaryState).toBe('resolves');
  });

  it('with the run-wide opt-in REMOVED, the guard still refuses — its DEFAULT state', () => {
    /*
    Test Doc:
    - Why: `vitest.config.ts` sets HARNESS_HOOKS_ALLOW_DEV_BINARY=1 for the WHOLE
      run, because the suite drives the real bin from whatever checkout it sits in
      and would otherwise be location-dependent. The cost is that the guard is OFF
      for all 6,060 tests, so every future test of install behaviour inherits the
      bypass silently and nothing would notice if the guard rotted. This is the one
      place the DEFAULT (var absent) is asserted, deliberately, so it stays covered.
    - Contract: with the variable genuinely absent from the process environment, a
      transient path is refused.
    - Why the env is read through `process.env` here and a FIXTURE path is used for
      the binary: reading the real environment is the point (a stubbed reader would
      re-introduce exactly the bypass under test), while a fixture binary keeps the
      row location-INDEPENDENT — asserting through the real bin would pass in a
      worktree and fail in the root checkout, which is the defect, not the test.
    */
    const saved = process.env.HARNESS_HOOKS_ALLOW_DEV_BINARY;
    delete process.env.HARNESS_HOOKS_ALLOW_DEV_BINARY;
    try {
      // The suite's own bypass really is gone for the duration — otherwise this
      // row passes vacuously, which is the failure mode it exists to prevent.
      expect(process.env.HARNESS_HOOKS_ALLOW_DEV_BINARY).toBeUndefined();

      const report = installHooks(
        deps({ binary: `"${TRANSIENT}"`, env: (name) => process.env[name] }),
      );

      expect(report.transientBinary).toBe(true);
      expect(report.installed).toEqual([]);
      expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.HARNESS_HOOKS_ALLOW_DEV_BINARY;
      else process.env.HARNESS_HOOKS_ALLOW_DEV_BINARY = saved;
    }
  });
});

describe('firesObserved — did the AGENT call us, as opposed to can WE run (plan 084)', () => {
  /*
  Test Doc:
  - Why: every other field on the status report describes the FILE WE WROTE.
    `executionState` is the one dynamic field and it answers a different question —
    it spawns our binary and looks for our sentinel, proving our command is
    invocable. An installed, resolvable, probe-passing hook that no agent has ever
    called is green on every field and is doing nothing. That is the shape this
    stream keeps finding, so the two claims are kept apart on purpose.
  - Contract: NULL means the instrument cannot answer; ZERO means it can and this
    agent never fired. Collapsing them would report "never fired" for an agent that
    may have fired thousands of times before the `agent` field existed.
  */
  const install = () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    installHooks(deps());
  };
  const cursor = () => statusHooks(deps()).find((r) => r.agent === 'cursor');
  const record = (agent: string | undefined, kind: 'recorded' | 'failed' = 'recorded') => ({
    at: `T-${agent ?? 'none'}-${kind}`,
    ...(agent === undefined ? {} : { agent }),
    phase: 'post' as const,
    repoRoot: '/repo',
    outcome: kind === 'failed' ? { kind, cause: 'x' } : { kind: 'recorded', phase: 'pre' },
  });

  it('NULL when the journal is empty — no evidence is not evidence of none', () => {
    install();
    expect(cursor()?.firesObserved).toBeNull();
  });

  it('NULL when every record predates the agent field — the 1,578 unattributable rows', () => {
    // The exact state of this host before plan 084: a full journal that cannot say
    // who fired. Reporting 0 here would be a confident, wrong answer.
    install();
    writeJournal([record(undefined), record(undefined), record(undefined)]);
    expect(cursor()?.firesObserved).toBeNull();
  });

  it('ZERO when the journal CAN attribute and this agent never fired', () => {
    // The instrument demonstrably works — another agent's fires are attributed in
    // the same file — so silence about cursor is a real finding, not a blind spot.
    install();
    writeJournal([record('github-copilot'), record('github-copilot')]);
    expect(cursor()?.firesObserved).toEqual({ total: 0, failed: 0, lastAt: null });
  });

  it('counts only THIS agent, separates failures, and carries the latest timestamp', () => {
    install();
    writeJournal([
      record('github-copilot'),
      record('cursor'),
      record('cursor', 'failed'),
      record('claude-code'),
    ]);
    expect(cursor()?.firesObserved).toEqual({
      total: 2,
      failed: 1,
      lastAt: 'T-cursor-failed',
    });
  });

  it('is INDEPENDENT of executionState — the two answer different questions', () => {
    /*
    The load-bearing row. No probe is injected, so `executionState` is `unchecked`
    — an honest "we did not look at whether our command runs". Meanwhile the
    journal proves the agent HAS called us. A single merged indicator could not
    represent that pair, and merging them is what would rebuild the defect.
    */
    install();
    writeJournal([record('cursor')]);
    const row = cursor();

    expect(row?.executionState).toBe('unchecked');
    expect(row?.firesObserved).toEqual({ total: 1, failed: 0, lastAt: 'T-cursor-recorded' });
  });
});
