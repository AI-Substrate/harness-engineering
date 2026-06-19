import type { Clock } from '../../adapters/clock/clock-port.js';
import type { ProvenanceFields } from '../record/provenance.js';

/**
 * Flow data model + the embedded event/comment surfaces (plan 024 Phase 1;
 * AC-04/05; workshop 002 §E1–E8). PURE — no I/O, no `node:*`, no `new Date()`;
 * every timestamp comes from the injected `Clock`.
 *
 * This module is the dependency LEAF of the flow service: it owns the shared
 * `FlowDoc` types and the constructors for the two timestamped surfaces —
 *   - root `events[]` (flow-scoped machine facts: built-in / manual / custom), and
 *   - per-node `comments[]` (node-scoped narrative).
 * `flow-service.ts` and `flow-mutations.ts` import these types + builders; this
 * file imports neither, so the graph stays acyclic.
 */

// ---------------------------------------------------------------------------
// Shared flow document types (the shared-core node field set — Context Brief).
// ---------------------------------------------------------------------------

/** A node-scoped narrative entry — append-only, immutable (ws-002 §E7). */
export interface FlowComment {
  /** ISO-8601 UTC instant (Clock.nowIso()) — REQUIRED. */
  at: string;
  /** The comment text — REQUIRED. */
  text: string;
  /** Who said it: `user | agent | system`. */
  source?: string;
  /** Suggested set `note | decision | warning | validation` (open — tolerant). */
  kind?: string;
  /** Commits / artifact paths this comment references. */
  refs?: string[];
}

/** A flow-scoped, append-only, immutable event (ws-002 §E1/E2/E3). */
export interface FlowEvent {
  /** `<PREFIX>-<NNN>` (per-prefix monotonic; observe id format). */
  id: string;
  /** `created | cursor-moved | … | build-run | custom | …` (open vocabulary). */
  kind: string;
  /** `engine` (built-in side effect) | `manual` (deliberate / custom). */
  origin: 'engine' | 'manual';
  /** ISO-8601 UTC instant the event fired. */
  fired_at: string;
  /** Human-readable summary (optional for built-ins; carries the manual payload). */
  description?: string;
  /** Structured payload (e.g. `{from,to}` for cursor-moved; `edge_op` for splices). */
  details?: Record<string, unknown>;
  /** Custom-event free name (the metric key). */
  name?: string;
  /** The duck-typed value class (`bool|int|float|date|string`) — stored explicitly. */
  type?: string;
  /** The parsed value for a custom event. */
  value?: unknown;
}

/**
 * Root provenance — the record 7-key block (ws-002 §E5), stamped ONCE at create.
 * REUSES `services/record/provenance.ts` `ProvenanceFields` directly (Finding 04;
 * companion anti-reinvention finding) so the shape can never drift from the record
 * service's. Type-only import — no runtime coupling. The JSON-object provenance
 * here cannot use the markdown-specific `spliceProvenance`, so only the TYPE is
 * shared; `branch` IS the user's requested `created_from_branch`.
 */
export type FlowProvenance = ProvenanceFields;

/**
 * An orthogonal **chore** marker (plan 024 Phase 4; ws-004 C1–C3). Presence on a
 * node flags it as cross-cutting upkeep (compact / validate / a loop seam) without
 * changing the node `type`. Carries WHAT to run (`kind` + the node's `command` ref)
 * and HOW STRONGLY it is advised (`importance`). Advisory only — there is no
 * `required` importance and `importance` NEVER gates (the harness invariant).
 */
export interface Chore {
  /** How the chore is carried out: `skill | command | builtin | manual`. */
  kind: string;
  /** Advisory strength: `strongly-recommended | recommended | optional | informational`. */
  importance: string;
}

/** A single flow node. Overlays add/constrain the `type`/`status` vocabularies. */
export interface FlowNode {
  id: string;
  type: string;
  label: string;
  status: string;
  next: string[];
  branch_of?: string;
  created_at?: string;
  modified_at?: string;
  ran_at?: string;
  /** The genesis directive that created the node (Phase 2's one 🗣 bubble). */
  user_input?: string;
  comments?: FlowComment[];
  /** Output artifacts produced at this node (files/paths) — drives the `📄N` badge + body-log. */
  artifacts?: string[];
  /** Forward-compat (Finding 02b): `cursor | substrate`, default `cursor`, unused in v1. */
  authority?: string;
  /** Rail band: `preflight | flight | postflight` (ws-002); unset → defaulted by type. */
  zone?: string;
  /** The command / ref this node runs (e.g. a slash-command). Settable via `--command` (Phase 4). */
  command?: string;
  /** Orthogonal chore marker (Phase 4) — presence flags the node as upkeep. */
  chore?: Chore;
  /** Tolerated pass-through fields (agents/output/error/note/…) round-trip. */
  [key: string]: unknown;
}

/**
 * The position object (workshop 002) — the flow's single source of "where am I":
 *   - `now`     the validated current node id (the truth),
 *   - `next`    an advisory next node id, or `null` (the LLM dispatches; the CLI never routes),
 *   - `intent`  a free-text statement of what this leg is for,
 *   - `bag`     a free-form, shallow qualifier map (NO schema — D7).
 * Replaces the pre-migration top-level `cursor`/`recommended_next` (clean break).
 */
export interface Nav {
  now: string;
  next: string | null;
  intent?: string;
  bag?: Record<string, unknown>;
}

/** The whole flow document — the canonical state `the-flow.json` shape. */
export interface FlowDoc {
  schema_version: number;
  kind: string;
  slug: string;
  /** Position + intent + bag (workshop 002). Absent on a bare/uninitialised flow. */
  nav?: Nav;
  created_at: string;
  provenance: FlowProvenance;
  events: FlowEvent[];
  nodes: FlowNode[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Event ids — reuse observe's `<PREFIX>-<NNN>` format (ws-002 §E6).
// ---------------------------------------------------------------------------

/** Built-in (engine) event kind → id prefix (ws-002 §E2). */
const BUILTIN_PREFIX: Record<string, string> = {
  created: 'CRT',
  'cursor-moved': 'CUR',
  'status-changed': 'STA',
  'node-created': 'NOD',
  'node-updated': 'UPD',
};

/** Known public-manual kinds → prefix; unknown manual kinds derive one (ws-002 §E6). */
const MANUAL_PREFIX: Record<string, string> = {
  'build-run': 'BLD',
  'test-run': 'TST',
  deploy: 'DEP',
  checkpoint: 'CHK',
  gate: 'GAT',
  custom: 'CUS',
};

/** Derive a 3-letter uppercase prefix from an arbitrary kind (manual fallback). */
function derivePrefix(kind: string): string {
  const letters = kind.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'EVT').padEnd(3, 'X');
}

/** The id prefix for a (kind, origin) pair. */
export function prefixFor(kind: string, origin: 'engine' | 'manual'): string {
  if (origin === 'engine') return BUILTIN_PREFIX[kind] ?? derivePrefix(kind);
  return MANUAL_PREFIX[kind] ?? derivePrefix(kind);
}

/**
 * Next monotonic id for `prefix` given the existing events — `<PREFIX>-<NNN>`,
 * `padStart(3)` (observe's `nextId` shape). Per-prefix ordinals; tolerant of
 * non-matching/legacy ids (they don't perturb the max).
 */
export function nextEventId(prefix: string, events: readonly FlowEvent[]): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const e of events) {
    const m = re.exec(e.id);
    if (m?.[1] !== undefined) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Duck-typing for custom events (ws-002 §E3).
// ---------------------------------------------------------------------------

export type ValueType = 'bool' | 'int' | 'float' | 'date' | 'string';

/** ISO-8601 UTC datetime (the `Z` form the CLI stamps). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** Canonical integer — NO leading zeros (so `"007"` stays a string). */
const INT_RE = /^-?(?:0|[1-9]\d*)$/;
/** Fractional / scientific float. */
const FLOAT_RE = /^-?\d+\.\d+(?:[eE]-?\d+)?$/;

/**
 * Duck-type a raw CLI string into `{ type, value }`. `--type` (explicit) wins;
 * otherwise: bool → date → int → float → string, with the leading-zero rule
 * keeping ids/codes as strings. The `type` is persisted so a reader never
 * re-guesses (a `date` stored as an ISO string is not confused with a string).
 */
export function duckTypeValue(
  raw: string,
  explicitType?: string,
): { type: ValueType; value: boolean | number | string } {
  if (explicitType !== undefined && explicitType.length > 0) {
    return coerce(raw, explicitType as ValueType);
  }
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === 'false') return { type: 'bool', value: lower === 'true' };
  if (ISO_UTC.test(raw)) return { type: 'date', value: raw };
  if (INT_RE.test(raw)) return { type: 'int', value: Number.parseInt(raw, 10) };
  if (FLOAT_RE.test(raw)) return { type: 'float', value: Number.parseFloat(raw) };
  return { type: 'string', value: raw };
}

/** Coerce a raw string to an explicitly-requested type (`--type` override). */
function coerce(
  raw: string,
  type: ValueType,
): { type: ValueType; value: boolean | number | string } {
  switch (type) {
    case 'bool':
      return { type, value: raw.toLowerCase() === 'true' };
    case 'int':
      return { type, value: Number.parseInt(raw, 10) };
    case 'float':
      return { type, value: Number.parseFloat(raw) };
    default:
      // date + string both persist the raw string verbatim.
      return { type, value: raw };
  }
}

// ---------------------------------------------------------------------------
// Constructors — the only place events/comments are minted.
// ---------------------------------------------------------------------------

/** Build a built-in (engine-fired) event for a mutation side effect. */
export function buildBuiltinEvent(
  kind: keyof typeof BUILTIN_PREFIX | string,
  details: Record<string, unknown>,
  events: readonly FlowEvent[],
  clock: Clock,
): FlowEvent {
  return {
    id: nextEventId(prefixFor(kind, 'engine'), events),
    kind,
    origin: 'engine',
    fired_at: clock.nowIso(),
    details,
  };
}

/** Build a public-manual event (`build-run`, `test-run`, …) — deliberate, open vocabulary. */
export function buildManualEvent(
  kind: string,
  events: readonly FlowEvent[],
  clock: Clock,
  opts?: { description?: string; details?: Record<string, unknown> },
): FlowEvent {
  return {
    id: nextEventId(prefixFor(kind, 'manual'), events),
    kind,
    origin: 'manual',
    fired_at: clock.nowIso(),
    ...(opts?.description !== undefined && { description: opts.description }),
    ...(opts?.details !== undefined && { details: opts.details }),
  };
}

/** Build a custom telemetry event — duck-typed value, `type` stored explicitly. */
export function buildCustomEvent(
  name: string,
  raw: string,
  events: readonly FlowEvent[],
  clock: Clock,
  explicitType?: string,
): FlowEvent {
  const { type, value } = duckTypeValue(raw, explicitType);
  return {
    id: nextEventId(prefixFor('custom', 'manual'), events),
    kind: 'custom',
    origin: 'manual',
    fired_at: clock.nowIso(),
    name,
    type,
    value,
  };
}

/** Build a node comment — `at` stamped from the Clock; `text` required. */
export function buildComment(
  text: string,
  clock: Clock,
  opts?: { source?: string; kind?: string; refs?: string[] },
): FlowComment {
  return {
    at: clock.nowIso(),
    text,
    ...(opts?.source !== undefined && { source: opts.source }),
    ...(opts?.kind !== undefined && { kind: opts.kind }),
    ...(opts?.refs !== undefined && { refs: opts.refs }),
  };
}
