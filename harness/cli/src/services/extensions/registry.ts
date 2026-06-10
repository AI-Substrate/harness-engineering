import type { ModuleLoaderPort } from '../../adapters/loader/module-loader-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { verbShapeIssues } from '../config/load-config.js';
import type { HarnessRecordType } from '../record/contract.js';
import { type ExtensionRecordType, recordTypeShapeIssues } from '../record/registry.js';
import type { ExtensionRecord, HarnessVerb } from './contract.js';

/** The assembled verb surface + the per-extension provenance `doctor` enumerates. */
export interface VerbRegistry {
  /** Verbs accepted into the command surface (deduped, core names excluded). */
  verbs: HarnessVerb[];
  /** One record per discovered extension file: loaded / failed / conflict. */
  records: ExtensionRecord[];
}

/** The full extension surface from ONE discovery pass: verbs + record types + provenance. */
export interface ExtensionRegistry {
  /** Verbs accepted into the command surface (deduped, reserved/claimed excluded). */
  verbs: HarnessVerb[];
  /** Record types accepted from extensions, paired with their discovery path (de-conflicted). */
  recordTypes: ExtensionRecordType[];
  /** One record per discovered extension file: loaded / failed / conflict. */
  records: ExtensionRecord[];
}

/** Options for the single-pass loader: which verb names + record-type names are reserved. */
export interface ExtensionRegistryOptions {
  /** Verb names an extension may NOT claim (core commands). Defaults to {@link RESERVED_NAMES}. */
  reservedVerbs?: ReadonlySet<string>;
  /** Record-type names an extension may NOT claim (core types). Defaults to empty. */
  reservedRecordTypes?: ReadonlySet<string>;
  /**
   * Entries discovery refused (e.g. unsupported flat layout). Each becomes a
   * synthesized `failed` record (E143) with NO load attempt, so doctor surfaces
   * it through the existing record rendering (plan 014 D1).
   */
  rejected?: readonly { path: string; reason: string }[];
}

/**
 * Core command names an extension may NOT shadow. `help`/`doctor`/`new`/`docs`/
 * `skills`/`record` are all reserved core commands.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'help',
  'doctor',
  'new',
  'docs',
  'skills',
  'record',
]);

/**
 * Build the full extension registry from discovered candidate paths in ONE load
 * pass (already sorted by discovery, so "first wins" is deterministic). Each file
 * is loaded in isolation: a load throw or malformed default export becomes a
 * `failed` record (`E140`) and never breaks the others. Each declared export is
 * routed by its `kind`:
 *   - `kind:'record'` → a {@link HarnessRecordType} candidate for the record registry;
 *   - absent/`'verb'`  → a {@link HarnessVerb} candidate for the command surface.
 * A verb name claimed by a reserved core command / earlier extension, or a record
 * type claimed by a reserved core type / earlier extension, is a `conflict`
 * (`E142`); ALL shadowed duplicates are recorded (verb shadows in `shadows`,
 * record-type shadows in `recordShadows`) and none of them are registered.
 */
export async function buildExtensionRegistry(
  candidates: string[],
  loader: ModuleLoaderPort,
  options: ExtensionRegistryOptions = {},
): Promise<ExtensionRegistry> {
  const reservedVerbs = options.reservedVerbs ?? RESERVED_NAMES;
  const reservedRecordTypes = options.reservedRecordTypes ?? new Set<string>();
  const records: ExtensionRecord[] = (options.rejected ?? []).map((entry) =>
    failed(entry.path, entry.reason, ErrorCodes.EXTENSION_FLAT_LAYOUT),
  );
  const verbs: HarnessVerb[] = [];
  const recordTypes: ExtensionRecordType[] = [];
  const claimedVerbs = new Set<string>();
  const claimedRecordTypes = new Set<string>();

  for (const entryPath of candidates) {
    let mod: unknown;
    try {
      mod = await loader.load(entryPath);
    } catch (err) {
      records.push(failed(entryPath, errorMessage(err)));
      continue;
    }

    const declared = coerceExports(mod);
    if (declared === null) {
      records.push(
        failed(
          entryPath,
          'default export is not a HarnessVerb/HarnessRecordType (or array of them)',
        ),
      );
      continue;
    }

    // Route each declared export by `kind`.
    const verbDecls: HarnessVerb[] = [];
    const recordDecls: HarnessRecordType[] = [];
    for (const entry of declared) {
      if (isRecordKind(entry)) {
        recordDecls.push(entry);
      } else {
        verbDecls.push(entry as HarnessVerb);
      }
    }

    // File-level shape validation (one bad export fails the whole file, like verbs always did).
    const shapeProblems = [
      ...verbDecls.flatMap(verbShapeIssues),
      ...recordDecls.flatMap(recordTypeShapeIssues),
    ];
    if (shapeProblems.length > 0) {
      records.push(failed(entryPath, shapeProblems.join('; ')));
      continue;
    }

    // Acceptance + conflict collection (reserved/claimed → shadowed, never registered).
    const acceptedVerbs: HarnessVerb[] = [];
    const acceptedRecords: HarnessRecordType[] = [];
    const verbShadows: string[] = [];
    const recordShadows: string[] = [];

    for (const verb of verbDecls) {
      if (reservedVerbs.has(verb.name) || claimedVerbs.has(verb.name)) {
        verbShadows.push(verb.name);
        continue;
      }
      claimedVerbs.add(verb.name);
      acceptedVerbs.push(verb);
      verbs.push(verb);
    }

    for (const rt of recordDecls) {
      if (reservedRecordTypes.has(rt.type) || claimedRecordTypes.has(rt.type)) {
        recordShadows.push(rt.type);
        continue;
      }
      claimedRecordTypes.add(rt.type);
      acceptedRecords.push(rt);
      recordTypes.push({ recordType: rt, entryPath });
    }

    const hasShadow = verbShadows.length > 0 || recordShadows.length > 0;
    records.push(
      hasShadow
        ? {
            entryPath,
            status: 'conflict',
            verbs: acceptedVerbs,
            ...(acceptedRecords.length > 0 && { recordTypes: acceptedRecords }),
            ...(verbShadows.length > 0 && { shadows: verbShadows }),
            ...(recordShadows.length > 0 && { recordShadows }),
            error: conflictError(verbShadows, recordShadows),
          }
        : {
            entryPath,
            status: 'loaded',
            verbs: acceptedVerbs,
            ...(acceptedRecords.length > 0 && { recordTypes: acceptedRecords }),
          },
    );
  }

  return { verbs, recordTypes, records };
}

/**
 * Verb-only projection of {@link buildExtensionRegistry} — the historical surface
 * many call sites + tests use. Record-kinded exports (if any) are routed away and
 * never registered as verbs; the per-file provenance is preserved.
 */
export async function buildVerbRegistry(
  candidates: string[],
  loader: ModuleLoaderPort,
  reserved: ReadonlySet<string> = RESERVED_NAMES,
): Promise<VerbRegistry> {
  const registry = await buildExtensionRegistry(candidates, loader, { reservedVerbs: reserved });
  return { verbs: registry.verbs, records: registry.records };
}

/** True when a declared export is a record type (`kind:'record'`). */
function isRecordKind(entry: object): entry is HarnessRecordType {
  return (entry as { kind?: unknown }).kind === 'record';
}

/** Normalise a default export to a list of declared exports, or null if it can't be one. */
function coerceExports(mod: unknown): object[] | null {
  const list = Array.isArray(mod) ? mod : [mod];
  if (list.length === 0) {
    return null;
  }
  if (list.some((entry) => entry === null || typeof entry !== 'object')) {
    return null;
  }
  return list as object[];
}

function conflictError(verbShadows: string[], recordShadows: string[]): string {
  const parts: string[] = [];
  if (verbShadows.length > 0) {
    parts.push(`verb(s) '${verbShadows.join("', '")}'`);
  }
  if (recordShadows.length > 0) {
    parts.push(`record type(s) '${recordShadows.join("', '")}'`);
  }
  return `${ErrorCodes.EXTENSION_VERB_CONFLICT}: ${parts.join(' and ')} already provided (core command/type or earlier extension); duplicate(s) ignored.`;
}

function failed(
  entryPath: string,
  reason: string,
  code: string = ErrorCodes.EXTENSION_LOAD_FAILED,
): ExtensionRecord {
  return {
    entryPath,
    status: 'failed',
    verbs: [],
    error: `${code}: ${reason}`,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
