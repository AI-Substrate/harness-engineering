import type { ModuleLoaderPort } from '../../adapters/loader/module-loader-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { verbShapeIssues } from '../config/load-config.js';
import type { ExtensionRecord, HarnessVerb } from './contract.js';

/** The assembled verb surface + the per-extension provenance `doctor` enumerates. */
export interface VerbRegistry {
  /** Verbs accepted into the command surface (deduped, core names excluded). */
  verbs: HarnessVerb[];
  /** One record per discovered extension file: loaded / failed / conflict. */
  records: ExtensionRecord[];
}

/** Core command names an extension may NOT shadow (`help`/`doctor`/`new`/`docs` are core commands). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(['help', 'doctor', 'new', 'docs']);

/**
 * Build the verb registry from discovered candidate paths (already sorted by
 * discovery, so "first wins" is deterministic). Each extension is loaded in
 * isolation: a load throw or malformed default export becomes a `failed` record
 * (`E140`) and never breaks the others (WS-A Decision 5). A verb name already
 * claimed by a core command or an earlier extension is a `conflict` (`E142`); ALL
 * shadowed duplicates from the export are recorded (not just the first), and none
 * are registered. Verb names are an open `string` key — no closed union (AC-7).
 */
export async function buildVerbRegistry(
  candidates: string[],
  loader: ModuleLoaderPort,
  reserved: ReadonlySet<string> = RESERVED_NAMES,
): Promise<VerbRegistry> {
  const records: ExtensionRecord[] = [];
  const verbs: HarnessVerb[] = [];
  const claimed = new Set<string>();

  for (const entryPath of candidates) {
    let mod: unknown;
    try {
      mod = await loader.load(entryPath);
    } catch (err) {
      records.push(failed(entryPath, errorMessage(err)));
      continue;
    }

    const declared = coerceVerbs(mod);
    if (declared === null) {
      records.push(failed(entryPath, 'default export is not a HarnessVerb or HarnessVerb[]'));
      continue;
    }
    const shapeProblems = declared.flatMap(verbShapeIssues);
    if (shapeProblems.length > 0) {
      records.push(failed(entryPath, shapeProblems.join('; ')));
      continue;
    }

    const accepted: HarnessVerb[] = [];
    const shadowed: string[] = [];
    for (const verb of declared) {
      if (reserved.has(verb.name) || claimed.has(verb.name)) {
        shadowed.push(verb.name);
        continue;
      }
      claimed.add(verb.name);
      accepted.push(verb);
      verbs.push(verb);
    }

    records.push(
      shadowed.length === 0
        ? { entryPath, status: 'loaded', verbs: accepted }
        : {
            entryPath,
            status: 'conflict',
            verbs: accepted,
            shadows: shadowed,
            error: `${ErrorCodes.EXTENSION_VERB_CONFLICT}: verb(s) '${shadowed.join("', '")}' already provided (core command or earlier extension); duplicate(s) ignored.`,
          },
    );
  }

  return { verbs, records };
}

/** Normalise a default export to a verb array, or null if it can't be one. */
function coerceVerbs(mod: unknown): HarnessVerb[] | null {
  const list = Array.isArray(mod) ? mod : [mod];
  if (list.length === 0) {
    return null;
  }
  if (list.some((entry) => entry === null || typeof entry !== 'object')) {
    return null;
  }
  return list as HarnessVerb[];
}

function failed(entryPath: string, reason: string): ExtensionRecord {
  return {
    entryPath,
    status: 'failed',
    verbs: [],
    error: `${ErrorCodes.EXTENSION_LOAD_FAILED}: ${reason}`,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
