import { ErrorCodes } from '../../output/error-codes.js';
import type { SurveyDimension, SurveyReason } from '../dd/plan/index.js';
import type { FlowNode } from './flow-events.js';
import { type FlowServiceDeps, readFlowDoc } from './flow-service.js';

/**
 * The backpressure survey, read off a flight plan.
 *
 * This composes `readFlowDoc` and reads node COMMENTS directly, and that is a
 * deliberate choice rather than an oversight: `harness flow chores --json`
 * projects a `ChoreRow` (`flow-mutations.ts`) that carries status, kind,
 * importance, command and anchor — but no comments. Receipts are unreachable
 * through it. Widening that public row for one consumer would make every other
 * caller pay for this question, so the read goes to the substrate instead, and a
 * fixture pins the shape so a model change fails loudly rather than quietly
 * reading every survey as unreceipted.
 */

/** The node `type` this repo's flight plans carry on a backpressure seam node. */
export const BACKPRESSURE_NODE_TYPE = 'backpressure';

/**
 * The node ID the doctrine actually PINS: `backpressure`, and on a re-basis
 * `backpressure-<first 12 hex of the surveyed plan's SHA-256>` (`eng-harness-flow`
 * SKILL.md, "Recurrence — latest-plan basis").
 *
 * Selecting on the id as well as the type is the point. The doctrine specifies the
 * id and says nothing about the `type` field, so a reader that matched on type
 * alone would be depending on whoever mints the node happening to choose the same
 * type this repo's flows happen to use — a coincidence, not a contract. Matching
 * either means the survey is still found when a minter picks a different type.
 */
const BACKPRESSURE_ID = /^backpressure(?:-[0-9a-f]{12})?$/i;

/**
 * The statuses that END a chore. Everything else means it is still outstanding —
 * which is "not run", not "failed".
 */
const TERMINAL_STATUSES = new Set(['done', 'skipped']);

/**
 * The comment kinds that can carry a receipt: `validation` (an agent's real
 * attempt) and `decision` (the human's decline). A `note` is deliberately NOT one
 * — the doctrine reserves receipts for append-only comments precisely because a
 * note is overwritable, and a receipt you can quietly rewrite proves nothing.
 *
 * The kind must be stated EXPLICITLY. A comment with no `kind` at all is not a
 * receipt either: accepting it would make the allow-list decorative, and "a
 * control that does not do what it says it does" is the exact defect class this
 * verb exists to catch.
 */
type ReceiptKind = 'validation' | 'decision';
const RECEIPT_KINDS = new Set<string>(['validation', 'decision']);

/** `basis_sha256:<64 hex>` — the surveyed plan's bytes, recorded in the receipt. */
const BASIS_PATTERN = /basis_sha256:([0-9a-fA-F]{64})/;

/** The doctrine's completed-attempt marker when the harness router is unavailable. */
const UNAVAILABLE_PATTERN = /^decision:unavailable reason:.+ time:.+$/;

/**
 * The reading's SHAPE (`SurveyDimension`, `SurveyReason`) is declared by the
 * consumer, in `dd/plan`'s verdict model, and imported through dd's published
 * barrel — the one seam the flow spine is allowed to reach for. It lives there
 * because `dd/plan` must stay filesystem-free: were the type declared here, the
 * import would run dd → flow and drag this module's fs/clock/git ports and the
 * output error table into a layer that is required to have neither.
 */

/** Every backpressure node, in document order (the re-basis nodes included). */
function backpressureNodes(nodes: readonly FlowNode[]): FlowNode[] {
  return nodes.filter(
    (node) => node.type === BACKPRESSURE_NODE_TYPE || BACKPRESSURE_ID.test(node.id),
  );
}

interface Receipt {
  kind: ReceiptKind;
  /** The `basis_sha256` this receipt records, or `null` when it carries none. */
  basis: string | null;
  /** Whether this is the doctrine's agent-authored unavailable-attempt receipt. */
  unavailable: boolean;
}

/**
 * The node's NEWEST receipt, or `null` when it carries none.
 *
 * Newest-first is load-bearing, not a detail. Comments are append-only, so a node
 * accumulates history: survey the plan, edit the plan, re-survey it, and the node
 * holds a stale receipt FOLLOWED by a current one. A first-match scan would let
 * the older receipt shadow the newer one and report `stale-basis` about a survey
 * that has in fact been redone. The last word wins, because the last word is the
 * most recent thing anyone recorded.
 *
 * The node is found by type or id (see `BACKPRESSURE_ID`) rather than by the
 * `chore` marker on purpose: a re-basis survey node is spliced in without one, and
 * a reader keyed on the chore marker would miss the very node that re-surveyed the
 * plan it is being asked about.
 */
function newestReceipt(node: FlowNode): Receipt | null {
  const comments = node.comments ?? [];
  for (let at = comments.length - 1; at >= 0; at -= 1) {
    const comment = comments[at];
    if (comment === undefined) continue;
    const kind = comment.kind;
    if (kind === undefined || !RECEIPT_KINDS.has(kind)) continue;
    if (kind === 'decision' && (node.status !== 'skipped' || comment.source !== 'user')) continue;
    const match = BASIS_PATTERN.exec(comment.text);
    return {
      kind: kind as ReceiptKind,
      basis: match?.[1]?.toLowerCase() ?? null,
      unavailable:
        kind === 'validation' &&
        comment.source === 'agent' &&
        UNAVAILABLE_PATTERN.test(comment.text),
    };
  }
  return null;
}

/**
 * What ONE terminal survey node says about these plan bytes.
 *
 * The two receipt kinds are treated asymmetrically, deliberately:
 *
 * - A `validation` receipt is an agent's completed survey — a claim about
 *   SPECIFIC plan bytes. It therefore requires basis equality, and goes stale the
 *   moment those bytes change (AC-10).
 * - A `decision` receipt is the human's decline, and the doctrine's decline
 *   command records the human's verbatim words and NO basis at all. Requiring one
 *   would make a documented decline unsatisfiable by the actual protocol. It also
 *   would not mean anything: a decline is a decision about THE WORK, not about the
 *   bytes, so there is nothing for a later edit to invalidate.
 *
 * Only the doctrine's agent-authored router-missing receipt
 * (`decision:unavailable reason:… time:…`) may omit a basis and read `null` /
 * CAN'T-TELL. A different basis-less validation receipt is malformed and remains
 * a known not-ready result. Shape alone is not evidence that the router was
 * unavailable.
 */
function judge(
  node: FlowNode,
  expected: string,
): { reason: SurveyReason; satisfied: boolean | null; basis: string | null } {
  const receipt = newestReceipt(node);
  if (receipt === null) return { satisfied: false, reason: 'missing-receipt', basis: null };
  const basis = receipt.basis;
  if (receipt.kind === 'decision') {
    return { satisfied: true, reason: 'declined-with-receipt', basis };
  }
  if (basis === null && receipt.unavailable) {
    return { satisfied: null, reason: 'missing-basis', basis };
  }
  if (basis === null) return { satisfied: false, reason: 'missing-receipt', basis };
  if (basis === expected) return { satisfied: true, reason: 'survey-done', basis };
  return { satisfied: false, reason: 'stale-basis', basis };
}

/**
 * Which non-satisfying reading tells a reader the most, when several nodes
 * dissent. A KNOWN failure outranks an unknown — the same precedence the verdict
 * itself uses — so a stale receipt is reported ahead of an unreadable one.
 */
const DISSENT_ORDER: readonly SurveyReason[] = ['stale-basis', 'missing-receipt', 'missing-basis'];

/** A node that did not satisfy: `ok` is `false` (a failure) or `null` (unknowable). */
interface Dissent {
  node: FlowNode;
  basis: string | null;
  ok: false | null;
}

/**
 * The node that owns the current plan basis.
 *
 * Re-basis nodes are deterministic: `backpressure-<first 12 hex>`. If one for
 * the current bytes exists it is the present, whatever historical terminal
 * nodes say. Before re-basis exists, the plain `backpressure` node is current.
 */
function currentNode(nodes: readonly FlowNode[], expected: string): FlowNode | undefined {
  const rebasedId = `backpressure-${expected.slice(0, 12)}`;
  return (
    nodes.find((node) => node.id.toLowerCase() === rebasedId) ??
    nodes.find((node) => node.id.toLowerCase() === 'backpressure')
  );
}

function reading(
  satisfied: boolean | null,
  reason: SurveyReason,
  expected: string,
  node?: FlowNode,
  basis?: string | null,
): SurveyDimension {
  return {
    satisfied,
    reason,
    node: node?.id ?? null,
    status: node?.status ?? null,
    basis: basis ?? null,
    expected_basis: expected,
  };
}

/**
 * Was the backpressure survey done, or explicitly declined, for THESE plan bytes?
 *
 * The question is asked of the chore, never of per-criterion links: `pressure` is
 * excluded from the plan's claiming relations deliberately, and requiring every
 * acceptance criterion to name an instrument would re-invent the coverage
 * predicate that decision threw away.
 *
 * `expectedBasis` is the SHA-256 of the plan document being judged. A completed
 * survey's receipt for different bytes is `stale-basis` and never satisfied — an
 * edit made after the survey must not inherit the old green. A human's DECLINE
 * carries no basis and needs none: see `judge` for why the two are asymmetric.
 *
 * When several backpressure nodes exist (the doctrine mints one per re-basis), the
 * node whose id names the current basis owns the answer; absent that node, the
 * plain `backpressure` node does. Historical nodes are consulted only when neither
 * current form exists, and their dissent ordering cannot override the present.
 */
export function readBackpressureSurvey(
  flowPath: string,
  deps: FlowServiceDeps,
  expectedBasis: string,
): SurveyDimension {
  const expected = expectedBasis.toLowerCase();
  const flow = readFlowDoc(flowPath, deps);
  if (!flow.ok) {
    return flow.code === ErrorCodes.FLOW_NOT_FOUND
      ? reading(null, 'no-flight-plan', expected)
      : reading(null, 'flight-plan-unreadable', expected);
  }

  const nodes = backpressureNodes(Array.isArray(flow.doc.nodes) ? flow.doc.nodes : []);
  if (nodes.length === 0) return reading(null, 'no-survey-node', expected);

  const current = currentNode(nodes, expected);
  if (current !== undefined) {
    if (!TERMINAL_STATUSES.has(current.status)) {
      return reading(false, 'not-run', expected, current);
    }
    const verdict = judge(current, expected);
    return reading(verdict.satisfied, verdict.reason, expected, current, verdict.basis);
  }

  const terminal = nodes.filter((node) => TERMINAL_STATUSES.has(node.status));
  if (terminal.length === 0) {
    return reading(false, 'not-run', expected, nodes[0]);
  }

  const dissent = new Map<SurveyReason, Dissent>();
  for (const node of terminal) {
    const verdict = judge(node, expected);
    if (verdict.satisfied === true) {
      return reading(true, verdict.reason, expected, node, verdict.basis);
    }
    if (!dissent.has(verdict.reason)) {
      dissent.set(verdict.reason, { node, basis: verdict.basis, ok: verdict.satisfied });
    }
  }

  for (const reason of DISSENT_ORDER) {
    const found = dissent.get(reason);
    if (found !== undefined) return reading(found.ok, reason, expected, found.node, found.basis);
  }
  return reading(false, 'missing-receipt', expected, terminal[0]);
}
