import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { VersionLookupPort } from '../../adapters/version-lookup/version-lookup-port.js';
import type { UpdateAvailable } from '../../output/envelope.js';
import { readCache, writeCache } from './cache.js';
import { UPDATE_COMMAND } from './constants.js';
import { isNewer } from './semver.js';

/** The throttle window: at most one registry lookup per 24h. */
export const CHECK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Build the `update_available` field iff `latest` is strictly newer than
 * `installed`. The command is pinned to "harness update" (AC7).
 */
export function toUpdateAvailable(
  installed: string,
  latest: string | null,
): UpdateAvailable | null {
  if (!latest) return null;
  return isNewer(latest, installed) ? { installed, latest, command: UPDATE_COMMAND } : null;
}

/**
 * SYNC banner source for the hot path (T007): read the cache and, if its
 * last-known latest is newer than the installed version, return the notice.
 * No network, a single cache read — safe to call on every command exit.
 */
export function bannerFromCache(
  fs: FsPort,
  env: EnvPort,
  installed: string,
): UpdateAvailable | null {
  const cache = readCache(fs, env);
  return toUpdateAvailable(installed, cache?.latest ?? null);
}

/** Whether the cache is stale enough to warrant a fresh lookup. */
export function isDue(
  now: string,
  lastSuccessIso: string,
  windowMs: number = CHECK_WINDOW_MS,
): boolean {
  const nowMs = Date.parse(now);
  const lastMs = Date.parse(lastSuccessIso);
  if (Number.isNaN(nowMs) || Number.isNaN(lastMs)) return true; // unreadable ts ⇒ due
  const delta = nowMs - lastMs;
  if (delta < 0) return false; // clock went backwards ⇒ treat the cache as fresh
  return delta >= windowMs;
}

export interface CheckResult {
  installed: string;
  /** Latest known — a fresh lookup, or last-known cache on skip/failure. */
  latest: string | null;
  update_available: UpdateAvailable | null;
  /** True if a registry lookup actually ran this call. */
  checked: boolean;
  /** True if a lookup ran AND succeeded (cache advanced). */
  refreshed: boolean;
}

export interface CheckDeps {
  fs: FsPort;
  env: EnvPort;
  clock: Clock;
  lookup: VersionLookupPort;
}

/**
 * Throttled update check. Reads the cache; if `force` or the 24h window has
 * elapsed, does exactly ONE registry lookup. A successful lookup (non-null)
 * advances the cache (ts + latest); a failed/empty lookup (null or throw) keeps
 * the cache untouched so a previously-known update survives (AC9). When not due,
 * reports off the last-known cache with no network call (AC5).
 */
export async function runCheck(
  deps: CheckDeps,
  installed: string,
  opts?: { force?: boolean },
): Promise<CheckResult> {
  const { fs, env, clock, lookup } = deps;
  const cache = readCache(fs, env);
  const now = clock.nowIso();
  const due = (opts?.force ?? false) || cache === null || isDue(now, cache.last_success_iso);

  if (!due) {
    const known = cache?.latest ?? null;
    return {
      installed,
      latest: known,
      update_available: toUpdateAvailable(installed, known),
      checked: false,
      refreshed: false,
    };
  }

  let latest: string | null = null;
  try {
    latest = await lookup.latest();
  } catch {
    latest = null;
  }

  if (latest !== null) {
    writeCache(fs, env, { last_success_iso: now, latest });
    return {
      installed,
      latest,
      update_available: toUpdateAvailable(installed, latest),
      checked: true,
      refreshed: true,
    };
  }

  // Lookup failed/empty: keep the cache (don't advance ts); fall back to last-known.
  const known = cache?.latest ?? null;
  return {
    installed,
    latest: known,
    update_available: toUpdateAvailable(installed, known),
    checked: true,
    refreshed: false,
  };
}
