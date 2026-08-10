import { spawnSync } from 'node:child_process';
import { HOOK_SELF_TEST_MARKER, type InvocationProbe } from './invocation-probe-port.js';

/**
 * EXECUTE THE CONFIGURED INVOCATION AND LOOK FOR OUR SENTINEL (plan 082, F008).
 *
 * The only adapter in this surface that answers "does it RUN", as opposed to
 * "does it exist" (`fs.exists`) or "do the option names match" (a string
 * comparison). It exists because both of those said healthy on a Windows 11
 * guest where our hook had never executed one line of our code.
 *
 * WHAT IT SPAWNS is the pair read back out of the USER'S CONFIG — not what we
 * would write today, not `harness` off PATH. The finding is precisely that the
 * configured pair was not what we assumed, so a probe that reconstructs its own
 * command answers a question nobody asked.
 *
 * `shell: false`, and the interpreter and script are passed as SEPARATE ARGV
 * ENTRIES rather than concatenated into a command line — no quoting, no
 * escaping, no `windowsVerbatimArguments`, and no shell-injection surface from a
 * path we read off disk (KF-06). This is also why the probe takes the pair
 * rather than the command string.
 *
 * EXIT 0 IS NOT EVIDENCE. Windows Script Host exited 0 after failing to execute
 * our ES module; a probe that trusted the exit code would have reported the
 * field machine healthy. Only the sentinel on stdout produces `runs`.
 */
export const spawnInvocationProbe: InvocationProbe = (interpreter, script) => {
  const [command, args] =
    interpreter === null
      ? [script, ['hooks', 'self-test']]
      : [interpreter, [script, 'hooks', 'self-test']];

  const result = spawnSync(command, args, {
    encoding: 'utf8',
    // A hook that cannot answer in five seconds is not a hook anyone can use;
    // and status must never hang a terminal on a wedged interpreter.
    timeout: 5_000,
    shell: false,
    windowsHide: true,
  });

  if (result.error !== undefined) {
    return { ok: false, evidence: false, detail: `could not execute: ${result.error.message}` };
  }
  const evidence = (result.stdout ?? '').includes(HOOK_SELF_TEST_MARKER);
  const ok = result.status === 0;
  if (evidence) return { ok, evidence: true };
  return {
    ok,
    evidence: false,
    detail: ok
      ? // The measured Windows shape, named so an operator recognises it: the
        // command was dispatched to SOMETHING, which returned success without
        // ever reaching us.
        `exit 0 with no self-test marker — the command ran but our code did not (on Windows a bare .js is dispatched to WScript.exe by file association)`
      : `exit ${result.status ?? 'unknown'} with no self-test marker — our code did not run`,
  };
};
