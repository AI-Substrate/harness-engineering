import { posixRelative } from '../../shared/posix-path.js';
import type { DdCorpusGraph, DdLinkEdge } from './model.js';

interface MermaidNode {
  id: string;
  label: string;
  resolved: boolean;
}

function escapeLabel(text: string): string {
  return text.replaceAll('"', "'");
}

function relative(repoRoot: string, path: string): string {
  const rel = posixRelative(repoRoot, path);
  return rel.length > 0 ? rel : path;
}

/**
 * Emit the graph as mermaid, directly.
 *
 * This is a string, built here, on purpose: `dd graph` must not reach into the
 * render layer. Phases 3 and 4 were split so they could land in parallel, and a
 * renderer import is the one dependency that would quietly re-couple them — so
 * the coupling is forbidden by an architecture rule, and this function is what
 * makes obeying it cheap (Opus F1b).
 *
 * Output is deterministic: nodes are sorted by path and numbered from that order,
 * edges are sorted by origin then by cell location. The same corpus always
 * produces the same bytes, which is what makes the output diffable and testable.
 */
export function toMermaid(graph: DdCorpusGraph, repoRoot: string): string {
  const nodes = new Map<string, MermaidNode>();
  for (const node of [...graph.nodes].sort((a, b) => a.path.localeCompare(b.path))) {
    if (nodes.has(node.path)) continue;
    nodes.set(node.path, {
      id: `n${nodes.size}`,
      label: relative(repoRoot, node.path),
      resolved: true,
    });
  }

  const edges = [...graph.edges].sort((a, b) =>
    a.from === b.from ? a.location.localeCompare(b.location) : a.from.localeCompare(b.from),
  );
  const unresolvedKey = (edge: DdLinkEdge): string => edge.to ?? `address:${edge.address}`;
  for (const edge of edges) {
    const key = unresolvedKey(edge);
    if (nodes.has(key)) continue;
    nodes.set(key, {
      id: `u${nodes.size}`,
      label: edge.to ? relative(repoRoot, edge.to) : edge.address,
      resolved: false,
    });
  }

  const lines = ['flowchart LR'];
  for (const node of nodes.values()) {
    lines.push(`  ${node.id}["${escapeLabel(node.label)}"]`);
  }
  for (const edge of edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(unresolvedKey(edge));
    if (!from || !to) continue;
    lines.push(`  ${from.id} ${to.resolved ? '-->' : '-.->'} ${to.id}`);
  }

  const unresolved = [...nodes.values()].filter((node) => !node.resolved);
  if (unresolved.length > 0) {
    lines.push('  classDef unresolved stroke-dasharray: 4 3;');
    lines.push(`  class ${unresolved.map((node) => node.id).join(',')} unresolved;`);
  }
  return `${lines.join('\n')}\n`;
}
