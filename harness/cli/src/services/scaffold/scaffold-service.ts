import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { RESERVED_NAMES } from '../extensions/registry.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import {
  renderStarter,
  type ScaffoldVariant,
  starterInstructions,
  starterSensorInstructions,
} from './templates.js';

/**
 * Scaffold a new extension PACKAGE for `harness new` (plan 006; folder form
 * since plan 014 AC-8): `<name>/extension.<ext>` + a starter `instructions.md`
 * beside it. Pure harness logic behind injected ports: validates the verb name,
 * roots the target the SAME way discovery does
 * (`posixJoin(toPosix(proc.cwd()), '.harness', 'extensions', …)` — Finding 07;
 * logical paths are POSIX on every OS, plan 017), picks a starter template, and
 * writes via `FsPort`. Never imports `node:fs` or `process.cwd()` (Constitution
 * P2), so it is unit-testable with fakes.
 */

const EXTENSIONS_DIR = ['.harness', 'extensions'] as const;
// Hyphen-separated alphanumeric segments — no trailing/doubled hyphens, since
// the name is now also a directory name (companion F002).
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// A --wrap value is embedded verbatim into the generated file. The scaffold
// accepts a simple `cmd arg arg` line only; reject anything that could break the
// emitted source (quotes, backticks, `$`, backslash, shell operators).
const SAFE_WRAP_PATTERN = /^[\w\-./:= ]+$/;

export interface ScaffoldOptions {
  name: string;
  wrap?: string;
  js?: boolean;
  force?: boolean;
  /** Emit one typed command-wrapper sensor instead of a verb. */
  sensor?: boolean;
  /** Real one-level child commands for the top-level verb. */
  sub?: string[];
}

export type ScaffoldOutcome =
  | {
      ok: true;
      /** Relative path of the entry file (`.harness/extensions/<name>/extension.<ext>`). */
      path: string;
      /** Relative path of the starter briefing (`.harness/extensions/<name>/instructions.md`). */
      instructionsPath: string;
      verb: string;
      variant: ScaffoldVariant;
    }
  | { ok: false; code: string; message: string; next_action: string };

export function scaffoldExtension(
  opts: ScaffoldOptions,
  deps: { fs: FsPort; proc: ProcessPort },
): ScaffoldOutcome {
  const { name, wrap, js = false, force = false, sensor = false, sub = [] } = opts;
  const { fs, proc } = deps;

  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      code: ErrorCodes.SCAFFOLD_INVALID_NAME,
      message: `Invalid extension name: ${JSON.stringify(name)}`,
      next_action:
        'Use a lowercase, hyphenated name starting with a letter, e.g. `harness new my-verb`.',
    };
  }

  if (RESERVED_NAMES.has(name)) {
    return {
      ok: false,
      code: ErrorCodes.SCAFFOLD_NAME_RESERVED,
      message: `'${name}' is a reserved core command and cannot be an extension item.`,
      next_action: `Choose a different verb name (reserved: ${[...RESERVED_NAMES].join(', ')}).`,
    };
  }

  if (wrap !== undefined && (wrap.trim().length === 0 || !SAFE_WRAP_PATTERN.test(wrap))) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_ARGS,
      message: `Unsupported --wrap command: ${JSON.stringify(wrap)}`,
      next_action:
        'Use a simple "cmd arg arg" form (letters, digits, - _ . / : =). For quotes/operators, scaffold without --wrap and edit the generated run() by hand.',
    };
  }

  const invalidSub = sub.find((subverb) => !NAME_PATTERN.test(subverb));
  if (invalidSub !== undefined || new Set(sub).size !== sub.length || sub.includes('help')) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_ARGS,
      message:
        invalidSub !== undefined
          ? `Invalid subverb name: ${JSON.stringify(invalidSub)}`
          : sub.includes('help')
            ? "Subverb 'help' is reserved for command help."
            : 'Duplicate subverb names are not allowed.',
      next_action: 'Use unique lowercase, hyphenated subverb names, e.g. `--sub reset,seed`.',
    };
  }

  if (sensor && (sub.length > 0 || wrap !== undefined || js)) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_ARGS,
      message: '`--sensor` cannot be combined with `--sub`, `--wrap`, or `--js`.',
      next_action: 'Choose the sensor scaffold or one verb scaffold form.',
    };
  }
  if (sub.length > 0 && (wrap !== undefined || js)) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_ARGS,
      message: '`--sub` cannot be combined with `--wrap` or `--js`.',
      next_action: 'Choose one scaffold form: --sub, --wrap, or --js.',
    };
  }
  if (js && wrap !== undefined) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_ARGS,
      message: '`--js` cannot be combined with `--wrap`.',
      next_action: 'Choose `--js` for a bare-literal stub or `--wrap` for a TypeScript wrapper.',
    };
  }

  const { contents, variant, ext } = renderStarter({ name, js, sensor, wrap, sub });
  // Folder form (plan 014 AC-8): every variant lands at <name>/extension.<ext>
  // (the `.record.ts` filename convention is retired — routing is by `kind`).
  const fileName = `extension.${ext}`;
  const relPath = posixJoin(...EXTENSIONS_DIR, name, fileName);
  const relInstructions = posixJoin(...EXTENSIONS_DIR, name, 'instructions.md');
  const dirAbs = posixJoin(toPosix(proc.cwd()), ...EXTENSIONS_DIR, name);
  const fileAbs = posixJoin(dirAbs, fileName);
  const instructionsAbs = posixJoin(dirAbs, 'instructions.md');

  if (!force && fs.exists(fileAbs)) {
    return {
      ok: false,
      code: ErrorCodes.SCAFFOLD_FILE_EXISTS,
      message: `An extension already exists at ${relPath}.`,
      next_action: 'Pass --force to overwrite, or choose another name.',
    };
  }

  try {
    fs.mkdirp(dirAbs);
    fs.writeText(fileAbs, contents);
    // Never clobber an authored briefing — --force replaces code, not judgment.
    if (!fs.exists(instructionsAbs)) {
      fs.writeText(
        instructionsAbs,
        sensor ? starterSensorInstructions(name) : starterInstructions(name),
      );
    }
  } catch (err) {
    return {
      ok: false,
      code: ErrorCodes.SCAFFOLD_WRITE_FAILED,
      message: `Could not write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      next_action: 'Check directory permissions and retry.',
    };
  }

  return { ok: true, path: relPath, instructionsPath: relInstructions, verb: name, variant };
}
