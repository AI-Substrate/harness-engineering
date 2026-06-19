import type { FsPort } from '../../adapters/fs/fs-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { BUNDLED_FLOW_SCHEMAS } from './schemas-content.js';

/**
 * Flow schema resolution + validation (plan 024 Phase 1; AC-03/10/11).
 *
 * Hand-rolled, dependency-free — mirrors `recordTypeShapeIssues` (the repo has no
 * JSON-Schema validator and deliberately stays dep-light). The CLI OWNS the
 * schema-descriptor format (grill 6/7); the-flow + custom flows conform to it.
 *
 * Two layers compose a resolved schema:
 *   - the SHARED-CORE descriptor (`flow.schema.json`, bundled) — universal field
 *     shape (node/comment/authority/root), the same for every flow;
 *   - a per-flow OVERLAY descriptor (`harness-loop`, the-flow's flight-plan, or a
 *     user custom) — declares `kind` + `statuses` + `nodeTypes`.
 *
 * Resolution precedence (AC-11): `--schema <path>` (absolute, OUT-OF-REPO ok,
 * isWithin-EXEMPT — guarded by JSON-only + a size cap) › `.harness/schemas/flows/
 * <type>.schema.json` › the bundled built-in (shared-core + harness-loop only) ›
 * `E304`.
 */

/** The bundle key for the shared-core descriptor (its file stem). */
const SHARED_CORE_KEY = 'flow';
/** Size cap for an out-of-repo `--schema` read (the isWithin exemption's guard). */
const MAX_SCHEMA_BYTES = 256 * 1024;
/** The schema major this CLI understands (version gate → E306). */
export const SUPPORTED_SCHEMA_MAJOR = 1;
/** Defensive defaults for the chore vocabulary (Phase 4) if a core descriptor omits the block. */
const DEFAULT_CHORE_KINDS = ['skill', 'command', 'builtin', 'manual'];
const DEFAULT_CHORE_IMPORTANCES = [
  'strongly-recommended',
  'recommended',
  'optional',
  'informational',
];

interface CoreDescriptor {
  schema_version?: number;
  node?: { required?: string[]; optional?: string[] };
  comment?: { required?: string[]; optional?: string[] };
  authority?: { values?: string[]; default?: string };
  chore?: { kinds?: string[]; importances?: string[] };
  root?: { required?: string[]; optional?: string[] };
}

interface OverlayDescriptor {
  schema_version?: number;
  kind?: string;
  extends?: string;
  statuses?: string[];
  nodeTypes?: string[];
}

/** A fully-merged schema (core field-shape + overlay vocabulary) the validator reads. */
export interface ResolvedFlowSchema {
  schemaVersionMajor: number;
  kind: string;
  statuses: string[];
  nodeTypes: string[];
  nodeRequired: string[];
  nodeOptional: string[];
  commentRequired: string[];
  commentOptional: string[];
  authorityValues: string[];
  /** Allowed `chore.kind` values (Phase 4) — universal, declared in the shared core. */
  choreKinds: string[];
  /** Allowed `chore.importance` values (Phase 4) — advisory only; `required` is intentionally absent. */
  choreImportances: string[];
  rootRequired: string[];
  rootOptional: string[];
}

export type SchemaSource = 'flag' | 'repo' | 'bundled';

export type SchemaResolution =
  | { ok: true; schema: ResolvedFlowSchema; source: SchemaSource }
  | { ok: false; code: string; message: string; next_action: string };

export interface ResolveSchemaOptions {
  /** The flow type/kind to resolve a schema for. */
  type: string;
  /** `--schema` override — may be an absolute, out-of-repo path (isWithin-exempt). */
  schemaPath?: string;
  /** Repo root, for the `.harness/schemas/flows/` precedence rung. */
  repoRoot: string;
}

export interface SchemaDeps {
  fs: FsPort;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function invalid(message: string, next_action: string): SchemaResolution {
  return { ok: false, code: ErrorCodes.FLOW_SCHEMA_INVALID, message, next_action };
}

/** Resolve the overlay descriptor per precedence (returns the raw descriptor + its source). */
function loadOverlay(
  opts: ResolveSchemaOptions,
  deps: SchemaDeps,
): { descriptor: unknown; source: SchemaSource } | SchemaResolution {
  // 1. --schema override — an explicit path MUST resolve (no silent fall-through).
  if (opts.schemaPath !== undefined && opts.schemaPath.length > 0) {
    const path = toPosix(opts.schemaPath);
    const raw = deps.fs.readText(path);
    if (raw === null) {
      return invalid(
        `--schema path not found or unreadable: ${path}`,
        'Point --schema at an existing, readable JSON schema file (absolute paths, including outside the repo, are allowed).',
      );
    }
    if (raw.length > MAX_SCHEMA_BYTES) {
      return invalid(
        `--schema file is too large (${raw.length} bytes > ${MAX_SCHEMA_BYTES} cap): ${path}`,
        'Supply a flow schema descriptor, not a large data file.',
      );
    }
    const parsed = parseJson(raw);
    if (parsed === undefined) {
      return invalid(
        `--schema file is not valid JSON: ${path}`,
        'Fix the JSON in the --schema file.',
      );
    }
    return { descriptor: parsed, source: 'flag' };
  }

  // 2. repo override at .harness/schemas/flows/<type>.schema.json
  const repoPath = posixJoin(
    toPosix(opts.repoRoot),
    '.harness/schemas/flows',
    `${opts.type}.schema.json`,
  );
  if (deps.fs.exists(repoPath)) {
    const parsed = parseJson(deps.fs.readText(repoPath));
    if (parsed === undefined) {
      return invalid(`repo schema is not valid JSON: ${repoPath}`, `Fix the JSON in ${repoPath}.`);
    }
    return { descriptor: parsed, source: 'repo' };
  }

  // 3. bundled built-in (shared-core + harness-loop only; the core itself is not a creatable type)
  if (opts.type !== SHARED_CORE_KEY && Object.hasOwn(BUNDLED_FLOW_SCHEMAS, opts.type)) {
    return { descriptor: BUNDLED_FLOW_SCHEMAS[opts.type], source: 'bundled' };
  }

  // 4. exhausted → E304
  return {
    ok: false,
    code: ErrorCodes.FLOW_TYPE_UNKNOWN,
    message: `No schema found for flow type "${opts.type}".`,
    next_action: `Pass --schema <path>, add .harness/schemas/flows/${opts.type}.schema.json, or use a bundled type (harness-loop).`,
  };
}

/** Resolve + merge the schema for a flow type. Pure over the injected FsPort. */
export function resolveFlowSchema(opts: ResolveSchemaOptions, deps: SchemaDeps): SchemaResolution {
  const loaded = loadOverlay(opts, deps);
  if ('ok' in loaded) return loaded; // an error resolution

  const overlay = loaded.descriptor as OverlayDescriptor;
  if (
    typeof overlay.kind !== 'string' ||
    !Array.isArray(overlay.statuses) ||
    !Array.isArray(overlay.nodeTypes)
  ) {
    return invalid(
      `schema for "${opts.type}" is not a valid flow overlay (needs string "kind" + "statuses"[] + "nodeTypes"[]).`,
      'Author the overlay with kind + statuses[] + nodeTypes[] (see harness-loop.schema.json).',
    );
  }

  const core = BUNDLED_FLOW_SCHEMAS[SHARED_CORE_KEY] as CoreDescriptor | undefined;
  if (!core?.node?.required || !core.root?.required) {
    return invalid(
      'bundled shared-core schema (flow) is missing or malformed.',
      'Run `npm run gen:flows` to regenerate the bundled schemas.',
    );
  }

  const schema: ResolvedFlowSchema = {
    schemaVersionMajor:
      typeof overlay.schema_version === 'number'
        ? overlay.schema_version
        : (core.schema_version ?? SUPPORTED_SCHEMA_MAJOR),
    kind: overlay.kind,
    statuses: overlay.statuses,
    nodeTypes: overlay.nodeTypes,
    nodeRequired: core.node.required,
    nodeOptional: core.node.optional ?? [],
    commentRequired: core.comment?.required ?? ['at', 'text'],
    commentOptional: core.comment?.optional ?? [],
    authorityValues: core.authority?.values ?? ['cursor', 'substrate'],
    choreKinds: core.chore?.kinds ?? DEFAULT_CHORE_KINDS,
    choreImportances: core.chore?.importances ?? DEFAULT_CHORE_IMPORTANCES,
    rootRequired: core.root.required,
    rootOptional: core.root.optional ?? [],
  };
  return { ok: true, schema, source: loaded.source };
}

/**
 * Validate a flow document against a resolved schema. Returns issues (empty =
 * valid), mirroring `recordTypeShapeIssues`. TOLERANT of extra fields (no
 * additionalProperties:false) so pass-through bookkeeping (`agents[]`, `output`,
 * `error`) round-trips; STRICT on required fields, the kind discriminator, the
 * overlay-declared status vocabulary, the allowed node-type set, and edge refs.
 */
export function validateFlowDoc(doc: unknown, schema: ResolvedFlowSchema): string[] {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['flow document is not an object'];
  }
  const d = doc as Record<string, unknown>;
  const issues: string[] = [];

  for (const key of schema.rootRequired) {
    if (!(key in d)) issues.push(`root: missing required field "${key}"`);
  }
  if (typeof d.kind === 'string' && d.kind !== schema.kind) {
    issues.push(`root: kind "${d.kind}" does not match the resolved schema kind "${schema.kind}"`);
  }
  if ('events' in d && !Array.isArray(d.events)) {
    issues.push('root: events must be an array');
  }

  const nodes = d.nodes;
  if (!Array.isArray(nodes)) {
    issues.push('root: nodes must be an array');
    return issues;
  }

  const ids = new Set<string>();
  for (const raw of nodes) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const id = (raw as Record<string, unknown>).id;
      if (typeof id === 'string') ids.add(id);
    }
  }

  for (const raw of nodes) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push('node: entry is not an object');
      continue;
    }
    const node = raw as Record<string, unknown>;
    const id = typeof node.id === 'string' ? node.id : '<no-id>';

    for (const key of schema.nodeRequired) {
      if (!(key in node)) issues.push(`node ${id}: missing required field "${key}"`);
    }
    if (typeof node.type === 'string' && !schema.nodeTypes.includes(node.type)) {
      issues.push(
        `node ${id}: type "${node.type}" is not valid for flow kind "${schema.kind}" (allowed: ${schema.nodeTypes.join(', ')})`,
      );
    }
    if (typeof node.status === 'string' && !schema.statuses.includes(node.status)) {
      issues.push(
        `node ${id}: status "${node.status}" is not in the declared status vocabulary (${schema.statuses.join(', ')})`,
      );
    }
    if (
      'next' in node &&
      !(Array.isArray(node.next) && node.next.every((x) => typeof x === 'string'))
    ) {
      issues.push(`node ${id}: next must be an array of node-id strings`);
    } else if (Array.isArray(node.next)) {
      for (const target of node.next) {
        if (typeof target === 'string' && !ids.has(target)) {
          issues.push(`node ${id}: next references unknown node "${target}"`);
        }
      }
    }
    if (typeof node.branch_of === 'string' && !ids.has(node.branch_of)) {
      issues.push(`node ${id}: branch_of references unknown node "${node.branch_of}"`);
    }
    if ('authority' in node && !schema.authorityValues.includes(node.authority as string)) {
      issues.push(
        `node ${id}: authority "${String(node.authority)}" is not one of ${schema.authorityValues.join(', ')}`,
      );
    }
    // chore (Phase 4): an orthogonal {kind, importance} marker. Present => both
    // enums are validated against the shared-core vocabulary. `importance` has no
    // `required` level by design — advisory only, never a gate (ws004 C3).
    if ('chore' in node) {
      const chore = node.chore;
      if (chore === null || typeof chore !== 'object' || Array.isArray(chore)) {
        issues.push(`node ${id}: chore must be an object { kind, importance }`);
      } else {
        const c = chore as Record<string, unknown>;
        if (!schema.choreKinds.includes(c.kind as string)) {
          issues.push(
            `node ${id}: chore.kind "${String(c.kind)}" is not one of ${schema.choreKinds.join(', ')}`,
          );
        }
        if (!schema.choreImportances.includes(c.importance as string)) {
          issues.push(
            `node ${id}: chore.importance "${String(c.importance)}" is not one of ${schema.choreImportances.join(', ')}`,
          );
        }
      }
    }
    if ('comments' in node) {
      if (!Array.isArray(node.comments)) {
        issues.push(`node ${id}: comments must be an array`);
      } else {
        node.comments.forEach((c, i) => {
          if (c === null || typeof c !== 'object') {
            issues.push(`node ${id}: comment[${i}] is not an object`);
            return;
          }
          for (const key of schema.commentRequired) {
            if (!(key in (c as Record<string, unknown>))) {
              issues.push(`node ${id}: comment[${i}] missing required "${key}"`);
            }
          }
        });
      }
    }
  }

  // nav.now / nav.next must reference existing nodes (the cursor-spine position
  // object replaced the top-level cursor/recommended_next refs — clean break).
  const nav = d.nav;
  if (nav !== null && typeof nav === 'object' && !Array.isArray(nav) && ids.size > 0) {
    const n = nav as Record<string, unknown>;
    if (typeof n.now === 'string' && n.now.length > 0 && !ids.has(n.now)) {
      issues.push(`root: nav.now "${n.now}" does not reference an existing node`);
    }
    if (typeof n.next === 'string' && n.next.length > 0 && !ids.has(n.next)) {
      issues.push(`root: nav.next "${n.next}" does not reference an existing node`);
    }
  }
  return issues;
}

/**
 * Version gate (T016 / AC-07): a flow whose `schema_version` MAJOR is not the one
 * this CLI understands → `E306`, with a `harness update` next_action. Doc-only
 * (independent of the overlay) so a forward-version flow is rejected before any
 * schema resolution — it ships GATED (the Open Question resolved). Absence is a
 * legacy / required-field concern handled by the E308 detector + `validateFlowDoc`.
 */
export function checkSchemaVersion(
  doc: unknown,
): { ok: true } | { ok: false; code: string; message: string; next_action: string } {
  const raw =
    doc !== null &&
    typeof doc === 'object' &&
    typeof (doc as Record<string, unknown>).schema_version === 'number'
      ? ((doc as Record<string, unknown>).schema_version as number)
      : undefined;
  if (raw === undefined) return { ok: true };
  const major = Math.trunc(raw);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return {
      ok: false,
      code: ErrorCodes.FLOW_SCHEMA_VERSION,
      message: `flow schema_version ${raw} has an unsupported major (this CLI understands major ${SUPPORTED_SCHEMA_MAJOR}).`,
      next_action: 'Run `harness update` to get a CLI that understands this flow version.',
    };
  }
  return { ok: true };
}
