import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A CLI THAT BOOTS AND THEN FAILS — the fixture both hook wrappers are measured
 * against (plan 089 · #180).
 *
 * ## The failure branch this stages, and why it needed a fixture at all
 *
 * Every existing wrapper row starves the wrapper of an interpreter, which exercises
 * the branch BEFORE node starts. Nothing exercised the branch AFTER: an interpreter
 * that resolves and then cannot boot the CLI — a `dist/` half-rewritten by a
 * concurrent `just build`, a bad import, a parse error. That is an ordinary race, not
 * an exotic state, and its consequence is severe: a non-zero PRE-tool hook is read by
 * every agent as a DENIAL, so every tool call in the session is blocked, and
 * `harness hooks uninstall` cannot rescue it because uninstall runs the same
 * unbootable CLI.
 *
 * Both wrappers resolve their target as `harness.js` NEXT TO THEMSELVES, so a fake
 * `harness.js` beside a COPY of the wrapper is the entire fixture. No install, no
 * build, no network.
 *
 * ## THE FIXTURE IS ITSELF A CONTROL — read this before changing it
 *
 * A fire row asserts *exit 0 and no output*. **A child that never started produces
 * exactly that too.** The two readings are identical at the observer and have
 * opposite meanings: one is the fix working, the other is the fixture broken. This
 * was not theoretical — it happened twice while this plan was being written, once in
 * a probe on this repo and once in a Windows VM probe built independently, and in
 * both cases a green was briefly believed.
 *
 * So the fake writes {@link BrokenCli.childArgv} BEFORE it writes either leak string
 * and before it exits, and every fire row asserts the child RAN. Absence of a leak is
 * evidence only when the child is independently known to have started.
 *
 * ## Why the `package.json` pin
 *
 * `require` in the fake dies at startup under any ancestor `package.json` declaring
 * `"type": "module"` — and this repo's root declares exactly that. The child then
 * fails before reaching its leak writes, and the wrapper swallows the evidence,
 * producing the false green above. A staging dir under `tmpdir()` has no such
 * ancestor today, so this is belt-and-braces rather than a live reproduction; it costs
 * one line and makes the fixture ancestor-proof instead of location-dependent.
 */

/** Written to stdout by the fake CLI. Identifiable by STRING, never by absence. */
export const FAKE_STDOUT_LEAK = 'FAKE_STDOUT_LEAK';
/** Written to stderr by the fake CLI. */
export const FAKE_STDERR_LEAK = 'FAKE_STDERR_LEAK';
/** The fake CLI's exit code — distinctive, so it cannot be confused with 0 or 1. */
export const FAKE_EXIT_CODE = 23;

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin');

/**
 * The fake CLI. Ordering is load-bearing: the marker is written FIRST, so a row can
 * distinguish "ran and was swallowed" from "never ran" even when the wrapper
 * discards both streams.
 *
 * It also records the payload the wrapper delivered, when one was named. That is what
 * pins the PowerShell spill path: the `.ps1` copies stdin to a temp file and passes
 * `--hook-input-file` precisely to avoid PS 5.1 re-encoding the bytes, and a row that
 * only checked exit codes could not tell a byte-exact delivery from a mangled one.
 */
const FAKE_CLI = `const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, 'child-argv.json'), JSON.stringify(args));
const named = args.indexOf('--hook-input-file');
if (named >= 0 && args[named + 1]) {
  try {
    fs.writeFileSync(
      path.join(__dirname, 'child-payload.hex'),
      fs.readFileSync(args[named + 1]).toString('hex'),
    );
  } catch {}
}
process.stdout.write('${FAKE_STDOUT_LEAK}\\n');
process.stderr.write('${FAKE_STDERR_LEAK}\\n');
process.exit(${FAKE_EXIT_CODE});
`;

export interface BrokenCli {
  /** Root of the staged fixture; delete this to clean up. */
  readonly dir: string;
  /** The wrapper copy to invoke. */
  readonly wrapper: string;
  /** A fenced HOME/USERPROFILE, so no real hook state is read or written. */
  readonly home: string;
  /** Where the wrappers write their failure log inside {@link home}. */
  readonly failureLog: string;
  /**
   * The interpreter the wrapper resolved and cached, read back from its own cache.
   *
   * Lets a row assert the failure record's context field EXACTLY rather than by
   * pattern — and an exact match is what proves the field is the interpreter and not,
   * say, the whole `PATH`.
   */
  resolvedInterpreter(): string | null;
  /** The argv the fake CLI saw, or `null` if it NEVER RAN. */
  childArgv(): string[] | null;
  /** Hex of the payload the wrapper delivered by file, or `null` if none was named. */
  childPayloadHex(): string | null;
  /**
   * Swap in a different fake CLI body — for failure modes the default fake cannot
   * express, above all a child KILLED BY A SIGNAL, whose wait status is not an exit
   * code at all. Keep writing the marker first, or the row loses its proof that the
   * child ran.
   */
  replaceCli(source: string): void;
}

/**
 * Stage a wrapper copy with a fake CLI that always fails, in a fenced HOME.
 *
 * @param wrapperFile which dialect to stage — the two are deliberately NOT inferred
 * from each other, so each is staged and asserted on its own terms.
 */
export function stageBrokenCli(wrapperFile: 'harness-hook.sh' | 'harness-hook.ps1'): BrokenCli {
  const dir = mkdtempSync(join(tmpdir(), 'harness-brokencli-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(home, '.harness', 'hooks'), { recursive: true });

  const wrapper = join(bin, wrapperFile);
  copyFileSync(join(BIN, wrapperFile), wrapper);
  chmodSync(wrapper, 0o755);

  writeFileSync(join(bin, 'harness.js'), FAKE_CLI, 'utf8');
  writeFileSync(join(bin, 'package.json'), '{"type":"commonjs"}\n', 'utf8');

  const read = (file: string): string | null => {
    const path = join(bin, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  };

  return {
    dir,
    wrapper,
    home,
    failureLog: join(home, '.harness', 'hooks', 'interpreter-failures.log'),
    resolvedInterpreter: () => {
      const cache = join(home, '.harness', 'hooks', 'interpreter');
      if (!existsSync(cache)) return null;
      const line = readFileSync(cache, 'utf8')
        .split(/\r?\n/)
        .find((row) => row.startsWith('path='));
      return line === undefined ? null : line.slice('path='.length);
    },
    childArgv: () => {
      const raw = read('child-argv.json');
      return raw === null ? null : (JSON.parse(raw) as string[]);
    },
    childPayloadHex: () => read('child-payload.hex'),
    replaceCli: (source: string) => writeFileSync(join(bin, 'harness.js'), source, 'utf8'),
  };
}

/**
 * A fake CLI that records that it ran and is then KILLED BY A SIGNAL.
 *
 * A signalled child has no exit code — POSIX shells surface it as 128+n, and a
 * wrapper that forwarded status would hand the agent 137 for a hook whose contract
 * says 0. The marker is written before the kill so the row keeps its proof that the
 * child started.
 */
export const SIGNALLED_CLI = `const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'child-argv.json'), JSON.stringify(process.argv.slice(2)));
process.kill(process.pid, 'SIGKILL');
`;

/**
 * The env a wrapper copy must run under.
 *
 * `PATH` LEADS WITH THE RUNNER'S OWN NODE, deliberately. These rows are about the
 * post-node branch, so interpreter resolution must not be the thing that varies: the
 * process running this suite is by definition a node new enough for the wrapper's
 * minimum, and naming its directory first makes every host resolve at step 2 instead
 * of falling through to a well-known path that may not exist on a CI image.
 *
 * `USERPROFILE` is set alongside `HOME` because the two dialects read different
 * variables for the same state directory, and a fixture that fenced only one would
 * let the other write to the developer's real `~/.harness/hooks`.
 */
export function brokenCliEnv(home: string): NodeJS.ProcessEnv {
  const nodeDir = dirname(process.execPath);
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PATH: `${nodeDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  };
}
