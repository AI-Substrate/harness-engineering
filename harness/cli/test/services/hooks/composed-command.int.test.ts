import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_MATRIX, eventKeys } from '../../../src/services/hooks/agent-matrix.js';
import {
  entryCommands,
  HOOK_MARKER,
  HOOK_MARKER_FLAG,
} from '../../../src/services/hooks/hook-marker.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';
import { POSIX_SHELL } from '../../support/posix-shell.js';

/**
 * THE PRODUCER AND THE CONSUMER, MEETING (plan 082, post-phase-3 defect F004).
 *
 * WHY THIS FILE EXISTS, and it is the most expensive lesson of the plan.
 *
 * The installer composed `… hooks fire <agent> --phase <p> --hook-input stdin
 * --hook-owner <marker>`. The `fire` verb registered `--phase` and `--hook-input`
 * and NOTHING ELSE. So every hook we ever installed, on every machine, died in
 * commander's argument parser with `error: unknown option '--hook-owner'` and
 * exit 1 — violating the exit-0 contract the entire design rests on, on every
 * single tool call, and never once reaching the code that journals.
 *
 * **Nothing caught it, and the reason is structural, not careless.** Every test
 * that EXECUTED fire hard-coded its own argv:
 *
 *     ['hooks','fire','cursor','--phase',phase,'--hook-input','stdin']   ← no marker
 *
 * and every test that examined the INSTALLED command treated it as a STRING —
 * matched the marker in it, stat'd the binary named by it, asserted byte
 * idempotency on it. Producer and consumer of one contract, each asserted against
 * its own idea of that contract, never against each other. Phase 1 built `fire`;
 * phase 2 invented the flag; nothing forced them to meet.
 *
 * **A test that retypes the argv proves the argv you typed.** So these rows never
 * type one. They read the command string BACK OUT of the config the real installer
 * wrote, and execute THAT.
 *
 * Two rows, deliberately different, because one of them can be made to pass by
 * accident:
 *
 * 1. `executes` — the end-to-end proof. Would go red today.
 * 2. `every option the installer emits is registered on fire` — the STATIC
 *    producer/consumer contract, which survives even if `fire` were later made
 *    tolerant of unknown options. Without it, adding tolerance would silently make
 *    row 1 green again while the installer went on emitting a flag nobody accepts.
 */

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'harness.js');

let dir: string;
let home: string;
let repo: string;

interface Composed {
  /** Which config file it came from — so a failure names the agent, not just a phase. */
  agent: string;
  phase: string;
  command: string;
}

/**
 * Every supported agent's marker directory and config path.
 *
 * ALL OF THEM, not just cursor. `hookCommand` is one shared function today, so a
 * cursor-only fixture would look sufficient — but "one function composes them all"
 * is exactly the kind of premise that stops being true without anyone noticing,
 * and this defect was born of two sides each testing its own idea of a contract.
 * Cheap to check the whole set; expensive to be wrong about which agents are
 * covered.
 */
const AGENT_MARKERS = [
  '.cursor',
  '.claude',
  '.gemini',
  '.factory',
  '.firebender',
  '.copilot',
  '.codeium',
] as const;
const AGENT_CONFIGS = [
  '.cursor/hooks.json',
  '.claude/settings.json',
  '.gemini/settings.json',
  '.factory/settings.json',
  '.firebender/hooks.json',
  // OURS, not git-ai's. The detection table lists `.copilot/hooks/git-ai.json`
  // because that is the file whose PRESENCE detects copilot; the file we WRITE is
  // our own beside it. Taking the path from the detection table gave 14 commands
  // where 16 were expected — which is the only reason this distinction is written
  // down rather than silently gotten wrong again.
  '.copilot/hooks/harness.json',
  '.codeium/hooks.json',
  '.codeium/windsurf/hooks.json',
] as const;

/**
 * Split a shell command into argv, honouring double quotes.
 *
 * WRITTEN HERE, NOT IMPORTED. `commandTokens` in `hook-marker.ts` is production
 * code that also splits on shell segment separators and drops empties — using it
 * would mean a bug in the parser under test could hide the very defect this file
 * exists to catch. Eight lines of independent parser is the cheaper risk.
 */
function argvOf(command: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (char === '\\' && command[i + 1] === '"') {
      current += '"';
      started = true;
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) out.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

/** Every hook command the real installer wrote, across EVERY agent's config. */
function composedCommands(): Composed[] {
  return AGENT_CONFIGS.flatMap((relative) => {
    const path = join(home, ...relative.split('/'));
    if (!existsSync(path)) return [];
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks?: Record<string, unknown[]>;
    };
    return Object.entries(config.hooks ?? {}).flatMap(([phase, entries]) =>
      // READ BOTH ENTRY SHAPES (plan 082 F005). Three agents keep the command at
      // `entry.hooks[].command`, not `entry.command` — so a flat-only read here does
      // not merely miss them, it silently DROPS claude-code, gemini and droid from
      // F004's coverage while the file still reports green. That is F004's own
      // failure class (a guard that stops covering what it names) arriving through
      // the entry shape.
      entries.flatMap((entry) =>
        entryCommands(entry)
          .filter((command) => command.includes(HOOK_MARKER))
          .map((command) => ({ agent: relative, phase, command })),
      ),
    );
  });
}

/**
 * How many commands a correct install writes, derived from the matrix.
 *
 * One per event key, per config file, for every SUPPORTED agent. Reading
 * `spec.supported` here is what makes the held-out firebender row a fact this
 * assertion respects rather than a discrepancy someone has to explain.
 */
const expectedCommandCount = (): number =>
  AGENT_MATRIX.filter((spec) => spec.supported).reduce(
    (total, spec) => total + spec.configFiles.length * eventKeys(spec).length,
    0,
  );

/** Just cursor's, for the rows that need one specific command rather than all of them. */
function cursorCommands(): Composed[] {
  return composedCommands().filter((c) => c.agent === '.cursor/hooks.json');
}

function journal(): Record<string, unknown>[] {
  try {
    return readFileSync(join(home, '.harness', 'hooks', 'fires.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

/**
 * Run an argv exactly as composed. `spawnSync` so a non-zero exit is DATA, not a throw.
 *
 * THE COMMAND SUPPLIES ITS OWN INTERPRETER (plan 082, F008). This used to spawn
 * `process.execPath` with the composed argv appended — i.e. the TEST supplied the
 * `node` that the CONFIG did not. That is exactly the assumption the defect was
 * made of: the row named itself "executes the installed string verbatim" while
 * quietly prepending the one token whose absence made every Windows install
 * inert. A file-association dispatch cannot be caught by a harness that hands the
 * command to Node itself.
 */
function runArgv(
  argv: string[],
  envOver: NodeJS.ProcessEnv = {},
  /**
   * What arrives on stdin. Overridden ONLY by the spill rows, which must prove the
   * payload was read from the FILE — a default payload on stdin would let them pass
   * on a build where `--hook-input-file` is ignored entirely.
   */
  inputOver?: string,
): { status: number | null; stdout: string; stderr: string } {
  const payload =
    inputOver ??
    JSON.stringify({
      tool_name: 'Shell',
      tool_input: { cwd: repo, command: 'git status' },
    });
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repo,
    encoding: 'utf8',
    input: payload,
    /*
     * THE COLOUR PAIR IS PINNED, NOT INHERITED (plan 082 F010 F5).
     *
     * `hermeticGitEnv` starts from `process.env`, so these rows used to inherit
     * whatever colour variables the developer's shell happened to carry. A
     * reviewer running the suite with BOTH `NO_COLOR` and `FORCE_COLOR` set saw
     * two rows go red that are green everywhere else — Node prints a startup
     * warning about the conflict before any of our code runs. **A test that
     * passes or fails on an inherited environment variable is not a gate**, in
     * either direction: it hid a real defect here, and it would report a false
     * one on the next machine that has the pair set for its own reasons.
     *
     * So the default is NEUTRAL — both unset — and the hostile pair is set
     * DELIBERATELY by the row that exists to prove we survive it.
     */
    env: {
      ...hermeticGitEnv(),
      HOME: home,
      USERPROFILE: home,
      NO_COLOR: undefined,
      FORCE_COLOR: undefined,
      ...envOver,
    },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

beforeEach(() => {
  // A home WITH SPACES, so the quoting is exercised by the same string that is
  // executed rather than only by the string that is inspected.
  dir = mkdtempSync(join(tmpdir(), 'harness composed '));
  home = join(dir, 'home');
  repo = join(dir, 'repo');
  mkdirSync(home, { recursive: true });
  for (const marker of AGENT_MARKERS) mkdirSync(join(home, marker), { recursive: true });
  // A real repository: `fire` returns before journalling if the payload's cwd is
  // not one, so without this the row would record nothing and read as a pass.
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });

  execFileSync(process.execPath, [CLI, 'hooks', 'install', '--json'], {
    encoding: 'utf8',
    env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * WHY FIVE ROWS IN THIS FILE ARE GATED ON A POSIX SHELL — and why the rest are not.
 *
 * The gated rows SPAWN THE INSTALLED COMMAND STRING, and since #172 its first token is
 * `harness-hook.sh`. `spawnSync` of a POSIX shell script on Windows never starts a
 * process: `status` comes back `null`, so every `toBe(0)` in them fails for a reason
 * that has nothing to do with the property under test. Measured on the VM at
 * `3e4b148a` - 5 of 10 rows here, alongside 7 in `hook-wrapper.int.test.ts`, all one
 * cause.
 *
 * THE OTHER ROWS STAY LIVE ON EVERY PLATFORM, deliberately, and that is the whole
 * shape of this change. They pass on Windows today because they build their argv as
 * `[process.execPath, CLI, ...]` - supplying the interpreter themselves rather than
 * asking the host to dispatch a script - or because they assert the composed argv's
 * SHAPE without running it at all (every token exists, the `hooks` verb is reached).
 * So Windows keeps real coverage of what this file is for: that the installer composes
 * a command whose every token is present and whose options `fire` actually declares.
 *
 * WHAT IS NO LONGER ASKED ON WINDOWS, so nobody reads the green as more than it is:
 * whether that composed string can EXECUTE there. It cannot be asked from here without
 * a shell, and it is open in **#173** - six of seven agents get `command` = a bare
 * `harness-hook.sh` path on Windows, executability unmeasured. **#174** covers the
 * `.ps1` twin having no execution coverage anywhere. Both were held out of plan 087 by
 * scope ruling, not resolved.
 */
describe('the command the INSTALLER composed is a command `fire` can actually RUN (F004)', () => {
  it.runIf(POSIX_SHELL)(
    'executes the installed string verbatim: exit 0, silent, and a journal entry',
    () => {
      /*
    Test Doc:
    - Why: F004. The shipped hook had never fired on any machine. The installer
      emitted `--hook-owner`, which `fire` did not register, so commander exited 1
      before any of our code ran. Every existing execution test typed its own argv
      and so tested a command nobody installs.
    - Contract: read the command back OUT of the config the real bin wrote, split it
      into argv, and execute it. Exit 0, no agent-visible output, and — because exit
      0 carries no information by design — a JOURNAL ENTRY, which is the observable
      that separates "ran" from "died quietly".
    - Quality Contribution: this is the only row in the suite where the producer of
      the command string and its consumer are the same string.
    */
      const composed = composedCommands();
      // Every supported agent, every config file, every event key. A count assertion
      // so a fixture that silently stopped detecting an agent reads as a failure
      // rather than as a pass.
      //
      // DERIVED FROM THE MATRIX, not written down. It used to be `AGENT_CONFIGS × 2`,
      // which assumed two events per agent and that every known agent is installed —
      // BOTH became false in plan 082 F005 (windsurf dispatches on five cascade
      // events, and firebender is deliberately held out). A literal here would have
      // had to be re-derived by hand at exactly the moment the shapes changed.
      expect(composed.length, 'the installer wrote a command for every agent×file×event').toBe(
        expectedCommandCount(),
      );

      for (const { agent, phase, command } of composed) {
        const argv = argvOf(command);
        const where = `${agent} ${phase}`;
        // EVERY token of the invocation must exist, not just the first (F008).
        // Derived INDEPENDENTLY, in keeping with this file's stance: the invocation
        // is whatever precedes the literal `hooks` verb. Checking only argv[0] once
        // that token is `node` asks whether Node exists on a machine that is
        // running Node — a check that cannot fail, occupying the slot where a check
        // should be.
        const verbAt = argv.indexOf('hooks');
        expect(verbAt, `${where}: the command must reach the hooks verb`).toBeGreaterThan(0);
        // The invocation is PATHS plus INTERPRETER FLAGS (F010 F5). A flag is not a
        // file, so only the paths are stat-able — and the count is asserted so this
        // cannot degrade into checking nothing once everything is filtered out.
        //
        // ONE PATH OR TWO, and which one is the point (plan 085). The installer now
        // prefers the shipped WRAPPER — a single token that resolves the interpreter
        // when the hook fires — and falls back to the interpreter+script pair when no
        // wrapper is present. Both are legal; naming NEITHER is not, which is what the
        // count still guards. Asserting a bare `2` here pinned the pair specifically,
        // so it failed the moment the wrapper shipped: correct behaviour from a fixture
        // that had outlived its contract.
        const paths = argv.slice(0, verbAt).filter((token) => !token.startsWith('-'));
        const wrapped = paths.length === 1 && paths[0]?.endsWith('harness-hook.sh') === true;
        expect(
          wrapped || paths.length === 2,
          `${where}: the invocation must name the wrapper, or interpreter and script`,
        ).toBe(true);
        for (const token of paths) {
          expect(existsSync(token), `${where}: composed invocation token ${token} must exist`).toBe(
            true,
          );
        }

        const run = runArgv(argv);
        expect(run.stderr, `${where}: the hook must print nothing an agent can see`).toBe('');
        expect(run.stdout, `${where}: the hook must print nothing an agent can see`).toBe('');
        expect(run.status, `${where}: the exit-0 contract, on the string we ship`).toBe(0);
      }

      // Exit 0 is unconditional by design, so it proves nothing on its own. The
      // journal is what separates "ran" from "died before reaching our code" — and
      // one entry per composed command, so a single silent death is visible.
      expect(journal().length).toBe(composed.length);
      // 120s, not the 30s floor — a SPAWN-COUNT budget, not a Windows exemption.
      //
      // This row spawns ~20 real CLI subprocesses (every supported agent x config
      // file x event key) plus an install and a `git init`. Measured: ~3.35s on
      // macOS, 54.2s on the Windows VM. Windows per-spawn cost is multiples of
      // macOS, so the row exceeded the wall ON BUDGET, never on correctness — every
      // assertion it makes was already passing when the clock ran out.
      //
      // vitest.config.ts chose 30s deliberately and its own reasoning points here:
      // the contention is "this suite spawns processes constantly", NOT "this suite
      // is on Windows", and it warns that a too-tight budget "fails cases whose
      // assertions were never in doubt and hides the ones that were". So this is a
      // PER-TEST raise on the spawn-heaviest row, with no platform branch — a
      // win32-only guard would encode "Windows is the weird one", which is the
      // wrong diagnosis attached to the right symptom.
      //
      // NOT SKIPPED, on purpose. This is the only end-to-end proof that the
      // installed string executes verbatim and lands a journal entry; skipping it
      // on the slow platform would mean the property is never proven on the
      // platform most likely to break it.
    },
    120_000,
  );

  it('emits no option `fire` does not register — checked flag by flag', () => {
    /*
    Test Doc:
    - Why: the reviewer's question, and it is the right one — "if the installer can
      emit one word fire does not accept, it can emit two". This row does not care
      WHICH flag; it enumerates every option token in the composed string and
      demands each be a registered option of the verb.
    - Contract: derived from `hooks fire --help` (the verb's own declaration of what
      it accepts) rather than from a hard-coded list, which would be a third idea of
      the contract beside the two that already disagreed.
    - Quality Contribution: survives any future decision to make `fire` tolerant of
      unknown options. Execution alone would then go green with the bug intact.
    */
    const help = execFileSync(process.execPath, [CLI, 'hooks', 'fire', '--help'], {
      encoding: 'utf8',
      env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
    });
    const registered = new Set(help.match(/--[a-z0-9][a-z0-9-]*/gi) ?? []);
    expect(registered.size, 'the help text must actually list options').toBeGreaterThan(0);

    const composed = composedCommands();
    expect(composed.length, 'every agent×file×event is checked, not just cursor').toBe(
      expectedCommandCount(),
    );
    for (const { agent, phase, command } of composed) {
      /*
       * ONLY THE OPTIONS THE VERB RECEIVES (F010 F5). Tokens before the `hooks`
       * verb belong to the INTERPRETER — `--no-warnings` is Node's flag and `fire`
       * has no business declaring it. Scanning the whole string asked commander to
       * account for someone else's arguments, and the production reader that made
       * the same mistake reported `unknown-options` for every healthy install.
       */
      const argv = argvOf(command);
      const emitted = argv.slice(argv.indexOf('hooks') + 1).filter((t) => t.startsWith('--'));
      expect(emitted.length, `${agent} ${phase}: the installer emits options`).toBeGreaterThan(0);
      for (const flag of emitted) {
        expect(registered.has(flag), `${agent} ${phase}: \`fire\` must register ${flag}`).toBe(
          true,
        );
      }
      // The other half, and it is what keeps the split honest: an interpreter flag
      // must never drift to the far side of the verb, where commander would meet it.
      const interpreterFlags = argv
        .slice(0, argv.indexOf('hooks'))
        .filter((t) => t.startsWith('-'));
      for (const flag of interpreterFlags) {
        expect(emitted.includes(flag), `${agent} ${phase}: ${flag} is the interpreter's`).toBe(
          false,
        );
      }
    }
  });

  it.runIf(POSIX_SHELL)(
    'treats the marker as PROVENANCE, not behaviour: same outcome with and without it',
    () => {
      /*
    Test Doc:
    - Why: the flag exists so uninstall can recognise its own entry. If `fire` ever
      started BEHAVING differently because of it, the installed command and every
      hand-typed reproduction would diverge again — the same class of defect, in the
      opposite direction. This row pins the flag as inert so nobody later gives it
      meaning without failing a test.
    - Contract: run the composed argv, and the same argv with the marker pair
      stripped; the journal entry each produces is identical apart from the fields
      that are per-run by construction.
    */
      const { command } = cursorCommands().find((c) => c.phase === 'preToolUse') as Composed;
      const withMarker = argvOf(command);
      const markerAt = withMarker.indexOf(HOOK_MARKER_FLAG);
      expect(markerAt, 'the composed command carries the marker flag').toBeGreaterThan(-1);
      const withoutMarker = [...withMarker];
      withoutMarker.splice(markerAt, 2);

      const first = runArgv(withMarker);
      const afterMarker = journal();
      const second = runArgv(withoutMarker);
      const afterBoth = journal();

      expect(first.status).toBe(0);
      expect(second.status).toBe(0);
      expect(afterMarker.length, 'the marked run journalled').toBe(1);
      expect(afterBoth.length, 'the unmarked run journalled too').toBe(2);

      // Per-run by construction: the clock and the identity of the firing process.
      const shape = (entry: Record<string, unknown>): Record<string, unknown> => {
        const { at, timestamp, id, pid, ...rest } = entry;
        void at;
        void timestamp;
        void id;
        void pid;
        return rest;
      };
      expect(shape(afterBoth[1])).toEqual(shape(afterBoth[0]));
    },
  );

  it.runIf(POSIX_SHELL)(
    'survives an option it does NOT declare: still exit 0, still silent, still journals',
    () => {
      /*
    Test Doc:
    - Why: registering `--hook-owner` fixes ONE flag. The exit-0 contract claims
      "every path" — and argument parsing was not one of them, which is how a
      single unknown word killed every hook on every machine before our code ran.
      This pins the CLASS: a config written by another version of this binary, or
      hand-edited, must degrade to an ignored word rather than an aborted turn.
    - Contract: an argv carrying a flag no version declares still exits 0, prints
      nothing, and REACHES the journal — the last of those being the one that
      separates "tolerated" from "died quietly", since exit 0 is unconditional.
    */
      const { command } = cursorCommands().find((c) => c.phase === 'preToolUse') as Composed;
      const argv = [...argvOf(command), '--a-flag-from-the-future', 'whatever'];

      const run = runArgv(argv);
      expect(run.stderr).toBe('');
      expect(run.stdout).toBe('');
      expect(run.status).toBe(0);
      expect(journal().length, 'tolerance means it RAN, not that it exited quietly').toBe(1);
    },
  );
});

describe('`hooks status` can see that the ARGUMENTS are rejected, not just that the binary is there', () => {
  const status = (): {
    agent: string;
    binaryState: string;
    commandState: string;
    unacceptedOptions?: string[];
  }[] =>
    (
      JSON.parse(
        execFileSync(process.execPath, [CLI, 'hooks', 'status', '--json'], {
          encoding: 'utf8',
          env: { ...hermeticGitEnv(), HOME: home, USERPROFILE: home },
        }),
      ) as {
        agents: {
          agent: string;
          binaryState: string;
          commandState: string;
          unacceptedOptions?: string[];
        }[];
      }
    ).agents;

  it('reports `accepted` for a command this binary can parse', () => {
    /*
    Test Doc:
    - Why: `binaryState: 'resolves'` stats the BINARY. It reported six agents
      healthy while none of them could run, because the binary existed and the
      ARGUMENTS were rejected. A field that cannot see the defect must not be the
      only field a reader has.
    - Contract: a freshly installed agent reads `resolves` AND `accepted`. Both,
      because either alone is not "works".
    */
    const cursor = status().find((row) => row.agent === 'cursor');
    expect(cursor?.binaryState).toBe('resolves');
    expect(cursor?.commandState).toBe('accepted');
    expect(cursor?.unacceptedOptions).toBeUndefined();
  });

  it('NAMES the option when a config carries one this binary does not declare', () => {
    /*
    Test Doc:
    - Why: the F004 shape as a user would actually meet it after the fix — a config
      written by a different version of the harness. `fire` tolerates it, so it is
      drift rather than breakage, but a reader must be able to SEE the disagreement
      rather than infer health from a binary that merely exists.
    - Contract: status reports `unknown-options` and names the offending flag; the
      binary still resolves, so the two fields are proven independent rather than
      one being a rename of the other.
    */
    const path = join(home, '.cursor', 'hooks.json');
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    config.hooks.preToolUse[0].command += ' --from-a-newer-harness v2';
    writeFileSync(path, JSON.stringify(config, null, 2));

    const cursor = status().find((row) => row.agent === 'cursor');
    expect(cursor?.commandState).toBe('unknown-options');
    expect(cursor?.unacceptedOptions).toEqual(['--from-a-newer-harness']);
    // Independent of the binary check, which still passes — the point of the split.
    expect(cursor?.binaryState).toBe('resolves');
  });
});

describe('the silent contract survives an environment we do not control (plan 082 F010 F5)', () => {
  it.runIf(POSIX_SHELL)(
    'prints NOTHING with both NO_COLOR and FORCE_COLOR set — the pair Node warns about',
    () => {
      /*
    Test Doc:
    - Why: `fire` runs inside an agent's tool loop under an exit-0-AND-SILENT
      contract, and since F008 the installed command launches Node DIRECTLY. Node
      emits `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env
      being set.` at STARTUP — before our process has run a line — so no amount of
      discipline inside `fire` can suppress it. A reviewer hit this in a real
      environment, not a constructed one.
    - Contract: make the INVOCATION robust rather than the environment. The
      composed command stays silent even when the hostile pair is set.
    - Quality Contribution: the pair is set EXPLICITLY here rather than inherited,
      so this row reproduces the defect on any machine instead of only on the
      machines that happen to be configured for it.
    */
      const { command } = cursorCommands().find((c) => c.phase === 'preToolUse') as Composed;
      const run = runArgv(argvOf(command), { NO_COLOR: '1', FORCE_COLOR: '1' });

      expect(run.stderr, 'a startup warning is still output an agent can see').toBe('');
      expect(run.stdout).toBe('');
      expect(run.status).toBe(0);
      // Exit 0 carries no information by design, so silence alone could mean the
      // process died before reaching us. The journal is what separates the two.
      expect(journal().length, 'silent must mean it RAN, not that it never started').toBe(1);
    },
  );

  it.runIf(POSIX_SHELL)(
    'still REACHES our code under that environment — silence is not the only property',
    () => {
      /*
    Test Doc:
    - Why: the counter-row for the obvious wrong fix. Redirecting or swallowing the
      hook's output would satisfy the row above while breaking everything the hook
      is for, and exit 0 could not tell you.
    - Contract: the journal records a fire under the hostile environment.
    */
      const { command } = cursorCommands().find((c) => c.phase === 'preToolUse') as Composed;
      runArgv(argvOf(command), { NO_COLOR: '1', FORCE_COLOR: '1' });

      expect(journal().length).toBe(1);
    },
  );
});

describe('`--hook-input-file`: the payload the WINDOWS wrapper spills (plan 085)', () => {
  /*
   * WHY THESE ROWS LIVE IN *THIS* FILE.
   *
   * This is the file that exists because a flag one side COMPOSED was a flag the
   * other side did not DECLARE, and commander exited 1 before our code ran — on
   * every machine, invisibly. `harness-hook.ps1` now composes `--hook-input-file`
   * at fire time, which is the same shape of risk with a narrower blast radius:
   * it would fail on Windows only, inside an agent's tool loop, silently.
   *
   * MEASURED CAUSE (wrapper alone, real repo, no agent): on Windows PowerShell 5.1
   * a payload piped into the `.ps1` does not survive the hop to node. Copilot sends
   * it, args arrive intact, node starts, stdin is EMPTY — so `repoRoot` is null, the
   * repo guard returns, and nothing is journalled. The wrapper therefore spills
   * stdin to a file byte-for-byte and names it here.
   */

  it('reads the payload from the FILE when stdin is empty — the Windows contract', () => {
    /*
    Test Doc:
    - Why: the whole point of the flag. If it were ignored, this fire would see an
      empty stdin, find no repoRoot and journal NOTHING — which is precisely the
      silent zero observed on Windows.
    - Contract: exit 0, and a journal entry naming the repo the FILE described.
    - Note the deliberately EMPTY stdin: a default payload there would let this row
      pass against a build that never reads the file.
    */
    const spill = join(dir, 'payload.json');
    writeFileSync(
      spill,
      JSON.stringify({ tool_name: 'Bash', tool_input: { cwd: repo, command: 'git status' } }),
    );

    const { status } = runArgv(
      [
        process.execPath,
        CLI,
        'hooks',
        'fire',
        'github-copilot',
        '--phase',
        'pre',
        '--hook-input',
        'stdin',
        '--hook-input-file',
        spill,
      ],
      {},
      '',
    );

    expect(status, 'the exit-0 contract holds on every path').toBe(0);
    const entries = journal();
    expect(entries.length, 'the file payload must reach the journal').toBe(1);
    expect(entries[0].repoRoot).toBe(repo);
  });

  it('JOURNALS a named spill it cannot read, rather than passing over it in silence', () => {
    /*
    Test Doc:
    - Why: every other empty payload is a legitimate quiet skip; this one is not.
      The wrapper wrote a file and said so, and it is gone by the time we look —
      treating that as "no payload" would return at the repo guard and rebuild the
      exact silent zero this plan spent a day chasing, one layer further in.
    - Contract: exit 0 (never break the tool call), and a `failed` record naming
      `payload-file-unreadable`.
    - Mutation: delete the guard in `acts/hooks.ts` and this row goes red while the
      row above stays green — the two are not redundant.
    */
    const { status } = runArgv(
      [
        process.execPath,
        CLI,
        'hooks',
        'fire',
        'github-copilot',
        '--phase',
        'pre',
        '--hook-input',
        'stdin',
        '--hook-input-file',
        join(dir, 'was-never-written.json'),
      ],
      {},
      '',
    );

    expect(status).toBe(0);
    const entries = journal();
    expect(entries.length, 'an unreadable spill is a FINDING, not a skip').toBe(1);
    expect(entries[0].outcome).toEqual({ kind: 'failed', cause: 'payload-file-unreadable' });
  });
});
