import { isAddressFailure, parseAddress } from '../core/address.js';
import {
  collectLinkCells,
  isPathWithinRepo,
  resolveAddressFile,
  type SchemaResolver,
} from '../core/validate.js';
import { type DocLoader, shouldExcludeFromSweep } from '../core/walk.js';
import {
  type DdCorpusGraph,
  type DdGraphNode,
  type DdLinkEdge,
  type DdLinkIssue,
  linkIssue,
} from './model.js';

export interface DdTraverseDeps {
  schemaResolver: SchemaResolver;
  docLoader: DocLoader;
}

export interface DdTraverseOptions {
  repoRoot: string;
  /**
   * `sweep` honours `sweep_exclude` and the fixture-path exclusion; `direct`
   * never skips a document (OD-1). Enumeration-driven callers are sweeps; a
   * caller that named one document is direct.
   */
  mode: 'direct' | 'sweep';
  /** Follow edges beyond the seed set — the radius-∞ traversal. Default true. */
  follow?: boolean;
}

/**
 * Walk the document graph once, breadth-first, and return it whole.
 *
 * `dd graph`, `dd links` and the doctor's radius-∞ sweep are three readings of
 * one traversal, so an edge means the same thing to all three.
 *
 * **The visited set is the loop breaker.** The corpus contains real cycles by
 * design (`cycle-a` ↔ `cycle-b`, and `self-cycle` pointing at itself); without
 * the set this queue never drains. Because "it hangs" is a terrible test
 * failure, the walk also carries a *derived* tripwire: every path that is ever
 * scheduled — the seeds, plus each in-repo target queued along the way — can be
 * popped at most once while the breaker holds, so the number of pops can never
 * exceed the number of distinct scheduled paths. Exceeding that bound is
 * structurally impossible unless the breaker is gone, so a regression reddens a
 * bounded test in milliseconds instead of hanging it.
 *
 * The bound counts *scheduled* paths, not successfully *loaded* ones, and the
 * difference is load-bearing: a document that will not load is still a document
 * this walk legitimately popped. Counting only loaded documents made one seed
 * with two missing neighbours trip its own tripwire (pops 3 against a bound of
 * 2) and report a terminating walk as a scan failure — promoting two ruled WARNs
 * into an ERROR. The bound is derived from the corpus rather than invented
 * (P2 DL-006), and it cannot fire on a well-formed run at any repository size.
 */
export function traverseCorpus(
  seeds: readonly string[],
  deps: DdTraverseDeps,
  options: DdTraverseOptions,
): DdCorpusGraph {
  const follow = options.follow ?? true;
  const seedSet = new Set(seeds);
  const visited = new Set<string>();
  /** Every path this walk has ever put on the queue — the tripwire's denominator. */
  const scheduled = new Set<string>(seeds);
  const nodes: DdGraphNode[] = [];
  const edges: DdLinkEdge[] = [];
  const issues: DdLinkIssue[] = [];
  const queue: string[] = [...seeds];
  let pops = 0;

  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined) break;
    if (visited.has(path)) continue;
    pops += 1;
    if (pops > scheduled.size) {
      issues.push(
        linkIssue(
          'link-scan-failed',
          'ERROR',
          path,
          'traversal exceeded its derived visit bound — the graph walk is not terminating',
          path,
        ),
      );
      break;
    }
    visited.add(path);

    const result = deps.docLoader.load(path);
    if (!result.ok) {
      if (seedSet.has(path)) {
        issues.push(linkIssue('link-scan-incomplete', 'WARN', path, result.message, path));
      }
      continue;
    }
    if (options.mode === 'sweep' && shouldExcludeFromSweep(path, result.doc)) continue;

    const resolved = deps.schemaResolver.resolve(result.doc.dd.schema, path);
    nodes.push({
      path,
      schema: resolved.ok ? resolved.schema.name : result.doc.dd.schema,
      sha: result.sha,
      tracked: result.tracked,
      external: !seedSet.has(path),
    });
    if (!resolved.ok) {
      // The schema is what says which cells are links. Without it this document's
      // edges are unknowable — say so instead of reporting it as a leaf.
      issues.push(
        linkIssue(
          'link-scan-incomplete',
          'WARN',
          '$.dd.schema',
          `outbound links were not scanned: ${resolved.message}`,
          path,
        ),
      );
      continue;
    }

    for (const cell of collectLinkCells(result.doc, resolved.schema)) {
      const address = parseAddress(cell.raw);
      if (isAddressFailure(address)) {
        edges.push({
          from: path,
          to: null,
          address: cell.raw,
          location: cell.location,
          rel: cell.rel,
          sameDocument: false,
          ...(cell.target && { target: cell.target }),
        });
        continue;
      }
      const sameDocument = address.file === null;
      const to = sameDocument ? path : resolveAddressFile(path, address.file as string);
      const within = isPathWithinRepo(to, options.repoRoot);
      edges.push({
        from: path,
        to: within ? to : null,
        address: cell.raw,
        location: cell.location,
        rel: cell.rel,
        sameDocument,
        ...(cell.target && { target: cell.target }),
      });
      if (follow && within) {
        scheduled.add(to);
        if (!visited.has(to)) queue.push(to);
      }
    }
  }

  return { nodes, edges, issues, visited: [...visited] };
}

/** One neighbour a {@link boundedWalk} expansion offered, and the edge that carried it. */
export interface DdWalkStep<E> {
  key: string;
  edge: E;
}

export interface DdWalkBounds {
  /** Greatest distance from a seed a node may be scheduled at. */
  depth: number;
  /** Greatest number of nodes ever SCHEDULED, seeds included. */
  maxNodes: number;
}

export interface DdWalkVisit<E> {
  key: string;
  distance: number;
  /** The edge that scheduled this node — null for a seed. The tree edge. */
  via: E | null;
}

/** A neighbour the bounds refused to schedule, and which bound refused it. */
export interface DdWalkCut {
  key: string;
  reason: 'depth' | 'max-nodes';
}

export interface DdWalkResult<E> {
  /** Scheduled nodes in visit order, each with its distance from the nearest seed. */
  order: DdWalkVisit<E>[];
  /** Every edge followed between two nodes that are both in the answer. */
  edges: E[];
  cuts: DdWalkCut[];
}

/** The bounds a caller passes when it wants the whole component, unclipped. */
export const UNBOUNDED: DdWalkBounds = {
  depth: Number.POSITIVE_INFINITY,
  maxNodes: Number.POSITIVE_INFINITY,
};

/**
 * Breadth-first over an arbitrary keyed graph, with bounds that bind and cuts
 * that are reported rather than silently applied.
 *
 * There is one walk in this layer and this is it: `reachableFrom` is a
 * projection of it, and so is the address-level map (`map.ts`). Two walkers that
 * must agree about cycles and bounds eventually disagree, and the disagreement
 * shows up as a graph that is wrong rather than as a test that is red.
 *
 * **The bounds count SCHEDULED nodes, never expanded or loaded ones** (P4 F001,
 * where a tripwire denominated on loaded documents let a legitimate walk trip
 * itself). A node is counted the moment it is put on the queue, so `maxNodes` is
 * the size of the answer the caller gets back, exactly.
 *
 * Level order is what a shared budget buys: two arms seeded together are drained
 * a distance at a time, so one arm's DEEPER nodes can never displace the other
 * arm's nearer ones. Within a single expansion the order is whatever the caller
 * offered — level order bounds how unfair the split can get, it does not make it
 * even.
 *
 * A node at the depth bound is still expanded — but only so the neighbours it
 * would have reached can be REPORTED as cut. Nothing beyond the bound is
 * scheduled, because a truncated graph that looks complete is the worst answer
 * this can give. An edge between two nodes that BOTH made it into the answer is
 * always recorded, at any distance: hiding it would misdraw a cycle as a chain.
 * `via` separates the edge that first scheduled a node — the tree edge a reader
 * sees — from those closing edges.
 */
export function boundedWalk<E>(
  seeds: readonly string[],
  expand: (key: string, distance: number) => readonly DdWalkStep<E>[],
  bounds: DdWalkBounds,
): DdWalkResult<E> {
  const scheduled = new Set<string>();
  const order: DdWalkVisit<E>[] = [];
  const edges: E[] = [];
  const cuts: DdWalkCut[] = [];
  const cutKeys = new Set<string>();
  const queue: DdWalkVisit<E>[] = [];

  const cut = (key: string, reason: DdWalkCut['reason']): void => {
    const marker = `${reason}\u0000${key}`;
    if (cutKeys.has(marker)) return;
    cutKeys.add(marker);
    cuts.push({ key, reason });
  };

  for (const seed of seeds) {
    if (scheduled.has(seed)) continue;
    if (scheduled.size >= bounds.maxNodes) {
      cut(seed, 'max-nodes');
      continue;
    }
    scheduled.add(seed);
    queue.push({ key: seed, distance: 0, via: null });
  }

  let pops = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    // The same derived tripwire `traverseCorpus` carries: a node is scheduled at
    // most once, so pops can never exceed the scheduled count while the visited
    // discipline holds. A regression reddens in milliseconds instead of hanging.
    pops += 1;
    if (pops > scheduled.size) break;
    order.push(current);

    const atDepth = current.distance >= bounds.depth;
    for (const step of expand(current.key, current.distance)) {
      if (scheduled.has(step.key)) {
        edges.push(step.edge);
        continue;
      }
      if (atDepth) {
        cut(step.key, 'depth');
        continue;
      }
      if (scheduled.size >= bounds.maxNodes) {
        cut(step.key, 'max-nodes');
        continue;
      }
      scheduled.add(step.key);
      edges.push(step.edge);
      queue.push({ key: step.key, distance: current.distance + 1, via: step.edge });
    }
  }

  return { order, edges, cuts };
}

/**
 * Every document reachable from one seed, over an already-built edge list.
 *
 * This is how the doctor avoids re-walking a component once per document in it:
 * a walk rooted anywhere in a component already covers the whole component, so
 * the remaining seeds are skipped. Pure graph work — no I/O, and the same
 * visited-set discipline as the traversal, because the corpus really does
 * contain cycles.
 *
 * A projection of {@link boundedWalk} at radius infinity, rather than its own
 * loop: the doctor's reachability and `dd graph map`'s bounded walk are then the
 * same breadth-first traversal read two ways.
 */
export function reachableFrom(seed: string, edges: readonly DdLinkEdge[]): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.to === null) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const walk = boundedWalk<null>(
    [seed],
    (key) => (outgoing.get(key) ?? []).map((next) => ({ key: next, edge: null })),
    UNBOUNDED,
  );
  return new Set(walk.order.map((visit) => visit.key));
}
