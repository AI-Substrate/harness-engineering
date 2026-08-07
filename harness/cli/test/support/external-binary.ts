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
 * ## The cache is per-process, deliberately
 *
 * A binary does not appear mid-run, and probing once per call would add spawns
 * to a suite whose process count is already under scrutiny (#109).
 */
const cache = new Map<string, boolean>();

/** Is `binary` runnable on this host? Probed once per process, per binary. */
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
