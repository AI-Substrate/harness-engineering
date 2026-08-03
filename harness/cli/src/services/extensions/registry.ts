import type { ModuleLoaderPort } from '../../adapters/loader/module-loader-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { verbShapeIssues } from '../config/load-config.js';
import type { HarnessRecordType } from '../record/contract.js';
import { type ExtensionRecordType, recordTypeShapeIssues } from '../record/registry.js';
import type { CustomRegistryItem, ExtensionRecord } from './contract.js';
import { gateExtensionDefinition } from './v2/api-gate.js';
import { type ClassifiedExtensionEntry, classifyExtensionExport } from './v2/classify.js';
import { normalizeV1Extension, normalizeV2Extension } from './v2/normalize.js';
import type {
  NormalizedCustomItem,
  NormalizedExtension,
  NormalizedSensor,
  NormalizedVerb,
} from './v2/types.js';
import { validateV2Extension } from './v2/validate.js';

/** Sensor accepted into the one flat cross-extension runtime registry. */
export interface RegisteredSensor extends NormalizedSensor {
  extension: string;
  entryPath: string;
}

/** Custom item with package provenance, also the public ctx.registry item shape. */
export type RegisteredCustomItem = CustomRegistryItem;

/** The assembled verb surface + the per-extension provenance `doctor` enumerates. */
export interface VerbRegistry {
  /** Current-shape verbs accepted into the command surface (deduped, core names excluded). */
  verbs: NormalizedVerb[];
  /** One record per discovered extension file: loaded / failed / conflict. */
  records: ExtensionRecord[];
  /** Normalized provenance. Optional only so pre-v2 in-memory test registries stay source-compatible. */
  extensions?: NormalizedExtension[];
  /** Registered sensors; optional for pre-Phase-2 in-memory registries. */
  sensors?: RegisteredSensor[];
  /** Registered user-defined items; optional for pre-Phase-2 in-memory registries. */
  customItems?: RegisteredCustomItem[];
}

/** The full extension surface from ONE discovery pass: verbs + item registries + provenance. */
export interface ExtensionRegistry {
  /** Current-shape verbs accepted into the command surface. */
  verbs: NormalizedVerb[];
  /** Record types accepted from extensions, paired with their discovery path (de-conflicted). */
  recordTypes: ExtensionRecordType[];
  /** Sensors accepted into the flat first-wins namespace. */
  sensors: RegisteredSensor[];
  /** All registered custom items, preserving extension provenance. */
  customItems: RegisteredCustomItem[];
  /** One record per discovered extension file: loaded / failed / conflict. */
  records: ExtensionRecord[];
  /** Every successfully normalized entry, with conflicted items removed. */
  extensions: NormalizedExtension[];
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
 * `skills`/`record`/`instructions`/`observe`/`init` are all reserved core
 * commands (`instructions` reserved since plan 014 — the agent-briefing act;
 * `observe` since plan 015 — the friction-capture act; `init` since plan 008
 * FX001 — the governance-doc inception writer; `sensors` since plan 059).
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'help',
  'doctor',
  'new',
  'docs',
  'skills',
  'record',
  'instructions',
  'observe',
  'init',
  'flow',
  'dd',
  'sensors',
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
    failed(
      entry.path,
      entry.reason,
      ErrorCodes.EXTENSION_FLAT_LAYOUT,
      'Move the extension into `.harness/extensions/<name>/extension.ts`, then retry.',
    ),
  );
  const verbs: NormalizedVerb[] = [];
  const recordTypes: ExtensionRecordType[] = [];
  const sensors: RegisteredSensor[] = [];
  const customItems: RegisteredCustomItem[] = [];
  const extensions: NormalizedExtension[] = [];
  const claimedVerbs = new Set<string>();
  const claimedRecordTypes = new Set<string>();
  const claimedSensors = new Map<string, string>();

  candidate: for (const entryPath of candidates) {
    let mod: unknown;
    try {
      mod = await loader.load(entryPath);
    } catch (err) {
      records.push(failed(entryPath, errorMessage(err)));
      continue;
    }

    const classified = classifyExtensionExport(mod);
    if (classified === null) {
      records.push(
        failed(
          entryPath,
          'default export is not a HarnessVerb/HarnessRecordType/ExtensionDefinition (or array of them)',
        ),
      );
      continue;
    }

    // Preserve the old validators exactly on old entries. One bad entry still
    // fails the whole file, matching the v1 file-level isolation contract.
    const v1Verbs = classified
      .filter((entry) => entry.kind === 'v1-verb')
      .map((entry) => entry.value);
    const v1Records = classified
      .filter((entry) => entry.kind === 'v1-record')
      .map((entry) => entry.value);
    const v1Problems = [
      ...v1Verbs.flatMap(verbShapeIssues),
      ...v1Records.flatMap(recordTypeShapeIssues),
    ];
    if (v1Problems.length > 0) {
      records.push(
        failed(
          entryPath,
          v1Problems.join('; '),
          undefined,
          undefined,
          formatClassified(classified),
        ),
      );
      continue;
    }

    const normalized: NormalizedExtension[] = [];
    for (const entry of classified) {
      if (entry.kind === 'v1-verb') {
        normalized.push(normalizeV1Extension(entryPath, [entry.value], []));
        continue;
      }
      if (entry.kind === 'v1-record') {
        normalized.push(normalizeV1Extension(entryPath, [], [entry.value]));
        continue;
      }

      const gate = gateExtensionDefinition(entry.value);
      if (!gate.ok) {
        records.push(
          failed(
            entryPath,
            gate.message,
            gate.code,
            gate.next_action,
            formatClassified(classified),
          ),
        );
        continue candidate;
      }
      const validation = validateV2Extension(entry.value);
      const info = [...gate.info, ...validation.info];
      if (validation.issues.length > 0) {
        const sensorInvalid = validation.sensorIssues.length > 0;
        records.push(
          failed(
            entryPath,
            validation.issues.join('; '),
            sensorInvalid ? ErrorCodes.SENSOR_DECL_INVALID : ErrorCodes.EXTENSION_LOAD_FAILED,
            sensorInvalid
              ? 'Fix the invalid sensor declaration fields listed above, then retry.'
              : 'Fix the invalid v2 declaration fields listed above, then retry.',
            formatClassified(classified),
            info,
          ),
        );
        continue candidate;
      }
      normalized.push(normalizeV2Extension(entryPath, entry.value, info));
    }

    const fileInfo = normalized.flatMap((entry) => entry.info);
    const sources = new Set(normalized.map((entry) => entry.source));
    if (sources.size > 1) {
      fileInfo.push('mixed v1/v2 default export routed independently (tolerated)');
    }
    const format = formatNormalized(normalized);

    // Sensor declarations are file-fatal on a flat-namespace conflict (S9):
    // first discovered wins and the later extension gets an E217 failed record.
    const sensorNamesInFile = new Set<string>();
    for (const sensor of normalized.flatMap((entry) => entry.sensors)) {
      const firstPath = claimedSensors.get(sensor.name);
      if (firstPath !== undefined || sensorNamesInFile.has(sensor.name)) {
        records.push(
          failed(
            entryPath,
            `sensor '${sensor.name}' conflicts with the first declaration in ${firstPath ?? entryPath}`,
            ErrorCodes.SENSOR_NAME_CONFLICT,
            `Rename sensor '${sensor.name}' in ${entryPath}; the first declaration remains active.`,
            format,
            fileInfo,
          ),
        );
        continue candidate;
      }
      sensorNamesInFile.add(sensor.name);
    }

    // Acceptance + conflict collection. Keep the normalized entry boundaries,
    // but remove every shadowed item before exposing them to kernel consumers.
    const acceptedExtensions = normalized.map((entry) => ({
      ...entry,
      verbs: [] as NormalizedVerb[],
      sensors: [] as NormalizedSensor[],
      recordTypes: [] as HarnessRecordType[],
      customItems: [] as NormalizedCustomItem[],
    }));
    const acceptedVerbs: NormalizedVerb[] = [];
    const acceptedRecords: HarnessRecordType[] = [];
    const acceptedSensors: RegisteredSensor[] = [];
    const acceptedCustomItems: RegisteredCustomItem[] = [];
    const verbShadows: string[] = [];
    const recordShadows: string[] = [];

    normalized.forEach((entry, index) => {
      const accepted = acceptedExtensions[index];
      if (accepted === undefined) return;
      for (const verb of entry.verbs) {
        if (reservedVerbs.has(verb.name) || claimedVerbs.has(verb.name)) {
          verbShadows.push(verb.name);
          continue;
        }
        claimedVerbs.add(verb.name);
        accepted.verbs.push(verb);
        acceptedVerbs.push(verb);
        verbs.push(verb);
      }
      for (const recordType of entry.recordTypes) {
        if (reservedRecordTypes.has(recordType.type) || claimedRecordTypes.has(recordType.type)) {
          recordShadows.push(recordType.type);
          continue;
        }
        claimedRecordTypes.add(recordType.type);
        accepted.recordTypes.push(recordType);
        acceptedRecords.push(recordType);
        recordTypes.push({ recordType, entryPath });
      }
      for (const sensor of entry.sensors) {
        const registered = { ...sensor, extension: entry.name, entryPath };
        claimedSensors.set(sensor.name, entryPath);
        accepted.sensors.push(sensor);
        acceptedSensors.push(registered);
        sensors.push(registered);
      }
      for (const item of entry.customItems) {
        const registered = { ...item, extension: entry.name, entryPath };
        accepted.customItems.push(item);
        acceptedCustomItems.push(registered);
        customItems.push(registered);
      }
    });
    extensions.push(...acceptedExtensions);

    const hasShadow = verbShadows.length > 0 || recordShadows.length > 0;
    records.push(
      hasShadow
        ? {
            entryPath,
            status: 'conflict',
            verbs: acceptedVerbs,
            format,
            ...(fileInfo.length > 0 && { info: fileInfo }),
            ...(acceptedRecords.length > 0 && { recordTypes: acceptedRecords }),
            ...(acceptedSensors.length > 0 && {
              sensors: acceptedSensors.map(({ name, declaration }) => ({
                name,
                summary: declaration.summary,
              })),
            }),
            ...(acceptedCustomItems.length > 0 && {
              customItems: acceptedCustomItems.map(({ type, name, declaration }) => ({
                type,
                name,
                summary: declaration.summary,
              })),
            }),
            ...(verbShadows.length > 0 && { shadows: verbShadows }),
            ...(recordShadows.length > 0 && { recordShadows }),
            code: ErrorCodes.EXTENSION_VERB_CONFLICT,
            error: conflictError(verbShadows, recordShadows),
            next_action:
              'Rename the shadowed verb/record type or remove the duplicate extension, then retry.',
          }
        : {
            entryPath,
            status: 'loaded',
            verbs: acceptedVerbs,
            format,
            ...(fileInfo.length > 0 && { info: fileInfo }),
            ...(acceptedRecords.length > 0 && { recordTypes: acceptedRecords }),
            ...(acceptedSensors.length > 0 && {
              sensors: acceptedSensors.map(({ name, declaration }) => ({
                name,
                summary: declaration.summary,
              })),
            }),
            ...(acceptedCustomItems.length > 0 && {
              customItems: acceptedCustomItems.map(({ type, name, declaration }) => ({
                type,
                name,
                summary: declaration.summary,
              })),
            }),
          },
    );
  }

  return { verbs, recordTypes, sensors, customItems, records, extensions };
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
  return {
    verbs: registry.verbs,
    records: registry.records,
    extensions: registry.extensions,
    sensors: registry.sensors,
    customItems: registry.customItems,
  };
}

function uniqueFormat(labels: string[]): string {
  return [...new Set(labels)].join(' + ');
}

function formatClassified(entries: readonly ClassifiedExtensionEntry[]): string {
  return uniqueFormat(
    entries.map((entry) =>
      entry.kind === 'v2' ? `v2 (api ${String(entry.value.api ?? 2)})` : 'v1',
    ),
  );
}

function formatNormalized(entries: readonly NormalizedExtension[]): string {
  return uniqueFormat(
    entries.map((entry) => (entry.source === 'v2' ? `v2 (api ${entry.api})` : 'v1')),
  );
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
  next_action = 'Fix or remove this extension, then run `harness doctor` again.',
  format?: string,
  info: readonly string[] = [],
): ExtensionRecord {
  return {
    entryPath,
    status: 'failed',
    verbs: [],
    ...(format !== undefined && { format }),
    ...(info.length > 0 && { info: [...info] }),
    code,
    error: `${code}: ${reason}`,
    next_action,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
