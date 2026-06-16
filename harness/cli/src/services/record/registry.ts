import type { HarnessRecordType } from './contract.js';
import { harnessBypassRecordType } from './core-types/harness-bypass.js';
import { harnessChangeRecordType } from './core-types/harness-change.js';
import { retroRecordType } from './core-types/retro.js';

/** Same name rule as verb names — the `<type>` arg + the records subdir name. */
const TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A resolved record type in the merged registry, with its provenance. */
export interface RecordTypeEntry {
  type: string;
  description: string;
  template: string;
  source: 'core' | 'extension';
  /** Present for `source: 'extension'` — the discovered file the type came from. */
  entryPath?: string;
}

/** An extension-provided record type, paired with the file it was discovered in. */
export interface ExtensionRecordType {
  recordType: HarnessRecordType;
  entryPath: string;
}

/** An extension record type dropped because its `type` was already claimed. */
export interface RecordTypeConflict {
  type: string;
  entryPath: string;
  /** What it collided with: an existing `core` type or an `extension` loaded earlier. */
  shadows: 'core' | 'extension';
}

/** The merged record-type surface (core ∪ extension) + the conflicts `doctor` reports. */
export interface RecordRegistry {
  /** Accepted types, deterministic order: core first, then de-conflicted extensions. */
  types: RecordTypeEntry[];
  /** Extension types skipped because their `type` was already claimed (never fatal). */
  conflicts: RecordTypeConflict[];
}

/** The core-bundled record types — always present, even under `--no-extensions`. */
export const coreRecordTypes: HarnessRecordType[] = [
  retroRecordType,
  harnessBypassRecordType,
  harnessChangeRecordType,
];

/**
 * Field-level issues for a record-type export (empty array = well-formed). Mirrors
 * `verbShapeIssues`: a malformed `kind:'record'` export becomes a clean `E140`
 * (recorded by `doctor`, non-fatal) instead of crashing `harness record`.
 */
export function recordTypeShapeIssues(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return ['not an object'];
  }
  const rt = value as Partial<HarnessRecordType>;
  const issues: string[] = [];
  if (rt.kind !== 'record') {
    issues.push("missing kind:'record'");
  }
  if (typeof rt.type !== 'string' || !TYPE_PATTERN.test(rt.type)) {
    issues.push('missing or invalid type (must match ^[a-z][a-z0-9-]*$)');
  }
  if (typeof rt.description !== 'string' || rt.description.length === 0) {
    issues.push('missing or empty description');
  }
  if (typeof rt.template !== 'string' || rt.template.length === 0) {
    issues.push('missing or empty template');
  }
  return issues;
}

/**
 * Merge core ∪ extension record types into one registry. Core types are
 * **reserved** — an extension declaring an existing core `type` is recorded as a
 * conflict and the core definition wins; two extensions with the same `type` →
 * first-loaded wins, the other is a conflict. The merge is deterministic and
 * defensive: even if a caller passes un-deconflicted extension types, duplicates
 * are dropped here (the loader normally de-conflicts first). Never throws.
 */
export function buildRecordRegistry(
  core: readonly HarnessRecordType[] = coreRecordTypes,
  extension: readonly ExtensionRecordType[] = [],
): RecordRegistry {
  const types: RecordTypeEntry[] = [];
  const conflicts: RecordTypeConflict[] = [];
  const claimed = new Set<string>();
  const coreNames = new Set(core.map((t) => t.type));

  for (const t of core) {
    if (claimed.has(t.type)) {
      continue;
    }
    claimed.add(t.type);
    types.push({ type: t.type, description: t.description, template: t.template, source: 'core' });
  }

  for (const { recordType: t, entryPath } of extension) {
    if (claimed.has(t.type)) {
      conflicts.push({
        type: t.type,
        entryPath,
        shadows: coreNames.has(t.type) ? 'core' : 'extension',
      });
      continue;
    }
    claimed.add(t.type);
    types.push({
      type: t.type,
      description: t.description,
      template: t.template,
      source: 'extension',
      entryPath,
    });
  }

  return { types, conflicts };
}
