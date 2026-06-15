import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR } from '../shared/temp.js';
import { buildGovernanceSkeleton } from './governance-template.js';

/** The governance doc's fixed filename inside `.harness/` (singleton — no date, no slug). */
export const GOVERNANCE_DOC = 'engineering-harness.md';

/**
 * Ports the init service needs: `fs` for the side-effects, `proc` to resolve the
 * repo root. No Clock — the skeleton is static and the path is fixed.
 */
export interface InitDeps {
  fs: FsPort;
  proc: ProcessPort;
}

/**
 * Outcome of seeding the governance doc. `created` distinguishes a fresh stamp
 * (`true`) from an idempotent no-op on an existing doc (`false`); the act maps
 * this onto the Envelope + exit code (ok → 0, error → 1).
 */
export type InitOutcome =
  | { ok: true; path: string; created: boolean }
  | { ok: false; code: string; message: string; next_action: string };

/**
 * Seed `.harness/engineering-harness.md` with the governance-doc skeleton — the
 * Inception write-condition (governance-doc.md G5). This is the INCEPTION writer,
 * so it bootstraps `.harness/` itself (unlike `record`, which returns
 * `unconfigured` when `.harness/` is absent). Idempotent + NEVER-CLOBBER: the
 * exists-check runs FIRST, and an existing doc is left byte-identical and
 * reported `created:false` (it holds the real maturity + injection map by then).
 * Side-effects go through the injected `fs` port; the pure skeleton comes from
 * the builder (Constitution P2 — no `node:fs` in services).
 */
export function initGovernance(deps: InitDeps): InitOutcome {
  const { fs, proc } = deps;
  // Logical paths are POSIX on every OS (plan 017) — convert once at the boundary.
  const cwd = toPosix(proc.cwd());
  const harnessDir = posixJoin(cwd, HARNESS_DIR);
  const fileAbs = posixJoin(harnessDir, GOVERNANCE_DOC);
  const relPath = posixJoin(HARNESS_DIR, GOVERNANCE_DOC);

  // Never clobber: exists-check FIRST — skip mkdirp+write entirely on a hit.
  if (fs.exists(fileAbs)) {
    return { ok: true, path: relPath, created: false };
  }

  // Absent → bootstrap `.harness/` then stamp the skeleton, both under ONE guard
  // so a permissions failure surfaces as E190 (not a generic E100).
  try {
    fs.mkdirp(harnessDir);
    fs.writeText(fileAbs, buildGovernanceSkeleton());
  } catch (err) {
    return {
      ok: false,
      code: ErrorCodes.INIT_WRITE_FAILED,
      message: `Could not write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      next_action: `Could not write \`${relPath}\` (permissions?). Check the repo root is writable.`,
    };
  }

  return { ok: true, path: relPath, created: true };
}
