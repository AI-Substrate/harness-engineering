import { spawnSync } from 'node:child_process';

/**
 * Probe for an external binary a test genuinely NEEDS — and say so out loud when
 * it is missing (plan 077 · #108 class 3).
 *
 * ## Why this exists at all
 *
 * Most external-binary uses in this suite are MECHANISM: the test wants a file
 * copied, a mode bit set, a line counted. Those were removed outright, because a
 * guard that skips is still coverage we do not have.
 *
 * A few are SUBJECT: the binary is the thing the test asserts about, so no
 * reimplementation is correct at any level of output fidelity — rewriting them
 * would keep the test green while destroying what it proves. Those get this.
 *
 * ## Why the skip is LOUD
 *
 * An absent-binary skip that prints nothing is a control that passes by
 * examining nothing. On a machine without the binary the suite would go green
 * having asserted less than it claims, and nobody would know which claim lapsed.
 * So every skip here names the binary, the reason it cannot be substituted, and
 * what stopped being checked.
 *
 * ## PRESENCE IS NOT CAPABILITY — the rule this file paid for, kept after its
 * subject was deleted
 *
 * This module used to carry a shell-capability prober (`probeShell`,
 * `canRunShellScript`, `POST_COMMIT_HOOK_CONTRACT`) whose only subject was the
 * tracked `.githooks/post-commit`. That hook was removed when harness-side
 * capture went default-off, so the machinery went with it. The LESSON does not
 * go with it, because the next person adding a binary guard will hit it again:
 *
 * ```
 * $ (Get-Command bash).Source
 * C:\Windows\system32\bash.exe          # WSL bash, not git-bash
 * $ bash C:\Users\...\Temp\hook\post-commit
 * /bin/bash: C:Users...Temphookpost-commit: No such file or directory   # exit 127
 * ```
 *
 * `bash --version` succeeds there, so a presence probe returned true, the guard
 * let the suite proceed, and the cases failed anyway with exit 127. **That is
 * WORSE than having no guard at all**: the declaration made the gap look handled,
 * so the red was read as noise instead of as an unmeasured claim.
 *
 * A second rung, from the same file: CAPABILITY is not DISPOSABILITY. A probe can
 * determine that a shell is unusable and still be unable to clean up after
 * finding out — and because that prober ran at MODULE SCOPE, its throw landed
 * during COLLECTION and took a whole file with it (`Tests: no tests` — seven
 * cases neither passed nor failed but UNRUN).
 *
 * Both rungs are one lesson: **what you proved is not what you assumed you
 * proved.** {@link hasBinary} below answers PRESENCE only. If you are guarding
 * something whose usefulness depends on how it interprets its ARGUMENTS — above
 * all a shell being handed a path — presence is the wrong question, and a probe
 * that EXECUTES the mechanism is the right one. Write that probe at call scope,
 * not module scope, and make its teardown tolerate refusal.
 *
 * ## The cache is per-process, deliberately
 *
 * A binary does not appear mid-run, and probing once per call would add spawns
 * to a suite whose process count is already under scrutiny (#109).
 */
const cache = new Map<string, boolean>();

/**
 * Is `binary` present and executable on this host? Probed once per process.
 *
 * PRESENCE only. Correct for a binary whose contract is fully expressed by "it
 * ran" — `jq` reads stdin and writes stdout, and a `jq` that starts is a `jq`
 * that filters. For anything whose usefulness depends on how it interprets its
 * ARGUMENTS, read the "PRESENCE IS NOT CAPABILITY" note above first.
 */
export function hasBinary(binary: string): boolean {
  const cached = cache.get(binary);
  if (cached !== undefined) return cached;
  let present: boolean;
  try {
    // `--version` is the cheapest near-universal "are you there" for the
    // binaries this suite needs. We care ONLY that it executed — a non-zero
    // exit still proves presence; ENOENT (status null + error) proves absence.
    const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
    present = probe.error === undefined;
  } catch {
    present = false;
  }
  cache.set(binary, present);
  return present;
}

/**
 * The reason string for a loud skip. Kept as a function so the wording cannot
 * drift between call sites, and so a reader of the skip output learns what was
 * NOT checked rather than only that something was not run.
 */
export function missingBinaryReason(binary: string, whatIsUnproven: string): string {
  return `SKIPPED — the external binary \`${binary}\` is not on PATH for this host. This case is NOT reimplementable: ${binary} is the SUBJECT of the assertion, not its mechanism, so an in-process substitute would assert something weaker while still passing. What is now unproven on this host: ${whatIsUnproven}`;
}
