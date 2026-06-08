import { join } from 'node:path';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { RESERVED_NAMES } from '../extensions/registry.js';
import { renderStarter, type ScaffoldVariant } from './templates.js';

/**
 * Scaffold a new extension file for `harness new` (plan 006). Pure harness logic
 * behind injected ports: validates the verb name, roots the target the SAME way
 * discovery does (`join(proc.cwd(), '.harness', 'extensions', …)` — Finding 07),
 * picks a starter template, and writes it via `FsPort`. Never imports `node:fs`
 * or `process.cwd()` (Constitution P2), so it is unit-testable with fakes.
 */

const EXTENSIONS_DIR = ['.harness', 'extensions'] as const;
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface ScaffoldOptions {
  name: string;
  wrap?: string;
  js?: boolean;
  force?: boolean;
}

export type ScaffoldOutcome =
  | { ok: true; path: string; verb: string; variant: ScaffoldVariant }
  | { ok: false; code: string; message: string; next_action: string };

export function scaffoldExtension(
  opts: ScaffoldOptions,
  deps: { fs: FsPort; proc: ProcessPort },
): ScaffoldOutcome {
  const { name, wrap, js = false, force = false } = opts;
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
      next_action: 'Choose a different verb name (reserved: help, doctor, new).',
    };
  }

  const { contents, variant, ext } = renderStarter({ name, js, wrap });
  const fileName = `${name}.${ext}`;
  const relPath = join(...EXTENSIONS_DIR, fileName);
  const dirAbs = join(proc.cwd(), ...EXTENSIONS_DIR);
  const fileAbs = join(dirAbs, fileName);

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
  } catch (err) {
    return {
      ok: false,
      code: ErrorCodes.SCAFFOLD_WRITE_FAILED,
      message: `Could not write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      next_action: 'Check directory permissions and retry.',
    };
  }

  return { ok: true, path: relPath, verb: name, variant };
}
