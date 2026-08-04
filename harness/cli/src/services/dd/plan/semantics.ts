import { effectiveRel } from '../core/rel.js';
import type {
  PlanEdge,
  PlanFinding,
  PlanIndex,
  PlanItem,
  PlanSemanticOptions,
  PlanSemanticResult,
} from './model.js';

/**
 * The relations that carry a CLAIM about doneness.
 *
 * `pressure` is deliberately absent. A backpressure row is a toolbelt entry — it
 * has no state to contradict, it gates nothing, and treating "I named an
 * instrument that is not itself ticked" as a contradiction would re-invent the
 * coverage predicate the design explicitly threw away. `ref` is absent for the
 * same reason a plain reference means nothing: it says these two things are
 * related, not that one accounts for the other.
 */
const CLAIMING_RELS = new Set(['proven_by', 'satisfies', 'derives']);

function claimingEdges(edges: readonly PlanEdge[]): PlanEdge[] {
  return edges.filter((edge) => CLAIMING_RELS.has(effectiveRel(edge.rel)));
}

/**
 * Every item reachable from a seed, plus — for a claim row — the work that
 * accounts for it.
 *
 * Outbound alone would answer "what does this depend on"; an acceptance
 * criterion's interesting neighbours point the OTHER way, because the rows that
 * satisfy it are what make it true. So the closure is outbound-transitive plus
 * one deliberate inbound arm, taken on `satisfies` only: pulling in every
 * inbound relation would drag the whole plan back through any row anything
 * mentions, and a scope that is the whole plan is not a scope.
 */
export function scopeFrom(index: PlanIndex, seedKey: string): Set<string> {
  const scope = new Set<string>();
  const queue: string[] = [];

  /**
   * Add a key AND everything inside it.
   *
   * Containment is half of what "reachable" means to a reader. A phase row cites
   * its task FILE's `tasks` section, not each task in it — so without descending
   * into a container, scoping to a phase would reach one section node and report
   * that nothing in the phase is open. An address stands for the subtree it names.
   */
  const admit = (key: string): void => {
    const item = index.byKey.get(key);
    if (item === undefined) {
      if (!scope.has(key)) {
        scope.add(key);
        queue.push(key);
      }
      return;
    }
    for (const candidate of index.items) {
      if (candidate.path !== item.path) continue;
      if (candidate.interior.length < item.interior.length) continue;
      if (!item.interior.every((segment, at) => candidate.interior[at] === segment)) continue;
      if (scope.has(candidate.key)) continue;
      scope.add(candidate.key);
      queue.push(candidate.key);
    }
  };

  admit(seedKey);
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) continue;
    for (const edge of index.edges) {
      if (edge.from === key && edge.to !== null && !scope.has(edge.to)) admit(edge.to);
      if (
        edge.to === key &&
        effectiveRel(edge.rel) === 'satisfies' &&
        index.byKey.get(key)?.claim === true &&
        !scope.has(edge.from)
      ) {
        admit(edge.from);
      }
    }
  }
  return scope;
}

function describe(item: PlanItem): string {
  return item.label === null ? item.address : `${item.address} (${item.label})`;
}

/**
 * Read a plan's structure for the things only a plan can be wrong about.
 *
 * Written once against RELATIONS and never against field names — that is the
 * whole reason relations exist. A schema that renames `proven_by` to `evidenced`
 * keeps every check below; a schema that stops declaring the relation loses them,
 * loudly, because `builder-rels.test.ts` pins the declarations.
 */
export function readPlanSemantics(
  index: PlanIndex,
  options: PlanSemanticOptions = {},
): PlanSemanticResult {
  const inScope = (key: string): boolean => options.scope === undefined || options.scope.has(key);
  const perRow = options.complete === true || options.scope !== undefined;

  const considered = index.items.filter((item) => inScope(item.key));
  const completable = considered.filter((item) => item.completable);
  const open = completable.filter((item) => !item.done);

  const findings: PlanFinding[] = [];

  // 1. Contradictions. A row that says it is DONE while something it claims to
  //    rest on is still open is the one inconsistency a document can prove about
  //    itself, and it is reported ALWAYS — under every mode — because it is a
  //    statement that is wrong now, not work that is merely unfinished.
  for (const edge of claimingEdges(index.edges)) {
    const from = index.byKey.get(edge.from);
    const to = edge.to === null ? undefined : index.byKey.get(edge.to);
    if (!from || !to) continue;
    if (!inScope(from.key) && !inScope(to.key)) continue;
    // The CITER must be a row that claims doneness itself: a section is not
    // making a claim, its members are.
    if (!from.completable || !from.done) continue;
    // The TARGET only has to be checkable — a `done_when` list has no state of
    // its own, and "ticked while my proof list is not complete" is precisely the
    // contradiction worth catching.
    if (!to.checkable || to.done) continue;
    findings.push({
      class: 'contradiction',
      severity: 'WARN',
      address: from.address,
      owner: from.path,
      location: edge.location,
      rel: effectiveRel(edge.rel),
      counterpart: to.address,
      message: `${describe(from)} is "${from.state}" but ${effectiveRel(edge.rel)} ${describe(to)}, which is still "${to.state}"`,
    });
  }

  // 2. Open completables. Per-row ONLY under --complete or a scoped read: the
  //    ruling is that a mid-flight plan is SUPPOSED to have open rows, so warning
  //    about each of them teaches a reader to ignore warnings (ac-7007).
  if (perRow) {
    for (const item of open) {
      findings.push({
        class: 'open-completable',
        severity: 'WARN',
        address: item.address,
        owner: item.path,
        location: item.location,
        message: `${describe(item)} is still "${item.state}"`,
      });
    }
  }

  // 3. Orphan claims — a claim row nothing accounts for. Under --complete only:
  //    an unclaimed criterion mid-flight is a plan that has not been fully broken
  //    down yet, which is a normal state to be in and a fatal one to finish in.
  const claimed = new Set(
    index.edges
      .filter((edge) => effectiveRel(edge.rel) === 'satisfies' && edge.to !== null)
      .map((edge) => edge.to as string),
  );
  const orphans = considered.filter((item) => item.claim && !claimed.has(item.key));
  if (options.complete === true) {
    for (const item of orphans) {
      findings.push({
        class: 'orphan-claim',
        severity: 'WARN',
        address: item.address,
        owner: item.path,
        location: item.location,
        message: `${describe(item)} has no incoming satisfies — no task accounts for it`,
      });
    }
  }

  const summary =
    perRow || open.length === 0
      ? null
      : `${open.length} of ${completable.length} completable item(s) are still open — run with --complete for the per-row list, or --address <address> to scope the read.`;

  return {
    findings,
    summary,
    counts: {
      items: index.items.length,
      completable: completable.length,
      open: open.length,
      contradictions: findings.filter((finding) => finding.class === 'contradiction').length,
      orphans: orphans.length,
      in_scope: considered.length,
    },
  };
}
