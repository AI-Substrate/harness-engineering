import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../../../src/acts/dd/schema-fs.js';
import { collectDeclaredRels } from '../../../../src/services/dd/core/rel.js';
import { ConventionSchemaResolver } from '../../../../src/services/dd/schema/resolve.js';
import { createSyntheticPlan, type SyntheticCorpus } from '../../../support/dd-corpus.js';
import { runCli } from '../../../support/run-cli.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url)).replace(/\/$/, '');

/**
 * The declaration a contradiction engine actually reads.
 *
 * Validation finding F2: the engine can be perfect and still ship INERT if no
 * shipped schema declares a relation, and no unit test of the engine itself can
 * notice. So the shipped `builder/*` packages are pinned here, field by field —
 * a link that loses its rel reddens this list, not a subtle behaviour somewhere
 * three layers away.
 */
describe('builder/* schemas — declared relations (dw-0154)', () => {
  const resolver = new ConventionSchemaResolver({ fs: new NodeSchemaFs(), repoRoot: REPO_ROOT });

  it('declares a rel on EVERY link field of builder/plan', () => {
    const record = resolver.resolveDetailed('builder/plan').record;
    expect(record).toBeDefined();
    const rels = collectDeclaredRels(record?.schema ?? { name: 'x', sections: {} });
    expect(rels.map((entry) => `${entry.field}=${entry.rel}`)).toStrictEqual([
      'meta.backpressure=pressure',
      'meta.log=ref',
      'acceptance_criteria[].pressure=pressure',
      'acceptance_criteria[].proven_by=proven_by',
      'phases[].tasks=derives',
      'tasks[].done=derives',
      'tasks[].satisfies[]=satisfies',
      // satisfies-toward: OPEN-NAMESPACE convention (plan 080, ledger #4) — ref-behaving
      // by design (dd ruling: practice not vocabulary). Pinned HERE so the exact spelling
      // is machine-checked: a near-miss rel silently degrades to ref (dd wl-0019).
      'tasks[].satisfies_toward[]=satisfies-toward',
      'done_when.*[].proven_by=proven_by',
      'done_when.*[].pressure=pressure',
    ]);
    // Every one of them is a FROZEN relation — an unknown rel is legal in a
    // schema, but a builder schema shipping one would mean dd silently attaches
    // no meaning to an edge the builder depends on.
    // REGISTER of intentional non-builtin relations (dd wl-0019 remedy shape): a
    // rel here is a RULED convention — ref-behaving by design, meaning carried
    // elsewhere (satisfies-toward: partial-ness lives in the backpressure rows,
    // plan 080 ledger #4; dd ruling 2026-08-09: practice, not vocabulary). Any
    // non-builtin rel NOT in this register is still a red — that is the guard
    // against both accidental conventions and near-miss builtin misspellings.
    const INTENTIONAL_NON_BUILTIN = new Set(['satisfies-toward']);
    expect(rels.every((entry) => entry.builtin || INTENTIONAL_NON_BUILTIN.has(entry.rel))).toBe(true);
  });

  it('declares a rel on every link field of builder/backpressure and builder/execution-log', () => {
    for (const [name, expected] of [
      ['builder/backpressure', ['meta.plan=ref']],
      ['builder/execution-log', ['meta.plan=ref', 'entries[].links[]=ref']],
    ] as const) {
      const record = resolver.resolveDetailed(name).record;
      const rels = collectDeclaredRels(record?.schema ?? { name, sections: {} });
      expect(rels.map((entry) => `${entry.field}=${entry.rel}`)).toStrictEqual([...expected]);
    }
  });
});

describe('builder/plan — the new ERROR classes fire (dw-0151..dw-0153)', () => {
  let corpus: SyntheticCorpus;
  let previousCwd = '';

  const build = (options: Parameters<typeof createSyntheticPlan>[0]) => {
    corpus = createSyntheticPlan(options);
    previousCwd = process.cwd();
    process.chdir(corpus.root);
  };

  afterEach(() => {
    // Restore FIRST, and only if we actually moved: vitest reuses a worker across
    // files, so a suite that leaves the process parked in a deleted temp
    // directory poisons whatever file runs next in that worker.
    if (previousCwd.length > 0) process.chdir(previousCwd);
    previousCwd = '';
    corpus?.cleanup();
  });

  const validate = () =>
    runCli(['dd', 'validate', corpus.taskFileRelative('ph-0001'), '--depth', '0']);

  const withAssertion = (assertion: Record<string, unknown>) => ({
    acceptance: [{ id: 'ac-0001', claim: 'it works' }],
    phases: [
      {
        id: 'ph-0001',
        title: 'core',
        tasks: [
          {
            id: 'tk-0001',
            title: 'build it',
            satisfies: ['ac-0001'],
            assertions: [{ id: 'dw-0001', assertion: 'it holds', ...assertion }],
          },
        ],
      },
    ],
  });

  it('PLANTED BAD: an assertion with no pressure is a hard ERROR', async () => {
    build(withAssertion({}));
    const result = await validate();
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E402');
    // The message names the rule and the way out of it, not just the field.
    expect(result.envelope?.error?.message).toContain('names no instrument');
    expect(result.envelope?.error?.message).toContain('not-applicable');
  });

  it('GOOD TWIN: `not-applicable` validates and is the explicit out', async () => {
    build(withAssertion({ pressure: 'not-applicable' }));
    const result = await validate();
    expect(result.code).toBe(0);
    expect(result.envelope?.status).toBe('ok');
  });

  it('GOOD TWIN: a real backpressure row validates', async () => {
    build(withAssertion({ pressure: 'bp-0001' }));
    const result = await validate();
    // The bp document does not exist in this synthetic corpus, so a depth-0 run
    // is clean: the address parses, and following it is a different question.
    expect(result.code).toBe(0);
  });

  it('PLANTED BAD: a non-array `satisfies` fails validation (dw-0152)', async () => {
    build({
      acceptance: [{ id: 'ac-0001', claim: 'it works' }],
      phases: [
        {
          id: 'ph-0001',
          title: 'core',
          tasks: [
            {
              id: 'tk-0001',
              title: 'build it',
              // A single address instead of the always-array. The coarse-grained
              // ruling is "task row, always an array" — one AC is still a list of
              // one, so that a consumer never has to branch on cardinality.
              satisfies: '../../../plan.dd.json#acceptance_criteria/ac-0001',
            },
          ],
        },
      ],
    });
    const result = await validate();
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E402');
    expect(result.envelope?.error?.message).toContain('must be an array');
  });

  it('GOOD TWIN: an array of one validates and carries the satisfies relation', async () => {
    build({
      acceptance: [{ id: 'ac-0001', claim: 'it works' }],
      phases: [
        {
          id: 'ph-0001',
          title: 'core',
          tasks: [{ id: 'tk-0001', title: 'build it', satisfies: ['ac-0001'] }],
        },
      ],
    });
    expect((await validate()).code).toBe(0);
  });

  it('keeps dw- ids untouched across the rename (dw-0151)', async () => {
    build(withAssertion({ pressure: 'not-applicable' }));
    const read = await runCli([
      'dd',
      'get',
      `${corpus.taskFileRelative('ph-0001')}#done_when/tk-0001`,
    ]);
    expect((read.envelope?.data as { value: { id: string }[] }).value[0]?.id).toBe('dw-0001');
  });
});
