import { describe, expect, it } from 'vitest';
import type { ExecScript } from '../../src/adapters/exec/fake-exec.js';
import { inspectBuilderOnTrack } from '../../src/services/builder/on-track-service.js';
import {
  builderContext,
  builderRecordPath,
  writeBuilderRecord,
} from '../../src/services/builder/records.js';
import type { BuilderRecord, BuilderResult } from '../../src/services/builder/types.js';
import {
  BUILDER_FIXTURE_GUIDE,
  BUILDER_FIXTURE_PLAN,
  BUILDER_FIXTURE_SHA,
  builderFixture,
  fixtureBaseline,
  fixtureComposition,
} from '../fixtures/builder-contracts.js';

const A = BUILDER_FIXTURE_SHA;
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const TEAM = '/repo/docs/plans/001-example/assets/team';
const META = 'docs/plans/001-example/assets/team/evidence.json';

function value<T>(result: BuilderResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

function scenario() {
  const scripts: Record<string, ExecScript> = {
    git: { code: 128, stderr: 'Unscripted Git operation' },
  };
  const git = (args: string[], stdout = '', code = 0) => {
    scripts[['git', '-c', 'core.hooksPath=', ...args].join(' ')] = {
      code,
      stdout,
      stderr: code ? 'Git inspection failed' : '',
    };
  };
  const f = builderFixture({}, scripts);
  const context = value(builderContext(f.deps, BUILDER_FIXTURE_PLAN));
  for (const ref of ['HEAD', A, B, C])
    git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], ref === 'HEAD' ? C : ref);
  for (const from of [A, B, C]) {
    git(['merge-base', '--is-ancestor', from, C]);
    git(['diff', '--name-only', '--no-renames', '-z', from, C]);
    git(['rev-list', '--reverse', `${from}..${C}`]);
  }
  git(['diff', '--name-only', '--no-renames', '-z']);
  git(['diff', '--cached', '--name-only', '--no-renames', '-z']);
  git(['ls-files', '--others', '--exclude-standard', '-z'], 'new.ts\0');
  const store = (record: BuilderRecord) =>
    value(writeBuilderRecord(f.deps, builderRecordPath(context, record.record_type), record));
  const mutations = () => ({
    writes: [...f.fs.writes],
    mkdirs: [...f.fs.mkdirs],
    deletes: [...f.fs.deletes],
    renames: [...f.fs.renames],
    appends: [...f.fs.appends],
  });
  return { ...f, git, store, mutations };
}

describe('Builder advisory on-track inspection', () => {
  it('inspects tracked current work on main without a seal, native calls or mutations', async () => {
    const s = scenario();
    s.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], 'main');
    s.git(
      ['diff', '--name-only', '--no-renames', '-z'],
      `src/parser.ts\0contracts.ts\0${META}\0.harness/friction.json\0`,
    );
    s.git(
      ['diff', '--cached', '--name-only', '--no-renames', '-z'],
      'src/renderer.ts\0src/main.ts\0docs/plans/002-other/source.ts\0src/parser.ts\0',
    );
    const before = s.mutations();
    const report = value(await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN }));
    expect(report).toEqual({
      compared: true,
      mode: 'pm',
      basis: 'head',
      from: C,
      to: C,
      includes_worktree: true,
      includes_untracked: false,
      issues: [],
      warnings: [
        { file: '.harness/friction.json', owning_unit: 'unmapped', stage: 'verify' },
        { file: 'docs/plans/002-other/source.ts', owning_unit: 'unmapped', stage: 'verify' },
        { file: 'src/parser.ts', owning_unit: 'tk-0002', stage: 'verify' },
        { file: 'src/renderer.ts', owning_unit: 'tk-0003', stage: 'verify' },
      ],
    });
    expect(s.mutations()).toEqual(before);
    expect(s.exec.calls.every((call) => call.command === 'git')).toBe(true);
    expect(
      s.exec.calls.some(
        (call) => call.args.includes('--others') || call.args.includes('symbolic-ref'),
      ),
    ).toBe(false);
  });

  it('includes new files only when explicitly requested', async () => {
    const s = scenario();
    const tracked = value(await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN }));
    expect(tracked.warnings).toEqual([]);
    const all = value(
      await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, untracked: true }),
    );
    expect(all.includes_untracked).toBe(true);
    expect(all.warnings).toEqual([{ file: 'new.ts', owning_unit: 'unmapped', stage: 'verify' }]);
  });

  it('selects imported PM history before baseline, while a named unit keeps its baseline basis', async () => {
    const s = scenario();
    s.store(fixtureBaseline());
    // Inspection reads the basis, not sealed file integrity or readiness.
    s.fs.writeText('/repo/contracts.ts', 'working contract changes');
    s.git(['diff', '--name-only', '--no-renames', '-z', A, C], 'baseline-only.ts\0');
    s.git(['diff', '--name-only', '--no-renames', '-z', B, C], 'post-import.ts\0');
    const baseline = value(
      await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, to: C }),
    );
    expect(baseline).toMatchObject({
      compared: true,
      basis: 'baseline',
      from: A,
      warnings: [{ file: 'baseline-only.ts' }],
    });
    s.store(fixtureComposition({ integration_sha: B }));
    const pm = value(await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, to: C }));
    expect(pm).toMatchObject({
      compared: true,
      mode: 'pm',
      basis: 'import',
      from: B,
      warnings: [{ file: 'post-import.ts' }],
    });
    const unit = value(
      await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, unit: 'tk-0002', to: C }),
    );
    expect(unit).toMatchObject({
      compared: true,
      mode: 'unit',
      unit_id: 'tk-0002',
      basis: 'baseline',
      from: A,
      warnings: [],
    });
  });

  it('uses explicit safely resolved refs and ignores all current work with an explicit to', async () => {
    const s = scenario();
    s.fs.writeText(`${TEAM}/baseline.dd.json`, '{broken baseline');
    s.fs.writeText(`${TEAM}/composition.dd.json`, '{broken import');
    s.git(['rev-parse', '--verify', '--end-of-options', '--option-like-ref^{commit}'], A);
    s.git(['rev-parse', '--verify', '--end-of-options', 'release-tag^{commit}'], C);
    s.git(['diff', '--name-only', '--no-renames', '-z', A, C], 'committed.ts\0');
    s.git(['diff', '--name-only', '--no-renames', '-z'], 'unstaged.ts\0');
    s.git(['diff', '--cached', '--name-only', '--no-renames', '-z'], 'staged.ts\0');
    const before = s.mutations();
    const report = value(
      await inspectBuilderOnTrack(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        from: '--option-like-ref',
        to: 'release-tag',
        untracked: true,
      }),
    );
    expect(report).toEqual({
      compared: true,
      mode: 'pm',
      basis: 'explicit',
      from: A,
      to: C,
      includes_worktree: false,
      includes_untracked: false,
      issues: [],
      warnings: [{ file: 'committed.ts', owning_unit: 'unmapped', stage: 'verify' }],
    });
    expect(s.mutations()).toEqual(before);
    expect(
      s.exec.calls.some((call) => call.args.includes('--cached') || call.args.includes('--others')),
    ).toBe(false);
  });

  it('keeps every committed coder touch including reverted writes and plan metadata', async () => {
    const s = scenario();
    s.store(fixtureBaseline());
    s.git(['rev-list', '--reverse', `${A}..${C}`], `${B}\n${C}`);
    for (const commit of [B, C])
      s.git(
        ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-m', '-r', '-z', commit],
        `src/renderer.ts\0src/parser.ts\0${META}\0`,
      );
    s.git(['diff', '--name-only', '--no-renames', '-z', A, C]);
    const pm = value(await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, to: C }));
    expect(pm.warnings).toEqual([]);
    const unit = value(
      await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, unit: 'tk-0002', to: C }),
    );
    expect(unit.warnings).toEqual([
      { file: META, owning_unit: 'unmapped', stage: 'delivery', unit_id: 'tk-0002' },
      { file: 'src/renderer.ts', owning_unit: 'tk-0003', stage: 'delivery', unit_id: 'tk-0002' },
    ]);
  });

  it('adds tracked and opt-in untracked observations to named-unit history', async () => {
    const s = scenario();
    s.store(fixtureBaseline());
    s.git(['rev-list', '--reverse', `${A}..${C}`], B);
    s.git(
      ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-m', '-r', '-z', B],
      'src/renderer.ts\0',
    );
    s.git(['diff', '--name-only', '--no-renames', '-z'], 'src/renderer.ts\0unstaged.ts\0');
    s.git(['diff', '--cached', '--name-only', '--no-renames', '-z'], 'staged.ts\0');
    const report = value(
      await inspectBuilderOnTrack(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        unit: 'tk-0002',
        untracked: true,
      }),
    );
    expect(report.warnings).toEqual([
      { file: 'new.ts', owning_unit: 'unmapped', stage: 'delivery', unit_id: 'tk-0002' },
      { file: 'src/renderer.ts', owning_unit: 'tk-0003', stage: 'delivery', unit_id: 'tk-0002' },
      { file: 'staged.ts', owning_unit: 'unmapped', stage: 'delivery', unit_id: 'tk-0002' },
      { file: 'unstaged.ts', owning_unit: 'unmapped', stage: 'delivery', unit_id: 'tk-0002' },
    ]);
  });

  it.each([
    'guide',
    'import',
    'baseline',
  ])('reports malformed existing %s data without fallback or mutation', async (kind) => {
    const s = scenario();
    const path =
      kind === 'guide'
        ? `/repo/${BUILDER_FIXTURE_GUIDE}`
        : `${TEAM}/${kind === 'import' ? 'composition' : 'baseline'}.dd.json`;
    s.fs.writeText(path, '{malformed canonical data');
    const before = s.mutations();
    const report = value(await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN }));
    expect(report).toMatchObject({
      compared: false,
      warnings: [],
      issues: [{ code: 'E470', message: expect.any(String), next_action: expect.any(String) }],
    });
    expect(report.basis).toBe(kind === 'guide' ? undefined : kind);
    expect(s.exec.calls).toEqual([]);
    expect(s.mutations()).toEqual(before);
  });

  it('reports an unknown unit instead of silently comparing the PM maps', async () => {
    const s = scenario();
    const report = value(
      await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN, unit: 'tk-missing' }),
    );
    expect(report).toMatchObject({
      compared: false,
      mode: 'unit',
      unit_id: 'tk-missing',
      warnings: [],
      issues: [{ message: expect.stringContaining('tk-missing'), next_action: expect.any(String) }],
    });
    expect(s.exec.calls).toEqual([]);
  });

  it.each([
    'ref',
    'ancestry',
    'delta',
    'worktree',
    'history',
  ])('returns incomplete inspection data after unavailable %s evidence', async (kind) => {
    const s = scenario();
    s.store(fixtureBaseline());
    if (kind === 'ref')
      s.git(['rev-parse', '--verify', '--end-of-options', `${A}^{commit}`], '', 128);
    if (kind === 'ancestry') s.git(['merge-base', '--is-ancestor', A, C], '', 1);
    if (kind === 'delta') s.git(['diff', '--name-only', '--no-renames', '-z', A, C], '', 128);
    if (kind === 'worktree')
      s.git(['diff', '--cached', '--name-only', '--no-renames', '-z'], '', 128);
    if (kind === 'history') s.git(['rev-list', '--reverse', `${A}..${C}`], '', 128);
    const before = s.mutations();
    const report = value(
      await inspectBuilderOnTrack(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        ...(kind === 'history' && { unit: 'tk-0002' }),
      }),
    );
    expect(report).toMatchObject({
      compared: false,
      basis: 'baseline',
      warnings: [],
      issues: [{ code: 'E475', message: expect.any(String), next_action: expect.any(String) }],
    });
    expect(s.mutations()).toEqual(before);
  });

  it('reports an out-of-plan baseline path without reading outside the plan', async () => {
    const s = scenario();
    const guidePath = `/repo/${BUILDER_FIXTURE_GUIDE}`;
    const doc = JSON.parse(s.fs.readText(guidePath) as string);
    doc.sections.find((section: { name: string }) => section.name === 'baseline').value.receipt =
      '../../../../../outside.dd.json';
    s.fs.writeText(guidePath, JSON.stringify(doc));
    const report = value(await inspectBuilderOnTrack(s.deps, { plan: BUILDER_FIXTURE_PLAN }));
    expect(report).toMatchObject({
      compared: false,
      issues: [{ code: 'E470', next_action: expect.any(String) }],
    });
    expect(s.fs.reads.some((path) => path.endsWith('/outside.dd.json'))).toBe(false);
  });
});
