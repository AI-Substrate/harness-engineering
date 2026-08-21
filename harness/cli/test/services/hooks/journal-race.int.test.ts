import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * THE JOURNAL MUST NOT LOSE A RECORD (plan 082 tk-0011).
 *
 * WHY THIS IS AN OUT-OF-PROCESS FIXTURE, and why an in-process one is worthless
 * here. `FileHookJournal.record()` was a read-rewrite-write. Within ONE process
 * that is perfectly safe — `record()` is synchronous, so two concurrent fires can
 * never interleave, and the in-process concurrency row in `provocation.int.test.ts`
 * is green precisely because it CANNOT observe this class. The real runtime is one
 * `harness hooks fire` OS PROCESS per agent tool call, and two of those overlap
 * with nothing serialising them.
 *
 * MEASURED against the read-rewrite-write implementation, N processes -> lines:
 *
 *   24 -> 22     8 -> 8 (not every run)     8 -> 6     4 -> 3     3 -> 2
 *
 * It fires at THREE, which is an agent issuing three parallel tool calls — not a
 * stress test.
 *
 * WHY IT BLOCKS THE STATUS VERB RATHER THAN FOLLOWING IT. The journal is the ONLY
 * observable for a failure that exits 0 by design, and ac-000b — the compensating
 * control the exit-0 constitutional deviation was granted for — is a READ of this
 * journal. The record most likely to be lost in a burst is a `failed` one, which
 * is exactly what the control exists to expose. A lossy journal reads exactly like
 * a quiet one, so building the reader first would ship a control that silently
 * drops what it was built to catch, with green tests.
 *
 * THE TWO ASSERTIONS HERE ARE DELIBERATELY DIFFERENT SHAPES, and that asymmetry is
 * load-bearing:
 *
 * - The RED control (against the OLD implementation, recorded in the execution log
 *   rather than committed as a test) is necessarily PROBABILISTIC: the loss is a
 *   race, so it is "over K repeats, at least one run loses a record".
 * - The GREEN assertion below is EXACT and holds on EVERY repeat: N processes
 *   produce exactly N records, K times out of K. An `O_APPEND` single write does
 *   not sometimes lose a line, so there is no residual flakiness to tolerate.
 *
 * Writing the green side as a bound too ("usually N", "at least N-1") would build a
 * test that passes against a partially-fixed implementation and can never tell a
 * real fix from a smaller leak — the same defect as a row asserting only `silent`.
 * If this ever needs a tolerance, the fix is incomplete; do not absorb it into a
 * threshold.
 *
 * WHY K = 5, MEASURED RATHER THAN CHOSEN. A single run is not enough evidence: one
 * run in five recorded all 8 even against the broken implementation, so a K of 1
 * would have been a coin toss reported as a proof. At K = 5 the FILE detected the
 * broken implementation on 8 of 8 attempts — and twice it was caught by only ONE of
 * the two rows, which is why both are kept: they fail independently, so the pair
 * detects more reliably than either alone. Against the fixed implementation the
 * same 8 attempts were green 8 of 8, exactly, with no tolerance.
 *
 * DELIBERATELY LEFT IN THE FAST TEST SCOPE at ~1.4s. The two suites that prove the
 * commit guard (`provocation.int`, `live-daemon-note.int`) are both in SLOW_TESTS,
 * so a default `just test` says nothing about them. This one is cheap enough that
 * the loss-free property does get default-scope signal, and it should stay that way.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

/** Concurrent processes per run. dw-003b requires at least 8. */
const N = 8;
/** Repeats. The green assertion must hold on every one of them. */
const K = 5;

let dir: string;
let home: string;
let repo: string;

const journalPath = (): string => join(home, '.harness', 'hooks', 'fires.jsonl');

function journalLines(): string[] {
  try {
    return readFileSync(journalPath(), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Fire `count` hook processes and resolve when all have exited.
 *
 * `spawn` (not `execFileSync`) is what makes this a race: every child is started
 * before any is awaited, so their journal writes overlap. Starting them one at a
 * time and awaiting each would serialise the exact window under test, and the
 * fixture would pass against a journal that loses records.
 *
 * NO SHELL, deliberately. An earlier version wrote a `/bin/sh` script with `&`
 * backgrounding, which raced correctly but would have failed outright on the
 * `windows-latest` suite leg — a fixture that cannot run on a platform reports
 * nothing about it. `spawn` is portable, and it also removes the temp script.
 */
async function fireConcurrently(count: number): Promise<void> {
  const payload = JSON.stringify({
    tool_name: 'Shell',
    tool_input: { cwd: repo, command: 'git status' },
  });

  const children = Array.from({ length: count }, () => {
    const child = spawn(
      process.execPath,
      [CLI, 'hooks', 'fire', 'cursor', '--phase', 'pre', '--hook-input', 'stdin'],
      {
        cwd: repo,
        env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    child.stdin.end(payload);
    return child;
  });

  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          child.on('close', () => resolve());
          child.on('error', () => resolve());
        }),
    ),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-journal-race-'));
  home = join(dir, 'home');
  repo = join(dir, 'repo');
  mkdirSync(home, { recursive: true });

  // A real repository: the verb exits before any journal write if the payload's
  // cwd is not one, so without this the fixture would record zero and "pass".
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: repo, env: hermeticGitEnv() });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo, env: hermeticGitEnv() });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('hook journal — interprocess append is LOSS-FREE (dw-003b)', () => {
  it(`records exactly ${N} lines for ${N} concurrent processes, ${K} times out of ${K}`, async () => {
    /*
    Test Doc:
    - Why: dw-003b. A read-rewrite-write journal loses records when hook processes
      overlap, and the runtime is one process per agent tool call.
    - Contract: EXACTLY N, on EVERY repeat. Not a bound — see the file header.
    - Quality Contribution: drives the real bin, so it proves the wiring and the
      adapter, not a service in isolation.
    */
    const observed: number[] = [];

    for (let run = 0; run < K; run++) {
      rmSync(join(home, '.harness'), { recursive: true, force: true });
      await fireConcurrently(N);
      observed.push(journalLines().length);
    }

    // Asserting the whole vector rather than each run in turn: a failure then
    // reports WHICH runs lost records and how many, which is the difference
    // between "the race is still there" and "the fix does nothing at all".
    expect(observed).toEqual(Array.from({ length: K }, () => N));
  });

  it('every record survives INTACT — no torn or interleaved lines', async () => {
    /*
    Test Doc:
    - Why: counting lines alone would accept a file where two records were spliced
      into one corrupt line and a third was lost — the count could still come out
      right. O_APPEND guarantees whole-record atomicity only if each record is ONE
      write call, so this asserts the property that guarantee actually buys.
    - Contract: every line parses as JSON and carries the expected shape.
    - Quality Contribution: distinguishes "N lines" from "N VALID records".
    */
    await fireConcurrently(N);
    const lines = journalLines();
    expect(lines).toHaveLength(N);

    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(entry.phase).toBe('pre');
      expect(entry.repoRoot).toBe(repo);
      expect(entry.outcome).toEqual({ kind: 'recorded', phase: 'pre' });
    }
  });
});
