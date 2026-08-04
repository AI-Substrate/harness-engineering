import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixJoin, resolveInRepo, toPosix } from '../shared/posix-path.js';
import {
  buildBuiltinEvent,
  ddLinkOf,
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
/**
 * The env var `provenance.plan_id` falls back to when `--plan-id` is omitted (089). The same
 * var is resolved by the telemetry capture path; there is deliberately NO sibling constant for
 * `HARNESS_AGENT` — `provenance.agent` stays explicit-only (see `createFlow`).
 */
const PLAN_ID_ENV = 'HARNESS_PLAN_ID';

/** An env value, treating unset/blank/whitespace-only alike as absent → `null` (never `''`). */
function envOrNull(value: string | undefined): string | null {
  return value !== undefined && value.trim().length > 0 ? value : null;
}

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
    // Both sides of the comparison are named, deliberately. On macOS `/var` is a
    // symlink to `/private/var`, so a temp-dir path and the process's own resolved
    // cwd can look identical to a reader and still fail containment — naming only
    // the rejected path leaves no way to see why.
    return fail(
      ErrorCodes.FLOW_PATH_ESCAPE,
      `flow write path escapes the repo root: ${p} is not inside ${root}`,
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
  /**
   * `--plan-dir` — the repo-relative plan folder this flow belongs to.
   *
   * Recorded on the root, and used to ANCHOR the template's relative `dd_link`
   * addresses at the folder (see `anchorDdLinks`). Absent ⇒ nothing is recorded
   * and no address is touched, so every existing flow and template is unaffected.
   */
  planDir?: string;
  /**
   * `--agent` — stamp `provenance.agent` (D-06 fix). **The only source**: there is deliberately
   * NO `HARNESS_AGENT` fallback (026 AC-5 / companion HIGH — the env carries the model name in
   * an agent runtime and it would surface in the rail title). Omitted → `null`.
   */
  agent?: string;
  /** `--plan-id` — stamp `provenance.plan_id`; wins over the `HARNESS_PLAN_ID` fallback (089). */
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
/**
 * `--plan-dir`, normalized: repo-relative POSIX, no leading or trailing slash,
 * or `null` when absent/empty.
 *
 * An absolute path is refused by returning `null` rather than by failing the
 * create: the option exists to anchor addresses INSIDE the repository, and a
 * machine-specific absolute prefix baked into a committed flow is worse than no
 * prefix at all — a flow whose gates only resolve on one laptop.
 */
function normalizePlanDir(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const posix = toPosix(raw).trim();
  // Absoluteness is checked BEFORE any stripping — stripping a leading `/` first
  // would silently turn `/Users/someone/repo/docs/plans/x` into a plausible-looking
  // relative path and bake it in, which is the exact outcome this guard exists to
  // prevent.
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return null;
  const trimmed = posix.replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Anchor a template's RELATIVE `dd_link` addresses at the plan folder (ac-7110).
 *
 * A flight-plan template is static: it is authored once, shipped in `skills/`, and
 * cannot know which plan folder it will be instantiated into. But a flow's
 * `dd_link.address` is REPO-ROOT anchored (`fromPath: null`, key finding F8) —
 * which is why ac-7113 has the archive step rewrite them. So the template writes
 * what it can know, `assets/tasks/phase-1/tasks.dd.json#tasks`, and create
 * prefixes the folder it is being instantiated into.
 *
 * Doing it HERE rather than in prompt-ware is the whole point. A gate address
 * assembled by a model is a gate that fails silently the day the model
 * paraphrases, and mechanical refusal is precisely what this surface is for.
 *
 * ABSOLUTE-shaped addresses are left ALONE — an address already anchored at the
 * repo root means what it says, and prefixing it would break a template that
 * deliberately gates on something outside its own folder.
 */
function anchorDdLinks(nodes: readonly FlowNode[], planDir: string): FlowNode[] {
  return nodes.map((node) => {
    const link = ddLinkOf(node);
    if (link === undefined || typeof link.address !== 'string') return node;
    const anchored = anchorAddress(link.address, planDir);
    return anchored === link.address ? node : { ...node, dd_link: { ...link, address: anchored } };
  });
}

/** Prefix one address, unless it is already repo-root anchored. */
function anchorAddress(address: string, planDir: string): string {
  const trimmed = address.trim();
  if (trimmed.length === 0) return address;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return address;
  if (trimmed.startsWith(`${planDir}/`)) return address;
  return `${planDir}/${trimmed}`;
}

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
    // `agent` is EXPLICIT-ONLY (026 AC-5; companion HIGH): omitted → null (the rail then uses
    // the slug fallback). The flow's agent identity is set by whoever CREATES it (the-flow
    // passes `--agent the-flow`) — NOT inherited from the model-runtime env, which would leak
    // the model name (e.g. `claude-opus`) into the rail title. Do not add an env fallback here.
    agent: opts.agent ?? null,
    // `plan_id` DOES fall back to the env (089) — the deliberate asymmetry with `agent` above.
    // It is an OPAQUE plan identifier, never an identity: it has no rail-title surface, so none
    // of the model-name leak that motivated the companion HIGH applies. Honouring it restores
    // the CLI's own documented interface and matches the telemetry capture path, which already
    // resolves the same var — letting an orchestrator label every flow it creates via the
    // environment, with no knowledge of that orchestrator anywhere in the harness.
    plan_id: opts.planId ?? envOrNull(deps.env.get(PLAN_ID_ENV)),
  };

  const ids = new Set(template.nodes.map((n) => n.id));
  const initialNow =
    template.cursor !== undefined && ids.has(template.cursor)
      ? template.cursor
      : template.nodes[0]?.id;

  const planDir = normalizePlanDir(opts.planDir);
  const nodes = planDir === null ? template.nodes : anchorDdLinks(template.nodes, planDir);

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
    nodes,
  };
  if (planDir !== null) doc.plan_dir = planDir;
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
