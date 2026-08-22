import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * CAN THIS HOST EXECUTE A `.ps1` FILE? — the PowerShell sibling of
 * {@link ./posix-shell.ts} (plan 089 · closes the executable half of #174).
 *
 * ## Why this exists
 *
 * `harness-hook.ps1` had **no execution coverage anywhere**. Its only reference in
 * the whole test tree was a `readFileSync` text grep for `$input`. That was tolerable
 * while the file was reachable by one agent through one optional field; it stopped
 * being tolerable at `9d3ea8e4` (#177), when the Windows `command` for **all five
 * agents** became `powershell.exe -NoProfile -File harness-hook.ps1`. The dialect
 * with no executable coverage became the dialect carrying the entire Windows blast
 * radius.
 *
 * #180 is what made that concrete: a wrapper that leaks a failed CLI's non-zero exit
 * is read by every agent as a DENIED TOOL CALL, and the existing exit-code contract
 * rows are gated on {@link ./posix-shell.ts} — so they assert on POSIX only. **An
 * exit-code defect had no test that could see it in the dialect where it hurt most.**
 *
 * ## PRESENCE IS NOT CAPABILITY — why this probe EXECUTES
 *
 * `external-binary.ts` paid for this rule and it applies here with force. A
 * `pwsh --version` that succeeds proves the binary exists; it does **not** prove this
 * host will run a `.ps1` **file**, which is a different question with a different
 * answer on Windows, where execution policy blocks files while `-Command` keeps
 * working. Since the hook config invokes `-File`, that is what this probe invokes:
 * a real script, on disk, run the way the agent runs it, asserting a distinctive exit
 * code so that "it ran" and "it propagated the exit code" are both established rather
 * than assumed.
 *
 * ## NO `-ExecutionPolicy Bypass`, DELIBERATELY
 *
 * It would make this probe pass more often and mean less. Execution policy is part of
 * the capability being measured, so masking it would report a host as capable that
 * cannot in fact run the shipped wrapper. Note for anyone reading a result from a VM:
 * a launcher that passes `-ExecutionPolicy Bypass` **leaks into child processes** via
 * `PSExecutionPolicyPreference`, so a green measured under such a launcher is not
 * evidence about policy. Clear that variable and assert the child's effective policy
 * before trusting one.
 *
 * ## WHICH PowerShell answered — never collapse 5.1 and 7
 *
 * {@link POWERSHELL_BIN} names the interpreter that passed, and consumers are expected
 * to put it in the row name. Every hard-won constraint in `harness-hook.ps1` was
 * measured on **Windows PowerShell 5.1** — the `$input` parse-time stdin drain, the
 * UTF-16LE/ASCII pipeline re-encode, the two-argument `File.Move` overload. `pwsh 7`
 * on macOS shares the dialect but not the runtime, so a green there **narrows** #174,
 * it does not close it. A run that cannot say which binary it used cannot tell those
 * two greens apart.
 *
 * On Windows the candidate order puts `powershell.exe` first on purpose: 5.1 is what
 * the emitted hook command actually names, so it is the runtime whose answer counts.
 */

const CANDIDATES =
  process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh', 'powershell'];

/**
 * Probe ONCE, at module load — the answer cannot change mid-run, and each attempt
 * costs a process spawn in a suite already under spawn-count scrutiny (#109).
 *
 * NOTHING HERE MAY THROW. `external-binary.ts` records a probe that threw at module
 * scope and took an entire file down during COLLECTION — seven cases neither passed
 * nor failed but UNRUN, which reads as absence rather than as failure. So every step
 * is wrapped, and the teardown tolerates refusal: a host that cannot run the script
 * may equally fail to let go of the temp dir it was written into.
 */
const probe = (): { bin: string | null } => {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'harness-pwsh-probe-'));
    const script = join(dir, 'probe.ps1');
    // Exit 23, not 0: a policy-blocked or non-existent script also "completes", and
    // only a distinctive code separates "the file ran" from "something returned".
    writeFileSync(script, 'exit 23\n', 'ascii');

    for (const bin of CANDIDATES) {
      try {
        const result = spawnSync(bin, ['-NoProfile', '-File', script], { stdio: 'ignore' });
        if (result.error === undefined && result.status === 23) return { bin };
      } catch {
        // Try the next candidate; an unusable one is not an error here.
      }
    }
    return { bin: null };
  } catch {
    return { bin: null };
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A host that refused to run the script may refuse this too. Not our failure.
      }
    }
  }
};

const { bin } = probe();

/**
 * The interpreter that PROVED it can execute a `.ps1` file on this host, or `null`.
 *
 * Put this in row names. `powershell.exe` means Windows PowerShell 5.1 — the runtime
 * the shipped hook command actually names, and the one every constraint in
 * `harness-hook.ps1` was measured against. Anything else means the dialect was
 * exercised on a different runtime.
 */
export const POWERSHELL_BIN: string | null = bin;

/** Can this host execute a `.ps1` FILE (not merely start a PowerShell)? */
export const POWERSHELL: boolean = bin !== null;

/**
 * Name a row for the property it ACTUALLY proved on this host.
 *
 * Mirrors `provenLabel` in {@link ./symlink-capability.ts} and `shellProvenLabel` in
 * {@link ./posix-shell.ts}. Two greens that prove different things must not look
 * identical in a reporter, and here the difference is load-bearing: 5.1 is the
 * runtime under test, and everything else is an approximation of it.
 */
export const powershellProvenLabel = (name: string): string =>
  POWERSHELL_BIN === null
    ? `${name} [SKIPPED — no host PowerShell can execute a .ps1 file; #174 stays open here]`
    : POWERSHELL_BIN === 'powershell.exe'
      ? `${name} [FULL PROPERTY — Windows PowerShell 5.1, the runtime the hook command names]`
      : `${name} [PARTIAL — ${POWERSHELL_BIN}, not Windows PowerShell 5.1; narrows #174, does not close it]`;
