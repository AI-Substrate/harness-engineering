import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * CAN THIS PROCESS CREATE A SYMLINK? — one probe, one convention (plan 083).
 *
 * ## Why this exists
 *
 * Creating a symlink REQUIRES PRIVILEGE ON WINDOWS. An unelevated process without
 * Developer Mode gets `EPERM`, so any case that stages one in its setup dies before
 * reaching the property it was written to prove. Several files needed this answer
 * and each had grown its own copy of the probe; two copies of a safety rule is one
 * copy and a rumour.
 *
 * ## The convention this module exists to settle: DEGRADE, DO NOT SKIP
 *
 * The tempting answer is `it.skipIf(!canSymlink)`. It is the wrong one, and the
 * argument (originally made in `node-fs.test.ts` for the symlink-swap control) is
 * worth restating because it is what this helper encodes:
 *
 * > A `skipIf` would have bought the same silence in a different coat: green here,
 * > mute there. So the case DETECTS whether it could stage, and reports what it
 * > actually proved — the full property where the swap is real, and the weaker
 * > property that still holds where it is not.
 *
 * Most of these cases guard against **symlink-based exfiltration** (CWE-59). A
 * skipped security guard proves nothing on the platform where it skipped, and that
 * platform is precisely the one nobody runs locally. So the rule is:
 *
 * 1. **Assert the property that matters on EVERY path.** For an exfil guard that is
 *    *the attacker's bytes are absent* — a claim that holds whether or not a
 *    symlink could be planted, because it is about what the product did NOT return.
 * 2. **Stage the symlink when you can**, and assert the full property then.
 * 3. **Name the row for what it proved**, via {@link provenLabel}, so a reader
 *    scanning a run can tell two greens apart. Two greens that prove different
 *    things must not look identical.
 *
 * Skipping is a last resort for a case with NO weaker property at all — and if you
 * reach for it, say so in the row, because a silent skip is the failure this module
 * was written to remove.
 */

/**
 * Probe ONCE, at module load: the answer cannot change during a run, and probing
 * per-row would multiply temp-dir churn across every consumer.
 *
 * Not inferred from `platform()`. The question is not "is this Windows" but "does
 * THIS PROCESS hold symlink privilege", and those differ — an elevated box, or one
 * with Developer Mode on, can stage; an ordinary user account cannot.
 */
export const SYMLINK_CAPABLE: boolean = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-symlink-probe-'));
  try {
    const target = join(dir, 'target');
    writeFileSync(target, 'x', 'utf8');
    symlinkSync(target, join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/**
 * Create a symlink, reporting whether it was staged instead of throwing.
 *
 * SWALLOWED DELIBERATELY. Letting the `EPERM` escape is what made these failures
 * unreadable: the error surfaces from deep inside a setup block and the row appears
 * to fail on the property under test rather than on its own staging.
 *
 * Returns `false` when the link could not be created, so a caller can branch on
 * WHAT ACTUALLY HAPPENED rather than on the module-level probe. Prefer this over
 * reading {@link SYMLINK_CAPABLE} directly at a staging site: the probe answers for
 * a temp dir, and a specific call can still fail for its own reasons (a filesystem
 * that forbids links, a path that already exists).
 */
export function trySymlink(
  target: string,
  path: string,
  type?: 'dir' | 'file' | 'junction',
): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch {
    return false;
  }
}

/**
 * Name a row for the property it ACTUALLY proved on this host.
 *
 * The name reaches the JSON reporter and any CI summary, which is the only place a
 * reader can see that a green on Windows and a green on Linux mean different
 * things. `degraded` should state plainly what was NOT proven — never merely that
 * something was reduced.
 */
export const provenLabel = (full: string, degraded: string): string =>
  SYMLINK_CAPABLE
    ? `${full} [FULL PROPERTY — symlink staged]`
    : `${degraded} [DEGRADED — no symlink privilege on this host]`;
