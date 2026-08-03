import type { DdIssue, DdIssueClass, DdSeverity, SchemaResolver } from '../core/validate.js';
import { type DocLoader, shouldExcludeFromSweep, validateWalk } from '../core/walk.js';
import type { SchemaFs } from '../schema/model.js';
import { MemoizingDocLoader } from './loader.js';
import {
  type DdAdapterGap,
  type DdAdapterGapSource,
  type DdCorpusGraph,
  type DdLinkIssueClass,
  type DdLinkUnresolvedReason,
  linkIssue,
} from './model.js';
import { resolveLink } from './resolver.js';
import { scanCorpus } from './scan.js';
import { reachableFrom, traverseCorpus } from './traverse.js';

export interface DdDoctorDeps {
  schemaResolver: SchemaResolver;
  docLoader: DocLoader;
  /** Phase 3's aggregation, injected. Absent simply means no adapter findings. */
  adapterGaps?: DdAdapterGapSource;
}

export interface DdDoctorOptions {
  repoRoot: string;
  /** The subtree to sweep. Scopes the ROOT SET; the radius stays infinite. */
  root: string;
}

export interface DdDoctorFinding {
  class: DdIssueClass | DdLinkIssueClass;
  severity: DdSeverity;
  location: string;
  message: string;
  owner: string;
  reason?: DdLinkUnresolvedReason;
  /** Present only on `adapter-gap` findings; the act maps it onto E423-E426. */
  adapterKind?: DdAdapterGap['kind'];
}

export interface DdDoctorReport {
  root: string;
  /** Documents enumerated by the scan, before exclusions. */
  discovered: string[];
  /** Documents the sweep actually inspected. */
  swept: string[];
  findings: DdDoctorFinding[];
  counts: { error: number; warn: number };
  graph: DdCorpusGraph;
}

/**
 * The interior-resolution reasons the doctor owns.
 *
 * Everything else a failed resolution can say is already reported, at its ruled
 * severity, by a layer that got there first: a missing or untracked target and a
 * path that leaves the repository are WARNs from dd-core's validator and walk
 * (workshop 001 § Resolution), a malformed address is its ERROR, and a target
 * whose schema will not resolve raises that ERROR against the target itself when
 * the sweep reaches it. Repeating any of those here would double-report it — and
 * reporting a missing file as an ERROR would contradict the severity table
 * outright. What no other layer does is follow the interior, so that is exactly
 * what this pass adds.
 */
const INTERIOR_REASONS = new Set<DdLinkUnresolvedReason>([
  'id-not-found',
  'not-a-container',
  'part-unknown',
  'section-unknown',
]);

function key(finding: DdDoctorFinding): string {
  return `${finding.owner}|${finding.class}|${finding.location}|${finding.message}`;
}

/**
 * `dd doctor` — the validate engine at radius ∞ (W8, plan 4.5).
 *
 * The engine is P1's: every document is validated by `validateDocument` through
 * `validateWalk`, run at infinite depth so a finding anywhere in a document's
 * outbound neighbourhood surfaces. The doctor adds three things that only exist
 * once you look at the whole corpus at once — the enumeration that produces the
 * roots, the interior-resolution pass, and the render layer's adapter gaps.
 *
 * A walk rooted anywhere in a connected component covers that whole component,
 * so components are walked once rather than once per document; findings are
 * deduped regardless, because components overlap wherever two of them point at
 * the same document.
 *
 * Exclusions are the sweep's, and only the sweep's (OD-1): `sweep_exclude` and
 * fixture paths are skipped here, and never by a direct `dd validate`. That is
 * what lets a repository keep a known-bad corpus committed and still run a green
 * `harness checks` (AC-15).
 */
export function runDoctor(
  fs: SchemaFs,
  deps: DdDoctorDeps,
  options: DdDoctorOptions,
): DdDoctorReport {
  const docLoader = new MemoizingDocLoader(deps.docLoader);
  const walkDeps = { schemaResolver: deps.schemaResolver, docLoader };
  const scan = scanCorpus(fs, options.root);
  const findings: DdDoctorFinding[] = [...scan.issues];

  const graph = traverseCorpus(scan.paths, walkDeps, {
    repoRoot: options.repoRoot,
    mode: 'sweep',
  });
  findings.push(...graph.issues);

  const swept = graph.nodes.filter((node) => !node.external).map((node) => node.path);
  const covered = new Set<string>();
  const walkIssues: DdIssue[] = [];
  for (const path of swept) {
    if (covered.has(path)) continue;
    const loaded = docLoader.load(path);
    if (!loaded.ok) continue;
    walkIssues.push(
      ...validateWalk(loaded.doc, path, walkDeps, {
        repoRoot: options.repoRoot,
        depth: Number.POSITIVE_INFINITY,
        mode: 'sweep',
      }),
    );
    for (const reached of reachableFrom(path, graph.edges)) covered.add(reached);
  }
  findings.push(...walkIssues);

  // Radius ∞ means every document the traversal REACHED, not only the ones the
  // root set named. `--path` scopes which documents seed the sweep; it does not
  // cap the walk, so an invalid interior in a document reached beyond the scoped
  // subtree is still this doctor's finding. `graph.nodes` is exactly the reached
  // and non-excluded set — a document skipped by `sweep_exclude` never became a
  // node, so the exclusion contract survives unchanged. `swept` stays the
  // root-set metric the envelope reports.
  const reached = new Set(graph.nodes.map((node) => node.path));
  for (const edge of graph.edges) {
    if (!reached.has(edge.from)) continue;
    const resolution = resolveLink(edge.address, walkDeps, {
      repoRoot: options.repoRoot,
      fromPath: edge.from,
      location: edge.location,
      owner: edge.from,
    });
    if (resolution.ok) continue;
    findings.push(
      ...resolution.issues.filter(
        (issue) => issue.reason !== undefined && INTERIOR_REASONS.has(issue.reason),
      ),
    );
  }

  for (const gap of deps.adapterGaps?.adapterGaps([...reached]) ?? []) {
    findings.push(adapterFinding(gap));
  }

  const deduped: DdDoctorFinding[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const id = key(finding);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(finding);
  }

  return {
    root: options.root,
    discovered: scan.paths,
    swept,
    findings: deduped,
    counts: {
      error: deduped.filter((finding) => finding.severity === 'ERROR').length,
      warn: deduped.filter((finding) => finding.severity === 'WARN').length,
    },
    graph,
  };
}

/** AC-04: the doctor repeats a render-layer adapter gap as a WARN, never louder. */
function adapterFinding(gap: DdAdapterGap): DdDoctorFinding {
  const where = [gap.schema, gap.type].filter(Boolean).join('/');
  return {
    ...linkIssue(
      'adapter-gap',
      'WARN',
      where.length > 0 ? `$.adapters[${where}]` : '$.adapters',
      gap.message,
      gap.path,
    ),
    adapterKind: gap.kind,
  };
}

export { shouldExcludeFromSweep };
