import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { HARNESS_DIR } from '../shared/temp.js';

/**
 * User-global update-check cache: a tiny record under `~/.harness/` (NOT the
 * repo's `.harness/`) remembering when the registry was last successfully
 * queried and what it returned. Lets the check throttle to once / 24h and lets
 * a known update keep showing through later lookup failures (AC5/AC6/AC9).
 *
 * All I/O is via `FsPort`; the home directory via `EnvPort.home()` — no `node:*`
 * (P2). Reads are total: anything wrong ⇒ null, never a throw.
 */

const CACHE_FILE = 'update-check.json';

export interface UpdateCheckCache {
  /** ISO-8601 instant of the last SUCCESSFUL registry lookup. */
  last_success_iso: string;
  /** Latest version seen at that lookup, or null if the registry returned none. */
  latest: string | null;
}

/** `<home>/.harness`, or null when the home directory can't be resolved. */
function harnessDir(env: EnvPort): string | null {
  const home = env.home();
  return home ? posixJoin(home, HARNESS_DIR) : null;
}

/** Absolute logical path to the cache file, or null if home is unresolved. */
export function cachePath(env: EnvPort): string | null {
  const dir = harnessDir(env);
  return dir ? posixJoin(dir, CACHE_FILE) : null;
}

/**
 * Read + validate the cache. Returns null on any of: home unresolved, file
 * missing/unreadable, non-JSON, or wrong shape — the caller treats null as
 * "no cached info". Never throws.
 */
export function readCache(fs: FsPort, env: EnvPort): UpdateCheckCache | null {
  const path = cachePath(env);
  if (!path) return null;
  const raw = fs.readText(path);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.last_success_iso !== 'string') return null;
    if (obj.latest !== null && typeof obj.latest !== 'string') return null;
    return { last_success_iso: obj.last_success_iso, latest: obj.latest ?? null };
  } catch {
    return null;
  }
}

/**
 * Write the cache under `~/.harness/` (creating the dir). No-op when home is
 * unresolved — best-effort, the check still works off live lookups.
 */
export function writeCache(fs: FsPort, env: EnvPort, cache: UpdateCheckCache): void {
  const dir = harnessDir(env);
  if (!dir) return;
  fs.mkdirp(dir);
  fs.writeText(posixJoin(dir, CACHE_FILE), `${JSON.stringify(cache, null, 2)}\n`);
}
