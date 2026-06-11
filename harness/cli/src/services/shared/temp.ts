import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from './posix-path.js';

/**
 * Shared transient-storage mechanics for `.harness/temp/` — the gitignored,
 * never-committed scratch class that sits beside the committed
 * `.harness/records/`. Relocated from record-service (plan 015 D1) so the
 * `record` and `observe` services share the guarantee without either importing
 * the other's internals.
 */

export const HARNESS_DIR = '.harness';
export const TEMP_DIR = 'temp';

export const TEMP_GITIGNORE = '# Crash-resilient agent scratch — never committed.\n*\n';

/** The ports the temp guarantee needs (a structural subset of RecordDeps/ObserveDeps). */
export interface TempDeps {
  fs: FsPort;
  proc: ProcessPort;
}

/**
 * Ensure `.harness/temp/` exists and is self-gitignored on first use: the
 * crash-resilient scratch buffer is never committed even in a consumer repo
 * that hasn't added the root `.gitignore` rule. Idempotent — only writes what's
 * missing. Returns the absolute temp dir.
 */
export function ensureTemp(deps: TempDeps): string {
  const tempDir = posixJoin(toPosix(deps.proc.cwd()), HARNESS_DIR, TEMP_DIR);
  if (!deps.fs.exists(tempDir)) {
    deps.fs.mkdirp(tempDir);
  }
  const gitignore = posixJoin(tempDir, '.gitignore');
  if (!deps.fs.exists(gitignore)) {
    deps.fs.writeText(gitignore, TEMP_GITIGNORE);
  }
  return tempDir;
}
