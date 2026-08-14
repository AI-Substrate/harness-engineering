import { accessSync, constants } from 'node:fs';

/**
 * CAN THIS HOST RUN A POSIX SHELL SCRIPT? — one probe, one convention (plan 087).
 *
 * ## Why this exists
 *
 * `harness-hook.sh` is POSIX shell. The files that exercise it hand the script to
 * `/bin/sh` directly, which does not exist on Windows: the spawn throws `ENOENT`
 * with `e.status === null`, the catch coerces that to `-1`, and every row asserting
 * `toBe(0)` or `toBe(1)` fails. **Nothing about the wrapper is implicated — the
 * process never starts.** Measured on the Windows VM at `3e4b148a`: 12 rows red
 * across two files, all from this one cause, independently reproduced on a second
 * Windows box.
 *
 * The boundary was already known. `hook-wrapper.int.test.ts` said so in prose at its
 * line 24 — *"WINDOWS IS NOT COVERED HERE AND MUST NOT BE INFERRED FROM HERE"* — and
 * nothing enforced it, so the file went red on every Windows box for as long as it
 * had existed. **A boundary stated in a comment is not a boundary.** This module is
 * that sentence, encoded.
 *
 * ## DEGRADE, DO NOT GO DARK
 *
 * The same rule {@link ../support/symlink-capability.ts} settles for symlinks, and it
 * matters more here, not less. A file that skips wholesale on `win32` teaches the
 * next author that the platform is out of scope — which is precisely the defect this
 * module exists to fix. So a consumer of this flag owes Windows something:
 *
 * 1. **Gate only what genuinely needs the shell** — running the script, reading what
 *    it wrote, asserting its exit codes.
 * 2. **Keep asserting what does NOT need it, on every platform** — that both wrapper
 *    files are present beside each other, that they are ASCII with no BOM, and that a
 *    composed argv names the wrapper as its first token. Those are real properties and
 *    they hold everywhere.
 * 3. **Say what stopped being covered, at the gate**, not in a changelog.
 *
 * ## What is NOT covered here, deliberately, and where it lives instead
 *
 * Two findings came out of the run that produced this module. Both were excluded from
 * plan 087 **by scope ruling, not by being resolved**, and both have issues so that a
 * green here is never mistaken for coverage of them:
 *
 * - **#173** — `hookInvocation` (`acts/hooks.ts`) returns the `.sh` wrapper on EVERY
 *   platform with no `win32` branch, and only `github-copilot` carries a `.ps1` twin,
 *   so six of seven agents get `command` = a bare `harness-hook.sh` path on Windows.
 *   Whether that executes there is **unmeasured**. The rows this module gates are the
 *   only thing in the suite pointing near that question.
 * - **#174** — `harness-hook.ps1` has **no execution coverage anywhere**; its sole
 *   reference in the test tree is a `readFileSync` text grep.
 */

/**
 * Probe ONCE, at module load. Not inferred from `platform()`: the question is not
 * "is this Windows" but "can this host execute a POSIX shell script", and those come
 * apart — a stripped container may lack `/bin/sh`, and a Windows box with a POSIX
 * layer is not the case these rows were written for either way.
 */
export const POSIX_SHELL: boolean = (() => {
  try {
    accessSync('/bin/sh', constants.X_OK);
    return true;
  } catch {
    return false;
  }
})();

/**
 * Name a row for the property it ACTUALLY proved on this host.
 *
 * Mirrors `provenLabel` in {@link ./symlink-capability.ts}. The name reaches the JSON
 * reporter, which is the only place a reader can see that a green on Windows and a
 * green on Linux mean different things. `degraded` must state what was NOT proven.
 */
export const shellProvenLabel = (full: string, degraded: string): string =>
  POSIX_SHELL
    ? `${full} [FULL PROPERTY — POSIX shell available]`
    : `${degraded} [DEGRADED — no POSIX shell on this host; see #173, #174]`;
