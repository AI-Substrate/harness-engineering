import type { Clock } from '../../adapters/clock/clock-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import {
  buildBuiltinEvent,
  buildComment,
  type Chore,
  type FlowDoc,
  type FlowNode,
  type Nav,
} from './flow-events.js';
import { type FlowFailure, fail } from './flow-service.js';

/**
 * Flow mutations (plan 024 Phase 1; AC-04/05/15; ws-002 §E2 + ws-003 I2–I4) —
 * `cursor`/`status`/`add-node`/`set-node`/`comment` + `insert-node`. PURE: each
 * operates on a deep CLONE of the doc and returns the mutated copy (so a rejected
 * mutation — e.g. an `insert-node` that fails the DAG re-check — leaves the
 * caller's doc untouched and NOTHING is written). Every mutation auto-fires its
 * built-in event + stamps `modified_at` (and `ran_at` on →done/→blocked). The
 * status VALUE's validity vs the overlay vocabulary is enforced by the act's
 * post-mutation `validateFlowDoc`; mutations only enforce node existence (E305)
 * and the edge algebra — matching grill decision (2): no external enforcement of
 * "good" usage, only mechanical integrity.
 */

export interface MutationDeps {
  clock: Clock;
}

export type MutationResult = { ok: true; doc: FlowDoc } | FlowFailure;

/** The two write-time statuses that stamp `ran_at` (ws-002 §E5/state machine). */
const RAN_AT_STATUSES = new Set(['done', 'blocked']);

function clone(doc: FlowDoc): FlowDoc {
  return structuredClone(doc);
}

function findNode(doc: FlowDoc, id: string): FlowNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

function nodeNotFound(id: string): FlowFailure {
  return fail(
    ErrorCodes.FLOW_NODE_INVALID,
    `no node with id "${id}" in this flow.`,
    'Use `harness flow show` to list node ids, or `harness flow add-node` to create it.',
  );
}

// ---------------------------------------------------------------------------
// nav — position (now/next), intent, and the free-form meta bag (ws-002).
// ---------------------------------------------------------------------------

/** Read (or seed) the nav object on the CLONED doc — callers always pass a clone. */
function navOf(doc: FlowDoc): Nav {
  if (doc.nav === undefined) doc.nav = { now: '', next: null };
  return doc.nav;
}

/** `flow nav set --now X` — move position, firing `cursor-moved {from,to}` (reuses the ws-002 kind). */
export function setNow(doc: FlowDoc, to: string, deps: MutationDeps): MutationResult {
  const next = clone(doc);
  if (findNode(next, to) === undefined) return nodeNotFound(to);
  const nav = navOf(next);
  const from = nav.now;
  nav.now = to;
  next.events.push(buildBuiltinEvent('cursor-moved', { from, to }, next.events, deps.clock));
  return { ok: true, doc: next };
}

/**
 * `flow nav set --next X | --clear-next` — set the advisory next (validated when an
 * id is given — E305) or clear it to `null`. Advisory pointer, NOT a transition →
 * no built-in event (ws-002 §E2 has none), matching the pre-migration `recommendNext`.
 */
export function setNext(doc: FlowDoc, to: string | null, deps: MutationDeps): MutationResult {
  const next = clone(doc);
  if (to !== null && findNode(next, to) === undefined) return nodeNotFound(to);
  navOf(next).next = to;
  void deps;
  return { ok: true, doc: next };
}

/** `flow nav set --intent "<t>"` — set the leg's intent. Metadata, not a transition → no event. */
export function setIntent(doc: FlowDoc, intent: string, deps: MutationDeps): MutationResult {
  const next = clone(doc);
  navOf(next).intent = intent;
  void deps;
  return { ok: true, doc: next };
}

/**
 * `flow nav meta set <k> <v>` — shallow-merge one key into `nav.bag`, preserving the
 * other keys (D7: free-form, no schema). Metadata, not a transition → no event.
 */
export function setMeta(
  doc: FlowDoc,
  key: string,
  value: unknown,
  deps: MutationDeps,
): MutationResult {
  const next = clone(doc);
  const nav = navOf(next);
  nav.bag = { ...(nav.bag ?? {}), [key]: value };
  void deps;
  return { ok: true, doc: next };
}

/** Read the meta bag — a single key, or the whole bag when no key is given (read, not a mutation). */
export function getMeta(doc: FlowDoc, key?: string): unknown {
  const bag = doc.nav?.bag ?? {};
  return key === undefined ? bag : bag[key];
}

// ---------------------------------------------------------------------------
// neighbours — the shared edge scan (Finding 04; reused by insert-node's
// --before splice, `nav show`, and `rail`).
// ---------------------------------------------------------------------------

/** Nodes that point AT `id` (its predecessors) — the reverse-edge scan. */
export function predecessorsOf(nodes: readonly FlowNode[], id: string): FlowNode[] {
  return nodes.filter((n) => (Array.isArray(n.next) ? n.next : []).includes(id));
}

/** Nodes `id` points at (its successors) — resolves `id`'s `next[]` to nodes. */
export function successorsOf(nodes: readonly FlowNode[], id: string): FlowNode[] {
  const node = nodes.find((n) => n.id === id);
  const outs = node && Array.isArray(node.next) ? node.next : [];
  return outs
    .map((t) => nodes.find((n) => n.id === t))
    .filter((n): n is FlowNode => n !== undefined);
}

/** A trimmed neighbour view for `nav show` (ws-002: don't over-fetch). */
export interface NavNeighbour {
  id: string;
  type: string;
  status: string;
  label: string;
  next: string[];
}

function trimNeighbour(n: FlowNode): NavNeighbour {
  return {
    id: n.id,
    type: n.type,
    status: n.status,
    label: n.label,
    next: Array.isArray(n.next) ? n.next : [],
  };
}

export interface NavShow {
  nav: Nav | null;
  predecessors: NavNeighbour[];
  successors: NavNeighbour[];
  /** Chores anchored at `nav.now` still outstanding (status ∉ {done, skipped}) — the "due here" read. */
  due_chores: ChoreRow[];
}

/**
 * `flow nav show` — the position read: the `nav` object (or `null` when the doc
 * carries none — graceful, never an error) plus the `now` node's trimmed
 * neighbours. A read, not a mutation (no clone, no event).
 */
export function navShow(doc: FlowDoc): NavShow {
  const nav = doc.nav ?? null;
  const now = nav?.now ?? '';
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const has = now.length > 0 && nodes.some((n) => n.id === now);
  return {
    nav,
    predecessors: has ? predecessorsOf(nodes, now).map(trimNeighbour) : [],
    successors: has ? successorsOf(nodes, now).map(trimNeighbour) : [],
    due_chores: dueChores(doc),
  };
}

// ---------------------------------------------------------------------------
// chores — the read-model for `harness flow chores` (Phase 4; ws-004).
// ---------------------------------------------------------------------------

/** Kinds an agent can invoke directly; `builtin`/`manual` are noted "agent can't run". */
const AGENT_RUNNABLE_KINDS = new Set(['skill', 'command']);

/** One row of the `harness flow chores` listing — a chore node projected to its essentials. */
export interface ChoreRow {
  id: string;
  label: string;
  status: string;
  kind: string;
  importance: string;
  /** The command/ref the chore runs (`node.command`), or `null`. */
  command: string | null;
  /** Where it sits: its `branch_of` (excursion) else its first predecessor, else `null`. */
  anchor: string | null;
  /** Whether an agent can run it directly (`skill`/`command`); `false` for `builtin`/`manual`. */
  runnable: boolean;
}

/**
 * `flow chores` — list every node carrying a `chore` marker, in document order
 * (a READ: no clone, no event). Each row carries the chore's kind/importance, its
 * status, the node's `command` ref, an `anchor` (its `branch_of` or first
 * predecessor — "where does this upkeep sit?"), and whether an agent can run it.
 * When `at` is given, only chores anchored at that node id are returned (the
 * position-aware "what's due at <node>?" read; `flow chores --at`).
 */
export function listChores(doc: FlowDoc, at?: string): ChoreRow[] {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const rows: ChoreRow[] = [];
  for (const n of nodes) {
    if (n.chore === undefined) continue;
    const anchor =
      typeof n.branch_of === 'string' && n.branch_of.length > 0
        ? n.branch_of
        : (predecessorsOf(nodes, n.id)[0]?.id ?? null);
    rows.push({
      id: n.id,
      label: n.label ?? n.id,
      status: n.status,
      kind: n.chore.kind,
      importance: n.chore.importance,
      command: typeof n.command === 'string' ? n.command : null,
      anchor,
      runnable: AGENT_RUNNABLE_KINDS.has(n.chore.kind),
    });
  }
  return at === undefined ? rows : rows.filter((r) => r.anchor === at);
}

/**
 * The "due here" read: chores anchored at the current `nav.now` whose status is
 * still outstanding (`∉ {done, skipped}`). Empty when there is no position or no
 * such chore. Surfaced in `nav show` (`due_chores`) so a driver can deterministically
 * see which upkeep belongs to the node it is on — anchored chores become checks, not
 * floating decorations.
 */
export function dueChores(doc: FlowDoc): ChoreRow[] {
  const now = doc.nav?.now;
  if (typeof now !== 'string' || now.length === 0) return [];
  return listChores(doc, now).filter((c) => c.status !== 'done' && c.status !== 'skipped');
}

// ---------------------------------------------------------------------------
// status.
// ---------------------------------------------------------------------------

/**
 * `flow status --node n --to s` — set a node's status, firing
 * `status-changed {node,from,to}`; always bumps `modified_at`; stamps `ran_at`
 * on a transition to `done`/`blocked` (ws-002 §E5).
 */
export function setStatus(
  doc: FlowDoc,
  nodeId: string,
  toStatus: string,
  deps: MutationDeps,
): MutationResult {
  const next = clone(doc);
  const node = findNode(next, nodeId);
  if (node === undefined) return nodeNotFound(nodeId);
  const from = node.status;
  const now = deps.clock.nowIso();
  node.status = toStatus;
  node.modified_at = now;
  if (RAN_AT_STATUSES.has(toStatus)) node.ran_at = now;
  next.events.push(
    buildBuiltinEvent(
      'status-changed',
      // A chore tick rides the SAME event kind, discriminated by the chore
      // {kind, importance} pair in details (ws-004 C7 — no new event kind), so a
      // log reader can replay upkeep without re-reading the node.
      {
        node: nodeId,
        from,
        to: toStatus,
        ...(node.chore !== undefined && {
          chore: { kind: node.chore.kind, importance: node.chore.importance },
        }),
      },
      next.events,
      deps.clock,
    ),
  );
  return { ok: true, doc: next };
}

// ---------------------------------------------------------------------------
// add-node.
// ---------------------------------------------------------------------------

export interface NodeSpec {
  id: string;
  type: string;
  label: string;
  status: string;
  next?: string[];
  branch_of?: string;
  user_input?: string;
  authority?: string;
  artifacts?: string[];
  zone?: string;
  /** The command/ref this node runs (Phase 4 — wired by `--command`). */
  command?: string;
  /** Orthogonal chore marker (Phase 4 — assembled from `--chore-kind`/`--importance`). */
  chore?: Chore;
}

function materialize(spec: NodeSpec, now: string): FlowNode {
  return {
    id: spec.id,
    type: spec.type,
    label: spec.label,
    status: spec.status,
    next: spec.next ? [...spec.next] : [],
    created_at: now,
    // A new node carries modified_at = created_at so the datetime trio is always
    // queryable (companion HIGH: every node a mutation touches must have it).
    modified_at: now,
    ...(spec.branch_of !== undefined && { branch_of: spec.branch_of }),
    ...(spec.user_input !== undefined && { user_input: spec.user_input }),
    ...(spec.authority !== undefined && { authority: spec.authority }),
    ...(spec.artifacts !== undefined && { artifacts: [...spec.artifacts] }),
    ...(spec.zone !== undefined && { zone: spec.zone }),
    ...(spec.command !== undefined && { command: spec.command }),
    ...(spec.chore !== undefined && { chore: { ...spec.chore } }),
  };
}

/** The closed shared-core zone enum (ws-002); an invalid explicit `--zone` is rejected pre-write. */
const ZONE_VALUES = new Set(['preflight', 'flight', 'postflight']);
function badZone(spec: NodeSpec): FlowFailure | null {
  if (spec.zone !== undefined && !ZONE_VALUES.has(spec.zone)) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `invalid zone "${spec.zone}".`,
      'Use --zone preflight | flight | postflight (or omit it for the type default).',
    );
  }
  return null;
}

/**
 * The shared-core chore vocabularies (Phase 4) — mirrored here for the PRE-WRITE
 * guard, exactly as `ZONE_VALUES` mirrors the zone enum. `validateFlowDoc` is the
 * schema-authoritative check; `badChore` gives a fast, clear `E108` before any
 * write. `required` is intentionally absent from the importances (advisory
 * invariant — a chore can never gate, ws-004 C3).
 */
const CHORE_KINDS = new Set(['skill', 'command', 'builtin', 'manual']);
const CHORE_IMPORTANCES = new Set([
  'strongly-recommended',
  'recommended',
  'optional',
  'informational',
]);
function badChore(spec: NodeSpec): FlowFailure | null {
  if (spec.chore === undefined) return null;
  if (!CHORE_KINDS.has(spec.chore.kind)) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `invalid chore kind "${spec.chore.kind}".`,
      'Use --chore-kind skill | command | builtin | manual (and pass --importance too).',
    );
  }
  if (!CHORE_IMPORTANCES.has(spec.chore.importance)) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `invalid chore importance "${spec.chore.importance}".`,
      'Use --importance strongly-recommended | recommended | optional | informational (there is no "required" — chores are advisory).',
    );
  }
  return null;
}

/**
 * Reject any `next[]` target that names a node not present in `doc` — the
 * dangling-edge guard. Like the nav setters' E305 check, this is a MECHANICAL
 * integrity guard that runs REGARDLESS of schema resolution, so a forward /
 * dangling `--next` is refused even on out-of-repo-schema flows (e.g. the-flow
 * flight plans) where the act's post-mutation `validateFlowDoc` — which also flags
 * dangling refs — is tolerantly skipped. Returns the E305 failure (nothing
 * written) or null. Callers run it once `doc`'s node set reflects what the edge
 * may legitimately point at (add-node: before the new node is pushed, so a forward
 * / self ref is rejected; insert-node: after, so a self-rejoin resolves and is
 * left to the DAG re-check's E309).
 */
function badNext(doc: FlowDoc, targets: readonly string[] | undefined): FlowFailure | null {
  if (targets === undefined) return null;
  for (const target of targets) {
    if (findNode(doc, target) === undefined) return nodeNotFound(target);
  }
  return null;
}

/** `flow add-node` — append a brand-new node, firing `node-created {node,type}`. */
export function addNode(doc: FlowDoc, spec: NodeSpec, deps: MutationDeps): MutationResult {
  const next = clone(doc);
  if (findNode(next, spec.id) !== undefined) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `a node with id "${spec.id}" already exists.`,
      'Pick a unique node id, or use `harness flow set-node` to edit the existing one.',
    );
  }
  const zoneErr = badZone(spec);
  if (zoneErr !== null) return zoneErr;
  const choreErr = badChore(spec);
  if (choreErr !== null) return choreErr;
  // Dangling-edge guard: every --next target must already exist. The new node is
  // not yet pushed, so a forward (or self) ref is rejected → build last-to-first.
  const nextErr = badNext(next, spec.next);
  if (nextErr !== null) return nextErr;
  const now = deps.clock.nowIso();
  next.nodes.push(materialize(spec, now));
  next.events.push(
    buildBuiltinEvent(
      'node-created',
      {
        node: spec.id,
        type: spec.type,
        ...(spec.chore !== undefined && {
          chore: { kind: spec.chore.kind, importance: spec.chore.importance },
        }),
      },
      next.events,
      deps.clock,
    ),
  );
  return { ok: true, doc: next };
}

// ---------------------------------------------------------------------------
// set-node.
// ---------------------------------------------------------------------------

/**
 * `flow set-node` — merge fields into an existing node, firing
 * `node-updated {node,fields}`; bumps `modified_at`. `id` is never reassignable.
 * Status changes should go through `flow status` (which fires `status-changed` +
 * stamps `ran_at`); set-node is the general field editor.
 */
export function setNode(
  doc: FlowDoc,
  nodeId: string,
  fields: Record<string, unknown>,
  deps: MutationDeps,
): MutationResult {
  const next = clone(doc);
  const node = findNode(next, nodeId);
  if (node === undefined) return nodeNotFound(nodeId);
  // Validate chore/zone when set here (mirrors add-node's pre-write guards). This
  // matters for the R-1 path — flagging an existing the-flow seam node as a chore —
  // because the-flow flight plans resolve an out-of-repo schema, so the act's
  // post-mutation validateFlowDoc is tolerantly skipped; without this a bad value
  // would slip through. (A no-op for the field editor's other keys.)
  const zoneErr = badZone({ zone: fields.zone } as NodeSpec);
  if (fields.zone !== undefined && zoneErr !== null) return zoneErr;
  const choreErr = badChore({ chore: fields.chore } as NodeSpec);
  if (fields.chore !== undefined && choreErr !== null) return choreErr;
  // Idempotent no-op (AC-07): if every requested field already equals the node's
  // current value, return the doc UNCHANGED — no `modified_at` restamp, no
  // `node-updated` event. This makes re-flagging an already-correct chore (the
  // R-1 re-injection path) byte-identical. Validation above still runs first.
  const unchanged = Object.entries(fields).every(
    ([key, value]) => key === 'id' || JSON.stringify(node[key]) === JSON.stringify(value),
  );
  if (unchanged) return { ok: true, doc };
  const applied: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id') continue; // identity is immutable
    node[key] = value;
    applied.push(key);
  }
  node.modified_at = deps.clock.nowIso();
  next.events.push(
    buildBuiltinEvent('node-updated', { node: nodeId, fields: applied }, next.events, deps.clock),
  );
  return { ok: true, doc: next };
}

// ---------------------------------------------------------------------------
// comment.
// ---------------------------------------------------------------------------

/**
 * `flow comment` — append a timestamped narrative comment to a node, firing
 * `node-updated {node, fields:['comments']}`. The comment text lives in the
 * node's `comments[]`, not duplicated into the event (ws-002 §E2).
 */
export function addComment(
  doc: FlowDoc,
  nodeId: string,
  text: string,
  deps: MutationDeps,
  opts?: { source?: string; kind?: string; refs?: string[] },
): MutationResult {
  const next = clone(doc);
  const node = findNode(next, nodeId);
  if (node === undefined) return nodeNotFound(nodeId);
  const comment = buildComment(text, deps.clock, opts);
  node.comments = [...(node.comments ?? []), comment];
  node.modified_at = comment.at;
  next.events.push(
    buildBuiltinEvent(
      'node-updated',
      { node: nodeId, fields: ['comments'] },
      next.events,
      deps.clock,
    ),
  );
  return { ok: true, doc: next };
}

// ---------------------------------------------------------------------------
// insert-node — the edge-splicing verb (ws-003 I2–I4; AC-15).
// ---------------------------------------------------------------------------

export interface Placement {
  /** N takes X's OUT-edges: `N.next = old X.next`, `X.next = [N]`. */
  after?: string;
  /** N takes X's IN-edges: every predecessor of X → N, `N.next = [X]`. */
  before?: string;
  /** Excursion: `N.branch_of = X`, `N.next = [X]` (or `--rejoin R`); `X.next` unchanged. */
  branchOf?: string;
  /** Override the branch rejoin target (default = the branch-of node). */
  rejoin?: string;
}

/**
 * DAG re-check: a non-null message names the first cycle (DFS over `next[]`) or
 * a disconnected orphan (a node with no in- or out-edge when >1 node exists).
 * Run AFTER the splice, BEFORE the write — a non-null result → `E309`, nothing
 * written. Exported for direct testing.
 */
export function dagIssue(nodes: FlowNode[]): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  let cycle: string | null = null;

  const visit = (id: string, stack: string[]): boolean => {
    color.set(id, GRAY);
    for (const nx of byId.get(id)?.next ?? []) {
      if (!byId.has(nx)) continue; // dangling ref — a validation concern, not a cycle
      const c = color.get(nx);
      if (c === GRAY) {
        cycle = [...stack, id, nx].join(' -> ');
        return true;
      }
      if (c === WHITE && visit(nx, [...stack, id])) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const n of nodes) {
    if (color.get(n.id) === WHITE && visit(n.id, [])) {
      return `cycle detected: ${cycle}`;
    }
  }

  if (nodes.length > 1) {
    const referenced = new Set<string>();
    for (const n of nodes) {
      for (const nx of n.next ?? []) referenced.add(nx);
      if (typeof n.branch_of === 'string') referenced.add(n.branch_of);
    }
    for (const n of nodes) {
      const hasIn = referenced.has(n.id);
      const hasOut = (n.next?.length ?? 0) > 0 || typeof n.branch_of === 'string';
      if (!hasIn && !hasOut) return `orphan node "${n.id}" (no edges in or out)`;
    }
  }
  return null;
}

/**
 * `flow insert-node` — add a fresh node AND splice the edges for the agent
 * (ws-003: this session inserted nodes by hand 3×; insert-node makes it
 * first-class). Exactly one of `--after`/`--before`/`--branch-of` (else `E108`);
 * the target must exist (`E305`). Fires `node-created` + one `node-updated`
 * `{edge_op}` per rewired edge; re-checks the DAG before returning — a cycle/
 * orphan → `E309` with the doc untouched.
 */
export function insertNode(
  doc: FlowDoc,
  spec: NodeSpec,
  placement: Placement,
  deps: MutationDeps,
): MutationResult {
  const next = clone(doc);
  if (findNode(next, spec.id) !== undefined) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `a node with id "${spec.id}" already exists.`,
      'Pick a unique node id for the inserted node.',
    );
  }
  const zoneErr = badZone(spec);
  if (zoneErr !== null) return zoneErr;
  const choreErr = badChore(spec);
  if (choreErr !== null) return choreErr;

  const now = deps.clock.nowIso();
  const node = materialize(spec, now);

  // Splice the edges via the shared placement algebra (extracted so mv-node and the
  // apply batch reuse the exact same logic). Exactly one of after/before/branch-of
  // (else E108); a missing target → E305. The node is not yet pushed, so a forward /
  // self ref resolves through the post-push badNext + DAG re-check below.
  const placed = applyPlacement(next.nodes, node, placement, now);
  if (!placed.ok) return placed;

  next.nodes.push(node);

  // Dangling-edge guard: the inserted node's final next[] (placement-derived,
  // incl. --rejoin) must all resolve. Runs AFTER the push so a self-rejoin still
  // resolves here and is left to the DAG re-check below (a self-cycle → E309),
  // while a genuinely-absent --rejoin target → E305 with nothing written.
  const nextErr = badNext(next, node.next);
  if (nextErr !== null) return nextErr;

  // DAG re-check BEFORE returning — a bad splice writes NOTHING (AC-15).
  const issue = dagIssue(next.nodes);
  if (issue !== null) {
    return fail(
      ErrorCodes.FLOW_EDGE_INVALID,
      `insert-node would produce an invalid flow graph: ${issue}.`,
      'Fix the placement (--after/--before/--branch-of/--rejoin) so the result stays an acyclic, connected flow. Nothing was written.',
    );
  }

  // Audit: node-created + one node-updated{edge_op} per rewired edge (reuses
  // ws-002 kinds — no new built-in event kind). A chore rides the `chore`
  // discriminator in details (ws-004 C7).
  next.events.push(
    buildBuiltinEvent(
      'node-created',
      {
        node: node.id,
        type: node.type,
        ...(node.chore !== undefined && {
          chore: { kind: node.chore.kind, importance: node.chore.importance },
        }),
      },
      next.events,
      deps.clock,
    ),
  );
  for (const e of placed.edges) {
    next.events.push(
      buildBuiltinEvent(
        'node-updated',
        { node: e.node, fields: ['next'], edge_op: e.edge_op },
        next.events,
        deps.clock,
      ),
    );
  }
  return { ok: true, doc: next };
}

// ---------------------------------------------------------------------------
// Plan 039 — generic transactional node primitives: applyPlacement (the shared
// edge algebra), remove-node, mv-node, and the batch `apply`. All PURE
// (doc → MutationResult on a clone) + roster-blind — they only enforce mechanical
// integrity (existence, the edge algebra, the DAG, and the D5 terminal guard).
// ---------------------------------------------------------------------------

/** The two terminal statuses the D5 guard protects: a `done`/`skipped` node is
 *  never silently reverted, removed, or moved (without explicit `force`). */
const TERMINAL_STATUSES = new Set(['done', 'skipped']);
const isTerminal = (node: FlowNode): boolean => TERMINAL_STATUSES.has(node.status);

/** The D5 refusal — an honest diagnostic, nothing written (matches the advisory invariant). */
function d5Refuse(message: string): FlowFailure {
  return fail(
    ErrorCodes.INVALID_ARGS,
    message,
    'Use `harness flow status` for a deliberate status change, or pass --force to remove/move a terminal node. Nothing was written.',
  );
}

type EdgeEvent = { node: string; edge_op: string };

/**
 * The shared edge-placement algebra (extracted from insert-node; reused by mv-node
 * and the apply batch). Splices `node`'s edges for exactly one of `after`/`before`/
 * `branchOf` against the existing `nodes` (the node may or may not already be in the
 * array — the `--before` predecessor scan skips the node itself). Mutates `nodes` +
 * `node` in place; returns the rewired-edge events, or a FlowFailure (E108 wrong
 * placement count · E305 missing target). Does NOT push the node or re-check the DAG.
 */
function applyPlacement(
  nodes: FlowNode[],
  node: FlowNode,
  placement: Placement,
  now: string,
): { ok: true; edges: EdgeEvent[] } | FlowFailure {
  const modes = [placement.after, placement.before, placement.branchOf].filter(
    (m) => m !== undefined,
  );
  if (modes.length !== 1) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `placement needs exactly one of --after / --before / --branch-of; got ${modes.length}.`,
      'Pass exactly one of --after <id>, --before <id>, or --branch-of <id>.',
    );
  }
  const edges: EdgeEvent[] = [];
  if (placement.after !== undefined) {
    const target = nodes.find((n) => n.id === placement.after);
    if (target === undefined) return nodeNotFound(placement.after);
    node.next = [...(Array.isArray(target.next) ? target.next : [])]; // N inherits X's out-edges
    target.next = [node.id]; // X now points only at N
    target.modified_at = now;
    edges.push({ node: target.id, edge_op: 'splice-after' });
  } else if (placement.before !== undefined) {
    const target = nodes.find((n) => n.id === placement.before);
    if (target === undefined) return nodeNotFound(placement.before);
    for (const p of nodes) {
      if (p.id === node.id) continue; // never rewire the moved/inserted node to itself
      if (!Array.isArray(p.next) || !p.next.includes(placement.before)) continue;
      p.next = p.next.map((e) => (e === placement.before ? node.id : e));
      p.modified_at = now;
      edges.push({ node: p.id, edge_op: 'splice-before' });
    }
    node.next = [placement.before]; // N → X
  } else if (placement.branchOf !== undefined) {
    const target = nodes.find((n) => n.id === placement.branchOf);
    if (target === undefined) return nodeNotFound(placement.branchOf);
    node.branch_of = placement.branchOf;
    node.next = [placement.rejoin ?? placement.branchOf]; // X.next UNCHANGED
  }
  return { ok: true, edges };
}

/**
 * Rewire every predecessor of `id` to point at `id`'s successors instead — the
 * "splice it out" step shared by remove-node (then deletes the node) and mv-node
 * (then re-places it). Mutates `nodes` in place; returns the rewired-edge events.
 */
function rewireThrough(nodes: FlowNode[], id: string, now: string): EdgeEvent[] {
  const node = nodes.find((n) => n.id === id);
  const succs = node && Array.isArray(node.next) ? node.next : [];
  const edges: EdgeEvent[] = [];
  for (const p of nodes) {
    if (p.id === id || !Array.isArray(p.next) || !p.next.includes(id)) continue;
    const rebuilt: string[] = [];
    for (const e of p.next) {
      const repl = e === id ? succs : [e];
      for (const r of repl) if (!rebuilt.includes(r)) rebuilt.push(r);
    }
    p.next = rebuilt;
    p.modified_at = now;
    edges.push({ node: p.id, edge_op: 'rewire' });
  }
  return edges;
}

/** First `next`/`branch_of` target that names no node in the set (dangling edge) — `dagIssue`
 *  treats dangling refs as "not a cycle", so the batch + remove/mv validate this separately. */
function firstDanglingRef(nodes: FlowNode[]): string | null {
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    for (const t of Array.isArray(n.next) ? n.next : []) if (!ids.has(t)) return t;
    if (typeof n.branch_of === 'string' && n.branch_of.length > 0 && !ids.has(n.branch_of)) {
      return n.branch_of;
    }
  }
  return null;
}

/** Core remove (no clone/D5/events): rewire predecessors→successors, then splice the
 *  node out. Returns the rewired-edge events or E305 (missing node). */
function removeCore(
  nodes: FlowNode[],
  id: string,
  now: string,
): { ok: true; edges: EdgeEvent[] } | FlowFailure {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx === -1) return nodeNotFound(id);
  const edges = rewireThrough(nodes, id, now);
  nodes.splice(idx, 1);
  return { ok: true, edges };
}

/** Core re-parent (no clone/D5/events): detach (predecessors bypass the node) then
 *  re-splice at the new placement. Returns the combined edge events or a FlowFailure. */
function mvCore(
  nodes: FlowNode[],
  id: string,
  placement: Placement,
  now: string,
): { ok: true; edges: EdgeEvent[] } | FlowFailure {
  const node = nodes.find((n) => n.id === id);
  if (node === undefined) return nodeNotFound(id);
  const detached = rewireThrough(nodes, id, now);
  node.next = [];
  delete node.branch_of; // drop the excursion flag so the move re-roots cleanly
  const placed = applyPlacement(nodes, node, placement, now);
  if (!placed.ok) return placed;
  node.modified_at = now;
  return { ok: true, edges: [...detached, ...placed.edges] };
}

/**
 * `flow remove-node` — delete a node and rewire predecessors→successors so no
 * orphan/dangling edge remains; DAG-rechecked. A graph-breaking removal (cycle/
 * orphan/dangling) is refused (`E309`), nothing written. A `done`/`skipped`
 * terminal node needs `--force` (D5). Fires one `node-updated {removed}` + one
 * `node-updated {rewire}` per rewired predecessor.
 */
export function removeNode(
  doc: FlowDoc,
  id: string,
  opts: { force?: boolean },
  deps: MutationDeps,
): MutationResult {
  const next = clone(doc);
  const node = findNode(next, id);
  if (node === undefined) return nodeNotFound(id);
  if (isTerminal(node) && opts.force !== true) {
    return d5Refuse(`node "${id}" is ${node.status} (terminal) — removing it needs --force.`);
  }
  const now = deps.clock.nowIso();
  const r = removeCore(next.nodes, id, now);
  if (!r.ok) return r;
  const issue = dagIssue(next.nodes);
  const dangling = firstDanglingRef(next.nodes);
  if (issue !== null || dangling !== null) {
    return fail(
      ErrorCodes.FLOW_EDGE_INVALID,
      `remove-node would produce an invalid flow graph: ${issue ?? `dangling edge to removed node "${dangling}"`}.`,
      'Pick a different node, or rewire the surrounding edges first so the result stays an acyclic, connected flow. Nothing was written.',
    );
  }
  next.events.push(
    buildBuiltinEvent('node-updated', { node: id, fields: ['removed'] }, next.events, deps.clock),
  );
  for (const e of r.edges) {
    next.events.push(
      buildBuiltinEvent(
        'node-updated',
        { node: e.node, fields: ['next'], edge_op: e.edge_op },
        next.events,
        deps.clock,
      ),
    );
  }
  return { ok: true, doc: next };
}

/**
 * `flow mv-node` — re-parent a node (`--after`/`--before`/`--branch-of` + optional
 * `--rejoin`) and rewire; DAG-rechecked. Cannot create a cycle (refused `E309`). A
 * terminal node needs `--force` (D5). Fires `node-updated {moved}` + the rewired-edge
 * events.
 */
export function mvNode(
  doc: FlowDoc,
  id: string,
  placement: Placement,
  opts: { force?: boolean },
  deps: MutationDeps,
): MutationResult {
  const next = clone(doc);
  const node = findNode(next, id);
  if (node === undefined) return nodeNotFound(id);
  if (isTerminal(node) && opts.force !== true) {
    return d5Refuse(`node "${id}" is ${node.status} (terminal) — moving it needs --force.`);
  }
  const now = deps.clock.nowIso();
  const r = mvCore(next.nodes, id, placement, now);
  if (!r.ok) return r;
  const moved = findNode(next, id);
  const nextErr = badNext(next, moved?.next);
  if (nextErr !== null) return nextErr;
  const issue = dagIssue(next.nodes);
  if (issue !== null) {
    return fail(
      ErrorCodes.FLOW_EDGE_INVALID,
      `mv-node would produce an invalid flow graph: ${issue}.`,
      'Pick a placement (--after/--before/--branch-of) that keeps the flow acyclic. Nothing was written.',
    );
  }
  next.events.push(
    buildBuiltinEvent('node-updated', { node: id, fields: ['moved'] }, next.events, deps.clock),
  );
  for (const e of r.edges) {
    next.events.push(
      buildBuiltinEvent(
        'node-updated',
        { node: e.node, fields: ['next'], edge_op: e.edge_op },
        next.events,
        deps.clock,
      ),
    );
  }
  return { ok: true, doc: next };
}

// ---------------------------------------------------------------------------
// apply — the transactional batch (AC-01/02/03/04). Two-phase: materialize node
// creates/upserts, then position edges, then validate the final DAG ONCE.
// ---------------------------------------------------------------------------

/** The op kinds `apply` accepts. */
export type FlowOpKind = 'add' | 'upsert' | 'set' | 'insert' | 'mv' | 'remove';

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A normalized, validated op (parsed once, up-front, before any mutation). */
interface NormOp {
  op: FlowOpKind;
  id: string;
  /** add/upsert/insert — the node to materialize (insert ignores `next`; placement owns it). */
  spec?: NodeSpec;
  /** upsert-merge / set — the shallow-merge field set. */
  fields?: Record<string, unknown>;
  /** insert/mv — the edge placement. */
  placement?: Placement;
  /** mv/remove — D5 override. */
  force?: boolean;
}

/** Build a NodeSpec from a raw op object (defaults: status `known`; absent type/label → ''). */
function specFrom(raw: Record<string, unknown>): NodeSpec {
  const spec: NodeSpec = {
    id: String(raw.id),
    type: typeof raw.type === 'string' ? raw.type : '',
    label: typeof raw.label === 'string' ? raw.label : '',
    status: typeof raw.status === 'string' ? raw.status : 'known',
  };
  if (Array.isArray(raw.next)) spec.next = raw.next as string[];
  if (typeof raw.branch_of === 'string') spec.branch_of = raw.branch_of;
  if (typeof raw.zone === 'string') spec.zone = raw.zone;
  if (typeof raw.command === 'string') spec.command = raw.command;
  // The shape is validated at runtime by `badChore`; the cast only satisfies TS.
  if (isObject(raw.chore)) spec.chore = raw.chore as unknown as NodeSpec['chore'];
  if (Array.isArray(raw.artifacts)) spec.artifacts = raw.artifacts as string[];
  if (typeof raw.user_input === 'string') spec.user_input = raw.user_input;
  return spec;
}

/** The shallow-merge field set = the op object minus its control keys. */
const OP_CONTROL_KEYS = new Set(['op', 'id', 'after', 'before', 'branch_of', 'rejoin', 'force']);
function fieldsFrom(raw: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!OP_CONTROL_KEYS.has(k)) fields[k] = v;
  return fields;
}

/** Map an op's snake-case placement keys to a Placement (camelCase `branchOf`). */
function placementFrom(raw: Record<string, unknown>): Placement {
  return {
    after: typeof raw.after === 'string' ? raw.after : undefined,
    before: typeof raw.before === 'string' ? raw.before : undefined,
    branchOf: typeof raw.branch_of === 'string' ? raw.branch_of : undefined,
    rejoin: typeof raw.rejoin === 'string' ? raw.rejoin : undefined,
  };
}

/** Validate + normalize one raw op (E108 on a malformed op — before any mutation). */
function parseOp(raw: unknown, i: number): NormOp | FlowFailure {
  if (!isObject(raw)) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `op #${i} is not an object.`,
      'Each op is a JSON object with an "op" and "id".',
    );
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `op #${i} is missing a string "id".`,
      'Every op needs an "id".',
    );
  }
  const id = raw.id;
  switch (raw.op) {
    case 'add':
    case 'insert': {
      if (typeof raw.type !== 'string' || typeof raw.label !== 'string') {
        return fail(
          ErrorCodes.INVALID_ARGS,
          `op #${i} ("${raw.op}" ${id}) needs a "type" and a "label".`,
          'A node-creating op carries at least {op, id, type, label}.',
        );
      }
      return raw.op === 'insert'
        ? { op: 'insert', id, spec: specFrom(raw), placement: placementFrom(raw) }
        : { op: 'add', id, spec: specFrom(raw) };
    }
    case 'upsert':
      return { op: 'upsert', id, spec: specFrom(raw), fields: fieldsFrom(raw) };
    case 'set':
      return { op: 'set', id, fields: fieldsFrom(raw) };
    case 'mv':
      return { op: 'mv', id, placement: placementFrom(raw), force: raw.force === true };
    case 'remove':
      return { op: 'remove', id, force: raw.force === true };
    default:
      return fail(
        ErrorCodes.INVALID_ARGS,
        `op #${i} has an unknown op kind ${JSON.stringify(raw.op)}.`,
        'Use one of: add, upsert, set, insert, mv, remove.',
      );
  }
}

/** Shallow-merge `fields` into `node`, skipping no-op fields; bump `modified_at` if any
 *  field actually changed. Returns the changed keys (drives the node-updated event). */
function mergeInto(node: FlowNode, fields: Record<string, unknown>, now: string): string[] {
  const changed: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'id') continue; // identity is immutable
    if (JSON.stringify(node[k]) === JSON.stringify(v)) continue; // per-field no-op
    node[k] = v;
    changed.push(k);
  }
  if (changed.length > 0) node.modified_at = now;
  return changed;
}

/**
 * `flow apply` — apply a transactional batch of generic node ops. **Two-phase**:
 * (phase 0) splice out `remove`s, (phase 1) materialize `add`/`upsert`/`insert`
 * nodes, (phase 2) position edges + merge `set`s, then validate the **final** DAG
 * **once** and (the act) write **once or not at all**. Forward refs resolve at the
 * end (order within a batch is irrelevant). The **batch-wide D5 guard** refuses any
 * resurrection of a base-terminal node — including a `remove`-then-re-`add` of the
 * same terminal id. A fully-no-op batch fires no event and returns the doc
 * **byte-identical** (no write). Invalid op / cycle / orphan / dangling → nothing
 * written (`E108`/`E309`/`E305`).
 */
export function applyBatch(doc: FlowDoc, rawOps: unknown, deps: MutationDeps): MutationResult {
  if (!Array.isArray(rawOps)) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      'apply expects a JSON array of ops.',
      'Pass --ops <file | -> a JSON array, e.g. [{"op":"add","id":"x","type":"phase","label":"X"}].',
    );
  }
  const ops: NormOp[] = [];
  for (let i = 0; i < rawOps.length; i++) {
    const parsed = parseOp(rawOps[i], i);
    if (!('op' in parsed)) return parsed; // FlowFailure
    ops.push(parsed);
  }

  const next = clone(doc);
  const now = deps.clock.nowIso();
  const baseTerminals = new Set(next.nodes.filter(isTerminal).map((n) => n.id));
  const fire = (kind: string, details: Record<string, unknown>): void => {
    next.events.push(buildBuiltinEvent(kind, details, next.events, deps.clock));
  };
  const fireEdges = (edges: EdgeEvent[]): void => {
    for (const e of edges)
      fire('node-updated', { node: e.node, fields: ['next'], edge_op: e.edge_op });
  };
  const createdDetails = (spec: NodeSpec): Record<string, unknown> => ({
    node: spec.id,
    type: spec.type,
    ...(spec.chore !== undefined && {
      chore: { kind: spec.chore.kind, importance: spec.chore.importance },
    }),
  });

  // PHASE 0 — removals first, so a `remove`-then-re-`add` of the same id is a fresh
  // insert (the laundering case), not a dup-id error. D5 force is checked per-op; the
  // batch-wide resurrection guard below catches the re-add.
  for (const op of ops) {
    if (op.op !== 'remove') continue;
    const node = findNode(next, op.id);
    if (node === undefined) return nodeNotFound(op.id);
    if (isTerminal(node) && op.force !== true) {
      return d5Refuse(`node "${op.id}" is ${node.status} (terminal) — removing it needs force.`);
    }
    const r = removeCore(next.nodes, op.id, now);
    if (!r.ok) return r;
    fire('node-updated', { node: op.id, fields: ['removed'] });
    fireEdges(r.edges);
  }

  // PHASE 1 — node materialization (add / upsert / insert). No edge validation yet
  // (forward refs resolve at the final DAG check), so build order stops mattering.
  for (const op of ops) {
    if (op.op === 'add') {
      if (op.spec === undefined) continue;
      if (findNode(next, op.id) !== undefined) {
        return fail(
          ErrorCodes.INVALID_ARGS,
          `op "add" ${op.id}: a node with that id already exists.`,
          'Use op "upsert" to insert-or-merge, or pick a unique id.',
        );
      }
      const guard = badZone(op.spec) ?? badChore(op.spec);
      if (guard !== null) return guard;
      next.nodes.push(materialize(op.spec, now));
      fire('node-created', createdDetails(op.spec));
    } else if (op.op === 'insert') {
      if (op.spec === undefined) continue;
      if (findNode(next, op.id) !== undefined) {
        return fail(
          ErrorCodes.INVALID_ARGS,
          `op "insert" ${op.id}: a node with that id already exists.`,
          'Pick a unique id for the inserted node (or use op "mv" to move an existing one).',
        );
      }
      const guard = badZone(op.spec) ?? badChore(op.spec);
      if (guard !== null) return guard;
      next.nodes.push(materialize(op.spec, now)); // placement applied in phase 2
      fire('node-created', createdDetails(op.spec));
    } else if (op.op === 'upsert' && op.spec !== undefined) {
      const guard = badZone(op.spec) ?? badChore(op.spec);
      if (guard !== null) return guard;
      const existing = findNode(next, op.id);
      if (existing === undefined) {
        next.nodes.push(materialize(op.spec, now)); // insert-if-absent
        fire('node-created', createdDetails(op.spec));
      } else {
        const changed = mergeInto(existing, op.fields ?? {}, now); // shallow-merge-if-present
        if (changed.length > 0) fire('node-updated', { node: op.id, fields: changed });
      }
    }
  }

  // PHASE 2 — edge positioning (insert placement / mv) + field merges (set) against
  // the complete node set.
  for (const op of ops) {
    if (op.op === 'set') {
      const node = findNode(next, op.id);
      if (node === undefined) return nodeNotFound(op.id);
      const fields = op.fields ?? {};
      if (fields.zone !== undefined) {
        const z = badZone({ zone: fields.zone } as NodeSpec);
        if (z !== null) return z;
      }
      if (fields.chore !== undefined) {
        const c = badChore({ chore: fields.chore } as NodeSpec);
        if (c !== null) return c;
      }
      const changed = mergeInto(node, fields, now);
      if (changed.length > 0) fire('node-updated', { node: op.id, fields: changed });
    } else if (op.op === 'insert' && op.placement !== undefined) {
      const node = findNode(next, op.id);
      if (node === undefined) continue; // materialized in phase 1
      const placed = applyPlacement(next.nodes, node, op.placement, now);
      if (!placed.ok) return placed;
      fireEdges(placed.edges);
    } else if (op.op === 'mv' && op.placement !== undefined) {
      const node = findNode(next, op.id);
      if (node === undefined) return nodeNotFound(op.id);
      if (isTerminal(node) && op.force !== true) {
        return d5Refuse(`node "${op.id}" is ${node.status} (terminal) — moving it needs force.`);
      }
      const r = mvCore(next.nodes, op.id, op.placement, now);
      if (!r.ok) return r;
      fire('node-updated', { node: op.id, fields: ['moved'] });
      fireEdges(r.edges);
    }
  }

  // BATCH-WIDE D5 — a base-terminal id still present must still be terminal (no
  // silent revert, and no remove-then-re-add laundering of a `done`/`skipped` node).
  for (const id of baseTerminals) {
    const node = findNode(next, id);
    if (node !== undefined && !isTerminal(node)) {
      return d5Refuse(
        `op would resurrect terminal node "${id}" (re-stamping a done/skipped node as ${node.status}).`,
      );
    }
  }

  // FINAL validation — ONCE: dangling refs (E305) then the DAG (E309 cycle/orphan).
  const dangling = firstDanglingRef(next.nodes);
  if (dangling !== null) return nodeNotFound(dangling);
  const issue = dagIssue(next.nodes);
  if (issue !== null) {
    return fail(
      ErrorCodes.FLOW_EDGE_INVALID,
      `apply would produce an invalid flow graph: ${issue}.`,
      'Fix the ops so the final graph stays an acyclic, connected flow. Nothing was written.',
    );
  }

  // BYTE-STABILITY — a fully-no-op batch fired no event; return the ORIGINAL doc so
  // the act writes byte-identical bytes (no modified_at bump, no event).
  if (next.events.length === doc.events.length) return { ok: true, doc };
  return { ok: true, doc: next };
}
