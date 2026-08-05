import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../../../src/acts/dd/schema-fs.js';
import { FsDocLoader } from '../../../../src/acts/dd/shared.js';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../../../src/adapters/git/fake-git.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { readPlanCheck } from '../../../../src/services/dd/plan/check.js';
import { readPlanReadiness } from '../../../../src/services/dd/plan/ready.js';
import { ConventionSchemaResolver } from '../../../../src/services/dd/schema/resolve.js';
import { readBackpressureSurvey } from '../../../../src/services/flow/chores-read.js';
import type { FlowDoc } from '../../../../src/services/flow/flow-events.js';
import { listChores } from '../../../../src/services/flow/flow-mutations.js';
import type { FlowServiceDeps } from '../../../../src/services/flow/flow-service.js';
import { createSyntheticPlan, type SyntheticCorpus } from '../../../support/dd-corpus.js';
import { runCli } from '../../../support/run-cli.js';

/**
 * `harness plan ready` — the readiness verdict.
 *
 * Everything here runs against the REAL `builder/*` schemas via the synthetic
 * corpus factory and a REAL flight-plan file, because both halves of this verdict
 * are readings of shipped shapes: a mocked plan would prove the verdict function
 * works on a fixture nobody ships, and a mocked flow document would not notice the
 * day the receipt shape moves.
 */

let corpus: SyntheticCorpus | null = null;
let previousCwd = '';

afterEach(() => {
  // Restore FIRST, and only if we actually moved: vitest reuses a worker across
  // files, so a suite that leaves the process parked in a deleted temp directory
  // poisons whatever file runs next in that worker.
  if (previousCwd.length > 0) process.chdir(previousCwd);
  previousCwd = '';
  corpus?.cleanup();
  corpus = null;
});

/** Drive the real verb from inside the corpus, exactly as an agent would. */
function runReady(target: SyntheticCorpus, ...args: string[]) {
  previousCwd = process.cwd();
  process.chdir(target.root);
  return runCli(['plan', 'ready', target.planRelative, ...args]);
}

const FLOW_FILE = 'the-flow.json';

/** SHA-256 of a file's bytes — the same basis a receipt records. */
function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A receipt comment exactly as the doctrine writes one. */
function receipt(basis: string, kind: 'validation' | 'decision' = 'validation') {
  return {
    at: '2026-08-05T08:25:38.868Z',
    text: `decision:completed verdict:Partial artifact:backpressure-coverage.md basis_sha256:${basis} time:2026-08-05T08:10:00Z`,
    source: kind === 'decision' ? 'user' : 'agent',
    kind,
  };
}

interface SurveyNode {
  status: string;
  comments?: Array<Record<string, unknown>>;
  id?: string;
}

/**
 * Write a flight plan beside the plan document, carrying the given backpressure
 * nodes. The envelope mirrors a CLI-created flow (a `provenance` block is what
 * stops `readFlowDoc` calling it a legacy hand-written flow).
 */
function writeFlow(folder: string, surveys: SurveyNode[]): string {
  const path = join(folder, FLOW_FILE);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema_version: 1,
        kind: 'flight-plan',
        slug: 'synthetic-plan',
        nav: { now: 'phase-1', next: null },
        created_at: '2026-08-05T08:00:00.000Z',
        provenance: {
          record_kind: 'flow',
          harness_version: '0.4.0',
          branch: null,
          repo: null,
          created_at: '2026-08-05T08:00:00.000Z',
          agent: 'the-flow',
          plan_id: null,
        },
        events: [],
        nodes: [
          { id: 'plan', type: 'plan', label: 'Plan', status: 'done', next: ['phase-1'] },
          { id: 'phase-1', type: 'phase', label: 'Phase 1', status: 'todo', next: [] },
          ...surveys.map((survey, at) => ({
            id: survey.id ?? (at === 0 ? 'backpressure' : `backpressure-${at}`),
            type: 'backpressure',
            label: 'Backpressure survey',
            status: survey.status,
            branch_of: 'plan',
            next: ['plan'],
            chore: { kind: 'command', importance: 'optional' },
            ...(survey.comments !== undefined && { comments: survey.comments }),
          })),
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return path;
}

function flowDeps(root: string): FlowServiceDeps {
  return {
    fs: new NodeFs(),
    clock: new FakeClock('2026-08-05T00:00:00.000Z'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    env: new FakeEnv({}, `${root}/nohome`),
  };
}

/**
 * The composition the verb performs: the plan's own complete reading, the flight
 * plan's survey reading, and the verdict that follows from both.
 */
function readReady(target: SyntheticCorpus) {
  const fs = new NodeSchemaFs();
  const check = readPlanCheck(
    target.plan,
    {
      schemaResolver: new ConventionSchemaResolver({
        fs,
        repoRoot: target.root,
        home: `${target.root}/nohome`,
      }),
      docLoader: new FsDocLoader(fs, new NodeHash(), null),
    },
    { repoRoot: target.root, complete: true },
  );
  const survey = readBackpressureSurvey(
    join(target.folder, FLOW_FILE),
    flowDeps(target.root),
    sha256(target.plan),
  );
  return readPlanReadiness(check, survey);
}

/**
 * T005 / AC-03 / AC-11 — the vacuity refusal, proven adversarially.
 *
 * The fixture is READY IN EVERY OTHER RESPECT: its backpressure chore is `done`
 * and carries a receipt whose `basis_sha256` matches the plan's current bytes, so
 * the survey dimension is affirmatively satisfied and no criterion is unclaimed.
 * The single thing wrong with it is that there is nothing in it to judge.
 *
 * That precision is the whole point. The obvious fixture — a bare `plan new`
 * scaffold — ALSO has no flight plan, so it would read non-ready for the wrong
 * reason, and a RED that came from the missing survey would prove nothing about
 * vacuity. The positive control below asserts the fixture's other dimensions are
 * green FIRST; only then does the vacuity assertion mean anything.
 *
 * A control only ever run against good input has been demonstrated, not tested —
 * so this test was written and run BEFORE the guard existed, and its failure is
 * recorded verbatim in `execution.log.md`.
 */
describe('plan ready — vacuity (T005, AC-03, AC-11)', () => {
  it('refuses to judge a plan with zero claim rows, however green everything else is', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', acceptance: [], phases: [] });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const reading = readReady(corpus);

    // Positive control: everything EXCEPT vacuity is affirmatively fine. Without
    // these four, the assertion below could pass for any reason at all.
    expect(reading.survey.satisfied).toBe(true);
    expect(reading.survey.reason).toBe('survey-done');
    expect(reading.criteria.unclaimed).toEqual([]);
    expect(reading.criteria.claims).toBe(0);

    // The refusal itself.
    expect(reading.verdict).toBe('cant-tell');
    expect(reading.reason).toBe('nothing-to-check');
    expect(reading.criteria.satisfied).toBeNull();
  });
});

/**
 * A plan whose single criterion IS accounted for — the shape every "ready" case
 * below starts from, so a fixture can be made bad in exactly one way at a time.
 */
const CLAIMED = {
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
          assertions: [{ id: 'dw-0001', assertion: 'it holds', pressure: 'not-applicable' }],
        },
      ],
    },
  ],
};

/** The same criterion, with nothing claiming it. */
const UNCLAIMED = { acceptance: [{ id: 'ac-0001', claim: 'it works' }], phases: [] };

describe('plan ready — the criteria dimension', () => {
  it('AC-02/AC-11 — a criterion no task accounts for is not-ready, named by address', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...UNCLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const reading = readReady(corpus);

    // AC-11's second half: claim rows with zero tasks is NOT vacuity. The plan has
    // something to judge and it fails — "can't tell" here would be a dodge.
    expect(reading.criteria.claims).toBe(1);
    expect(reading.verdict).toBe('not-ready');
    expect(reading.reason).toBe('unclaimed-criteria');
    expect(reading.decided_by).toBe('criteria');
    expect(reading.criteria.unclaimed.map((row) => row.address)).toEqual([
      'docs/plans/synthetic-plan/plan.dd.json#acceptance_criteria/ac-0001',
    ]);
  });

  it('AC-01 — every criterion claimed, survey receipted for these bytes, reads ready', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const reading = readReady(corpus);

    expect(reading.verdict).toBe('ready');
    expect(reading.reason).toBe('ready');
    expect(reading.decided_by).toBeNull();
    expect(reading.criteria.claims).toBe(1);
  });
});

describe('plan ready — the survey dimension', () => {
  const ready = (surveys: SurveyNode[]) => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, surveys);
    return readReady(corpus);
  };

  it('AC-04 — a decline is a legitimate ready: skipped, with a matching decision receipt', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [
      { status: 'skipped', comments: [receipt(sha256(corpus.plan), 'decision')] },
    ]);

    const reading = readReady(corpus);

    // Declining the survey is the human's right. A gate that read a receipted
    // decline as not-ready would be a compliance floor, which the flow forbids.
    expect(reading.survey.reason).toBe('declined-with-receipt');
    expect(reading.verdict).toBe('ready');
  });

  it('AC-05 — skipped with no receipt is not satisfied: nothing records what was decided', () => {
    const reading = ready([{ status: 'skipped' }]);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('missing-receipt');
    expect(reading.verdict).toBe('not-ready');
    expect(reading.decided_by).toBe('survey');
  });

  it('AC-10 — a receipt for different plan bytes is stale-basis, never satisfied', () => {
    // The green was earned against bytes that no longer exist. Inheriting it would
    // let any edit after the survey ride the old answer.
    const reading = ready([{ status: 'done', comments: [receipt('0'.repeat(64))] }]);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('stale-basis');
    expect(reading.survey.basis).toBe('0'.repeat(64));
    expect(reading.verdict).toBe('not-ready');
  });

  it('a survey that never reached a terminal status reads not-run', () => {
    const reading = ready([{ status: 'todo' }]);

    expect(reading.survey.reason).toBe('not-run');
    expect(reading.verdict).toBe('not-ready');
  });

  it('AC-06 — no flight plan beside the plan is cant-tell, not a pass and not a failure', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    // Deliberately no `the-flow.json`: a plan authored without the-flow has no
    // chore to read, and declined-vs-never-run is unknowable from a document.

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBeNull();
    expect(reading.survey.reason).toBe('no-flight-plan');
    expect(reading.verdict).toBe('cant-tell');
    expect(reading.decided_by).toBe('survey');
  });

  it('a re-basis survey node without a chore marker still answers for the current bytes', () => {
    // The doctrine mints `backpressure-<12 hex>` on a re-basis, and the live plan
    // 072 flight plan shows those nodes carry NO `chore` block. A reader keyed on
    // the chore marker would miss the only node that surveyed these bytes.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    const path = join(corpus.folder, FLOW_FILE);
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt('a'.repeat(64))] }]);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id: `backpressure-${basis.slice(0, 12)}`,
      type: 'backpressure',
      label: 'Backpressure survey (re-basis)',
      status: 'done',
      branch_of: 'plan',
      next: ['plan'],
      comments: [receipt(basis)],
    });
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

    const reading = readReady(corpus);

    expect(reading.survey.node).toBe(`backpressure-${basis.slice(0, 12)}`);
    expect(reading.survey.reason).toBe('survey-done');
    expect(reading.verdict).toBe('ready');
  });

  it('pins the receipt-shape coupling: `listChores` cannot answer this question', () => {
    // The risk this read carries is that it reads the node model directly. This is
    // the fixture that makes that coupling loud: if `ChoreRow` ever grows receipt
    // evidence, this assertion fails and the survey read should move onto it.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);
    const doc = JSON.parse(readFileSync(join(corpus.folder, FLOW_FILE), 'utf8')) as FlowDoc;

    const rows = listChores(doc);

    expect(rows.map((row) => row.id)).toContain('backpressure');
    for (const row of rows) expect(Object.keys(row)).not.toContain('comments');
  });
});

/**
 * T006 / T007 / AC-07 — the verb, its envelope, and its exit codes.
 *
 * Exercised through the REAL program (`runCli`), because the exit code is the
 * whole point of the strict flag and a service call cannot produce one.
 */
describe('harness plan ready — envelope and exit mapping', () => {
  it('ready → status ok, exit 0', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const run = await runReady(corpus);

    expect(run.envelope?.status).toBe('ok');
    expect(run.code).toBe(0);
    expect((run.envelope?.data as { verdict: string }).verdict).toBe('ready');
  });

  it('AC-07 — not-ready is advisory by default: status degraded, exit 0', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...UNCLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const run = await runReady(corpus);

    // Flow invariant #4: the gate never blocks a human at a terminal.
    expect(run.envelope?.status).toBe('degraded');
    expect(run.code).toBe(0);
    expect((run.envelope?.data as { verdict: string }).verdict).toBe('not-ready');
  });

  it('AC-07 — `--strict` gives CI teeth: status error, exit 1', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...UNCLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const run = await runReady(corpus, '--strict');

    // `error`/1 is the ONLY non-zero code the kernel's status mapping can express
    // here — `exit.ts` maps by status alone, so a `degraded` verdict cannot exit
    // non-zero. Chosen deliberately rather than by bypassing the mapping.
    expect(run.envelope?.status).toBe('error');
    expect(run.envelope?.error?.code).toBe('E462');
    expect(run.code).toBe(1);
  });

  it('AC-03 — a vacuous plan is unconfigured, exit 2, and never ready', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', acceptance: [], phases: [] });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const run = await runReady(corpus);

    // `unconfigured` is the repo's own word for "nothing is mapped here yet" —
    // the honest status for a refusal, and exit 2 is what the kernel gives it.
    expect(run.envelope?.status).toBe('unconfigured');
    expect(run.code).toBe(2);
    const data = run.envelope?.data as { verdict: string; reason: string };
    expect(data.verdict).toBe('cant-tell');
    expect(data.reason).toBe('nothing-to-check');
  });

  it('AC-03 — `--strict` does NOT turn a refusal into a failure', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', acceptance: [], phases: [] });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const run = await runReady(corpus, '--strict');

    // Strict adds teeth to a KNOWN not-ready. "I cannot tell" is not a not-ready,
    // and reporting it as one would be the gate inventing an answer.
    expect(run.envelope?.status).toBe('unconfigured');
    expect(run.code).toBe(2);
  });

  it('AC-06 — a missing flight plan is cant-tell at the CLI too, exit 2', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });

    const run = await runReady(corpus);

    expect(run.envelope?.status).toBe('unconfigured');
    expect(run.code).toBe(2);
    expect(run.envelope?.next_action).toContain('No flight plan');
  });

  it('names only the dimension that decided it (ruling ac-7007)', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...UNCLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [receipt(sha256(corpus.plan))] }]);

    const run = await runReady(corpus);

    // One line, about the failing dimension. Per-row warning walls teach readers
    // to ignore warnings, which is the failure mode already ruled on.
    expect(run.envelope?.next_action).toContain('#acceptance_criteria/ac-0001');
    expect(run.envelope?.next_action?.split('\n')).toHaveLength(1);
  });
});

/**
 * T008 / AC-08 — the verb writes nothing.
 *
 * A byte-identical before/after is a NULL RESULT on its own: two empty files, or
 * two runs that never touched anything because the command silently failed,
 * compare equal just as happily. So the before-state is asserted non-trivial
 * first, and the run is asserted to have actually produced a verdict — only then
 * does "the bytes did not move" mean the verb is read-only.
 */
describe('harness plan ready — read-only (T008, AC-08)', () => {
  it('leaves the plan document and the flight plan byte-identical', async () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const flowPath = writeFlow(corpus.folder, [
      { status: 'done', comments: [receipt(sha256(corpus.plan))] },
    ]);
    const taskPath = corpus.taskFiles['ph-0001'] as string;

    const before = {
      plan: readFileSync(corpus.plan),
      flow: readFileSync(flowPath),
      tasks: readFileSync(taskPath),
    };

    // POSITIVE CONTROL, before anything is compared: the files under observation
    // are real, non-empty, and carry the content whose survival is the claim.
    expect(before.plan.length).toBeGreaterThan(200);
    expect(before.flow.length).toBeGreaterThan(200);
    expect(before.tasks.length).toBeGreaterThan(100);
    expect(before.plan.toString('utf8')).toContain('ac-0001');
    expect(before.flow.toString('utf8')).toContain('basis_sha256');
    expect(before.tasks.toString('utf8')).toContain('tk-0001');

    const run = await runReady(corpus);

    // And the run did real work — a command that exploded would also write nothing.
    expect(run.code).toBe(0);
    expect((run.envelope?.data as { verdict: string }).verdict).toBe('ready');

    expect(readFileSync(corpus.plan).equals(before.plan)).toBe(true);
    expect(readFileSync(flowPath).equals(before.flow)).toBe(true);
    expect(readFileSync(taskPath).equals(before.tasks)).toBe(true);
  });
});
