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

/** The node `type` the harness doctrine stamps on a backpressure seam node. */
export const BACKPRESSURE_NODE_TYPE = 'backpressure';

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
 */
const RECEIPT_KINDS = new Set(['validation', 'decision']);

/** `basis_sha256:<64 hex>` — the surveyed plan's bytes, recorded in the receipt. */
const BASIS_PATTERN = /basis_sha256:([0-9a-fA-F]{64})/;

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
  return nodes.filter((node) => node.type === BACKPRESSURE_NODE_TYPE);
}

/**
 * The basis a node's receipt records, or `null` when it carries no receipt.
 *
 * Keyed on the node TYPE rather than the `chore` marker on purpose: a re-basis
 * survey node is spliced in without a chore marker, and a reader that only looked
 * at chore-marked nodes would miss the very node that re-surveyed the plan it is
 * being asked about.
 */
function receiptBasis(node: FlowNode): string | null {
  for (const comment of node.comments ?? []) {
    if (comment.kind !== undefined && !RECEIPT_KINDS.has(comment.kind)) continue;
    const match = BASIS_PATTERN.exec(comment.text);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  return null;
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
 * `expectedBasis` is the SHA-256 of the plan document being judged. A receipt for
 * different bytes is `stale-basis` and never satisfied — an edit made after the
 * survey must not inherit the old green.
 *
 * When several backpressure nodes exist (the doctrine mints one per re-basis), the
 * most informative reading wins: a matching receipt, else a stale one, else a
 * terminal node with no receipt, else "not run". A survey that happened for the
 * current bytes is the truth regardless of how many earlier ones are lying around.
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

  const terminal = nodes.filter((node) => TERMINAL_STATUSES.has(node.status));
  if (terminal.length === 0) {
    return reading(false, 'not-run', expected, nodes[0]);
  }

  let stale: { node: FlowNode; basis: string } | null = null;
  for (const node of terminal) {
    const basis = receiptBasis(node);
    if (basis === null) continue;
    if (basis === expected) {
      return reading(
        true,
        node.status === 'skipped' ? 'declined-with-receipt' : 'survey-done',
        expected,
        node,
        basis,
      );
    }
    stale ??= { node, basis };
  }

  if (stale !== null) {
    return reading(false, 'stale-basis', expected, stale.node, stale.basis);
  }
  return reading(false, 'missing-receipt', expected, terminal[0]);
}
