import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecScript } from '../../src/adapters/exec/fake-exec.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import {
  checkBuilderReadiness,
  sealBuilderContracts,
} from '../../src/services/builder/contracts-service.js';
import { checkBuilderGuide, readBuilderGuide } from '../../src/services/builder/guide-service.js';
import {
  digestBuilderFile,
  readBuilderRecord,
  sha256,
  writeBuilderRecord,
} from '../../src/services/builder/records.js';
import type {
  BaselineReceipt,
  BuilderResult,
  Guide,
  ReviewReceipt,
} from '../../src/services/builder/types.js';
import { posixDirname, posixJoin, toPosix } from '../../src/services/shared/posix-path.js';
import {
  BUILDER_FIXTURE_GUIDE,
  BUILDER_FIXTURE_PLAN,
  BUILDER_FIXTURE_SHA,
  builderFixture,
  fixtureBaseline,
  fixtureCheck,
  fixtureComposition,
  fixtureGuide,
  fixtureReview,
} from '../fixtures/builder-contracts.js';

const criteria = [{ id: 'ac-0001' }, { id: 'ac-0002' }];
const reviewPath = 'docs/plans/001-example/assets/team/review-decomposition.dd.json';
const baselinePath = 'docs/plans/001-example/assets/team/baseline.dd.json';
const reportPath = 'docs/plans/001-example/assets/reviews/decomposition.json';
function value<T>(result: BuilderResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}
function guideJson(guide: Guide): string {
  return JSON.stringify({
    dd: { schema: 'builder/impl-guide' },
    sections: Object.entries(guide).map(([name, section]) => ({ name, value: section })),
    references: [],
  });
}
function soloGuide(): Guide {
  const guide = fixtureGuide();
  const unit = guide.units[0];
  unit.acceptance = criteria.map(({ id }) => `../plan.dd.json#acceptance_criteria/${id}`);
  guide.units = [unit];
  guide.capabilities = guide.capabilities.map((capability) => ({
    ...capability,
    owner: unit.id,
    proof: unit.proof,
  }));
  guide.fan_out = {
    decision: 'solo-pm',
    rationale: 'One small responsibility needs no peer fan-out.',
  };
  guide.isolation.mode = 'solo';
  guide.composition = {
    owner: unit.id,
    order: [],
    steps: ['Exercise the integrated PM-owned capability.'],
    proof: unit.proof,
  };
  guide.roles = [];
  return guide;
}

describe('implementation guide structure', () => {
  it('accepts owned independent units without claiming architectural review', () => {
    expect(checkBuilderGuide(fixtureGuide(), criteria)).toEqual({
      valid: true,
      issues: [],
      warnings: [],
      architectural_judgement: 'not-performed',
    });
  });
  it('accepts an honest solo PM without manufacturing coders or role defaults', () => {
    expect(checkBuilderGuide(soloGuide(), criteria).valid).toBe(true);
  });
  it('accepts the capability map as the observable-owner declaration without duplicate unit AC rows', () => {
    const guide = fixtureGuide();
    guide.capabilities = guide.capabilities.map((capability) => ({
      ...capability,
      owner: 'tk-0004',
    }));
    expect(guide.units[3].acceptance).toEqual([]);
    expect(checkBuilderGuide(guide, criteria).valid).toBe(true);
  });
  it('warns for both owners of nested subtree collisions without invalidating the guide', () => {
    const guide = fixtureGuide();
    guide.units[1].paths = ['src/parser/**', 'test/parser.test.ts'];
    guide.units[3].reads[0].paths = ['src/parser/index.ts'];
    expect(checkBuilderGuide(guide, criteria).valid).toBe(true);
    guide.units[2].paths.push('src/parser/nested.ts');
    const report = checkBuilderGuide(guide, criteria);
    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual(
      expect.arrayContaining(
        ['tk-0002', 'tk-0003'].map((owning_unit) =>
          expect.objectContaining({
            code: 'write-overlap',
            file: 'src/parser/nested.ts',
            owning_unit,
            stage: 'guide',
          }),
        ),
      ),
    );
  });
  it('warns about subtree read coverage without prefix sibling leakage', () => {
    const guide = fixtureGuide();
    guide.units[1].paths = ['src/parser/**', 'test/parser.test.ts'];
    guide.units[3].reads[0].paths = ['src/parser/**'];
    expect(checkBuilderGuide(guide, criteria).valid).toBe(true);
    guide.units[3].reads[0].paths = ['src/parser-other/**'];
    const report = checkBuilderGuide(guide, criteria);
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        code: 'read-coverage',
        file: 'src/parser-other/**',
        owning_unit: 'tk-0002',
      }),
    );
  });
  const cases: Array<[string, (guide: Guide) => void, string]> = [
    [
      'empty units',
      (guide) => {
        guide.units = [];
      },
      'empty',
    ],
    [
      'empty contracts',
      (guide) => {
        guide.architecture.contracts = [];
      },
      'empty',
    ],
    [
      'blank rationale',
      (guide) => {
        guide.fan_out.rationale = ' ';
      },
      'empty',
    ],
    [
      'empty capability map',
      (guide) => {
        guide.capabilities = [];
      },
      'capability-gap',
    ],
    [
      'producer without observable owner',
      (guide) => {
        guide.capabilities.pop();
      },
      'capability-gap',
    ],
    [
      'unknown capability owner',
      (guide) => {
        guide.capabilities[0].owner = 'missing';
      },
      'capability-owner',
    ],
    [
      'empty capability owner',
      (guide) => {
        guide.capabilities[0].owner = '';
      },
      'capability-owner',
    ],
    [
      'unknown criterion',
      (guide) => {
        guide.units[1].acceptance = ['../plan.dd.json#acceptance_criteria/missing'];
      },
      'unknown-criterion',
    ],
    [
      'criterion in another plan',
      (guide) => {
        guide.capabilities[0].criterion = '../other.dd.json#acceptance_criteria/ac-0001';
      },
      'unknown-criterion',
    ],
    [
      'duplicate units',
      (guide) => {
        guide.units[1].id = guide.units[0].id;
      },
      'duplicate-id',
    ],
    [
      'unknown dependency',
      (guide) => {
        guide.units[1].depends_on = ['missing'];
      },
      'dependency',
    ],
    [
      'cyclic dependencies',
      (guide) => {
        guide.units[0].depends_on = ['tk-0002'];
      },
      'cycle',
    ],
    [
      'backward wave',
      (guide) => {
        guide.units[1].wave = 0;
      },
      'wave',
    ],
    [
      'fractional wave',
      (guide) => {
        guide.units[1].wave = 1.5;
      },
      'wave',
    ],
    [
      'same write path',
      (guide) => {
        guide.units[2].paths.push('src/parser.ts');
      },
      'write-overlap',
    ],
    [
      'nested write fence',
      (guide) => {
        guide.units[2].paths.push('src/**');
      },
      'write-overlap',
    ],
    [
      'unconfined write path',
      (guide) => {
        guide.units[1].paths.push('../escape.ts');
      },
      'map-path',
    ],
    [
      'ambiguous glob fence',
      (guide) => {
        guide.units[1].paths.push('src/*.ts');
      },
      'map-path',
    ],
    [
      'unknown read owner',
      (guide) => {
        guide.units[1].reads[0].owner = 'missing';
      },
      'read-owner',
    ],
    [
      'read ownership gap',
      (guide) => {
        guide.units[1].reads[0].paths = ['unowned.ts'];
      },
      'read-coverage',
    ],
    [
      'undeclared read dependency',
      (guide) => {
        guide.units[1].depends_on = [];
      },
      'read-owner',
    ],
    [
      'empty proof',
      (guide) => {
        guide.units[1].proof = [];
      },
      'empty',
    ],
    [
      'unknown proof',
      (guide) => {
        guide.units[1].proof = ['impl-guide.dd.json#checks/missing'];
      },
      'unknown-check',
    ],
    [
      'proof in different guide',
      (guide) => {
        guide.units[1].proof = ['other.dd.json#checks/vd-0002'];
      },
      'unknown-check',
    ],
    [
      'unbounded check',
      (guide) => {
        guide.checks[0].timeout_ms = 0;
      },
      'executable-check',
    ],
    [
      'escaping check cwd',
      (guide) => {
        guide.checks[0].cwd = '..';
      },
      'executable-check',
    ],
    [
      'empty baseline',
      (guide) => {
        guide.baseline.files = [];
      },
      'empty',
    ],
    [
      'unowned baseline',
      (guide) => {
        guide.baseline.files = ['unowned.ts'];
      },
      'baseline-owner',
    ],
    [
      'escaping receipt',
      (guide) => {
        guide.baseline.receipt = '../baseline.dd.json';
      },
      'path',
    ],
    [
      'coder as composition owner',
      (guide) => {
        guide.composition.owner = 'tk-0002';
      },
      'composition-owner',
    ],
    [
      'missing import',
      (guide) => {
        guide.composition.order.pop();
      },
      'composition-order',
    ],
    [
      'unknown import',
      (guide) => {
        guide.composition.order.push('missing');
      },
      'composition-order',
    ],
    [
      'composition too early',
      (guide) => {
        guide.units[3].wave = 1;
      },
      'wave',
    ],
    [
      'false solo decision',
      (guide) => {
        guide.fan_out.decision = 'solo-pm';
      },
      'fan-out',
    ],
    [
      'unreviewable architecture',
      (guide) => {
        guide.review.inputs = [];
      },
      'empty',
    ],
  ];
  const advisoryCodes = new Set([
    'write-overlap',
    'map-path',
    'map-empty',
    'map-duplicate',
    'read-owner',
    'read-coverage',
    'capability-gap',
    'capability-owner',
    'baseline-owner',
    'composition-owner',
  ]);
  it.each(cases)('distinguishes %s from structural failure', (_name, mutate, code) => {
    const guide = fixtureGuide();
    mutate(guide);
    const report = checkBuilderGuide(guide, criteria);
    const advisory = advisoryCodes.has(code);
    expect(report.valid).toBe(advisory);
    expect(report.architectural_judgement).toBe('not-performed');
    expect(advisory ? report.warnings : report.issues).toContainEqual(
      expect.objectContaining({ code, next_action: expect.any(String) }),
    );
    if (advisory) expect(report.issues).toEqual([]);
  });
  it('rejects a vacuous product acceptance contract', () => {
    expect(checkBuilderGuide(fixtureGuide(), []).valid).toBe(false);
  });
  it('orders dependent coder deliveries, not only their wave numbers', () => {
    const guide = fixtureGuide();
    guide.units[2].depends_on.push('tk-0002');
    guide.units[2].wave = 2;
    guide.units[3].wave = 3;
    guide.composition.order.reverse();
    expect(checkBuilderGuide(guide, criteria).issues).toContainEqual(
      expect.objectContaining({ code: 'composition-order' }),
    );
  });
  it('uses exact file matching rather than treating a bare path as a subtree', () => {
    const guide = fixtureGuide();
    guide.units[2].paths.push('src');
    expect(checkBuilderGuide(guide, criteria).warnings).not.toContainEqual(
      expect.objectContaining({ code: 'write-overlap' }),
    );
  });
  it('keeps empty, repeated and invalid map hints advisory with honest locations', () => {
    const guide = fixtureGuide();
    guide.units[0].paths = [];
    guide.units[1].paths = ['', '../escape.ts', 'src/*.ts', 'same.ts', 'same.ts'];
    guide.units[1].reads = [{ owner: '', paths: [] }];
    const report = checkBuilderGuide(guide, criteria);
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'map-empty',
          file: '<guide:units/tk-0001/paths>',
          owning_unit: 'tk-0001',
        }),
        expect.objectContaining({
          code: 'map-path',
          file: '<guide:units/tk-0002/paths>',
          owning_unit: 'tk-0002',
        }),
        expect.objectContaining({ code: 'map-path', file: '../escape.ts', owning_unit: 'tk-0002' }),
        expect.objectContaining({ code: 'map-path', file: 'src/*.ts', owning_unit: 'tk-0002' }),
        expect.objectContaining({ code: 'map-duplicate', file: 'same.ts', owning_unit: 'tk-0002' }),
        expect.objectContaining({
          code: 'read-owner',
          file: '<guide:units/tk-0002/reads/0/owner>',
          owning_unit: 'unmapped',
        }),
        expect.objectContaining({
          code: 'baseline-owner',
          file: 'contracts.ts',
          owning_unit: 'unmapped',
        }),
      ]),
    );
  });
  it('reports declaration-only owner hints without inventing file paths or hidden ownership vetoes', () => {
    const guide = fixtureGuide();
    guide.capabilities[0].owner = '';
    guide.capabilities[0].path = '';
    guide.composition.owner = 'tk-0002';
    const report = checkBuilderGuide(guide, criteria);
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'capability-owner',
          file: `<guide:capabilities/${guide.capabilities[0].id}/owner>`,
          owning_unit: 'unmapped',
        }),
        expect.objectContaining({
          code: 'capability-path',
          file: `<guide:capabilities/${guide.capabilities[0].id}/path>`,
          owning_unit: 'unmapped',
        }),
        expect.objectContaining({
          code: 'composition-owner',
          file: '<guide:composition/owner>',
          owning_unit: 'tk-0002',
        }),
        expect.objectContaining({
          code: 'composition-wave',
          file: '<guide:composition/owner>',
          owning_unit: 'tk-0002',
        }),
      ]),
    );
  });
});

describe('guide loading and draft authoring', () => {
  it('loads a schema-valid guide without executing proof or writing state', () => {
    const { deps, exec } = builderFixture();
    expect(value(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN }))).toEqual(fixtureGuide());
    expect(exec.calls).toEqual([]);
  });
  it('initializes a renderable but explicitly not-ready draft without fabricated commands', () => {
    const { deps, fs } = builderFixture();
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    const draft = value(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true }));
    expect(draft.units).toEqual([]);
    expect(draft.checks).toEqual([]);
    expect(checkBuilderGuide(draft, criteria).valid).toBe(false);
    expect(fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE.replace('.json', '.md')}`)).toContain(
      draft.meta.title,
    );
  });
  it('uses the explicit packaged template instead of inventing a second draft', () => {
    const { deps, fs } = builderFixture();
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    const templatePath = '/package/templates/impl-guide.template.json';
    const template = JSON.parse(fs.readText(templatePath) ?? '{}');
    template.sections.find(
      (section: { name: string }) => section.name === 'architecture',
    ).value.principles = 'Package-owned draft guidance';
    const contents = JSON.stringify(template);
    fs.writeText(templatePath, contents);
    const draft = value(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true }));
    expect(draft.architecture.principles).toBe('Package-owned draft guidance');
    expect(draft.units).toEqual([]);
    expect(fs.readText(templatePath)).toBe(contents);
    expect(fs.exists('/repo/docs/plans/001-example/assets/backpressure.dd.json')).toBe(false);
    expect(fs.exists('/repo/docs/plans/001-example/assets/roles.template.json')).toBe(false);
  });
  it.each([
    undefined,
    '',
    '/missing/templates',
  ])('refuses unavailable template capability %s without partial guide output', (templatesDir) => {
    const { deps, fs } = builderFixture();
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    if (templatesDir === undefined) delete deps.templatesDir;
    else deps.templatesDir = templatesDir;
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true })).toMatchObject({
      ok: false,
      code: 'E473',
      next_action: expect.any(String),
    });
    expect(fs.exists(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe(false);
    expect(fs.exists(`/repo/${BUILDER_FIXTURE_GUIDE.replace('.json', '.md')}`)).toBe(false);
  });
  it('leaves ordinary reads and existing-guide init independent of templatesDir', () => {
    const { deps, fs } = builderFixture();
    delete deps.templatesDir;
    const before = fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN }).ok).toBe(true);
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true }).ok).toBe(true);
    expect(fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe(before);
  });
  it.each([
    '{',
    '{"dd":{"schema":"builder/plan"},"sections":[],"references":[]}',
  ])('refuses malformed or wrong-schema templates without writing a guide', (contents) => {
    const { deps, fs } = builderFixture({
      '/package/templates/impl-guide.template.json': contents,
    });
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true })).toMatchObject({
      ok: false,
      code: 'E470',
    });
    expect(fs.exists(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe(false);
  });
  it('validates template shape through the shared writer before publishing', () => {
    const { deps, fs } = builderFixture();
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    const template = JSON.parse(fs.readText('/package/templates/impl-guide.template.json') ?? '{}');
    template.sections.find(
      (section: { name: string }) => section.name === 'architecture',
    ).value.contracts = 1;
    fs.writeText('/package/templates/impl-guide.template.json', JSON.stringify(template));
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true })).toMatchObject({
      ok: false,
      code: 'E470',
    });
    expect(fs.exists(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe(false);
  });
  it('rejects duplicate template sections before creating the guide', () => {
    const { deps, fs } = builderFixture();
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    const template = JSON.parse(fs.readText('/package/templates/impl-guide.template.json') ?? '{}');
    template.sections.push(template.sections[0]);
    fs.writeText('/package/templates/impl-guide.template.json', JSON.stringify(template));
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true })).toMatchObject({
      ok: false,
      code: 'E470',
    });
    expect(fs.exists(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe(false);
  });
  it('binds a template to the selected plan file rather than its authored placeholder', () => {
    const { deps, fs } = builderFixture();
    const selected = 'docs/plans/001-example/selected.dd.json';
    fs.writeText(`/repo/${selected}`, fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '');
    fs.deleteFile(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    const draft = value(readBuilderGuide(deps, { plan: selected, init: true }));
    expect(draft.meta.plan).toBe('../selected.dd.json#meta');
  });
  it('never overwrites an existing guide on init', () => {
    const { deps, fs } = builderFixture();
    const before = fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true }).ok).toBe(true);
    expect(fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe(before);
  });
  it('refuses malformed existing guides instead of replacing them', () => {
    const { deps, fs } = builderFixture({ [`/repo/${BUILDER_FIXTURE_GUIDE}`]: '{' });
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN, init: true })).toMatchObject({
      ok: false,
      code: 'E470',
    });
    expect(fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`)).toBe('{');
  });
  it('rejects a guide bound to a different plan', () => {
    const guide = fixtureGuide();
    guide.meta.plan = '../other.dd.json#meta';
    const { deps } = builderFixture({ [`/repo/${BUILDER_FIXTURE_GUIDE}`]: guideJson(guide) });
    expect(readBuilderGuide(deps, { plan: BUILDER_FIXTURE_PLAN })).toMatchObject({
      ok: false,
      code: 'E470',
    });
  });
});

/** Script real port outputs; no internal module mocks and no process spawning in the unit suite. */
function contractFixture(guide = fixtureGuide()) {
  const scripts: Record<string, ExecScript> = {};
  const fixture = builderFixture({}, scripts);
  const { fs, deps, exec } = fixture;
  const plan = JSON.parse(fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
  plan.sections.find((section: { name: string }) => section.name === 'acceptance_criteria').value =
    criteria.map(({ id }) => ({ id, claim: `Observable ${id}`, state: 'unchecked' }));
  fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
  fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, guideJson(guide));
  fs.writeText(`/repo/${reportPath}`, 'Independent architectural review.');
  const files = new Map<string, Uint8Array>();
  for (const path of [BUILDER_FIXTURE_PLAN, BUILDER_FIXTURE_GUIDE, ...guide.baseline.files]) {
    const bytes = fs.readBytesNoFollow(`/repo/${path}`);
    if (bytes) files.set(path, bytes);
  }
  const blob = (bytes: Uint8Array) =>
    createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const execute = exec.run.bind(exec);
  let observedHead = BUILDER_FIXTURE_SHA;
  deps.exec = {
    run: async (command, args, options) => {
      const scripted = await execute(command, args, options);
      if ([command, ...args].join(' ') in scripts || command !== 'git') return scripted;
      let stdout = '';
      if (args.join(' ') === 'rev-parse --show-toplevel') stdout = '/repo\n';
      else if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') stdout = `${observedHead}\n`;
      else if (args[0] === 'merge-base') stdout = '';
      else if (args[0] === '--literal-pathspecs' && args[1] === 'ls-tree') {
        stdout = args
          .slice(args.indexOf('--') + 1)
          .map((path) =>
            files.has(path) ? `100644 blob ${blob(files.get(path) as Uint8Array)}\t${path}\0` : '',
          )
          .join('');
      } else if (args[0] === 'hash-object') {
        stdout = args
          .slice(args.indexOf('--') + 1)
          .map((path) => {
            const bytes = fs.readBytesNoFollow(`/repo/${path}`);
            return bytes ? blob(bytes) : 'missing';
          })
          .join('\n');
      } else if (args[0] === 'show') {
        const path = args[1].slice(args[1].indexOf(':') + 1);
        stdout = Buffer.from(files.get(path) ?? []).toString('utf8');
      } else
        return {
          ok: false,
          code: 127,
          stdout: '',
          stderr: `Unscripted Git observation: ${args.join(' ')}`,
        };
      return { ok: true, code: 0, stdout, stderr: '' };
    },
  };
  const digest = (path: string) => value(digestBuilderFile(deps, path));
  const review = fixtureReview({
    plan: digest(BUILDER_FIXTURE_PLAN),
    guide: digest(BUILDER_FIXTURE_GUIDE),
    report: digest(reportPath),
  });
  value(writeBuilderRecord(deps, reviewPath, review));
  const seal = () => sealBuilderContracts(deps, { plan: BUILDER_FIXTURE_PLAN, review: reviewPath });
  const ready = (unit?: string) =>
    checkBuilderReadiness(deps, {
      plan: BUILDER_FIXTURE_PLAN,
      ...(unit !== undefined && { unit }),
    });
  const changeRecord = <T extends BaselineReceipt | ReviewReceipt>(
    path: string,
    kind: T['record_type'],
    mutate: (record: T) => void,
  ) => {
    const record = value(readBuilderRecord<T>(deps, path, kind));
    mutate(record.value);
    value(writeBuilderRecord(deps, path, record.value, { expectedSha256: record.ref.sha256 }));
  };
  return {
    ...fixture,
    guide,
    scripts,
    files,
    seal,
    ready,
    changeRecord,
    moveHead: (sha: string) => {
      observedHead = sha;
    },
  };
}

describe('contract sealing and readiness', () => {
  it('seals committed raw inputs and successful named checks, then admits a coder', async () => {
    const fixture = contractFixture();
    const sealed = value(await fixture.seal());
    expect(sealed.value.source_sha).toBe(BUILDER_FIXTURE_SHA);
    expect(sealed.value.files).toEqual([value(digestBuilderFile(fixture.deps, 'contracts.ts'))]);
    expect(sealed.value.checks).toEqual([
      expect.objectContaining({
        id: 'vd-0001',
        command: 'node',
        args: ['test/contracts.mjs'],
        exit_code: 0,
      }),
    ]);
    expect(value(await fixture.ready('tk-0002')).status).toBe('ready');
    expect(
      fixture.exec.calls.filter((call) => call.command === 'node').map((call) => call.args),
    ).toEqual([['test/contracts.mjs']]);
  });
  it('retains ownership guidance through unsealed readiness, sealing, successful readiness and receipt reuse', async () => {
    const guide = fixtureGuide();
    guide.units[0].paths = [];
    guide.units[1].paths.push('src/renderer.ts', '../outside.ts');
    guide.units[1].reads[0].owner = '';
    guide.capabilities = [];
    guide.composition.owner = 'tk-0002';
    const fixture = contractFixture(guide);
    const unsealed = value(await fixture.ready('tk-0002'));
    expect(unsealed.status).toBe('not-ready');
    expect(unsealed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'baseline-owner',
          file: 'contracts.ts',
          owning_unit: 'unmapped',
        }),
        expect.objectContaining({
          code: 'map-path',
          file: '../outside.ts',
          owning_unit: 'tk-0002',
        }),
        expect.objectContaining({
          code: 'composition-owner',
          file: '<guide:composition/owner>',
          owning_unit: 'tk-0002',
        }),
      ]),
    );
    const sealed = value(await fixture.seal());
    expect(sealed.value.warnings).toEqual(unsealed.warnings);
    const ready = value(await fixture.ready('tk-0002'));
    expect(ready.status).toBe('ready');
    expect(ready.warnings).toEqual(unsealed.warnings);
    const bytes = fixture.fs.readText(`/repo/${baselinePath}`);
    expect(value(await fixture.seal())).toEqual(sealed);
    expect(fixture.fs.readText(`/repo/${baselinePath}`)).toBe(bytes);
  });
  it('retains advisory warnings alongside actual proof failures and unavailable Git evidence', async () => {
    const guide = fixtureGuide();
    guide.units[0].paths = [];
    const fixture = contractFixture(guide);
    const sealed = value(await fixture.seal());
    fixture.scripts['git rev-parse --show-toplevel'] = { code: 1, stderr: 'Git unavailable' };
    expect(value(await fixture.ready())).toMatchObject({
      status: 'cant-tell',
      warnings: sealed.value.warnings,
    });
    delete fixture.scripts['git rev-parse --show-toplevel'];
    fixture.changeRecord<BaselineReceipt>(baselinePath, 'baseline', (receipt) => {
      receipt.checks[0].exit_code = 1;
    });
    expect(value(await fixture.ready())).toMatchObject({
      status: 'not-ready',
      warnings: sealed.value.warnings,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'baseline-proof' })]),
    });
  });
  it('does not discard map guidance when a separate structural check makes readiness unavailable', async () => {
    const guide = fixtureGuide();
    guide.units[0].paths = [];
    guide.checks[0].cwd = '..';
    const fixture = contractFixture(guide);
    expect(value(await fixture.ready())).toMatchObject({
      status: 'not-ready',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'executable-check' })]),
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'baseline-owner',
          file: 'contracts.ts',
          owning_unit: 'unmapped',
        }),
      ]),
    });
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E471' });
  });
  it('accepts receipt-only descendant commits without changing historical source binding', async () => {
    const fixture = contractFixture();
    const sealed = value(await fixture.seal());
    fixture.moveHead('b'.repeat(40));
    expect(value(await fixture.ready()).status).toBe('ready');
    expect(
      value(readBuilderRecord<BaselineReceipt>(fixture.deps, baselinePath, 'baseline')).ref,
    ).toEqual(sealed.ref);
  });
  it('preserves solo readiness but refuses PM dispatch', async () => {
    const fixture = contractFixture(soloGuide());
    value(await fixture.seal());
    expect(value(await fixture.ready()).status).toBe('ready');
    expect(value(await fixture.ready('tk-0001')).status).toBe('not-ready');
  });
  it.each(['missing', 'tk-0001'])('does not dispatch %s', async (unit) => {
    const fixture = contractFixture();
    value(await fixture.seal());
    expect(value(await fixture.ready(unit)).status).toBe('not-ready');
  });
  it('refuses missing evidence instead of interpreting a status flag', async () => {
    const fixture = contractFixture();
    expect(value(await fixture.ready()).status).toBe('not-ready');
    expect(fixture.exec.calls.filter((call) => call.command === 'node')).toEqual([]);
  });
  it('refuses uncommitted contract changes before executing proof', async () => {
    const fixture = contractFixture();
    fixture.fs.writeText('/repo/contracts.ts', 'Changed interface');
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E475' });
    expect(fixture.exec.calls.some((call) => call.command === 'node')).toBe(false);
    expect(fixture.fs.exists(`/repo/${baselinePath}`)).toBe(false);
  });
  it('refuses a declared file absent from the commit', async () => {
    const fixture = contractFixture();
    fixture.files.delete('contracts.ts');
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E475' });
  });
  it('hashes and preserves binary evidence through the native filesystem', async () => {
    const fixture = contractFixture();
    const bytes = new Uint8Array([0, 255, 128, 10]);
    fixture.fs.writeBytes('/repo/contracts.ts', bytes);
    fixture.files.set('contracts.ts', bytes);
    const root = toPosix(realpathSync(mkdtempSync(join(tmpdir(), 'builder-binary-'))));
    try {
      // Use the real byte/identity boundary; FakeFs.realpath omits byte-only files.
      // Git stays on the injected executable port with the identical committed snapshot.
      const native = new NodeFs();
      const paths = fixture.fs.listRegularFilesNoFollow('/repo');
      if (paths === null) throw new Error('Expected the complete regular-file fixture.');
      for (const path of paths) {
        const content = fixture.fs.readBytesNoFollow(`/repo/${path}`);
        if (content === null) throw new Error(`Missing fixture bytes: ${path}`);
        const target = posixJoin(root, path);
        native.mkdirp(posixDirname(target));
        native.writeBytes(target, content);
      }
      fixture.deps.fs = native;
      fixture.deps.repoRoot = root;
      fixture.scripts['git rev-parse --show-toplevel'] = { code: 0, stdout: `${root}\n` };
      const sealed = value(await fixture.seal());
      expect(sealed.value.files[0].sha256).toBe(sha256(bytes));
      expect(native.readBytesNoFollow(posixJoin(root, 'contracts.ts'))).toEqual(bytes);
      expect(value(await fixture.ready()).status).toBe('ready');
      native.writeBytes(posixJoin(root, 'contracts.ts'), new Uint8Array([0, 255, 129, 10]));
      expect(value(await fixture.ready()).status).toBe('not-ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('does not publish red proof', async () => {
    const fixture = contractFixture();
    fixture.scripts['node test/contracts.mjs'] = { code: 1, stderr: 'contract mismatch' };
    expect(await fixture.seal()).toMatchObject({
      ok: false,
      code: 'E475',
      details: { exit_code: 1 },
    });
    expect(fixture.fs.exists(`/repo/${baselinePath}`)).toBe(false);
  });
  it('does not publish timed-out proof', async () => {
    const fixture = contractFixture();
    fixture.scripts['node test/contracts.mjs'] = { code: 0, hang: true };
    expect(await fixture.seal()).toMatchObject({
      ok: false,
      code: 'E475',
      details: { exit_code: 124 },
    });
    expect(fixture.fs.exists(`/repo/${baselinePath}`)).toBe(false);
  });
  it.each(['contracts.ts', reportPath, reviewPath])('blocks changed evidence %s', async (path) => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.fs.writeText(`/repo/${path}`, 'changed');
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('blocks a missing baseline file', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.fs.deleteFile('/repo/contracts.ts');
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it.each([
    [
      'red',
      (receipt: BaselineReceipt) => {
        receipt.checks[0].exit_code = 1;
      },
    ],
    [
      'missing',
      (receipt: BaselineReceipt) => {
        receipt.checks = [];
      },
    ],
    [
      'wrong argv',
      (receipt: BaselineReceipt) => {
        receipt.checks[0].args = ['other.mjs'];
      },
    ],
    [
      'wrong root',
      (receipt: BaselineReceipt) => {
        receipt.checks[0].cwd = '/elsewhere';
      },
    ],
  ] as const)('refuses %s baseline proof receipts', async (_name, mutate) => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.changeRecord<BaselineReceipt>(baselinePath, 'baseline', mutate);
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('rejects duplicate proof at publication and refuses externally corrupted evidence on read', async () => {
    const fixture = contractFixture();
    const original = value(await fixture.seal());
    const corrupt = {
      ...original.value,
      checks: [...original.value.checks, original.value.checks[0]],
    };
    expect(
      writeBuilderRecord(fixture.deps, baselinePath, corrupt, {
        expectedSha256: original.ref.sha256,
      }),
    ).toMatchObject({ ok: false, code: 'E470' });
    expect(
      value(readBuilderRecord<BaselineReceipt>(fixture.deps, baselinePath, 'baseline')).ref,
    ).toEqual(original.ref);
    // Invalid evidence cannot be published through the validating writer. Model
    // external corruption below that boundary, then exercise the normal reader.
    fixture.fs.writeText(
      `/repo/${baselinePath}`,
      JSON.stringify({
        dd: { schema: 'builder/team' },
        sections: [{ name: 'baseline', value: corrupt }],
        references: [],
      }),
    );
    const ready = value(await fixture.ready());
    expect(ready.status).toBe('not-ready');
    expect(ready.issues.length).toBeGreaterThan(0);
    expect(
      ready.issues.every((issue) => issue.message.length > 0 && issue.next_action.length > 0),
    ).toBe(true);
  });
  it.each([
    [
      'different source',
      (review: ReviewReceipt) => {
        review.subject_sha = 'b'.repeat(40);
      },
    ],
    [
      'red verdict',
      (review: ReviewReceipt) => {
        review.verdict = 'changes-requested';
      },
    ],
    [
      'unresolved findings',
      (review: ReviewReceipt) => {
        review.findings.push({
          id: 'f1',
          severity: 'high',
          description: 'Missing observable owner',
          disposition: 'open',
        });
      },
    ],
    [
      'unobserved runtime',
      (review: ReviewReceipt) => {
        review.observed.ready = false;
      },
    ],
  ] as const)('requires approved bound independent review: %s', async (_name, mutate) => {
    const fixture = contractFixture();
    fixture.changeRecord<ReviewReceipt>(reviewPath, 'review', mutate);
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E475' });
    expect(fixture.fs.exists(`/repo/${baselinePath}`)).toBe(false);
  });
  it('returns cant-tell when Git cannot be observed', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.scripts['git rev-parse --show-toplevel'] = { code: 127, stderr: 'unavailable' };
    expect(value(await fixture.ready()).status).toBe('cant-tell');
  });
  it('rejects unrelated committed history', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.scripts[`git merge-base --is-ancestor ${BUILDER_FIXTURE_SHA} ${BUILDER_FIXTURE_SHA}`] =
      { code: 1 };
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('does not seal when a check mutates an input', async () => {
    const fixture = contractFixture();
    const execute = fixture.deps.exec.run.bind(fixture.deps.exec);
    fixture.deps.exec = {
      run: async (command, args, options) => {
        const result = await execute(command, args, options);
        if (command === 'node') fixture.fs.writeText('/repo/contracts.ts', 'mutated by proof');
        return result;
      },
    };
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E475' });
    expect(fixture.fs.exists(`/repo/${baselinePath}`)).toBe(false);
  });
  it('does not seal when a check moves HEAD', async () => {
    const fixture = contractFixture();
    const execute = fixture.deps.exec.run.bind(fixture.deps.exec);
    fixture.deps.exec = {
      run: async (command, args, options) => {
        const result = await execute(command, args, options);
        if (command === 'node') fixture.moveHead('b'.repeat(40));
        return result;
      },
    };
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E472' });
  });
});

describe('historical baseline binding', () => {
  it('allows factual state and plan status changes without rewriting the seal', async () => {
    const fixture = contractFixture();
    const seal = value(await fixture.seal());
    const plan = JSON.parse(fixture.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.status =
      'in-progress';
    plan.sections.find(
      (section: { name: string }) => section.name === 'acceptance_criteria',
    ).value[0].state = 'checked';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect(value(await fixture.ready()).status).toBe('ready');
    expect(
      value(readBuilderRecord<BaselineReceipt>(fixture.deps, baselinePath, 'baseline')).ref,
    ).toEqual(seal.ref);
  });
  it.each(['claim', 'note', 'receipt'])('does not discard material AC %s fields', async (field) => {
    const fixture = contractFixture();
    value(await fixture.seal());
    const plan = JSON.parse(fixture.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
    plan.sections.find(
      (section: { name: string }) => section.name === 'acceptance_criteria',
    ).value[0][field] = 'Changed responsibility or evidence declaration';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('allows only the supported guide timestamp, not guide intent drift', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.guide.meta.updated = '2026-09-06';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, guideJson(fixture.guide));
    expect(value(await fixture.ready()).status).toBe('ready');
    fixture.guide.architecture.principles = 'Different architecture';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, guideJson(fixture.guide));
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('accepts the same plan archive while preserving original document and review digests', async () => {
    const fixture = contractFixture();
    const seal = value(await fixture.seal());
    const archived = 'docs/plans/archive/001-example';
    expect(fixture.fs.copyDir('/repo/docs/plans/001-example', `/repo/${archived}`)).toBe(true);
    fixture.fs.removeDir('/repo/docs/plans/001-example');
    const ready = value(
      await checkBuilderReadiness(fixture.deps, { plan: `${archived}/plan.dd.json` }),
    );
    expect(ready.status).toBe('ready');
    if (ready.status === 'ready') expect(ready.baseline.value).toEqual(seal.value);
  });
  it('resolves genuinely re-anchored external DD links before shared intent comparison', async () => {
    const fixture = contractFixture();
    const plan = JSON.parse(fixture.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.log =
      '../../shared/execution.dd.json#entries';
    const original = JSON.stringify(plan);
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, original);
    fixture.files.set(BUILDER_FIXTURE_PLAN, new TextEncoder().encode(original));
    fixture.changeRecord<ReviewReceipt>(reviewPath, 'review', (review) => {
      review.plan = value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_PLAN));
    });
    value(await fixture.seal());
    const archived = 'docs/plans/archive/001-example';
    expect(fixture.fs.copyDir('/repo/docs/plans/001-example', `/repo/${archived}`)).toBe(true);
    fixture.fs.removeDir('/repo/docs/plans/001-example');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.log =
      '../../../shared/execution.dd.json#entries';
    fixture.fs.writeText(`/repo/${archived}/plan.dd.json`, JSON.stringify(plan));
    expect(
      value(await checkBuilderReadiness(fixture.deps, { plan: `${archived}/plan.dd.json` })).status,
    ).toBe('ready');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.log =
      '../../../different/execution.dd.json#entries';
    fixture.fs.writeText(`/repo/${archived}/plan.dd.json`, JSON.stringify(plan));
    expect(
      value(await checkBuilderReadiness(fixture.deps, { plan: `${archived}/plan.dd.json` })).status,
    ).toBe('not-ready');
  });
  it('keeps the guide baseline receipt path material even when the new file contains the old seal', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.fs.writeText(
      '/repo/docs/plans/001-example/assets/team/different.dd.json',
      fixture.fs.readText(`/repo/${baselinePath}`) ?? '',
    );
    fixture.guide.baseline.receipt = 'team/different.dd.json';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, guideJson(fixture.guide));
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('allows proven_by on recognised work rows but not unrelated metadata', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    const plan = JSON.parse(fixture.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
    plan.sections.find(
      (section: { name: string }) => section.name === 'acceptance_criteria',
    ).value[0].proven_by = 'assets/execution.dd.json#entries/observed';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect(value(await fixture.ready()).status).toBe('ready');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.proven_by =
      'different';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('does not mistake an arbitrary copied plan for its original or archive', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    expect(fixture.fs.copyDir('/repo/docs/plans/001-example', '/repo/docs/plans/002-other')).toBe(
      true,
    );
    const ready = value(
      await checkBuilderReadiness(fixture.deps, { plan: 'docs/plans/002-other/plan.dd.json' }),
    );
    expect(ready.status).toBe('not-ready');
  });
  it('checks historical raw digests before projecting progress', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    fixture.files.set(BUILDER_FIXTURE_PLAN, new TextEncoder().encode('forged historical content'));
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
  it('does not discard state-looking text outside recognised DD work rows', async () => {
    const fixture = contractFixture();
    value(await fixture.seal());
    const plan = JSON.parse(fixture.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.summary =
      'state changed in intent';
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect(value(await fixture.ready()).status).toBe('not-ready');
  });
});

describe('dependency evidence', () => {
  function laterWave(subtree = false) {
    const guide = fixtureGuide();
    guide.units[2].depends_on.push('tk-0002');
    guide.units[2].reads.push({ owner: 'tk-0002', paths: ['src/parser.ts'] });
    guide.units[2].wave = 2;
    guide.units[3].wave = 3;
    if (subtree) {
      guide.units[1].paths = ['src/parser/**', 'test/parser.test.ts'];
      guide.units[2].reads[1].paths = ['src/parser/index.ts'];
      guide.units[3].reads[0].paths = ['src/parser/**'];
    }
    return contractFixture(guide);
  }
  it('does not release a later unit merely because an earlier unit was declared', async () => {
    const fixture = laterWave();
    value(await fixture.seal());
    const ready = value(await fixture.ready('tk-0003'));
    expect(ready.status).toBe('not-ready');
    expect(ready.issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('tk-0002') }),
    );
  });
  it.each([
    false,
    true,
  ])('requires verified composition and current dependency bytes (subtree: %s)', async (subtree) => {
    const fixture = laterWave(subtree);
    const baseline = value(await fixture.seal());
    const parserPath = subtree ? 'src/parser/index.ts' : 'src/parser.ts';
    const files = [parserPath, 'test/parser.test.ts'].map((path) => {
      fixture.fs.writeText(`/repo/${path}`, `Implemented ${path}`);
      fixture.files.set(path, new TextEncoder().encode(`Implemented ${path}`));
      return value(digestBuilderFile(fixture.deps, path));
    });
    const path = 'docs/plans/001-example/assets/team/composition.dd.json';
    const imported = value(
      writeBuilderRecord(
        fixture.deps,
        path,
        fixtureComposition({
          baseline: baseline.ref,
          files,
          checks: [fixtureCheck({ id: 'vd-0004', args: ['test/integration.mjs'] })],
        }),
      ),
    );
    expect(value(await fixture.ready('tk-0003')).status).toBe('not-ready');
    value(
      writeBuilderRecord(
        fixture.deps,
        path,
        { ...imported.value, artifact_sha: 'c'.repeat(40) },
        { expectedSha256: imported.ref.sha256 },
      ),
    );
    expect(value(await fixture.ready('tk-0003')).status).toBe('ready');
    fixture.fs.writeText(`/repo/${parserPath}`, 'drifted dependency');
    expect(value(await fixture.ready('tk-0003')).status).toBe('not-ready');
  });
});

describe('readiness refusal diagnostics', () => {
  it('projects schema failures to actionable Builder issues', async () => {
    const fixture = contractFixture();
    fixture.fs.writeText(
      `/repo/${BUILDER_FIXTURE_GUIDE}`,
      guideJson({ ...fixture.guide, checks: null } as unknown as Guide),
    );
    const ready = value(await fixture.ready());
    expect(ready.status).toBe('not-ready');
    expect(ready.issues.length).toBeGreaterThan(0);
    for (const issue of ready.issues) {
      expect(issue.code).toEqual(expect.any(String));
      expect(issue.message).toEqual(expect.any(String));
      expect(issue.next_action.length).toBeGreaterThan(0);
    }
  });
});

describe('immutable baseline seals', () => {
  it.each([
    BUILDER_FIXTURE_SHA,
    'b'.repeat(40),
  ])('reuses unchanged historical proof without rerunning or rewriting it at HEAD %s', async (head) => {
    const fixture = contractFixture();
    const original = value(await fixture.seal());
    const source = fixture.fs.readText(`/repo/${baselinePath}`);
    const face = fixture.fs.readText(`/repo/${baselinePath.replace('.json', '.md')}`);
    const writes = fixture.fs.writes.length;
    await fixture.clock.sleep(1000);
    fixture.moveHead(head);
    fixture.scripts['node test/contracts.mjs'] = {
      code: 1,
      stderr: 'must not rerun existing proof',
    };
    expect(value(await fixture.seal())).toEqual(original);
    expect(fixture.fs.readText(`/repo/${baselinePath}`)).toBe(source);
    expect(fixture.fs.readText(`/repo/${baselinePath.replace('.json', '.md')}`)).toBe(face);
    expect(fixture.fs.writes.length).toBe(writes);
    expect(fixture.exec.calls.filter((call) => call.command === 'node')).toHaveLength(1);
  });
  it.each([
    'contract',
    'guide',
    'corrupt-receipt',
    'red-proof',
  ] as const)('refuses %s changes without modifying or refreshing the existing seal', async (change) => {
    const fixture = contractFixture();
    value(await fixture.seal());
    if (change === 'contract')
      fixture.fs.writeText('/repo/contracts.ts', 'revised shared contract');
    if (change === 'guide') {
      fixture.guide.architecture.principles = 'Revised decomposition';
      fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, guideJson(fixture.guide));
    }
    if (change === 'corrupt-receipt') fixture.fs.writeText(`/repo/${baselinePath}`, '{');
    if (change === 'red-proof')
      fixture.changeRecord<BaselineReceipt>(baselinePath, 'baseline', (receipt) => {
        receipt.checks[0].exit_code = 1;
      });
    const source = fixture.fs.readText(`/repo/${baselinePath}`);
    const face = fixture.fs.readText(`/repo/${baselinePath.replace('.json', '.md')}`);
    const writes = fixture.fs.writes.length;
    expect(await fixture.seal()).toMatchObject({
      ok: false,
      code: 'E472',
    });
    expect(fixture.fs.readText(`/repo/${baselinePath}`)).toBe(source);
    expect(fixture.fs.readText(`/repo/${baselinePath.replace('.json', '.md')}`)).toBe(face);
    expect(fixture.fs.writes.length).toBe(writes);
    expect(fixture.exec.calls.filter((call) => call.command === 'node')).toHaveLength(1);
  });
  it('refuses a different review identity instead of silently rebinding the seal', async () => {
    const fixture = contractFixture();
    const original = value(await fixture.seal());
    const alternate = 'docs/plans/001-example/assets/team/review-decomposition-v2.dd.json';
    fixture.fs.writeText(`/repo/${alternate}`, fixture.fs.readText(`/repo/${reviewPath}`) ?? '');
    expect(
      await sealBuilderContracts(fixture.deps, { plan: BUILDER_FIXTURE_PLAN, review: alternate }),
    ).toMatchObject({ ok: false, code: 'E472' });
    expect(
      value(readBuilderRecord<BaselineReceipt>(fixture.deps, baselinePath, 'baseline')),
    ).toEqual(original);
    expect(fixture.exec.calls.filter((call) => call.command === 'node')).toHaveLength(1);
  });
  it('preserves a competing seal published while a new attempt runs proof', async () => {
    const fixture = contractFixture();
    const competing = fixtureBaseline({
      plan: value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_PLAN)),
      guide: value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_GUIDE)),
      files: [value(digestBuilderFile(fixture.deps, 'contracts.ts'))],
      review: value(digestBuilderFile(fixture.deps, reviewPath)),
      checks: [fixtureCheck({ args: ['test/contracts.mjs'] })],
    });
    let published: string | null = null;
    const execute = fixture.deps.exec.run.bind(fixture.deps.exec);
    fixture.deps.exec = {
      run: async (command, args, options) => {
        const result = await execute(command, args, options);
        if (command === 'node') {
          value(writeBuilderRecord(fixture.deps, baselinePath, competing));
          published = fixture.fs.readText(`/repo/${baselinePath}`);
        }
        return result;
      },
    };
    expect(await fixture.seal()).toMatchObject({ ok: false, code: 'E472' });
    expect(published).not.toBeNull();
    expect(fixture.fs.readText(`/repo/${baselinePath}`)).toBe(published);
    expect(
      value(readBuilderRecord<BaselineReceipt>(fixture.deps, baselinePath, 'baseline')).value,
    ).toEqual(competing);
  });
  it('seals revised committed inputs only under a deliberately fresh receipt identity', async () => {
    const fixture = contractFixture();
    const original = value(await fixture.seal());
    const source = fixture.fs.readText(`/repo/${baselinePath}`);
    const oldReview = fixture.fs.readText(`/repo/${reviewPath}`);
    fixture.guide.baseline.receipt = 'team/baseline-v2.dd.json';
    const updatedGuide = guideJson(fixture.guide);
    fixture.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, updatedGuide);
    fixture.files.set(BUILDER_FIXTURE_GUIDE, new TextEncoder().encode(updatedGuide));
    fixture.moveHead('b'.repeat(40));
    await fixture.clock.sleep(1000);
    const review = 'docs/plans/001-example/assets/team/review-decomposition-v2.dd.json';
    value(
      writeBuilderRecord(
        fixture.deps,
        review,
        fixtureReview({
          subject_sha: 'b'.repeat(40),
          plan: value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_PLAN)),
          guide: value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_GUIDE)),
          report: value(digestBuilderFile(fixture.deps, reportPath)),
        }),
      ),
    );
    const fresh = value(
      await sealBuilderContracts(fixture.deps, { plan: BUILDER_FIXTURE_PLAN, review }),
    );
    expect(fresh.ref.path).toBe('docs/plans/001-example/assets/team/baseline-v2.dd.json');
    expect(fresh.value.source_sha).toBe('b'.repeat(40));
    expect(fresh.value.recorded_at).not.toBe(original.value.recorded_at);
    expect(fixture.fs.readText(`/repo/${baselinePath}`)).toBe(source);
    expect(fixture.fs.readText(`/repo/${reviewPath}`)).toBe(oldReview);
    expect(fixture.exec.calls.filter((call) => call.command === 'node')).toHaveLength(2);
  });
  it('preserves the old seal and names a fresh identity when revised inputs are missing', async () => {
    const fixture = contractFixture();
    const original = value(await fixture.seal());
    fixture.fs.deleteFile('/repo/contracts.ts');
    expect(await fixture.seal()).toMatchObject({
      ok: false,
    });
    expect(
      value(readBuilderRecord<BaselineReceipt>(fixture.deps, baselinePath, 'baseline')),
    ).toEqual(original);
    expect(fixture.exec.calls.filter((call) => call.command === 'node')).toHaveLength(1);
  });
});
