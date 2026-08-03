import { resolveInRepo } from '../../shared/posix-path.js';
import { isAddressFailure, parseAddress } from '../core/address.js';
import { resolveAddressFile } from '../core/validate.js';
import type { DdCorpusGraph, DdLinkEdge } from './model.js';

export interface DdLinksReport {
  /** The document the report is about, absolute and POSIX-logical. */
  path: string;
  /** The argument as given, normalized — an address keeps its interior. */
  target: string;
  /** Edges written in this document. */
  outbound: DdLinkEdge[];
  /** Edges anywhere in the corpus that land in this document. */
  inbound: DdLinkEdge[];
}

/**
 * Resolve the `dd links <target>` argument to a document path.
 *
 * The argument is either a path or an address; an address's interior selects
 * nothing extra, because edges are a property of documents (D11). Reporting at
 * document granularity is the honest answer to "what points here" — a cell's
 * address names a document plus a location inside it, and both are already in
 * the edge.
 */
export function resolveLinksTarget(target: string, repoRoot: string): string {
  const parsed = parseAddress(target);
  if (isAddressFailure(parsed) || parsed.file === null) {
    return resolveInRepo(target.split('#')[0] ?? target, repoRoot);
  }
  return resolveAddressFile(`${repoRoot}/_`, parsed.file);
}

/**
 * Inbound and outbound edges for one document, read off a traversal.
 *
 * Nothing is stored and nothing is indexed (D11): the corpus is scanned, the
 * graph is built, and the answer is a filter over it. A link that was deleted
 * upstream stops being reported the moment it is deleted, because there is no
 * cached edge to go stale.
 */
export function linksFor(path: string, graph: DdCorpusGraph, target = path): DdLinksReport {
  return {
    path,
    target,
    outbound: graph.edges.filter((edge) => edge.from === path),
    inbound: graph.edges.filter((edge) => edge.to === path && edge.from !== path),
  };
}
