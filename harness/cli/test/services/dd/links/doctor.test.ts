import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../../../src/services/dd/links/doctor.js';
import type { DdAdapterGapSource } from '../../../../src/services/dd/links/model.js';
import { deps, docPath, FixtureDocLoader, FixtureFs, REPO } from './helpers.js';

function doctor(adapterGaps?: DdAdapterGapSource, root = REPO) {
  const loader = new FixtureDocLoader();
  return {
    loader,
    report: runDoctor(
      new FixtureFs(),
      { ...deps(loader), ...(adapterGaps && { adapterGaps }) },
      { repoRoot: REPO, root },
    ),
  };
}

const owners = (report: ReturnType<typeof doctor>['report'], issueClass: string) =>
  report.findings.filter((finding) => finding.class === issueClass).map((finding) => finding.owner);

describe('dd doctor — the validate engine at radius infinity', () => {
  it('sweeps the corpus and terminates on it', () => {
    const { report } = doctor();
    expect(report.discovered.length).toBeGreaterThanOrEqual(23);
    expect(report.swept.length).toBeGreaterThan(0);
    expect(report.findings.filter((finding) => finding.class === 'link-scan-failed')).toEqual([]);
  });

  it.each([
    ['section-unknown', 'docs/unresolved-section.dd.json'],
    ['part-unknown', 'docs/unresolved-part.dd.json'],
    ['id-not-found', 'docs/unresolved-id.dd.json'],
    ['not-a-container', 'docs/unresolved-not-a-container.dd.json'],
  ] as const)('reports interior reason %s as an ERROR on %s', (reason, relative) => {
    const { report } = doctor();
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'link-unresolved',
          severity: 'ERROR',
          reason,
          owner: docPath(relative),
        }),
      ]),
    );
  });

  it.each([
    ['address-path-absolute', 'WARN'],
    ['address-path-non-posix', 'WARN'],
    ['address-path-escape', 'WARN'],
    ['address-target-missing', 'WARN'],
    ['address-target-untracked', 'WARN'],
    ['basis-stale', 'WARN'],
    ['link-type-mismatch', 'ERROR'],
    ['state-note-required', 'ERROR'],
  ] as const)('carries the workshop-001 severity for %s', (issueClass, severity) => {
    const { report } = doctor();
    const found = report.findings.filter((finding) => finding.class === issueClass);
    expect(found.length).toBeGreaterThan(0);
    for (const finding of found) expect(finding.severity).toBe(severity);
  });

  it('owns a finding by the file that must change', () => {
    const { report } = doctor();
    // `plan-cites-broken` is clean; the document it cites is not. The finding
    // surfaces on the sweep, but it belongs to the neighbour, because the
    // neighbour is what has to be edited to fix it.
    expect(owners(report, 'state-note-required')).toContain(
      docPath('docs/broken-neighbour.dd.json'),
    );
    expect(owners(report, 'state-note-required')).not.toContain(
      docPath('docs/plan-cites-broken.dd.json'),
    );
  });

  it('reports each finding once, however many roots reach it', () => {
    const { report } = doctor();
    const keys = report.findings.map(
      (finding) => `${finding.owner}|${finding.class}|${finding.location}|${finding.message}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(report.counts.error).toBe(
      report.findings.filter((finding) => finding.severity === 'ERROR').length,
    );
  });

  it('does not report a missing target twice, or at the wrong severity', () => {
    // Resolution cannot reach a target that is not there, but "the file is
    // missing" is already a WARN from the walk — promoting it to an unresolved
    // ERROR here would contradict the severity table.
    const { report } = doctor();
    const missing = report.findings.filter(
      (finding) => finding.owner === docPath('docs/target-missing.dd.json'),
    );
    expect(missing).toEqual([
      expect.objectContaining({ class: 'address-target-missing', severity: 'WARN' }),
    ]);
  });
});

describe('dd doctor — the exclusion contract (OD-1, AC-15)', () => {
  it('skips an opted-out document and every finding inside it', () => {
    const { report } = doctor();
    const excluded = docPath('docs/sweep-excluded.dd.json');
    expect(report.discovered).toContain(excluded);
    expect(report.swept).not.toContain(excluded);
    expect(report.findings.some((finding) => finding.owner === excluded)).toBe(false);
  });
});

describe('dd doctor — adapter gaps (AC-04, consumed by interface)', () => {
  it('repeats a render-layer adapter gap as a WARN', () => {
    // Phase 3 owns the aggregation; Phase 4 owns only this seam, so the source is
    // faked against the declared shape and no Phase 3 module is imported.
    const source: DdAdapterGapSource = {
      adapterGaps: (paths) => [
        {
          path: paths[0] ?? docPath('docs/plan.dd.json'),
          kind: 'not-found',
          message: 'no adapter for type "burndown"',
          schema: 'links/plan',
          type: 'burndown',
        },
      ],
    };
    const { report } = doctor(source);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'adapter-gap',
          severity: 'WARN',
          location: '$.adapters[links/plan/burndown]',
        }),
      ]),
    );
  });

  it('reports nothing extra when the render layer is absent', () => {
    const withSource = doctor({ adapterGaps: () => [] }).report.findings.length;
    expect(doctor().report.findings).toHaveLength(withSource);
  });
});

describe('dd doctor — scoping', () => {
  it('scopes the root set without changing the radius', () => {
    const { report } = doctor(undefined, `${REPO}/docs/nested`);
    expect(report.discovered).toEqual([
      docPath('docs/nested/child.dd.json'),
      docPath('docs/nested/gateway.dd.json'),
    ]);
    // Radius stays infinite: the walk still leaves the scoped subtree by link.
    expect(report.graph.nodes.map((node) => node.path)).toContain(docPath('docs/plan.dd.json'));
    expect(report.swept).toEqual([
      docPath('docs/nested/child.dd.json'),
      docPath('docs/nested/gateway.dd.json'),
    ]);
  });

  it('reports a bad interior in a document reached BEYOND the scoped subtree', () => {
    // F002 regression. `--path` scopes which documents SEED the sweep; it never
    // caps the walk. `beyond-scope.dd.json` sits outside the scoped subtree and is
    // reached only by a link from inside it — and it is broken on its own terms.
    // Driving the interior pass from the root set alone silently dropped this
    // finding, which is precisely the class of miss a radius-∞ doctor exists to
    // prevent.
    const { report } = doctor(undefined, `${REPO}/docs/nested`);
    const beyond = docPath('docs/beyond-scope.dd.json');
    expect(report.swept).not.toContain(beyond);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'link-unresolved',
          severity: 'ERROR',
          reason: 'section-unknown',
          owner: beyond,
        }),
      ]),
    );
  });

  it('offers adapter-gap aggregation every reached document, not just the seeds', () => {
    const seen: string[] = [];
    const source: DdAdapterGapSource = {
      adapterGaps: (paths) => {
        seen.push(...paths);
        return [];
      },
    };
    doctor(source, `${REPO}/docs/nested`);
    expect(seen).toContain(docPath('docs/beyond-scope.dd.json'));
    expect(seen).toContain(docPath('docs/nested/gateway.dd.json'));
  });

  it('still excludes an opted-out document from the reached set', () => {
    // The widened pass must not widen past the exclusion contract: a document
    // skipped by `sweep_exclude` never becomes a node, so it is not "reached".
    const seen: string[] = [];
    const source: DdAdapterGapSource = {
      adapterGaps: (paths) => {
        seen.push(...paths);
        return [];
      },
    };
    const { report } = doctor(source);
    const excluded = docPath('docs/sweep-excluded.dd.json');
    expect(seen).not.toContain(excluded);
    expect(report.findings.some((finding) => finding.owner === excluded)).toBe(false);
  });
});
