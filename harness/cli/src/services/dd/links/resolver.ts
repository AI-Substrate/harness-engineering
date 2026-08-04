import { resolveInRepo } from '../../shared/posix-path.js';
import {
  formatAddress,
  isAddressFailure,
  normalizeAddress,
  parseAddress,
} from '../core/address.js';
import type { DdDoc, DdShape, ResolvedDdSchema } from '../core/model.js';
import { isPathWithinRepo, resolveAddressFile, type SchemaResolver } from '../core/validate.js';
import { isRecord } from '../core/value.js';
import type { DocLoader } from '../core/walk.js';
import {
  type DdLinkIssue,
  type DdLinkResolution,
  type DdLinkUnresolvedReason,
  type DdResolvedSegment,
  type DdSegmentKind,
  linkIssue,
} from './model.js';

export interface DdLinkResolverDeps {
  schemaResolver: SchemaResolver;
  docLoader: DocLoader;
}

export interface DdLinkResolveOptions {
  repoRoot: string;
  /**
   * Absolute path of the document the address is written in. Relative file parts
   * anchor here, and the bare-`#` form resolves to this document. `null` means
   * the caller has no containing document (the CLI face): relative paths then
   * anchor at the repo root, and a bare-`#` address has nothing to resolve
   * against, which is reported rather than guessed.
   */
  fromPath: string | null;
  /** The already-parsed containing document, when the caller holds it. */
  fromDoc?: DdDoc;
  /** Where the address was found, for the finding's location. */
  location?: string;
  /** The document that must change to fix a bad address — the one that holds it. */
  owner?: string;
}

interface Cursor {
  value: unknown;
  shape: DdShape | undefined;
}

/**
 * The one place a schema shape is walked segment by segment.
 *
 * Classification is shape-directed, never positional. `parseAddress` alternates
 * `name`/`id` by index because at parse time nothing better is knowable, but the
 * grammar's alternation is a convention of the common case, not a rule of the
 * data: `#meta/owner` is a shape part at an odd index, and an object nested in an
 * object puts parts at every index. Asking the shape is the only classification
 * that cannot be wrong (the Phase 4 leaf ruling on `--resolve`).
 */
function descend(
  doc: DdDoc,
  schema: ResolvedDdSchema,
  values: readonly string[],
  fail: (reason: DdLinkUnresolvedReason, message: string) => DdLinkResolution,
): DdLinkResolution | { trail: DdResolvedSegment[]; value: unknown; kind: DdSegmentKind } {
  const [first, ...rest] = values;
  if (first === undefined) return fail('section-unknown', 'address interior names no section');

  const declaration = schema.sections[first];
  if (!declaration) {
    return fail('section-unknown', `schema "${schema.name}" declares no section "${first}"`);
  }
  const section = doc.sections.find((candidate) => candidate.name === first);
  if (!section) {
    return fail('section-unknown', `the document has no section "${first}"`);
  }

  const trail: DdResolvedSegment[] = [{ value: first, kind: 'section' }];
  let cursor: Cursor = { value: section.value, shape: declaration.shape };

  for (const value of rest) {
    const shape = cursor.shape;
    if (shape?.type === 'array') {
      if (!Array.isArray(cursor.value)) {
        return fail(
          'not-a-container',
          `"${value}" descends into a non-array at "${trailOf(trail)}"`,
        );
      }
      const entry = cursor.value.find((candidate) => isRecord(candidate) && candidate.id === value);
      if (entry === undefined) {
        return fail('id-not-found', `no entry with id "${value}" in "${trailOf(trail)}"`);
      }
      trail.push({ value, kind: 'instance' });
      cursor = { value: entry, shape: shape.items };
      continue;
    }
    if (shape?.type === 'object') {
      // A declared field wins per key; `valuesShape` (OD-8) covers the keys a
      // schema cannot name in advance. Without the fallback a dynamic-key map is
      // unsteppable, which would strand workshop-002 Ruling 3's whole design —
      // `done -> #evidence/<task-id>`, an evidence list addressed by its owning
      // task's explicit id.
      const declaredField = shape.fields?.[value];
      const fieldShape = declaredField ?? shape.valuesShape;
      if (!fieldShape) {
        return fail('part-unknown', `"${trailOf(trail)}" declares no part "${value}"`);
      }
      if (!isRecord(cursor.value) || !(value in cursor.value)) {
        return fail('part-unknown', `the document carries no "${value}" at "${trailOf(trail)}"`);
      }
      // A map entry reached by its own id is an INSTANCE, exactly as an array
      // member found by id is — the kind is what the segment turned out to be
      // against shape and data, never where it sat in the address.
      trail.push({ value, kind: declaredField ? 'part' : 'instance' });
      cursor = { value: cursor.value[value], shape: fieldShape };
      continue;
    }
    return fail(
      'not-a-container',
      `"${trailOf(trail)}" is a ${shape?.type ?? 'leaf'} and cannot contain "${value}"`,
    );
  }

  const kind = trail.at(-1)?.kind ?? 'section';
  return { trail, value: cursor.value, kind };
}

function trailOf(trail: readonly DdResolvedSegment[]): string {
  return trail.map((segment) => segment.value).join('/');
}

function isResolution(
  value: DdLinkResolution | { trail: DdResolvedSegment[]; value: unknown; kind: DdSegmentKind },
): value is DdLinkResolution {
  return 'ok' in value;
}

/**
 * Resolve one address to the document, section, part or instance it names.
 *
 * The single engine behind `dd link resolve`, `dd address validate --resolve`,
 * `dd links`, `dd graph` and the doctor's interior checks (plan 4.1-4.5, D16):
 * three CLI faces and two sweeps over exactly one implementation, so a rule can
 * only be right or wrong in one place.
 *
 * Findings this returns are the ones only reachable by *following* an address.
 * Cell-level path warnings and cross-document target/basis findings already
 * belong to dd-core's validator and walk, and are deliberately not repeated here
 * — the doctor composes both layers and would otherwise report each twice.
 */
export function resolveLink(
  raw: string,
  deps: DdLinkResolverDeps,
  options: DdLinkResolveOptions,
): DdLinkResolution {
  const location = options.location ?? '$';
  const owner = options.owner ?? options.fromPath ?? location;
  const fail = (reason: DdLinkUnresolvedReason, message: string): DdLinkResolution => ({
    ok: false,
    issues: [linkIssue('link-unresolved', 'ERROR', location, message, owner, reason)],
  });

  const parsed = parseAddress(raw);
  if (isAddressFailure(parsed)) return fail('malformed', parsed.message);
  const address = normalizeAddress(parsed);

  if (address.file === null && options.fromPath === null) {
    return fail(
      'no-base-document',
      'a bare-"#" address resolves against its containing document; supply "<path>#<interior>"',
    );
  }

  const targetPath =
    address.file === null
      ? (options.fromPath as string)
      : options.fromPath === null
        ? resolveInRepo(address.file, options.repoRoot)
        : resolveAddressFile(options.fromPath, address.file);

  if (!isPathWithinRepo(targetPath, options.repoRoot)) {
    return fail('path-escape', `address resolves outside the repository: ${targetPath}`);
  }

  const loaded = deps.docLoader.load(targetPath);
  if (!loaded.ok) return fail('file-unreadable', loaded.message);

  const resolvedSchema = deps.schemaResolver.resolve(loaded.doc.dd.schema, loaded.path);
  if (!resolvedSchema.ok) return fail('schema-unresolvable', resolvedSchema.message);

  const descended = descend(
    loaded.doc,
    resolvedSchema.schema,
    address.segments.map((segment) => segment.value),
    fail,
  );
  if (isResolution(descended)) return descended;

  const issues: DdLinkIssue[] = [];
  return {
    ok: true,
    issues,
    target: {
      address: formatAddress(address),
      path: loaded.path,
      schema: resolvedSchema.schema.name,
      form: address.file === null ? 'bare' : 'qualified',
      segments: descended.trail,
      kind: descended.kind,
      value: descended.value,
      sha: loaded.sha,
      tracked: loaded.tracked,
    },
  };
}
