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

/**
 * The last COMPUTED gate reading, recorded on the node at gate-evaluation time
 * (plan 065 P6 T005).
 *
 * It exists for exactly one reason: the flow renderer is PURE — it takes a
 * `FlowDoc` and returns markdown, with no filesystem, no schema resolution and no
 * dd document loading. A gate badge that had to resolve an address at render time
 * would make the renderer an I/O consumer, so the reading is stored where the
 * renderer can already see it.
 *
 * **It is display/record only, and never gate truth** (PM ruling, 2026-08-04).
 * The gate RE-EVALUATES live on every mutation: a recorded `complete` must not let
 * a now-incomplete gate pass, and a recorded `incomplete` must not block a
 * now-complete departure. Read this to SHOW what was last computed; never to
 * DECIDE. `basis_sha` is its honesty check — when the target document has moved
 * since `at`, `orient` says so instead of trusting the cache.
 */
export interface DdLinkReading {
  /** Whether every collected item was gate-terminal at `at`. */
  status: 'complete' | 'incomplete';
  /** How many items were gate-terminal. */
  terminal: number;
  /** How many items were collected in total. */
  total: number;
  /** The ids of the items that were NOT gate-terminal, in document order. */
  incomplete: string[];
  /** ISO-8601 UTC instant the reading was computed (Clock.nowIso()). */
  at: string;
}

/**
 * A node's link to the dd document section whose completion it gates on (plan 065
 * P6; workshop-002 Ruling 1, AC-10/AC-11).
 *
 * **Opt-in, absolutely.** A node WITHOUT `dd_link` behaves exactly as it did
 * before this field existed — no resolution, no evaluation, no refusal, no new
 * event, byte-identical output. That is the whole mitigation for putting the
 * repo's first mechanical gate into the machinery every existing flow already
 * runs on, and it is regression-pinned by test.
 *
 * Two authored keys and two machine-recorded ones:
 *   - AUTHORED: `address` (the dd address whose items must be gate-terminal) and
 *     `gate` (whether that link actually gates departure, or is a plain reference).
 *   - RECORDED: `basis_sha` + `reading`, both written by the gate evaluation and
 *     never by hand.
 */
export interface DdLink {
  /** The dd address this node gates on, e.g. `tasks/phase-2/tasks.dd.json#tasks`. */
  address: string;
  /**
   * Whether departure from this node is GATED on that address being complete.
   * Absent is treated as `true`: a node that carries a link to its evidence and
   * says nothing else means the link to gate — declaring `gate: false` is how an
   * author keeps the address as a plain, surfaced reference.
   */
  gate?: boolean;
  /** The target document's content sha recorded at the last gate evaluation. */
  basis_sha?: string;
  /** The last computed reading — display/record only (see {@link DdLinkReading}). */
  reading?: DdLinkReading;
}

/**
 * The node's `dd_link`, or `undefined` when it carries nothing usable (P6 review
 * F007).
 *
 * F004 hardened the *contents* of a link against a hand-edited document. F007 is
 * the same threat one level up: the FIELD itself. `dd_link: null` passes flow
 * validation (the overlay only says which keys may appear), reaches every read
 * surface as a value that is `!== undefined`, and throws on the first property
 * access — so a single hand-edited character bricked `render`, the rail, `orient`
 * and `nav set` at once. A gate that crashes the commands you would use to
 * diagnose it is worse than a gate that refuses.
 *
 * So every surface asks THIS instead of touching `node.dd_link`, and the answer for
 * anything that is not a plain object is the same as for a node that never had a
 * link: clean absence. That is honest — a `null` link expresses no address, gates
 * nothing, and has nothing to badge. Authored garbage is still REFUSED on the way
 * in (`badDdLink` → `E108`); this is purely about surviving what is already on disk.
 *
 * An empty-string `address` is deliberately NOT filtered here: that is a real link
 * with a broken address, and `E449` exists to say so.
 */
export function ddLinkOf(node: { dd_link?: DdLink }): DdLink | undefined {
  const link: unknown = node.dd_link;
  if (link === null || typeof link !== 'object' || Array.isArray(link)) return undefined;
  return link as DdLink;
}

/** Whether a link gates departure — absent `gate` means gated (see {@link DdLink}). */
export function ddLinkGates(link: DdLink | undefined): link is DdLink {
  return link !== undefined && link !== null && link.gate !== false;
}

/**
 * A recorded reading's counts, ONLY if they are counts (P6 review F004).
 *
 * `DdLinkReading` says `terminal: number`, but a `FlowDoc` is JSON read off disk —
 * the type is a promise the file never made. `dd_link` reaches the document through
 * `apply --ops` and through anyone with an editor, and both halves of the reading
 * are interpolated straight into a mermaid node label and a rail line. A `total` of
 * `1"] --> EVIL["pwned` is not a display bug; it is a writable diagram.
 *
 * So the counts are TRUSTED NOWHERE and re-checked at every boundary they cross:
 * two non-negative safe integers, or nothing at all. Narrowing to integers is
 * stronger than escaping, because an integer has no representation that can carry
 * syntax. `null` means "no usable reading", which every caller already renders as
 * `not yet evaluated` — the honest answer for a reading that cannot be read.
 */
export function readingCounts(
  reading: DdLinkReading | undefined,
): { terminal: number; total: number } | null {
  if (reading === undefined || reading === null || typeof reading !== 'object') return null;
  const { terminal, total } = reading;
  if (!isCount(terminal) || !isCount(total)) return null;
  return { terminal, total };
}

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * Normalize an untrusted `dd_link` at the MUTATION boundary (P6 review F004).
 *
 * Two key classes, two answers, matching who owns them:
 *   - AUTHORED (`address`, `gate`) — a human wrote these, so a malformed one is
 *     REFUSED by the caller and said out loud. `null` here means "reject the op".
 *   - RECORDED (`basis_sha`, `reading`) — the gate wrote these, and they are
 *     display-only. A malformed one is DROPPED rather than refused: it is not a
 *     claim anyone made, the gate re-derives it live on the next departure, and the
 *     surfaces already have an honest rendering for its absence. Dropping loses a
 *     stale badge; keeping it risks rendering an attacker's syntax.
 */
export function sanitizeDdLink(raw: unknown): DdLink | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.address !== 'string' || src.address.trim().length === 0) return null;
  if (src.gate !== undefined && typeof src.gate !== 'boolean') return null;

  const link: DdLink = { address: src.address };
  if (src.gate !== undefined) link.gate = src.gate;
  if (typeof src.basis_sha === 'string' && /^[0-9a-f]{4,128}$/i.test(src.basis_sha)) {
    link.basis_sha = src.basis_sha;
  }
  const reading = sanitizeReading(src.reading);
  if (reading !== null) link.reading = reading;
  return link;
}

/** A recorded reading, or `null` when any part of it is not what it claims to be. */
function sanitizeReading(raw: unknown): DdLinkReading | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (src.status !== 'complete' && src.status !== 'incomplete') return null;
  if (!isCount(src.terminal) || !isCount(src.total)) return null;
  if (!Array.isArray(src.incomplete) || src.incomplete.some((i) => typeof i !== 'string')) {
    return null;
  }
  if (typeof src.at !== 'string') return null;
  return {
    status: src.status,
    terminal: src.terminal,
    total: src.total,
    incomplete: [...(src.incomplete as string[])],
    at: src.at,
  };
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
  /**
   * Authored + runtime guidance for this node (plan 040 D4) — the "static bone".
   * Round-trips through every mutation; `orient` prints the full text; a `📝N` badge
   * marks presence in the render (P3). The text NEVER appears in the diagram.
   */
  instructions?: string[];
  /** Forward-compat (Finding 02b): `cursor | substrate`, default `cursor`, unused in v1. */
  authority?: string;
  /** Rail band: `preflight | flight | postflight` (ws-002); unset → defaulted by type. */
  zone?: string;
  /** The command / ref this node runs (e.g. a slash-command). Settable via `--command` (Phase 4). */
  command?: string;
  /** Orthogonal chore marker (Phase 4) — presence flags the node as upkeep. */
  chore?: Chore;
  /**
   * The dd document section whose completion gates departure from this node
   * (plan 065 P6). ABSENT ⇒ zero behaviour change — the opt-in contract.
   */
  dd_link?: DdLink;
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
