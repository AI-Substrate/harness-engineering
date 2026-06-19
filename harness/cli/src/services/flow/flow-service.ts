import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixJoin, resolveInRepo, toPosix } from '../shared/posix-path.js';
import {
  buildBuiltinEvent,
  type FlowDoc,
  type FlowNode,
  type FlowProvenance,
} from './flow-events.js';
import { checkSchemaVersion, resolveFlowSchema, validateFlowDoc } from './flow-schema.js';
import { BUNDLED_FLOW_TEMPLATES } from './schemas-content.js';

/**
 * Flow service (plan 024 Phase 1; AC-01/02/07/14) — `create`/`new`/`show`/`list`
 * plus the atomic state I/O (temp-write + rename) and the read path (incl. the
 * `E308` clean-break legacy detector). PURE over injected ports (FsPort/Clock/
 * GitPort/EnvPort) — no `node:*`, no `new Date()`, no `process`. The act resolves
 * `repoRoot` (= `toPosix(proc.cwd())`) and the `harnessVersion` and passes them in.
 *
 * Write containment: every WRITE path (`--path`/default) must sit inside the repo
 * (`isWithin` → else `E303`). `--schema`/`--template` are READ paths and are
 * isWithin-EXEMPT (out-of-repo skill schemas/seeds are allowed; flow-schema.ts
 * guards them with a size cap + JSON-only).
 */

export const FLOWS_DIR = '.harness/flows';
export const SCHEMAS_DIR = '.harness/schemas/flows';
/** Identifies a flow's provenance block among record kinds (ws-002 §E5). */
const FLOW_RECORD_KIND = 'flow';
/** Flow-type name rule (lowercase, hyphenated) — mirrors the scaffold name discipline. */
const TYPE_NAME_RE = /^[a-z][a-z0-9-]*$/;

export interface FlowServiceDeps {
  fs: FsPort;
  clock: Clock;
  git: GitPort;
  env: EnvPort;
}

export type FlowFailure = {
  ok: false;
  status: 'error';
  code: string;
  message: string;
  next_action: string;
};

/** Build a canonical flow error result (exported so flow-mutations reuses it). */
export function fail(code: string, message: string, next_action: string): FlowFailure {
  return { ok: false, status: 'error', code, message, next_action };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// E308 — the clean-break legacy detector (plan Finding 02; grill 3/8).
// ---------------------------------------------------------------------------

/**
 * A POSITIVE legacy signature: the doc is flow-SHAPED (has `nodes` or `cursor`)
 * yet carries NO `provenance` block — the one thing the CLI always stamps. This
 * is keyed on the absent-provenance signal, NEVER on empty `events[]`: a freshly
 * `create`d flow has `events: []` and MUST NOT trip this (Finding 02).
 */
export function isLegacyFlow(doc: unknown): boolean {
  if (!isObject(doc)) return false;
  const flowShaped = Array.isArray(doc.nodes) || 'cursor' in doc;
  return flowShaped && !('provenance' in doc);
}

// ---------------------------------------------------------------------------
// Read path.
// ---------------------------------------------------------------------------

/**
 * Read + parse a flow file. `E301` missing/unreadable · `E300` invalid JSON ·
 * `E308` a pre-CLI legacy flow (no tolerant load — clean break).
 */
export function readFlowDoc(
  path: string,
  deps: FlowServiceDeps,
): { ok: true; doc: FlowDoc } | FlowFailure {
  const p = toPosix(path);
  const raw = deps.fs.readText(p);
  if (raw === null) {
    return fail(
      ErrorCodes.FLOW_NOT_FOUND,
      `flow file not found or unreadable: ${p}`,
      'Pass --path to an existing flow file, or `harness flow create` a new one.',
    );
  }
  const parsed = parseJson(raw);
  if (parsed === undefined) {
    return fail(
      ErrorCodes.FLOW_SCHEMA_INVALID,
      `flow file is not valid JSON: ${p}`,
      `Fix the JSON in ${p}.`,
    );
  }
  if (isLegacyFlow(parsed)) {
    return fail(
      ErrorCodes.FLOW_LEGACY_FORMAT,
      `flow file ${p} looks like a pre-CLI (legacy hand-written) flow — it has no \`provenance\` block.`,
      'The `harness flow` CLI does not migrate legacy flows (clean break). If this is unexpected, the file may be malformed — re-create it with `harness flow create`.',
    );
  }
  // Version gate (T016): a forward-major flow is rejected before any operation.
  const version = checkSchemaVersion(parsed);
  if (!version.ok) return fail(version.code, version.message, version.next_action);
  return { ok: true, doc: parsed as FlowDoc };
}

// ---------------------------------------------------------------------------
// Atomic write (temp + rename).
// ---------------------------------------------------------------------------

/**
 * Serialize + atomically write a flow doc: write a sibling `.tmp`, then
 * `rename` it over the target (crash-safe — a reader never sees a half-written
 * file). `E303` if the WRITE path escapes the repo; `E302` if the write/rename
 * itself fails.
 */
export function writeFlowAtomic(
  path: string,
  repoRoot: string,
  doc: FlowDoc,
  deps: FlowServiceDeps,
): { ok: true; path: string } | FlowFailure {
  const p = toPosix(path);
  const root = toPosix(repoRoot);
  if (!isWithin(root, p)) {
    return fail(
      ErrorCodes.FLOW_PATH_ESCAPE,
      `flow write path escapes the repo root: ${p}`,
      `Write inside the repository (e.g. ${FLOWS_DIR}/<slug>.json). --schema/--template may be out-of-repo; the flow file may not.`,
    );
  }
  const tmp = `${p}.tmp`;
  try {
    deps.fs.mkdirp(posixDirname(p));
    deps.fs.writeText(tmp, `${JSON.stringify(doc, null, 2)}\n`);
    deps.fs.rename(tmp, p);
  } catch (err) {
    return fail(
      ErrorCodes.FLOW_WRITE_FAILED,
      `failed to write flow file ${p}: ${err instanceof Error ? err.message : String(err)}`,
      'Check directory permissions and disk space, then retry.',
    );
  }
  return { ok: true, path: p };
}

// ---------------------------------------------------------------------------
// create.
// ---------------------------------------------------------------------------

export interface CreateFlowOptions {
  /** The flow type/kind to resolve a schema (+ template) for. */
  type: string;
  /** The instance slug (stamped into the root + the `created` event). */
  slug: string;
  /** Repo root (posix) — write containment + the repo schema rung. */
  repoRoot: string;
  /** Injected CLI version string (provenance.harness_version). */
  harnessVersion: string;
  /** `--path`/`--output` write target; defaults to `.harness/flows/<slug>.json`. */
  path?: string;
  /** `--schema` overlay override (isWithin-exempt). */
  schemaPath?: string;
  /** `--template` seed override (isWithin-exempt); else the bundled sibling template. */
  templatePath?: string;
  /** `--bare` — root-only, copy no template nodes. */
  bare?: boolean;
  /** `--agent` — stamp `provenance.agent` (D-06 fix); wins over `HARNESS_AGENT`. */
  agent?: string;
  /** `--plan-id` — stamp `provenance.plan_id`; wins over `HARNESS_PLAN_ID`. */
  planId?: string;
  /** `--title` — an explicit rail-title label (the rail prefers it over the slug). */
  title?: string;
}

/** Resolve the template node skeleton + its suggested cursor for a create. */
function resolveTemplate(
  opts: CreateFlowOptions,
  deps: FlowServiceDeps,
): { nodes: FlowNode[]; cursor?: string } | FlowFailure {
  if (opts.bare) return { nodes: [] };

  let descriptor: unknown;
  if (opts.templatePath !== undefined && opts.templatePath.length > 0) {
    const raw = deps.fs.readText(toPosix(opts.templatePath));
    if (raw === null) {
      return fail(
        ErrorCodes.FLOW_SCHEMA_INVALID,
        `--template not found or unreadable: ${opts.templatePath}`,
        'Point --template at an existing JSON template, or pass --bare for a root-only flow.',
      );
    }
    descriptor = parseJson(raw);
    if (descriptor === undefined) {
      return fail(
        ErrorCodes.FLOW_SCHEMA_INVALID,
        `--template is not valid JSON: ${opts.templatePath}`,
        'Fix the JSON in the --template file.',
      );
    }
  } else {
    // Bundled sibling template; absent → graceful root-only (no template ships).
    descriptor = BUNDLED_FLOW_TEMPLATES[opts.type];
    if (descriptor === undefined) return { nodes: [] };
  }

  if (!isObject(descriptor) || !Array.isArray(descriptor.nodes)) {
    return fail(
      ErrorCodes.FLOW_SCHEMA_INVALID,
      `template for "${opts.type}" has no nodes[] array.`,
      'A flow template is `{ "nodes": [...] }` (+ an optional "cursor"). Use --bare for a root-only flow.',
    );
  }
  return {
    // Deep-copy the template nodes VERBATIM (preserve next[]/branch_of/all fields).
    nodes: structuredClone(descriptor.nodes) as FlowNode[],
    // The template DSL's `cursor` key = its seed position (NOT the doc's migrated
    // `cursor` field — that's gone); createFlow maps it into `nav.now`.
    cursor: typeof descriptor.cursor === 'string' ? descriptor.cursor : undefined,
  };
}

/**
 * `flow create <type>` — instantiate a flow: resolve the schema + template,
 * deep-copy the template nodes verbatim, stamp root identity + provenance, fire
 * the `created` event, validate, and atomically write.
 */
export function createFlow(
  opts: CreateFlowOptions,
  deps: FlowServiceDeps,
): { ok: true; path: string; doc: FlowDoc } | FlowFailure {
  const repoRoot = toPosix(opts.repoRoot);
  // A relative --path anchors to the repo root before the containment check
  // (else an in-repo relative path resolves to `../…` and is wrongly rejected);
  // an absolute path passes through. Containment still applies after resolution.
  const targetPath = opts.path
    ? resolveInRepo(opts.path, repoRoot)
    : posixJoin(repoRoot, FLOWS_DIR, `${opts.slug}.json`);

  // Containment first — an out-of-repo write target is rejected before any work.
  if (!isWithin(repoRoot, targetPath)) {
    return fail(
      ErrorCodes.FLOW_PATH_ESCAPE,
      `flow write path escapes the repo root: ${targetPath}`,
      `Write inside the repository (e.g. ${FLOWS_DIR}/${opts.slug}.json).`,
    );
  }

  const resolved = resolveFlowSchema(
    { type: opts.type, schemaPath: opts.schemaPath, repoRoot },
    { fs: deps.fs },
  );
  if (!resolved.ok) {
    return fail(resolved.code, resolved.message, resolved.next_action);
  }

  const template = resolveTemplate(opts, deps);
  if ('ok' in template) return template; // a FlowFailure

  const createdAt = deps.clock.nowIso();
  const provenance: FlowProvenance = {
    record_kind: FLOW_RECORD_KIND,
    harness_version: opts.harnessVersion,
    branch: deps.git.currentBranch(),
    repo: deps.git.remoteUrl(),
    created_at: createdAt,
    // Explicit-only (AC-5; companion HIGH): omitted → null (the rail then uses the slug
    // fallback). The flow's agent identity is set by whoever CREATES it (the-flow passes
    // `--agent the-flow`) — NOT inherited from the model-runtime env, which would leak the
    // model name (e.g. `claude-opus`) into the rail title.
    agent: opts.agent ?? null,
    plan_id: opts.planId ?? null,
  };

  const ids = new Set(template.nodes.map((n) => n.id));
  const initialNow =
    template.cursor !== undefined && ids.has(template.cursor)
      ? template.cursor
      : template.nodes[0]?.id;

  const doc: FlowDoc = {
    schema_version: resolved.schema.schemaVersionMajor,
    kind: resolved.schema.kind,
    slug: opts.slug,
    // Seed nav from the template's initial node; a bare/no-node flow starts nav-less
    // (position can't reference a node that doesn't exist — nav stays absent, graceful).
    ...(initialNow !== undefined ? { nav: { now: initialNow, next: null } } : {}),
    created_at: createdAt,
    provenance,
    events: [],
    nodes: template.nodes,
  };
  if (opts.title !== undefined && opts.title.length > 0) doc.title = opts.title;
  // The `created` (CRT) built-in event — the flow's first audit fact (ws-002 §E2).
  doc.events.push(
    buildBuiltinEvent('created', { kind: doc.kind, slug: doc.slug }, doc.events, deps.clock),
  );

  const issues = validateFlowDoc(doc, resolved.schema);
  if (issues.length > 0) {
    return fail(
      ErrorCodes.FLOW_SCHEMA_INVALID,
      `the created flow failed schema validation: ${issues.join('; ')}`,
      'The resolved template/schema produced an invalid flow — fix the template or pass --bare.',
    );
  }

  const written = writeFlowAtomic(targetPath, repoRoot, doc, deps);
  if (!written.ok) return written;
  return { ok: true, path: written.path, doc };
}

// ---------------------------------------------------------------------------
// new — scaffold a custom flow-type schema overlay.
// ---------------------------------------------------------------------------

export interface NewFlowSchemaOptions {
  type: string;
  repoRoot: string;
  force?: boolean;
}

/** A minimal custom overlay skeleton (extends shared-core; declares its own vocab). */
function overlaySkeleton(type: string): string {
  const skeleton = {
    kind: type,
    extends: 'flow-core',
    schema_version: 1,
    description: `Custom flow overlay for "${type}". Declares its status vocabulary + node types; extends the shared flow-core field shape.`,
    statuses: ['assumed', 'known', 'in_progress', 'done', 'blocked'],
    nodeTypes: ['start', 'step', 'decision', 'end'],
  };
  return `${JSON.stringify(skeleton, null, 2)}\n`;
}

/**
 * `flow new <type>` — scaffold `.harness/schemas/flows/<type>.schema.json` so a
 * repo can author a custom flow type. Name-validated; refuses to clobber unless
 * `--force`.
 */
export function newFlowSchema(
  opts: NewFlowSchemaOptions,
  deps: FlowServiceDeps,
): { ok: true; path: string } | FlowFailure {
  if (!TYPE_NAME_RE.test(opts.type)) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `invalid flow type name: "${opts.type}"`,
      'Use a lowercase, hyphenated name (e.g. my-flow): /^[a-z][a-z0-9-]*$/.',
    );
  }
  const repoRoot = toPosix(opts.repoRoot);
  const target = posixJoin(repoRoot, SCHEMAS_DIR, `${opts.type}.schema.json`);
  if (deps.fs.exists(target) && !opts.force) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `a flow schema already exists at ${target}.`,
      'Pass --force to overwrite, or pick a different type name.',
    );
  }
  try {
    deps.fs.mkdirp(posixDirname(target));
    deps.fs.writeText(target, overlaySkeleton(opts.type));
  } catch (err) {
    return fail(
      ErrorCodes.FLOW_WRITE_FAILED,
      `failed to write schema ${target}: ${err instanceof Error ? err.message : String(err)}`,
      'Check directory permissions, then retry.',
    );
  }
  return { ok: true, path: target };
}

// ---------------------------------------------------------------------------
// show / list (read-only).
// ---------------------------------------------------------------------------

/** `flow show` — read a single flow by explicit path (read-only). */
export function showFlow(
  path: string,
  deps: FlowServiceDeps,
): { ok: true; path: string; doc: FlowDoc } | FlowFailure {
  const read = readFlowDoc(path, deps);
  if (!read.ok) return read;
  return { ok: true, path: toPosix(path), doc: read.doc };
}

export interface FlowSummary {
  slug: string;
  kind: string;
  now: string | null;
  path: string;
}

/**
 * `flow list` — discover flow files under `.harness/flows/` (or `--dir`) and
 * summarise each. Legacy/malformed files are skipped (tolerant — listing never
 * fails on one bad file).
 */
export function listFlows(
  opts: { repoRoot: string; dir?: string },
  deps: FlowServiceDeps,
): { ok: true; flows: FlowSummary[] } {
  const dir = opts.dir ? toPosix(opts.dir) : posixJoin(toPosix(opts.repoRoot), FLOWS_DIR);
  const flows: FlowSummary[] = [];
  for (const name of deps.fs.readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    const read = readFlowDoc(posixJoin(dir, name), deps);
    if (!read.ok) continue;
    const doc = read.doc;
    flows.push({
      slug: typeof doc.slug === 'string' ? doc.slug : name.replace(/\.json$/, ''),
      kind: typeof doc.kind === 'string' ? doc.kind : 'unknown',
      now: typeof doc.nav?.now === 'string' ? doc.nav.now : null,
      path: posixJoin(dir, name),
    });
  }
  return { ok: true, flows };
}
