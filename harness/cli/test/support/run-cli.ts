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
