import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { CollectorFsPort, HostTarget } from './types.js';

/**
 * The MACHINE-level record of a failed automatic install (plan 077).
 *
 * WHY THIS IS NOT THE REPO-LOCAL STATE FILE. `.harness/temp/gitai-collector.json`
 * records what happened IN A REPO, and its job is to let doctor's health row be
 * a pure filesystem read. The fact recorded here is about the MACHINE — git-ai
 * is absent and the download failed — and a machine fact stored per-repo is
 * neither pure nor true: a developer with ten repos would get ten failed
 * downloads for one broken network, and each repo would believe it had learned
 * something about itself.
 *
 * THE POLICY IS DELIBERATELY SIMPLE, and there is no timer in it. On failure:
 * record it, STOP RETRYING, and report the failure with the manual
 * instructions. `harness doctor --install-collector` IS the retry — which is
 * why that flag keeps its job now that installing is automatic. No cooldown, no
 * retry-after, nothing to tune and nothing to get wrong at 3am.
 *
 * WHAT IT MUST NEVER DO. This record says an ATTEMPT failed. It says nothing
 * about hook coverage, and it must never be read as though it did: a blocked or
 * failed attempt that overwrote coverage state once made doctor announce that no
 * attribution was being collected while the hooks were live and collecting.
 * Coverage is a fact about the machine and survives a failed attempt intact.
 *
 * PLATFORM. The path is composed from `host.home` — which the composition root
 * resolves as `$HOME || %USERPROFILE% || os.homedir()` — and joined with `/`,
 * the repo's logical-POSIX convention, which Node accepts on win32. Same shape
 * as `backup.ts`, on purpose.
 */

export interface AutoInstallBlock {
  /** ISO timestamp of the failure that stopped the automatic retries. */
  at: string;
  /** Why it failed, in the words the operator saw. */
  detail: string;
  /** The pinned version we were trying to place. */
  version: string;
}

/** `<home>/.git-ai/harness-autoinstall.json` — one file, machine-wide. */
export function autoInstallBlockPath(home: string): string {
  return `${home.replace(/\/+$/, '')}/.git-ai/harness-autoinstall.json`;
}

/**
 * Read the stop-retrying record. Any unreadable or malformed file reads as
 * ABSENT — a corrupt note must not be able to permanently disable installs, and
 * re-attempting is the safe direction here because the attempt itself is
 * warn-only.
 */
export function readAutoInstallBlock(
  fs: CollectorFsPort,
  host: HostTarget,
): AutoInstallBlock | null {
  const path = autoInstallBlockPath(host.home);
  try {
    if (!fs.exists(path)) return null;
    const raw = fs.readText(path);
    if (raw === null || raw.trim() === '') return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Partial<AutoInstallBlock>;
    if (typeof record.at !== 'string' || typeof record.detail !== 'string') return null;
    return { at: record.at, detail: record.detail, version: record.version ?? 'unknown' };
  } catch {
    return null;
  }
}

/** Record the failure that stops automatic retries. Never throws. */
export function writeAutoInstallBlock(
  fs: CollectorFsPort,
  host: HostTarget,
  clock: Clock,
  detail: string,
  version: string,
): void {
  const path = autoInstallBlockPath(host.home);
  try {
    fs.mkdirp(path.replace(/\/[^/]*$/, ''));
    fs.writeText(path, `${JSON.stringify({ at: clock.nowIso(), detail, version }, null, 2)}\n`);
  } catch {
    // A record we could not write means we will retry next run. That is a worse
    // outcome than remembering, and a better one than failing the doctor run
    // that was only ever trying to be helpful.
  }
}

/** Clear the record — an explicit `--install-collector` is the retry. */
export function clearAutoInstallBlock(fs: CollectorFsPort, host: HostTarget): void {
  try {
    const path = autoInstallBlockPath(host.home);
    if (fs.exists(path)) fs.deleteFile(path);
  } catch {
    // Best-effort: a stale block only costs an automatic attempt, and the
    // explicit flag the operator just used does not consult it anyway.
  }
}
