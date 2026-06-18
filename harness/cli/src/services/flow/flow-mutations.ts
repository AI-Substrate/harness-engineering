import type { Clock } from '../../adapters/clock/clock-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { buildBuiltinEvent, buildComment, type FlowDoc, type FlowNode } from './flow-events.js';
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
// cursor.
// ---------------------------------------------------------------------------

/** `flow cursor --to X` — move the cursor, firing `cursor-moved {from,to}`. */
export function moveCursor(doc: FlowDoc, to: string, deps: MutationDeps): MutationResult {
  const next = clone(doc);
  if (findNode(next, to) === undefined) return nodeNotFound(to);
  const from = next.cursor;
  next.cursor = to;
  next.events.push(buildBuiltinEvent('cursor-moved', { from, to }, next.events, deps.clock));
  return { ok: true, doc: next };
}

/** `flow cursor --recommend X` — set `recommended_next` WITHOUT moving the cursor. */
export function recommendNext(doc: FlowDoc, nodeId: string, deps: MutationDeps): MutationResult {
  const next = clone(doc);
  if (findNode(next, nodeId) === undefined) return nodeNotFound(nodeId);
  next.recommended_next = nodeId;
  // Advisory pointer, not a transition — no built-in event (ws-002 §E2 has none).
  void deps;
  return { ok: true, doc: next };
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
      { node: nodeId, from, to: toStatus },
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
}

function materialize(spec: NodeSpec, now: string): FlowNode {
  return {
    id: spec.id,
    type: spec.type,
    label: spec.label,
    status: spec.status,
    next: spec.next ? [...spec.next] : [],
    created_at: now,
    ...(spec.branch_of !== undefined && { branch_of: spec.branch_of }),
    ...(spec.user_input !== undefined && { user_input: spec.user_input }),
    ...(spec.authority !== undefined && { authority: spec.authority }),
  };
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
  const now = deps.clock.nowIso();
  next.nodes.push(materialize(spec, now));
  next.events.push(
    buildBuiltinEvent('node-created', { node: spec.id, type: spec.type }, next.events, deps.clock),
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
  const modes = [placement.after, placement.before, placement.branchOf].filter(
    (m) => m !== undefined,
  );
  if (modes.length !== 1) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `insert-node needs exactly one placement flag (--after | --before | --branch-of); got ${modes.length}.`,
      'Pass exactly one of --after <id>, --before <id>, or --branch-of <id>.',
    );
  }

  const next = clone(doc);
  if (findNode(next, spec.id) !== undefined) {
    return fail(
      ErrorCodes.INVALID_ARGS,
      `a node with id "${spec.id}" already exists.`,
      'Pick a unique node id for the inserted node.',
    );
  }

  const now = deps.clock.nowIso();
  const node = materialize(spec, now);
  const events: { node: string; edge_op: string }[] = [];

  if (placement.after !== undefined) {
    const target = findNode(next, placement.after);
    if (target === undefined) return nodeNotFound(placement.after);
    node.next = [...target.next]; // N inherits X's out-edges
    target.next = [node.id]; // X now points only at N
    events.push({ node: target.id, edge_op: 'splice-after' });
  } else if (placement.before !== undefined) {
    const target = findNode(next, placement.before);
    if (target === undefined) return nodeNotFound(placement.before);
    // Reverse-scan ALL nodes for predecessors of X (multi-predecessor support).
    for (const p of next.nodes) {
      if (p.next.includes(placement.before)) {
        p.next = p.next.map((e) => (e === placement.before ? node.id : e));
        events.push({ node: p.id, edge_op: 'splice-before' });
      }
    }
    node.next = [placement.before]; // N → X
  } else if (placement.branchOf !== undefined) {
    const target = findNode(next, placement.branchOf);
    if (target === undefined) return nodeNotFound(placement.branchOf);
    node.branch_of = placement.branchOf;
    node.next = [placement.rejoin ?? placement.branchOf]; // rejoin (default = the branch point); X.next UNCHANGED
    // No existing edge rewired → only node-created fires.
  }

  next.nodes.push(node);

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
  // ws-002 kinds — no new built-in event kind).
  next.events.push(
    buildBuiltinEvent('node-created', { node: node.id, type: node.type }, next.events, deps.clock),
  );
  for (const e of events) {
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
