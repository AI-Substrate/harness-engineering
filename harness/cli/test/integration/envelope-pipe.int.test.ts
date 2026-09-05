import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
Test Doc:
- Why: an ENVELOPE larger than a pipe's 64 KiB buffer was truncated at exactly 65 536
  bytes with exit 0 — `harness plan validate <big plan> --complete --json | python -c
  json.load` failed mid-string on macOS while the same command redirected to a file
  was complete. `exitWithEnvelope` calls process.exit straight after emit and macOS
  pipe stdout is asynchronous. The raw path had a guard (docs.test.ts, F002); the
  envelope path — 130 call sites — had none.
- Contract: piped stdout of a >64 KiB envelope is complete: it parses as JSON, its byte
  length exceeds the pipe buffer, and the process exit code is the envelope's mapped code.
- Usage Notes: the fixture is a plan scaffolded by `plan new` with enough OPEN acceptance criteria that
  `--complete` lists them all (each finding carries the absolute owner path, so ~250
  criteria clear 64 KiB comfortably). The plan lives in its own git repo because
  `plan validate` refuses a document outside the caller's repo root (E100). The
  child's stdout is a real pipe (execFileSync default), not a file — that is the whole
  point; a file would pass before and after the fix.
- Quality Contribution: a regression guard that can see the opposite — on a build
  without the blocking-pipe wiring this fails with a JSON parse error at ~65 536 bytes
  on macOS (verified 2026-09-05 against dist built from main).
- Worked Example: 250 unchecked criteria → --complete --json → ~100 KB → parses, 250
  open-completable findings.
*/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const distEntry = join(repoRoot, 'harness/cli/dist/index.js');
const PIPE_BUFFER = 64 * 1024;
const CRITERIA = 250;

let fixtureRoot = '';

describe('envelope output through a real pipe (no 64 KiB truncation)', () => {
  beforeAll(() => {
    if (!existsSync(distEntry)) {
      const win32 = process.platform === 'win32';
      execFileSync(win32 ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: repoRoot,
        stdio: 'ignore',
        shell: win32,
      });
    }
    fixtureRoot = mkdtempSync(join(tmpdir(), 'harness-envelope-pipe-'));
    execFileSync('git', ['init', '-q'], { cwd: fixtureRoot, stdio: 'ignore' });
    // Scaffold through the real verb so the document has every required section,
    // then widen its criteria list — the only part the size depends on.
    execFileSync(
      process.execPath,
      [
        distEntry,
        'plan',
        'new',
        'big',
        '--title',
        'Big plan',
        '--dir',
        'docs/plans',
        '--phase',
        'Phase 1',
        '--no-extensions',
      ],
      { cwd: fixtureRoot, stdio: 'ignore' },
    );
    const planPath = join(fixtureRoot, 'docs', 'plans', 'big', 'plan.dd.json');
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as {
      sections: Array<{ name: string; value: unknown }>;
    };
    const criteria = plan.sections.find((section) => section.name === 'acceptance_criteria');
    if (!criteria) throw new Error('scaffolded plan has no acceptance_criteria section');
    criteria.value = Array.from({ length: CRITERIA }, (_, i) => ({
      id: `ac-${String(i + 1).padStart(4, '0')}`,
      claim: `Criterion ${i + 1} holds end to end under the documented paved command.`,
      state: 'unchecked',
    }));
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  }, 120_000);

  afterAll(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('delivers the whole JSON envelope to a piped reader and exits with the mapped code', () => {
    let stdout = '';
    let stderr = '';
    let status: number | null = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        [
          distEntry,
          'plan',
          'validate',
          'docs/plans/big/plan.dd.json',
          '--complete',
          '--json',
          '--no-extensions',
        ],
        {
          cwd: fixtureRoot,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      // --complete on an all-open plan may map to a non-zero status; the bytes are what
      // this test is about, so keep whatever stdout the child produced.
      const failure = error as { stdout?: string; stderr?: string; status?: number | null };
      stdout = failure.stdout ?? '';
      stderr = failure.stderr ?? '';
      status = failure.status ?? null;
    }

    // A SMALL result is not truncation — it is the CLI answering something else (an error
    // envelope); say what it said so a CI-only failure is diagnosable from the log.
    const truncatedHint =
      `piped envelope is ${Buffer.byteLength(stdout)} bytes — a 65536-byte result means ` +
      'process.exit raced an asynchronous pipe flush (src/index.ts must make pipe stdio blocking); ' +
      `stdout head: ${stdout.slice(0, 600)} | stderr head: ${stderr.slice(0, 300)}`;
    expect(Buffer.byteLength(stdout), truncatedHint).toBeGreaterThan(PIPE_BUFFER);
    expect(() => JSON.parse(stdout), truncatedHint).not.toThrow();

    const envelope = JSON.parse(stdout) as {
      status: string;
      data: { findings: Array<{ class: string; address: string }> };
    };
    // every criterion is listed — the tail of the envelope arrived, not just its head
    const openCriteria = envelope.data.findings.filter(
      (f) => f.class === 'open-completable' && f.address.includes('#acceptance_criteria/'),
    );
    expect(openCriteria.length).toBe(CRITERIA);
    // exit code follows the envelope status (ok/degraded → 0, error → 1, unconfigured → 2)
    const expected = { ok: 0, degraded: 0, error: 1, unconfigured: 2 }[envelope.status];
    expect(status).toBe(expected);
  }, 120_000);
});
