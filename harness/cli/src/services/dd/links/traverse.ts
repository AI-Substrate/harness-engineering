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
 * failure, the walk also carries a *derived* tripwire: with the breaker in place
 * every queued document is popped at most once, so the number of pops can never
 * exceed the seeds plus the distinct documents actually loaded. Exceeding that
 * bound is structurally impossible unless the breaker is gone — so a regression
 * reddens a bounded test in milliseconds instead of hanging it. The bound is
 * derived from the corpus, not an invented ceiling (P2 DL-006), and it can never
 * fire on a well-formed run however large the repository is.
 */
export function traverseCorpus(
  seeds: readonly string[],
  deps: DdTraverseDeps,
  options: DdTraverseOptions,
): DdCorpusGraph {
  const follow = options.follow ?? true;
  const seedSet = new Set(seeds);
  const visited = new Set<string>();
  const loaded = new Set<string>();
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
    if (pops > seeds.length + loaded.size) {
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
    loaded.add(path);
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
        sameDocument,
        ...(cell.target && { target: cell.target }),
      });
      if (follow && within && !visited.has(to)) queue.push(to);
    }
  }

  return { nodes, edges, issues, visited: [...visited] };
}

/**
 * Every document reachable from one seed, over an already-built edge list.
 *
 * This is how the doctor avoids re-walking a component once per document in it:
 * a walk rooted anywhere in a component already covers the whole component, so
 * the remaining seeds are skipped. Pure graph work — no I/O, and the same
 * visited-set discipline as the traversal, because the corpus really does
 * contain cycles.
 */
export function reachableFrom(seed: string, edges: readonly DdLinkEdge[]): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.to === null) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const reached = new Set<string>([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of outgoing.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}
