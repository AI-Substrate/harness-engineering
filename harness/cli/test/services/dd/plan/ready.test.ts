import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');

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

/**
 * A DECLINE, exactly as the doctrine's decline command writes one:
 * `harness flow comment --kind decision --source user --text "<verbatim words>"`.
 *
 * Note what is not here: a `basis_sha256`. The doctrine's decline records the
 * human's words and nothing else, so a decline receipt that carried a basis is a
 * shape nobody ships.
 */
function decline(words = 'not worth it for a doc-only change') {
  return { at: '2026-08-05T08:25:38.868Z', text: words, source: 'user', kind: 'decision' };
}

/**
 * The DOCTRINE'S router-missing detection receipt, in its own words.
 *
 * `skills/builder/references/flight-plan.template.json:74` is the operative
 * instruction agents re-read: router missing or envelope `noop`/`UNAVAILABLE`
 * records `decision:unavailable reason:<…> time:<…>`.
 *
 * Copied from that persisted instruction, not inferred from a producer description.
 */
const UNAVAILABLE_RECEIPT = {
  at: '2026-08-05T08:25:38.868Z',
  text: 'decision:unavailable reason:router not installed time:2026-08-05T08:10:00Z',
  source: 'agent',
  kind: 'validation',
};

/**
 * Documented-alternative fixtures, not structural-envelope fixtures. The doctrine
 * permits the detection receipt or real envelope text, so these deliberately are
 * not parseable: the reader recognises the recorded outcome token, not a schema.
 */
function unavailableTokenReceipt(text: string) {
  return {
    ...UNAVAILABLE_RECEIPT,
    text,
  };
}

const NOOP_ALTERNATIVE_RECEIPT = unavailableTokenReceipt('router attempt returned token noop');
const UNAVAILABLE_ALTERNATIVE_RECEIPT = unavailableTokenReceipt(
  'boot attempt returned token UNAVAILABLE',
);

interface SurveyNode {
  status: string;
  comments?: Array<Record<string, unknown>>;
  id?: string;
  type?: string;
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
            type: survey.type ?? 'backpressure',
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

  it('AC-04 — a decline is a legitimate ready: skipped, with the doctrine\u2019s decision receipt', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    // The receipt carries the human's verbatim words and NO basis — the shape the
    // doctrine's decline command actually writes. Requiring a basis here made
    // AC-04 unsatisfiable by the real protocol (found in review, R1/F003).
    writeFlow(corpus.folder, [{ status: 'skipped', comments: [decline()] }]);

    const reading = readReady(corpus);

    // Declining the survey is the human's right. A gate that read a receipted
    // decline as not-ready would be a compliance floor, which the flow forbids.
    expect(reading.survey.reason).toBe('declined-with-receipt');
    expect(reading.survey.satisfied).toBe(true);
    expect(reading.survey.basis).toBeNull();
    expect(reading.verdict).toBe('ready');
  });

  it('AC-04 — a decline does not go stale when the plan is edited afterwards', () => {
    // The asymmetry, asserted rather than left implicit: a completed survey is a
    // claim about SPECIFIC bytes and expires when they change; a decline is a
    // decision about the WORK, so there is nothing for an edit to invalidate.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'skipped', comments: [decline()] }]);
    const before = sha256(corpus.plan);
    const doc = JSON.parse(readFileSync(corpus.plan, 'utf8')) as Record<string, unknown>;
    doc.summary = 'edited after the decline was recorded';
    writeFileSync(corpus.plan, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    expect(sha256(corpus.plan)).not.toBe(before);

    const reading = readReady(corpus);

    expect(reading.survey.reason).toBe('declined-with-receipt');
    expect(reading.verdict).toBe('ready');
  });

  it('R3/F001 — an agent-authored decision cannot decline a skipped survey', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [
      { status: 'skipped', comments: [{ ...decline(), source: 'agent' }] },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('invalid-receipt');
    expect(reading.verdict).toBe('not-ready');
  });

  it('R3/F001 — even a user decision is not a decline on a done survey', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [decline()] }]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('invalid-receipt');
    expect(reading.verdict).toBe('not-ready');
  });

  it('R1/F002 — a later matching receipt beats an earlier stale one on the same node', () => {
    // Comments are append-only, so a re-surveyed node holds its history: the stale
    // receipt FIRST, the current one after it. A first-match scan would report
    // `stale-basis` about a survey that has in fact already been redone — the
    // older word shadowing the newer one. The last word wins.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    writeFlow(corpus.folder, [
      { status: 'done', comments: [receipt('b'.repeat(64)), receipt(basis)] },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.reason).toBe('survey-done');
    expect(reading.survey.basis).toBe(basis);
    expect(reading.verdict).toBe('ready');
  });

  it('R1/F002 — and the reverse order still reads stale: the newest word is the word', () => {
    // The control for the control. If the fixture above passed because the reader
    // simply prefers a matching basis anywhere in the list, this one would pass
    // too — and it must not.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    writeFlow(corpus.folder, [
      { status: 'done', comments: [receipt(basis), receipt('b'.repeat(64))] },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.reason).toBe('stale-basis');
    expect(reading.survey.basis).toBe('b'.repeat(64));
    expect(reading.verdict).toBe('not-ready');
  });

  it('R1/F004 — a comment with NO kind is not a receipt, whatever it says', () => {
    // The allow-list has to actually list. A kind-less comment carrying a perfect
    // basis was being accepted, which made the stated `validation | decision`
    // rule decorative — a control that does not do what it says it does, which is
    // this verb's own defect class.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const { kind: _dropped, ...kindless } = receipt(sha256(corpus.plan));
    writeFlow(corpus.folder, [{ status: 'done', comments: [kindless] }]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('missing-receipt');
    expect(reading.verdict).toBe('not-ready');
  });

  it('R1/F004 — a `note` is not a receipt either: notes are overwritable', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const note = { ...receipt(sha256(corpus.plan)), kind: 'note' };
    writeFlow(corpus.folder, [{ status: 'done', comments: [note] }]);

    const reading = readReady(corpus);

    expect(reading.survey.reason).toBe('missing-receipt');
    expect(reading.verdict).toBe('not-ready');
  });

  it('F006/R6 — the reading is anchored to all three doctrine statements', () => {
    const doctrine = readFileSync(join(REPO_ROOT, 'skills/eng-harness-flow/SKILL.md'), 'utf8');
    const template = readFileSync(
      join(REPO_ROOT, 'skills/builder/references/flight-plan.template.json'),
      'utf8',
    );
    const routing = readFileSync(
      join(REPO_ROOT, 'skills/builder/references/00-routing.md'),
      'utf8',
    );

    expect(template).toContain(
      'Router missing, or envelope noop/UNAVAILABLE → same two calls with the detection receipt/envelope as the text:',
    );
    expect(template).toContain('--text \\"decision:unavailable reason:<…> time:<…>\\" THEN');
    expect(doctrine).toContain('with that **real envelope** as the comment text');
    expect(routing).toContain(
      'detection receipt (`decision:unavailable`) or real `noop` envelope on the node',
    );
    expect(routing).toContain('(or the real `noop`/`UNAVAILABLE` envelope as the text)');
    expect(UNAVAILABLE_RECEIPT).toMatchObject({ kind: 'validation', source: 'agent' });
    expect(UNAVAILABLE_RECEIPT.text).toMatch(/^decision:unavailable reason:.+ time:.+$/);
  });

  it('R3/F003 — a malformed basis-less validation is not a router-unavailable attempt', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [
      {
        status: 'done',
        comments: [
          {
            ...UNAVAILABLE_RECEIPT,
            text: 'decision:completed verdict:Pass time:2026-08-05T08:10:00Z',
          },
        ],
      },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('invalid-receipt');
    expect(reading.verdict).toBe('not-ready');
  });

  it.each([
    ['operative decision:unavailable receipt', UNAVAILABLE_RECEIPT],
    ['documented alternative token noop', NOOP_ALTERNATIVE_RECEIPT],
    ['documented alternative token UNAVAILABLE', UNAVAILABLE_ALTERNATIVE_RECEIPT],
  ])('R6/F001 — %s is a basis-less completed attempt', (_label, comment) => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [comment] }]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBeNull();
    expect(reading.survey.reason).toBe('missing-basis');
    expect(reading.verdict).toBe('cant-tell');
  });

  it.each([
    'snoopy',
    'UNAVAILABLES',
  ])('R6/F001 — documented token reading does not accept the word fragment %s', (fragment) => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [
      { status: 'done', comments: [unavailableTokenReceipt(`result:${fragment}`)] },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBe(false);
    expect(reading.survey.reason).toBe('invalid-receipt');
    expect(reading.verdict).toBe('not-ready');
  });

  it('a doctrine-shaped unavailable validation is CANT-TELL, not not-ready', () => {
    // The doctrine's router-missing detection receipt has exactly this shape, and
    // its stated purpose is that "a chore never sits outstanding forever blocking
    // `nav` in an un-harnessed repo". Reading it as not-ready would reinstate the
    // block it exists to remove — and it would be a block with no exit, because
    // there is nothing a user in a router-less repo could do to turn it green.
    //
    // "The work is not ready" and "I cannot determine whether the work is ready"
    // are different claims. This is the second, and having three values is the
    // only reason the distinction is expressible at all.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [UNAVAILABLE_RECEIPT] }]);

    const reading = readReady(corpus);

    expect(reading.survey.satisfied).toBeNull();
    expect(reading.survey.reason).toBe('missing-basis');
    expect(reading.verdict).toBe('cant-tell');
    expect(reading.decided_by).toBe('survey');
  });

  it('R3/F004 — historical stale evidence cannot outrank the current unavailable node', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    writeFlow(corpus.folder, [
      { status: 'done', comments: [receipt('c'.repeat(64))] },
      {
        status: 'done',
        id: `backpressure-${basis.slice(0, 12)}`,
        comments: [UNAVAILABLE_RECEIPT],
      },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.node).toBe(`backpressure-${basis.slice(0, 12)}`);
    expect(reading.survey.reason).toBe('missing-basis');
    expect(reading.survey.satisfied).toBeNull();
    expect(reading.verdict).toBe('cant-tell');
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

  it('R3/F002 — a current todo re-basis node outranks a historical decline', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    writeFlow(corpus.folder, [
      { status: 'skipped', comments: [decline()] },
      { status: 'todo', id: `backpressure-${basis.slice(0, 12)}` },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.node).toBe(`backpressure-${basis.slice(0, 12)}`);
    expect(reading.survey.reason).toBe('not-run');
    expect(reading.survey.satisfied).toBe(false);
    expect(reading.verdict).toBe('not-ready');
  });

  it.each([
    ['matching validation', (basis: string) => receipt(basis), 'done'],
    ['human decline', (_basis: string) => decline(), 'skipped'],
  ] as const)('R4/F003 — later green %s outranks stale plain-node fallback', (_label, makeComment, status) => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    writeFlow(corpus.folder, [
      { status: 'done', comments: [receipt('d'.repeat(64))] },
      {
        status,
        id: 'backpressure-aaaaaaaaaaaa',
        comments: [makeComment(basis)],
      },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.node).toBe('backpressure-aaaaaaaaaaaa');
    expect(reading.survey.satisfied).toBe(true);
    expect(reading.verdict).toBe('ready');
  });

  it('R4/F004 — a genuinely id-less survey node degrades instead of throwing', () => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const path = writeFlow(corpus.folder, [{ status: 'done' }]);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { nodes: Array<Record<string, unknown>> };
    const survey = doc.nodes.find((node) => node.type === 'backpressure');
    if (survey === undefined) throw new Error('fixture must contain a survey node');
    delete survey.id;
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

    const reading = readReady(corpus);

    expect(reading.survey.node).toBeNull();
    expect(reading.survey.reason).toBe('missing-receipt');
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

  it('R1/F001 — the survey is found by its doctrine-pinned ID, not only by its type', () => {
    // What the doctrine PINS is the id — `backpressure`, and on a re-basis
    // `backpressure-<first 12 hex>`. It says nothing about `type`. Selecting on
    // type alone therefore depends on whoever mints the node picking the same type
    // this repo's flows happen to use: a coincidence, not a contract. Both id
    // shapes are asserted here against a NON-matching type.
    //
    // Plan 071 demonstrates the historical shape: its terminal re-basis node
    // `backpressure-1f1d8db67e6c` carries `type: chore`. The earlier plan-072-only
    // probe could not reveal that counterexample because both of its nodes carry
    // `type: backpressure`.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    const basis = sha256(corpus.plan);
    writeFlow(corpus.folder, [
      { status: 'done', type: 'chore', comments: [receipt('a'.repeat(64))] },
      {
        status: 'done',
        type: 'chore',
        id: `backpressure-${basis.slice(0, 12)}`,
        comments: [receipt(basis)],
      },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.node).toBe(`backpressure-${basis.slice(0, 12)}`);
    expect(reading.survey.reason).toBe('survey-done');
    expect(reading.verdict).toBe('ready');
  });

  it('an unrelated chore node is not mistaken for the survey', () => {
    // The other half of id-matching: widening the selector must not swallow every
    // chore in the flight plan. A node that is neither the backpressure type nor
    // the backpressure id leaves the dimension unknowable, not satisfied.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [
      {
        status: 'done',
        type: 'chore',
        id: 'observe-drain',
        comments: [receipt(sha256(corpus.plan))],
      },
    ]);

    const reading = readReady(corpus);

    expect(reading.survey.reason).toBe('no-survey-node');
    expect(reading.verdict).toBe('cant-tell');
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

  it('a router-less repo gets exit 2, not a not-ready it cannot act on', async () => {
    // The control for the R2 ruling, at the surface that matters: the doctrine's
    // verbatim `decision:unavailable` receipt must produce `unconfigured`/2. Not
    // not-ready (a block with no exit in a router-less repo), and not ready.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [UNAVAILABLE_RECEIPT] }]);

    const run = await runReady(corpus);

    expect(run.envelope?.status).toBe('unconfigured');
    expect(run.code).toBe(2);
    const data = run.envelope?.data as { verdict: string; reason: string };
    expect(data.verdict).toBe('cant-tell');
    expect(data.reason).toBe('missing-basis');
  });

  it.each([
    ['token noop', NOOP_ALTERNATIVE_RECEIPT],
    ['token UNAVAILABLE', UNAVAILABLE_ALTERNATIVE_RECEIPT],
  ])('R6/F001 — documented %s is unconfigured at the CLI, exit 2', async (_shape, comment) => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [comment] }]);

    const run = await runReady(corpus);

    expect(run.envelope?.status).toBe('unconfigured');
    expect(run.code).toBe(2);
    const data = run.envelope?.data as { verdict: string; reason: string };
    expect(data.verdict).toBe('cant-tell');
    expect(data.reason).toBe('missing-basis');
    expect(run.envelope?.next_action).toContain('nothing to fix');
  });

  it.each([
    ['agent decision', { status: 'skipped', comments: [{ ...decline(), source: 'agent' }] }],
    [
      'malformed basis-less validation',
      {
        status: 'done',
        comments: [
          {
            ...UNAVAILABLE_RECEIPT,
            text: 'decision:completed verdict:Pass time:2026-08-05T08:10:00Z',
          },
        ],
      },
    ],
  ] as const)('R4/F005 — %s is invalid-receipt at the CLI, advisory exit 0', async (_label, survey) => {
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [survey]);

    const run = await runReady(corpus);

    expect(run.envelope?.status).toBe('degraded');
    expect(run.code).toBe(0);
    const data = run.envelope?.data as { verdict: string; reason: string };
    expect(data.verdict).toBe('not-ready');
    expect(data.reason).toBe('invalid-receipt');
    expect(run.envelope?.next_action).toContain('cannot count');
    expect(run.envelope?.next_action).toContain('basis_sha256');
    expect(run.envelope?.next_action).toContain('--kind decision --source user');
  });

  it('`--strict` does not give a router-less repo teeth either', async () => {
    // Strict adds teeth to a KNOWN not-ready. Escalating a can't-tell would put
    // back the un-clearable CI failure this ruling exists to remove.
    corpus = createSyntheticPlan({ slug: 'synthetic-plan', ...CLAIMED });
    writeFlow(corpus.folder, [{ status: 'done', comments: [UNAVAILABLE_RECEIPT] }]);

    const run = await runReady(corpus, '--strict');

    expect(run.envelope?.status).toBe('unconfigured');
    expect(run.code).toBe(2);
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
