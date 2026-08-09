import { vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-04T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

/**
 * Verb deps wired to a REAL directory — the flow act's filesystem is injected, so
 * driving `harness flow …` over a corpus on disk needs the real port rather than
 * the shared fake.
 *
 * `env.home()` is pointed at a non-existent directory inside the temp root on
 * purpose: without it, a developer who happens to have `~/.dd/schemas` resolves
 * schemas differently from CI, and a test can pass or fail by machine.
 */
function realDeps(root: string): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new NodeFs(),
    env: new FakeEnv({}, `${root}/nohome`),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-04T00:00:00.000Z'),
    proc: new FakeProcess({}, root),
  };
}

export interface CliRun {
  out: string;
  err: string;
  code: number;
  envelope: Envelope | null;
}

/**
 * Drive the REAL program over real files, as an agent would.
 *
 * The dd/plan acts construct their own filesystem adapters (they are composition
 * roots in their own right, exactly like `harness doctor`), so this is the honest
 * end-to-end surface — the fakes above only satisfy the shared verb deps.
 */
export async function runCli(argv: string[], mode: 'json' | 'human' = 'json'): Promise<CliRun> {
  return run(argv, mode, deps());
}

/**
 * The same real program, rooted at a REAL directory — for the surfaces whose
 * filesystem arrives through the injected port (the flow act) rather than being
 * constructed inside the act (the dd/plan acts).
 */
export async function runCliIn(
  root: string,
  argv: string[],
  mode: 'json' | 'human' = 'json',
): Promise<CliRun> {
  return run(argv, mode, realDeps(root));
}

async function run(argv: string[], mode: 'json' | 'human', verbDeps: VerbActDeps): Promise<CliRun> {
  let out = '';
  let err = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const io: CliIo = { mode, writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await buildProgram('0.0.0-test', io, verbDeps, EMPTY).parseAsync(['node', 'harness', ...argv]);
    code = process.exitCode ?? 0;
  } catch (error) {
    if (!/^exit:\d+$/.test(error instanceof Error ? error.message : '')) throw error;
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
  return {
    out,
    err,
    code,
    envelope:
      mode === 'json' && out.trim().length > 0 ? (JSON.parse(out.trim()) as Envelope) : null,
  };
}

/**
 * Drive the STANDALONE `dd` CLI, the way an operator does after plan 080 phase 3.
 *
 * `harness dd *` was deleted with the fork (tk-000d), but several tests here were
 * never testing those verbs — they USED them as tools to validate a fixture, mint
 * an address, or sweep a corpus. Deleting the verb does not delete that need, so
 * this routes it to dd's own bin instead of quietly dropping the assertion.
 *
 * The bin is resolved from `node_modules/.bin/dd`, never as bare `dd`, and never
 * via `npx dd`. THREE different programs answer to that name and only one is ours:
 *
 *   `dd`               -> coreutils' disk-dump utility (`which dd` -> /bin/dd) —
 *                         loud and harmless here, it just fails on our verbs.
 *   `npx dd`           -> an UNSCOPED `dd` package that really exists on npm
 *                         (v0.26.0, a stranger's devops tool — verified with
 *                         `npm view dd version`). In a repo without ours installed
 *                         this FETCHES AND RUNS REMOTE CODE. It is the dangerous
 *                         spelling precisely because it looks like the careful
 *                         one — it trades a visible failure for a silent
 *                         supply-chain path, so a rule that forbids only the bare
 *                         form actively steers people into this one.
 *   `npx @ai-substrate/dd` -> ours, and the safe PATH-independent spelling — but
 *                         NOT YET RUNNABLE: the package is unpublished today
 *                         (`npm view @ai-substrate/dd version` -> E404). It
 *                         becomes correct only from the release commit onward,
 *                         and then only after registry/proxy lag clears.
 *
 * So TODAY there is exactly one runnable prescription: `node_modules/.bin/dd`,
 * which is what this helper resolves. Write the scoped form in docs as the
 * post-publish route, never as a command a reader can run right now — a
 * prescription that 404s is how someone talks themselves back into `npx dd`.
 */
export async function runDd(argv: string[], cwd?: string): Promise<CliRun> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const bin = join(here, '../../../../node_modules/.bin/dd');
  const run = promisify(execFile);
  try {
    const { stdout, stderr } = await run(bin, argv, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return {
      out: stdout,
      err: stderr,
      code: 0,
      envelope: stdout.trim().length > 0 ? (JSON.parse(stdout.trim()) as Envelope) : null,
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    const stdout = e.stdout ?? '';
    return {
      out: stdout,
      err: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
      envelope: stdout.trim().length > 0 ? (JSON.parse(stdout.trim()) as Envelope) : null,
    };
  }
}
