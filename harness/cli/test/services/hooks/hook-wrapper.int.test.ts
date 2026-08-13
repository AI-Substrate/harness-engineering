import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * THE POSIX HOOK WRAPPER, exercised as a program rather than reasoned about.
 *
 * These rows run the real `harness-hook.sh` in a controlled `HOME`, because every
 * property that matters here is a property of the SHELL FILE, not of anything
 * TypeScript can observe. A test that imported a module and asserted on strings would
 * be testing a description of the wrapper.
 *
 * WINDOWS IS NOT COVERED HERE AND MUST NOT BE INFERRED FROM HERE. `harness-hook.ps1`
 * is a separate dialect with separate resolution, and npm's own `cmd-shim` diverges
 * between its `.cmd` and `.ps1` variants (npm/cmd-shim#51) - the reference
 * implementation of this exact pattern does not have parity between its own shells.
 */

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin');
const WRAPPER = join(BIN, 'harness-hook.sh');

let home: string;
let sandboxWrapper: string;

/** Run the wrapper with a controlled HOME and PATH; never throws on non-zero. */
const run = (
  args: string[],
  opts: { wrapper?: string; path?: string } = {},
): { status: number; stdout: string } => {
  try {
    const stdout = execFileSync('/bin/sh', [opts.wrapper ?? WRAPPER, ...args], {
      encoding: 'utf8',
      env: { HOME: home, PATH: opts.path ?? '/usr/bin:/bin' },
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '' };
  }
};

/**
 * A copy of the wrapper that can find NO interpreter, whatever this machine has.
 *
 * The well-known tier names absolute paths (`/usr/local/bin/node`,
 * `/opt/homebrew/bin/node`), so a stripped PATH is not enough to starve it - on a
 * developer Mac it resolves anyway and the row silently tests nothing. Neutering that
 * list in a copy is what makes "no interpreter" an actual state rather than a hope.
 */
const starvedWrapper = (): string => {
  const target = join(home, 'starved-hook.sh');
  copyFileSync(WRAPPER, target);
  const text = readFileSync(target, 'utf8').replace(
    'for _c in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do',
    'for _c in /nonexistent/definitely-not-node; do',
  );
  writeFileSync(target, text);
  chmodSync(target, 0o755);
  return target;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-hookwrap-'));
  mkdirSync(join(home, '.harness', 'hooks'), { recursive: true });
  sandboxWrapper = '';
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the hook wrapper resolves an interpreter at fire time', () => {
  it('runs the CLI and records WHICH STEP resolved it', () => {
    const result = run(['--version']);
    expect(result.status).toBe(0);

    const cache = readFileSync(join(home, '.harness', 'hooks', 'interpreter'), 'utf8');
    // The step is not decoration: it is the field that answers "is each resolution
    // tier earning its keep" from real machines, which is how a tier gets deleted on
    // evidence instead of argued about.
    expect(cache).toMatch(/^step=(path|relative-to-self|manager-shim|well-known|init)$/m);
    expect(cache).toMatch(/^path=\//m);
  });

  it('is READ-ONLY once warm — no write per fire', () => {
    /*
    Test Doc:
    - Why: a first version reused one variable for both "how was it found" and "was it
      cached", so a cache hit never looked like one and the file was rewritten on EVERY
      fire. Hooks fire twice per tool call, so that is two writes per tool call on the
      path whose entire promise is being read-only when warm.
    - Contract: byte-identical cache across consecutive fires.
    */
    run(['--version']);
    const first = readFileSync(join(home, '.harness', 'hooks', 'interpreter'), 'utf8');
    run(['--version']);
    const second = readFileSync(join(home, '.harness', 'hooks', 'interpreter'), 'utf8');

    expect(second).toBe(first);
  });

  it('SELF-HEALS a cache whose interpreter has gone', () => {
    // The measured failure: an interpreter that moves under a config that still names
    // it. Here the cache is the config.
    const cachePath = join(home, '.harness', 'hooks', 'interpreter');
    writeFileSync(cachePath, 'path=/nonexistent/node\nversion=24\nstep=path\nat=x\n');

    expect(run(['--version']).status).toBe(0);
    expect(readFileSync(cachePath, 'utf8')).not.toContain('/nonexistent/node');
  });
});

describe('the same broken state exits 1 to a CHECKER and 0 to a FIRE', () => {
  /*
  Test Doc:
  - Why: THIS ASYMMETRY IS DELIBERATE AND IT LOOKS LIKE A BUG. A later author tidying
    "inconsistent exit codes" would silently destroy the only failure signal `hooks
    status` has, and status would go back to reporting healthy for a wrapper that
    cannot find node - the exact false green this whole plan exists to remove, rebuilt
    one layer up.
  - The reason the two differ: a hook fire runs inside an agent's tool call, where a
    non-zero exit aborts the agent's turn, so it must exit 0 whatever happens. A
    `--harness-hook-check` invocation is an OPERATOR ASKING A QUESTION, and there is no
    such constraint - silence is the right answer to an agent and the wrong answer to a
    person.
  - Contract: both numbers asserted IN ONE BODY, so they sit next to each other and any
    attempt to unify them turns this red.
  */
  it('checker gets the truth, agent is never broken', () => {
    sandboxWrapper = starvedWrapper();

    const checked = run(['--harness-hook-check'], { wrapper: sandboxWrapper });
    const fired = run(['hooks', 'fire', 'cursor', '--phase', 'pre'], { wrapper: sandboxWrapper });

    // The operator is told, in the exit code, that nothing can run.
    expect(checked.status).toBe(1);
    expect(checked.stdout).toContain('step=none');

    // The agent, in the IDENTICAL state, is not disturbed.
    expect(fired.status).toBe(0);
  });

  it('and a healthy check reports the interpreter it WOULD use, without running node', () => {
    const checked = run(['--harness-hook-check']);

    expect(checked.status).toBe(0);
    expect(checked.stdout).toMatch(/^path=\//m);
    expect(checked.stdout).toMatch(/^step=/m);
    // No CLI banner, no command output: check mode resolves and stops. That is what
    // makes it cheap enough to run by default, unlike the InvocationProbe which starts
    // the CLI and is therefore opt-in.
    expect(checked.stdout).not.toContain('Usage');
  });
});

describe('a failure that cannot run node still reports itself', () => {
  it('records to its own log, and NEVER to the fire journal', () => {
    /*
    Test Doc:
    - Why: when this path runs there is by definition no node, so nothing written in
      TypeScript could report it - the shell has to. But `fires.jsonl` has exactly one
      writer and one schema, and a second writer in another language with no contract
      between them is the writer-shape defect class this project has already paid for.
    - Contract: the failure is recorded in a SEPARATE file with a trivial fixed format,
      and fires.jsonl is untouched.
    */
    sandboxWrapper = starvedWrapper();
    const fired = run(['hooks', 'fire', 'cursor', '--phase', 'pre'], { wrapper: sandboxWrapper });
    expect(fired.status).toBe(0);

    const log = readFileSync(join(home, '.harness', 'hooks', 'interpreter-failures.log'), 'utf8');
    expect(log).toContain('no-interpreter');

    expect(() => readFileSync(join(home, '.harness', 'hooks', 'fires.jsonl'), 'utf8')).toThrow();
  });

  it('records even when PATH is hostile — the bug that reproduced its own defect class', () => {
    /*
    Test Doc:
    - Why: MEASURED during development. With a broken PATH the wrapper died at exit 127
      BEFORE reaching its own failure recorder, because dirname/date/mkdir/sed could not
      be found - reproducing, inside the code written to remove silent failure, the
      silent failure it removes. It now appends known-good directories to PATH before
      touching anything.
    - Contract: a hostile PATH still yields exit 0 and a recorded line.
    */
    sandboxWrapper = starvedWrapper();
    const fired = run(['hooks', 'fire', 'cursor', '--phase', 'pre'], {
      wrapper: sandboxWrapper,
      path: '/nonexistent',
    });

    expect(fired.status).toBe(0);
    expect(
      readFileSync(join(home, '.harness', 'hooks', 'interpreter-failures.log'), 'utf8'),
    ).toContain('no-interpreter');
  });
});
