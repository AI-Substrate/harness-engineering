import { execFileSync, spawnSync } from 'node:child_process';
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
import {
  brokenCliEnv,
  FAKE_EXIT_CODE,
  FAKE_STDERR_LEAK,
  FAKE_STDOUT_LEAK,
  SIGNALLED_CLI,
  stageBrokenCli,
} from '../../support/broken-cli-fixture.js';
import { POSIX_SHELL } from '../../support/posix-shell.js';

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
 *
 * THAT SENTENCE IS NOW ENFORCED, AND FOR YEARS IT WAS NOT. It sat here as prose while
 * `run()` handed the script to `/bin/sh` unconditionally, so on Windows the spawn
 * ENOENT'd, the catch coerced a null status to -1, and all seven behavioural rows went
 * red on a platform the file itself declared out of scope. Measured on the VM at
 * `3e4b148a`; reproduced independently on a second Windows box. The gate is
 * {@link ../../support/posix-shell.ts}, and it degrades rather than going dark - see the
 * final describe, which runs everywhere.
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

describe.runIf(POSIX_SHELL)('the hook wrapper resolves an interpreter at fire time', () => {
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

describe.runIf(POSIX_SHELL)('the same broken state exits 1 to a CHECKER and 0 to a FIRE', () => {
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

describe.runIf(POSIX_SHELL)('a failure that cannot run node still reports itself', () => {
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

/**
 * THE FAILURE BRANCH THAT STARTS AFTER NODE DOES (#180) — POSIX dialect.
 *
 * The describe above proves the wrapper's asymmetry when NO interpreter can be found,
 * i.e. everything BEFORE node starts. This one covers the other half: an interpreter
 * that resolves and then cannot boot the CLI. See
 * {@link ../../support/broken-cli-fixture.ts} for why that is an ordinary race rather
 * than an exotic state, and why the fixture is itself a control.
 *
 * The PowerShell twin of these rows lives in `hook-wrapper-ps1.int.test.ts`, staged
 * against the same fixture but asserted on its own terms.
 */
describe.runIf(POSIX_SHELL)('a CLI that BOOTS AND THEN FAILS never denies the agent', () => {
  let broken: ReturnType<typeof stageBrokenCli>;

  beforeEach(() => {
    broken = stageBrokenCli('harness-hook.sh');
  });
  afterEach(() => rmSync(broken.dir, { recursive: true, force: true }));

  /**
   * `spawnSync`, not the `run()` helper above: these rows must read STDERR
   * separately from stdout (the defect leaked both) and must not depend on a throw to
   * observe a non-zero status.
   */
  const fire = (args: string[]) =>
    spawnSync('/bin/sh', [broken.wrapper, ...args], {
      encoding: 'utf8',
      env: brokenCliEnv(broken.home),
      input: '{"tool_name":"Bash"}',
    });

  it('swallows a broken CLI for a FIRE and preserves it for an OPERATOR', () => {
    /*
    Test Doc:
    - Why: MEASURED at 9d3ea8e4 — with a `harness.js` that wrote to both streams and
      exited 23, `hooks fire … --hook-input stdin` exited 23 and leaked both streams.
      A non-zero PRE-tool hook is read as a DENIAL, so in a real Copilot session every
      tool call was blocked; recovery was blocked too, because `hooks hooks uninstall`
      runs the same unbootable CLI. A half-written `dist/` from a concurrent build is
      all it takes.
    - Contract: a `hooks fire` invocation exits 0 and emits nothing, whatever the child
      does; EVERY other invocation keeps the child's exit code and both its streams.
    - Usage Notes: BOTH HALVES LIVE IN ONE BODY on purpose, matching the pre-node
      asymmetry row above. The operator half is the POSITIVE CONTROL: without it this
      file would pass just as happily against a wrapper that swallowed everything
      unconditionally — which would silently destroy `hooks status`. A test that cannot
      fail against the over-broad fix is not evidence.
    - Quality Contribution: catches (a) a return to `exec`, which forwards the child's
      status, (b) any suppression that widens past `hooks fire`, and (c) a fixture whose
      child never started — asserted directly, because "exit 0 and silent" and "never
      ran" are identical at the observer and opposite in meaning.
    - Worked Example: fire → {status: 0, stdout: '', stderr: ''} with childArgv
      non-null; `--version` → {status: 23, stdout: 'FAKE_STDOUT_LEAK'}.
    */
    const fired = fire([
      'hooks',
      'fire',
      'github-copilot',
      '--phase',
      'pre',
      '--hook-input',
      'stdin',
    ]);

    expect(broken.childArgv(), 'the fake CLI never ran — this row proves NOTHING').not.toBeNull();
    expect(fired.status).toBe(0);
    expect(fired.stdout).toBe('');
    expect(fired.stderr).toBe('');

    const operator = fire(['--version']);
    expect(operator.status).toBe(FAKE_EXIT_CODE);
    expect(operator.stdout).toContain(FAKE_STDOUT_LEAK);
    expect(operator.stderr).toContain(FAKE_STDERR_LEAK);
  });

  it('leaves CHECK MODE — what `hooks status` invokes — completely untouched', () => {
    /*
    Test Doc:
    - Why: a fix that special-cased only `--version` would pass the row above and still
      kill `--harness-hook-check`, which is the entry point `hooks status` invokes to
      answer CAN THIS RUN. Killing it would rebuild the false green this wrapper exists
      to remove, one layer up.
    - Contract: check mode still reports its resolution on stdout and exits 0, and it
      starts no node at all.
    - Usage Notes: the absence of the leak strings here means the CHILD WAS NEVER
      STARTED, which is the correct behaviour for check mode — the opposite of what the
      same absence means on the fire row.
    - Quality Contribution: catches a suppression scoped by anything looser than the
      exact `hooks fire` argument pair.
    - Worked Example: `--harness-hook-check` → {status: 0, stdout: 'path=/…\nversion=…'}.
    */
    const checked = fire(['--harness-hook-check']);

    expect(checked.status).toBe(0);
    expect(checked.stdout).toMatch(/^path=\//m);
    expect(checked.stdout).toMatch(/^step=/m);
    expect(checked.stdout).not.toContain(FAKE_STDOUT_LEAK);
    expect(broken.childArgv(), 'check mode must not start node').toBeNull();
  });

  it('exits 0 even when the child is KILLED BY A SIGNAL', () => {
    /*
    Test Doc:
    - Why: a signalled child has no exit code. A POSIX shell reports it as 128+n, so a
      wrapper that forwarded status would hand the agent 137 for a hook whose contract
      is exit 0 — the same denial as a non-zero exit, reached by a path that a
      `$? -eq 0` style fix could miss. OOM-killing a node process is not rare.
    - Contract: SIGKILL of the child still yields exit 0 from the wrapper.
    - Usage Notes: the fake writes its marker BEFORE killing itself, so the row still
      proves the child ran.
    - Quality Contribution: catches a fix that inspects the child's status and
      selectively forwards it rather than exiting 0 unconditionally.
    - Worked Example: child SIGKILLs itself → wrapper {status: 0}.
    */
    broken.replaceCli(SIGNALLED_CLI);

    const fired = fire(['hooks', 'fire', 'cursor', '--phase', 'post']);

    expect(broken.childArgv(), 'the fake CLI never ran — this row proves NOTHING').not.toBeNull();
    expect(fired.status).toBe(0);
  });

  it('RECORDS the boot failure it swallowed, so silence is not the whole story', () => {
    /*
    Test Doc:
    - Why: MEASURED while building this fix — after a swallowed boot failure the fenced
      state dir held the interpreter cache and NOTHING ELSE. No stderr (discarded), no
      `fires.jsonl` (the process that writes it is the one that died). `hooks status`
      then renders a CLI that is dead on every fire as "never fired", WHICH IS ALSO
      WHAT A HEALTHY IDLE REPO LOOKS LIKE: an operator checks, sees nothing, and
      correctly concludes nothing is wrong. A signal indistinguishable from health is
      worse than a missing one, and it is the exact defect class this wrapper was
      written to end — so swallowing without recording would rebuild it one layer up.
    - Contract: a swallowed fire failure appends a `cli-failed` line to
      `interpreter-failures.log`, carrying the child's exit code, the agent slug, and
      THE INTERPRETER THAT RAN. A healthy fire writes nothing.
    - Usage Notes: the kind is the SECOND tab-separated field; `no-interpreter` lines
      from the pre-node branch keep the same shape, so both parse the same way.
      Nothing in `src/` reads this file, so the new kind breaks no reader.
    - Quality Contribution: catches a future "simplification" that keeps the exit-0
      swallow and drops the record, which would leave the failure invisible on every
      surface. The exact match on field 4 also catches a revert to logging `$PATH`
      here — MEASURED on Windows PowerShell 5.1 at ~500 characters per line, on a log
      that grows twice per tool call while a CLI stays broken, and answering a question
      nobody is asking once node has already been found.
    - Worked Example: fire against the broken CLI → log line
      `2026-…Z\tcli-failed\texit=23 agent=github-copilot\t/opt/homebrew/bin/node`.
    */
    fire(['hooks', 'fire', 'github-copilot', '--phase', 'pre']);

    const log = readFileSync(broken.failureLog, 'utf8');
    const fields = log.trim().split('\n')[0].split('\t');
    expect(fields[1]).toBe('cli-failed');
    expect(fields[2]).toContain(`exit=${FAKE_EXIT_CODE}`);
    expect(fields[2]).toContain('agent=github-copilot');
    expect(fields[3]).toBe(broken.resolvedInterpreter());
  });
});

/**
 * A STATIC GUARD ON THE .PS1, IN A FILE THAT OTHERWISE COVERS ONLY THE .SH.
 *
 * This asserts nothing about PowerShell's behaviour — it asserts a TEXTUAL property,
 * which is dialect-independent and therefore honest to check from here. The behaviour
 * behind it was measured on a real host and is written up in the wrapper itself.
 *
 * WHAT IT PROTECTS. Merely MENTIONING `$input` in a PowerShell script makes the runtime
 * pre-read stdin into the pipeline before the script runs, so `[Console]::OpenStandardInput()`
 * then reads ZERO bytes. It binds at PARSE time: a branch that never executes drains the
 * stream just as thoroughly as one that does. Measured — two scripts differing only by
 * `if ($false) { $null = @($input) }` read 24 bytes and 0 bytes respectively.
 *
 * That is a one-line, plausible-looking edit that silently empties every hook payload on
 * Windows and CANNOT be caught by any POSIX row here, by review, or by a green macOS
 * end-to-end run. It already happened once, mid-fix. So it is encoded instead of trusted
 * to memory.
 */
describe('the PowerShell wrapper never mentions `$input` (measured stdin-drain hazard)', () => {
  it('contains no `$input` outside comments — a dead reference would empty every payload', () => {
    const source = readFileSync(join(BIN, 'harness-hook.ps1'), 'utf8');
    const offenders = source
      .split(/\r?\n/)
      .map((line, index) => ({ line, number: index + 1 }))
      // Comments are safe — verified on a real host: `$input` named in a comment
      // leaves the OS stream intact (24 bytes, same as a file that never names it).
      .map((row) => ({ ...row, code: row.line.split('#')[0] }))
      .filter((row) => /\$input\b/i.test(row.code));

    expect(
      offenders.map((row) => `${row.number}: ${row.line.trim()}`),
      'a `$input` reference anywhere in this file empties stdin at parse time',
    ).toEqual([]);
  });
});

/**
 * WHAT THIS FILE STILL PROVES ON A HOST WITH NO POSIX SHELL — the degrade half.
 *
 * These rows run EVERYWHERE, deliberately. Three of the describes above are gated on
 * {@link POSIX_SHELL} because they must start `/bin/sh`; if that were the whole change
 * this file would go fully dark on Windows, and a dark file teaches the next author
 * that the platform is out of scope. That is the exact defect being repaired here: the
 * boundary was stated at the top of this file and enforced nowhere, so it read as a
 * disclaimer rather than a contract.
 *
 * So the properties that DO NOT need a shell are asserted on every platform. They are
 * weaker than running the thing, and they are not nothing: a missing wrapper, a BOM, or
 * a `.ps1` that stopped shipping beside its twin are all live regressions that would
 * otherwise reach Windows users through a green run.
 *
 * WHAT THESE ROWS DO NOT PROVE, and where that lives instead. They say nothing about
 * whether either wrapper RUNS on Windows. **#173** is still fully open (six of seven
 * agents get `command` = a bare `harness-hook.sh` path on Windows, executability
 * unmeasured). **#174** is partly closed by plan 089: `hook-wrapper-ps1.int.test.ts`
 * now EXECUTES `harness-hook.ps1` wherever a host PowerShell can run a `.ps1` file, so
 * the dialect is no longer covered by a text grep alone — but every constraint in that
 * wrapper was measured on Windows PowerShell 5.1, and a green under `pwsh 7` is an
 * approximation of it. If you came here because Windows is green and wondered whether
 * that means both wrappers work there: it does not, and that is why.
 */
describe('both wrappers ship, on every platform (no shell required)', () => {
  const wrappers = [
    ['harness-hook.sh', WRAPPER],
    ['harness-hook.ps1', join(BIN, 'harness-hook.ps1')],
  ] as const;

  it.each(wrappers)('%s is present and non-empty beside its twin', (_name, path) => {
    /*
    Test Doc:
    - Why: the entry a hook config names is one of these two files. `package.json#files`
      ships `harness/cli/bin`, but a packaging change is exactly the kind of edit that
      looks harmless and removes a file nobody executes in CI on the platform that needs
      it. An entry naming a wrapper that is not there is the silent-failure class this
      whole plan exists to remove.
    - Contract: both files exist and carry content, whatever host this runs on.
    */
    expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0);
  });

  it.each(wrappers)('%s is ASCII with no BOM', (_name, path) => {
    /*
    Test Doc:
    - Why: MEASURED this week, twice. PowerShell 5.1's `Set-Content -Encoding UTF8`
      writes a BOM, and a BOM at the head of a script breaks parsing on the host that
      reads it — the same class that broke a fixture mid-investigation. A non-ASCII byte
      in a file staged for a Windows guest produces a PARSER error naming the WRONG
      line and blaming quoting, which costs an hour before anyone suspects encoding.
    - Contract: no BOM, and no byte outside printable ASCII plus tab/CR/LF. Asserted on
      BYTES, never on a decoded string — a text-mode read is what hides this.
    */
    const bytes = readFileSync(path);
    expect(
      bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
      `${_name} starts with a UTF-8 BOM`,
    ).toBe(false);

    const offenders = [...bytes]
      .map((byte, index) => ({ byte, index }))
      .filter(
        ({ byte }) =>
          byte > 0x7e || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d),
      );

    expect(
      offenders.slice(0, 5).map(({ byte, index }) => `byte ${index} = 0x${byte.toString(16)}`),
      `${_name} carries non-ASCII bytes`,
    ).toEqual([]);
  });
});
