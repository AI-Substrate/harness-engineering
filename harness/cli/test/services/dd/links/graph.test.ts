import { describe, expect, it } from 'vitest';
import { toMermaid } from '../../../../src/services/dd/links/graph.js';
import { linksFor, resolveLinksTarget } from '../../../../src/services/dd/links/report.js';
import { scanCorpus } from '../../../../src/services/dd/links/scan.js';
import { traverseCorpus } from '../../../../src/services/dd/links/traverse.js';
import { deps, docPath, FixtureFs, REPO } from './helpers.js';

function corpus(seeds?: string[]) {
  const paths = seeds ?? scanCorpus(new FixtureFs(), REPO).paths;
  return traverseCorpus(paths, deps(), { repoRoot: REPO, mode: 'sweep' });
}

describe('dd graph — direct mermaid emission', () => {
  it('emits a valid, deterministic mermaid flowchart', () => {
    const graph = corpus([docPath('docs/plan.dd.json')]);
    const mermaid = toMermaid(graph, REPO);
    expect(mermaid).toBe(
      [
        'flowchart LR',
        '  n0["docs/evidence.dd.json"]',
        '  n1["docs/plan.dd.json"]',
        '  n1 --> n0',
        '  n1 --> n0',
        '',
      ].join('\n'),
    );
    expect(toMermaid(corpus([docPath('docs/plan.dd.json')]), REPO)).toBe(mermaid);
  });

  it('draws an unresolved target as a dashed edge instead of dropping it', () => {
    const mermaid = toMermaid(corpus([docPath('docs/target-missing.dd.json')]), REPO);
    expect(mermaid).toContain('-.->');
    expect(mermaid).toContain('docs/missing.dd.json');
    expect(mermaid).toContain('classDef unresolved');
  });

  it('labels an out-of-repo edge by its address, since it has no node', () => {
    const mermaid = toMermaid(corpus([docPath('docs/path-escape.dd.json')]), REPO);
    expect(mermaid).toContain('["../../../outside.dd.json#entries"]');
  });

  it('covers the whole corpus without emitting a duplicate node', () => {
    const mermaid = toMermaid(corpus(), REPO);
    const ids = [...mermaid.matchAll(/^ {2}([nu]\d+)\[/gm)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mermaid.startsWith('flowchart LR\n')).toBe(true);
  });
});

describe('dd links — inbound and outbound, by local scan', () => {
  const plan = docPath('docs/plan.dd.json');
  const evidence = docPath('docs/evidence.dd.json');

  it('reports what a document points at', () => {
    const report = linksFor(plan, corpus());
    expect(report.outbound.map((edge) => edge.address)).toEqual([
      'evidence.dd.json#entries',
      'evidence.dd.json#entries/ev-5e6f',
    ]);
  });

  it('reports what points at a document, across folders', () => {
    const report = linksFor(plan, corpus());
    expect(report.inbound.map((edge) => edge.from)).toContain(docPath('docs/nested/child.dd.json'));
  });

  it('finds every citer of a widely-referenced document', () => {
    const report = linksFor(evidence, corpus());
    const citers = new Set(report.inbound.map((edge) => edge.from));
    expect(citers).toContain(plan);
    expect(citers).toContain(docPath('docs/basis-stale.dd.json'));
    expect(citers).toContain(docPath('docs/type-match.dd.json'));
    expect(report.outbound).toEqual([]);
  });

  it('never counts a document as its own inbound edge', () => {
    const selfCycle = docPath('docs/self-cycle.dd.json');
    const report = linksFor(selfCycle, corpus());
    expect(report.outbound).toHaveLength(1);
    expect(report.inbound).toEqual([]);
  });

  it.each([
    ['docs/plan.dd.json', docPath('docs/plan.dd.json')],
    ['docs/plan.dd.json#phases/ph-1a2b', docPath('docs/plan.dd.json')],
    [docPath('docs/plan.dd.json'), docPath('docs/plan.dd.json')],
  ])('resolves the target argument %s to a document', (given, expected) => {
    expect(resolveLinksTarget(given, REPO)).toBe(expected);
  });
});
