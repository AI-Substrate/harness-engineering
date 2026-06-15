import type { ExecResult } from '../../adapters/exec/exec-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { PACKAGE_NAME } from './constants.js';

/**
 * Pure helpers for the global install path (`harness update` / `self-install`).
 * Argv construction + failure classification live here (I/O-free, unit-testable);
 * the act owns the announce-then-run + envelope rendering, shelling only through
 * the injected `ExecPort` (the install itself is a `npm i -g` pass-through, P8).
 */

/** npm argv to install the harness globally at `spec` (a dist-tag like `latest`, or a concrete version). */
export function npmInstallArgv(spec: string): string[] {
  return ['i', '-g', `${PACKAGE_NAME}@${spec}`];
}

/** Render an npm argv as the exact command string (for the announce line + next_action). */
export function formatNpmCommand(argv: string[]): string {
  return `npm ${argv.join(' ')}`;
}

/** Normalise a pin like `v0.3.0` → `0.3.0` (npm specs carry no leading `v`). */
export function normalizePin(version: string): string {
  const v = version.trim();
  return v.startsWith('v') || v.startsWith('V') ? v.slice(1) : v;
}

export interface InstallFailure {
  code: string;
  message: string;
  next_action: string;
}

/**
 * Classify a failed `npm i -g` result into an actionable error (AC10). Order is
 * deliberate: npm-absent → auth → (pinned) version-not-found → permission →
 * generic. `command` is echoed into the next_action so the user can re-run.
 */
export function classifyInstallFailure(
  result: ExecResult,
  command: string,
  opts?: { pinned?: string },
): InstallFailure {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();

  if (result.code === 127 || /command not found|not recognized|spawn npm/.test(text)) {
    return {
      code: ErrorCodes.UPDATE_NPM_MISSING,
      message: 'npm was not found on PATH.',
      next_action: `Install Node.js + npm (https://nodejs.org), then re-run: ${command}`,
    };
  }

  // A PINNED version that 404s genuinely doesn't exist — checked BEFORE auth so a
  // pin miss is never mislabeled as an auth problem.
  if (opts?.pinned && /e?404|not found|no matching version|notarget|no such version/.test(text)) {
    return {
      code: ErrorCodes.UPDATE_VERSION_NOT_FOUND,
      message: `version ${opts.pinned} was not found in the registry.`,
      next_action:
        'Pick a published version (`harness update --check` shows the latest), then re-run with `--pin <version>`.',
    };
  }

  // Auth / registry-not-configured. A 401/403 is plainly auth; a NON-pinned 404
  // means the @ai-substrate scope/registry is unconfigured or the token lacks
  // access — both fixed by the same one-time .npmrc + read:packages setup (AC4/AC10).
  {
    const looksAuth =
      /\b(e?401|e?403)\b|unauthorized|forbidden|authentication|auth.*requir|need.*auth/.test(text);
    const looks404 = /e?404|not found|no matching version|notarget|no such version/.test(text);
    if (looksAuth || looks404) {
      return {
        code: ErrorCodes.UPDATE_AUTH_FAILED,
        message: looksAuth
          ? 'registry authentication failed (401/403).'
          : `${PACKAGE_NAME} could not be resolved — the GitHub Packages registry/scope is unconfigured or the token lacks access.`,
        next_action:
          `Configure a GitHub Packages \`.npmrc\` for the @ai-substrate scope with a ` +
          `\`read:packages\` token (see "keeping the harness up to date"), then re-run: ${command}`,
      };
    }
  }

  if (/eacces|eperm|permission denied|access is denied/.test(text)) {
    return {
      code: ErrorCodes.UPDATE_PERMISSION_DENIED,
      message: 'the global npm install was denied (permissions).',
      next_action: `Use a Node version manager (nvm/Volta) or a prefix-writable/elevated npm, then re-run: ${command}`,
    };
  }

  return {
    code: ErrorCodes.UPDATE_FAILED,
    message: `update failed (exit ${result.code}).`,
    next_action: `Inspect the npm output above, then re-run: ${command}`,
  };
}
