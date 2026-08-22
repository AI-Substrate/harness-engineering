import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  brokenCliEnv,
  FAKE_EXIT_CODE,
  FAKE_STDERR_LEAK,
  FAKE_STDOUT_LEAK,
  stageBrokenCli,
} from '../../support/broken-cli-fixture.js';
import {
  POWERSHELL,
  POWERSHELL_BIN,
  powershellProvenLabel,
} from '../../support/powershell-shell.js';

/**
 * THE POWERSHELL HOOK WRAPPER, EXECUTED — the first rows in this repo that run it
 * (plan 089 · #180, and the executable half of #174).
 *
 * ## Why this file exists at all
 *
 * `harness-hook.ps1` had no execution coverage anywhere. Its only reference in the
 * test tree was a `readFileSync` text grep for `$input`, and the exit-code contract it
 * shares with its POSIX twin was asserted on POSIX only, because those rows hand the
 * script to `/bin/sh` and are gated on a capability probe (#175).
 *
 * **That gap sat exactly on top of the blast radius.** Before `9d3ea8e4` this file was
 * reachable by one agent through one optional `powershell` field. Since #177 the
 * Windows `command` for ALL FIVE agents is `powershell.exe -NoProfile -File
 * harness-hook.ps1`. So when #180 turned out to be an exit-code contract failure —
 * a wrapper leaking a failed CLI's status, which every agent reads as a DENIED TOOL
 * CALL — the dialect carrying the whole Windows blast radius was the one with no test
 * that could see it.
 *
 * ## SEPARATE FILE, DELIBERATELY, AND NOT INFERRED FROM THE TWIN
 *
 * `harness-hook.sh` and `harness-hook.ps1` are maintained as independent
 * implementations: npm's own `cmd-shim` diverges between its `.cmd` and `.ps1`
 * variants (npm/cmd-shim#51), so the reference implementation of this pattern does not
 * have parity between its own shells either. These rows therefore stage the SAME
 * fixture as the POSIX rows — the same fake CLI, the same leak strings, so results are
 * directly comparable — but assert on this dialect's own terms and share no runner.
 *
 * ## WHAT A GREEN HERE MEANS DEPENDS ON WHICH POWERSHELL RAN
 *
 * Every hard-won constraint in the wrapper was measured on **Windows PowerShell
 * 5.1**: the parse-time stdin drain from merely naming `$input`, the UTF-16LE/ASCII
 * pipeline re-encode, the two-argument `File.Move` overload. `pwsh 7` shares the
 * dialect, not the runtime. {@link powershellProvenLabel} puts the interpreter in every
 * row name so a reader can tell a 5.1 green from an approximation — a green on macOS
 * NARROWS #174, it does not close it.
 */
describe.runIf(POWERSHELL)('the PowerShell hook wrapper, executed', () => {
  let broken: ReturnType<typeof stageBrokenCli>;

  beforeEach(() => {
    broken = stageBrokenCli('harness-hook.ps1');
  });
  afterEach(() => rmSync(broken.dir, { recursive: true, force: true }));

  /**
   * Invoked the way the installed hook command invokes it: `-NoProfile -File`.
   *
   * NO `-ExecutionPolicy Bypass`. It would make these rows pass more often and mean
   * less — policy is part of what makes a shipped `.ps1` runnable, and masking it
   * would report a wrapper as working on a host that cannot run it. (Anyone reading a
   * result from a VM: a launcher passing `Bypass` leaks it to children through
   * `PSExecutionPolicyPreference`, so clear that variable before trusting a green.)
   *
   * `input` is supplied on every call, which makes stdin a PIPE and therefore sends
   * the wrapper down its `[Console]::IsInputRedirected` spill branch — the branch a
   * real agent uses.
   */
  const fire = (args: string[], input: string | Buffer = '{"tool_name":"Bash"}') =>
    spawnSync(POWERSHELL_BIN as string, ['-NoProfile', '-File', broken.wrapper, ...args], {
      encoding: 'utf8',
      env: brokenCliEnv(broken.home),
      input,
    });

  it(
    powershellProvenLabel('swallows a broken CLI for a FIRE and preserves it for an OPERATOR'),
    () => {
      /*
    Test Doc:
    - Why: both of this file's call sites captured `$LASTEXITCODE` into `$Code` and
      ended at one unconditional `exit $Code`, so an interpreter that resolved and then
      failed to boot the CLI reached the agent as a non-zero PRE-tool hook — read as a
      DENIAL of the tool call, for all five agents on Windows since #177. Recovery was
      blocked too: `harness hooks uninstall` runs the same unbootable CLI.
    - Contract: an invocation whose first two arguments are `hooks fire` exits 0 and
      emits nothing, whatever the child does; every other invocation keeps the child's
      exit code and both its streams.
    - Usage Notes: BOTH HALVES IN ONE BODY, matching the POSIX twin. The operator half
      is the POSITIVE CONTROL — without it this file would pass against a wrapper that
      swallowed everything unconditionally, which would silently destroy `hooks status`.
      Note that both branches of this wrapper converge on ONE exit, so the fix cannot
      discriminate by BRANCH; it discriminates by ARGS, and that is what these two rows
      pin.
    - Quality Contribution: catches a return to `exit $LASTEXITCODE` on the fire path,
      any suppression that widens past `hooks fire`, and a fixture whose child never
      started — asserted directly, because "exit 0 and silent" and "never ran" are
      identical at the observer and opposite in meaning.
    - Worked Example: fire → {status: 0, stdout: '', stderr: ''}; `--version` →
      {status: 23, stdout: 'FAKE_STDOUT_LEAK'}.
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
    },
  );

  it(powershellProvenLabel('leaves CHECK MODE — what `hooks status` invokes — untouched'), () => {
    /*
    Test Doc:
    - Why: a fix special-casing only `--version` would pass the row above and still kill
      `--harness-hook-check`, the entry point `hooks status` invokes to answer CAN THIS
      RUN. On Windows check mode earns a second keep: a `.ps1` blocked by execution
      policy fails there, visibly, where a stat would report the file present and
      healthy. Killing it would rebuild the false green the wrapper exists to remove.
    - Contract: check mode still reports its resolution on stdout and exits 0, and it
      starts no node.
    - Usage Notes: the absence of the leak strings here means the child was never
      STARTED, which is correct for check mode — the opposite of what the same absence
      means on the fire row.
    - Quality Contribution: catches a suppression scoped by anything looser than the
      exact `hooks fire` argument pair.
    - Worked Example: `--harness-hook-check` → {status: 0, stdout: 'path=…\nversion=…'}.
    */
    const checked = fire(['--harness-hook-check']);

    expect(checked.status).toBe(0);
    expect(checked.stdout).toMatch(/^path=/m);
    expect(checked.stdout).toMatch(/^step=/m);
    expect(checked.stdout).not.toContain(FAKE_STDOUT_LEAK);
    expect(broken.childArgv(), 'check mode must not start node').toBeNull();
  });

  it(
    powershellProvenLabel('delivers the payload BYTE-EXACT through the spill while suppressing'),
    () => {
      /*
    Test Doc:
    - Why: this wrapper spills stdin to a temp file and passes `--hook-input-file`
      SPECIFICALLY to avoid PowerShell 5.1 re-encoding the payload — a pipeline
      redirects as UTF-16LE and writes to native commands using `$OutputEncoding`,
      which defaults to ASCII, so every non-ASCII byte becomes `?`. The output
      suppression added for #180 sits on the very same statement as that delivery, so
      it is exactly the edit that could turn the invocation back into a pipeline and
      destroy the wire bytes while every exit code stayed green.
    - Contract: the bytes the child receives are byte-identical to the bytes written to
      stdin, and `--hook-input-file` is still what names them.
    - Usage Notes: asserted on HEX, never on a decoded string — a text-mode comparison
      is what hides this class. The payload deliberately carries a UTF-8 BOM (efbbbf),
      a two-byte sequence (c3a9), a three-byte em dash (e28094) and a four-byte emoji
      (f09f94a5).
    - Quality Contribution: catches any "simplification" of the suppression into
      `| Out-Null` or a piped payload, and any change that drops `--hook-input-file`.
    - Worked Example: stdin `efbbbf7b…0a` → child reads `efbbbf7b…0a`.
    */
      const payload = Buffer.from(
        'efbbbf7b22746f6f6c223a22636166c3a920e2809420f09f94a5227d0a',
        'hex',
      );

      const fired = fire(['hooks', 'fire', 'github-copilot', '--phase', 'pre'], payload);

      expect(fired.status).toBe(0);
      const argv = broken.childArgv();
      expect(argv, 'the fake CLI never ran — this row proves NOTHING').not.toBeNull();
      expect(argv).toContain('--hook-input-file');
      expect(broken.childPayloadHex()).toBe(payload.toString('hex'));
    },
  );

  it(
    powershellProvenLabel('RECORDS the boot failure it swallowed, and leaves no spill behind'),
    () => {
      /*
    Test Doc:
    - Why: MEASURED — after a swallowed boot failure the fenced state dir held the
      interpreter cache and NOTHING ELSE. No stderr (discarded), no `fires.jsonl` (the
      process that writes it is the one that died). `hooks status` then renders a CLI
      dead on every fire as "never fired", WHICH IS ALSO WHAT A HEALTHY IDLE REPO LOOKS
      LIKE — a signal indistinguishable from health, which is worse than no signal and
      is the exact defect class this wrapper was written to end.
    - Contract: a swallowed fire failure appends a `cli-failed` line carrying the exit
      code, the agent slug, and THE INTERPRETER THAT RAN, AND the stdin spill file is
      still deleted on the always-exit-0 path.
    - Usage Notes: the kind is the second tab-separated field; the pre-node
      `no-interpreter` lines keep the same shape. The spill assertion reads the path out
      of the child's own argv, so it checks the actual file the wrapper created rather
      than a reconstruction of it.
    - Quality Contribution: catches a future simplification that keeps the swallow and
      drops the record, and catches a fire path that exits before its `finally` can
      clean up the temp — the hook must leave no trace. The exact match on field 4
      catches a revert to logging `$env:PATH`, MEASURED at ~500 characters per line on
      a real 5.1 host and disclosing environment detail on a log that grows twice per
      tool call.
    - Worked Example: fire against the broken CLI → `…\tcli-failed\texit=23
      agent=github-copilot\tC:\\Program Files\\nodejs\\node.exe`, and the named spill
      path no longer exists.
    */
      const fired = fire(['hooks', 'fire', 'github-copilot', '--phase', 'pre']);
      expect(fired.status).toBe(0);

      const fields = readFileSync(broken.failureLog, 'utf8').trim().split('\n')[0].split('\t');
      expect(fields[1]).toBe('cli-failed');
      expect(fields[2]).toContain(`exit=${FAKE_EXIT_CODE}`);
      expect(fields[2]).toContain('agent=github-copilot');
      expect(fields[3]).toBe(broken.resolvedInterpreter());

      const argv = broken.childArgv() ?? [];
      const spill = argv[argv.indexOf('--hook-input-file') + 1];
      expect(spill, 'no spill path was passed').toBeTruthy();
      expect(() => readFileSync(spill), 'the fire path leaked its stdin spill').toThrow();
    },
  );
});

/**
 * SAY WHAT STOPPED BEING COVERED, AT THE GATE — not in a changelog.
 *
 * This row runs everywhere and is the reason this file cannot go quietly dark. If no
 * host PowerShell can execute a `.ps1`, the describe above skips wholesale and a
 * reader scanning a green run has no way to learn that the dialect carrying the entire
 * Windows blast radius was never exercised.
 */
describe('the PowerShell execution gate declares itself', () => {
  it('reports which interpreter proved the .ps1 rows, or that none did', () => {
    /*
    Test Doc:
    - Why: `posix-shell.ts` was written because a boundary stated in prose is not a
      boundary. The same applies to its PowerShell sibling: a file that skips silently
      teaches the next author the platform is out of scope, which is how #174 stayed
      open across three plans.
    - Contract: the probe resolves to a definite answer — an interpreter name, or null —
      and never throws during collection.
    - Usage Notes: read the row NAMES above to see which runtime answered. Only
      `powershell.exe` (Windows PowerShell 5.1) is the runtime the emitted hook command
      actually names; anything else narrows #174 without closing it.
    - Quality Contribution: catches a probe that starts throwing at module scope, which
      would take this whole file down during COLLECTION — reported as absence rather
      than as failure.
    - Worked Example: on macOS with pwsh 7 → POWERSHELL true, POWERSHELL_BIN 'pwsh'.
    */
    expect(POWERSHELL).toBe(POWERSHELL_BIN !== null);
    if (!POWERSHELL) {
      console.warn(
        'SKIPPED — no host PowerShell can execute a .ps1 file, so harness-hook.ps1 was NOT exercised here. #174 remains open on this host.',
      );
    }
  });
});
