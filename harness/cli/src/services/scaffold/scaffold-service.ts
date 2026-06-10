import { join } from 'node:path';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { RESERVED_NAMES } from '../extensions/registry.js';
import { renderStarter, type ScaffoldVariant, starterInstructions } from './templates.js';

/**
 * Scaffold a new extension PACKAGE for `harness new` (plan 006; folder form
 * since plan 014 AC-8): `<name>/extension.<ext>` + a starter `instructions.md`
 * beside it. Pure harness logic behind injected ports: validates the verb name,
 * roots the target the SAME way discovery does
 * (`join(proc.cwd(), '.harness', 'extensions', …)` — Finding 07), picks a
 * starter template, and writes via `FsPort`. Never imports `node:fs` or
 * `process.cwd()` (Constitution P2), so it is unit-testable with fakes.
 */

const EXTENSIONS_DIR = ['.harness', 'extensions'] as const;
// Hyphen-separated alphanumeric segments — no trailing/doubled hyphens, since
// the name is now also a directory name (companion F002).
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// A --wrap value is embedded verbatim into the generated file. v1 supports a
// simple `cmd arg arg` line only; reject anything that could break the emitted
// JS (quotes, backticks, `$`, backslash, shell operators) rather than write
// invalid code (F002). Quoting/operators are a documented v1 non-goal.
const SAFE_WRAP_PATTERN = /^[\w\-./:= ]+$/;

export interface ScaffoldOptions {
  name: string;
  wrap?: string;
  js?: boolean;
  force?: boolean;
  /** Scaffold a record-type extension (`kind:'record'`) instead of a verb. */
  record?: boolean;
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
  const { name, wrap, js = false, force = false, record = false } = opts;
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
      message: `'${name}' is a reserved core command and cannot be an extension verb.`,
      next_action: `Choose a different verb name (reserved: ${[...RESERVED_NAMES].join(', ')}).`,
    };
  }

  if (
    !record &&
    wrap !== undefined &&
    (wrap.trim().length === 0 || !SAFE_WRAP_PATTERN.test(wrap))
  ) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_ARGS,
      message: `Unsupported --wrap command: ${JSON.stringify(wrap)}`,
      next_action:
        'Use a simple "cmd arg arg" form (letters, digits, - _ . / : =). For quotes/operators, scaffold without --wrap and edit the generated run() by hand.',
    };
  }

  const { contents, variant, ext } = renderStarter({ name, js, wrap, record });
  // Folder form (plan 014 AC-8): every variant lands at <name>/extension.<ext>
  // (the `.record.ts` filename convention is retired — routing is by `kind`).
  const fileName = `extension.${ext}`;
  const relPath = join(...EXTENSIONS_DIR, name, fileName);
  const relInstructions = join(...EXTENSIONS_DIR, name, 'instructions.md');
  const dirAbs = join(proc.cwd(), ...EXTENSIONS_DIR, name);
  const fileAbs = join(dirAbs, fileName);
  const instructionsAbs = join(dirAbs, 'instructions.md');

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
      fs.writeText(instructionsAbs, starterInstructions(name));
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
