import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { outcomeEvents } from '../../src/services/telemetry/outcome-events.js';
import { runCliIn } from '../support/run-cli.js';

/**
 * tk-7147 / dw-0010 — THE PHASE EXIT: create → JIT → refuse → green → depart.
 *
 * Every other task in ph-7102 is proven in its own unit. This one exists because
 * those proofs share an assumption they cannot check: that the pieces compose.
 * The template bakes an address, `--plan-dir` anchors it, the scaffolder births a
 * document at that path, the gate resolves it, the validator judges it, and the
 * writer verbs move it — six seams authored separately, each with its own idea of
 * what an address looks like. A single wrong segment anywhere and the journey
 * refuses forever with a gate nobody can clear.
 *
 * So the CLI is the ACTOR here, not a fixture: every step is a real `harness`
 * invocation over a real temp repository, in the order a journey performs them.
 * Nothing is hand-written into a document that a verb is supposed to write.
 *
 * The refusal in the middle is the point. A dry-run that only proved the happy
 * path would pass just as happily against a gate wired to nothing.
 */

const REFERENCES = fileURLToPath(
  new URL('../../../../skills/builder/references/', import.meta.url),
);
const TEMPLATE = join(REFERENCES, 'flight-plan.template.json');
const SCHEMA = join(REFERENCES, 'flight-plan.schema.json');

let root = '';
let previousCwd = '';

afterEach(() => {
  // Restore FIRST, and only if we moved: vitest reuses a worker across files, so
  // a suite that leaves the process parked in a deleted temp directory poisons
  // whatever runs next in that worker.
  if (previousCwd.length > 0) process.chdir(previousCwd);
  previousCwd = '';
  if (root.length > 0) rmSync(root, { recursive: true, force: true });
  root = '';
});

/** Copy the repo's real `.dd/schemas` in — the journey resolves the shipped builder package. */
function seedRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'dryrun-'));
  const schemas = fileURLToPath(new URL('../../../../.dd/schemas', import.meta.url));
  // Real schemas, never mocks — the same convention the corpus factory uses.
  mkdirSync(join(repo, '.dd'), { recursive: true });
  cpSync(schemas, join(repo, '.dd', 'schemas'), { recursive: true });
  // The dd/plan acts are composition roots and build their own `NodeProcess`, so
  // the repo root they resolve is the REAL cwd — not the injected fake.
  previousCwd = process.cwd();
  process.chdir(repo);
  return repo;
}

const PLAN_DIR = 'docs/plans/dry-run';

describe('dw-0010 — the joint-exit dry-run, CLI as actor', () => {
  it('creates, JIT-births, REFUSES, goes green, and departs', async () => {
    root = seedRepo();
    const abs = (relative: string) => join(root, relative);

    // ---------------------------------------------------------------- CREATE
    // 1. The plan document, scaffolded by the CLI. No -plan.md is produced.
    const scaffold = await runCliIn(root, [
      'plan',
      'new',
      'dry-run',
      '--title',
      'Dry run',
      '--dir',
      'docs/plans',
      '--phase',
      'Core',
    ]);
    expect(scaffold.code).toBe(0);
    const planPath = `${PLAN_DIR}/plan.dd.json`;
    expect(existsSync(abs(planPath))).toBe(true);
    expect(existsSync(abs(`${PLAN_DIR}/dry-run-plan.md`))).toBe(false);

    // 2. The flow, with its gates anchored at the plan folder.
    const flowPath = `${PLAN_DIR}/the-flow.json`;
    const created = await runCliIn(root, [
      'flow',
      'create',
      'flight-plan',
      '--slug',
      'dry-run',
      '--path',
      flowPath,
      '--schema',
      SCHEMA,
      '--template',
      TEMPLATE,
      '--plan-dir',
      PLAN_DIR,
    ]);
    expect(created.code).toBe(0);
    const flow = JSON.parse(readFileSync(abs(flowPath), 'utf8')) as {
      nodes: Array<{ id: string; dd_link?: { address: string; check?: string } }>;
    };
    const phaseGate = flow.nodes.find((n) => n.id === 'phase-1')?.dd_link;
    const reviewGate = flow.nodes.find((n) => n.id === 'review-1')?.dd_link;
    // The composition claim, stated: the baked address now names a real path.
    expect(phaseGate?.address).toBe(`${PLAN_DIR}/assets/tasks/phase-1/tasks.dd.json#tasks`);
    expect(reviewGate?.address).toBe(planPath);
    expect(reviewGate?.check).toBe('plan-validate');

    // ------------------------------------------------------------------- JIT
    // The scaffolder births the phase's task file at exactly the gate's address.
    // If these two ever disagree the journey is unclearable, so it is asserted
    // rather than assumed.
    const tasksPath = `${PLAN_DIR}/assets/tasks/phase-1/tasks.dd.json`;
    expect(existsSync(abs(tasksPath))).toBe(true);
    expect(phaseGate?.address.startsWith(tasksPath)).toBe(true);

    // The phase id is MINTED by the scaffolder, so it is read back rather than
    // guessed — a dry-run that hard-codes an id is not driving the CLI, it is
    // asserting against a copy of it.
    const phases = await runCliIn(root, ['dd', 'get', `${planPath}#phases`]);
    expect(phases.code).toBe(0);
    const phaseId = (
      (phases.envelope?.data as { value: Array<{ id: string }> }).value[0] as {
        id: string;
      }
    ).id;

    // Author one task + one assertion through the verbs, ids minted by the CLI.
    const ac = await runCliIn(root, [
      'dd',
      'add',
      `${planPath}#acceptance_criteria`,
      '{"claim":"the loop closes","state":"unchecked"}',
      '--mint',
      'ac',
    ]);
    expect(ac.code).toBe(0);
    const acId = (ac.envelope?.data as { minted: string }).minted;

    const task = await runCliIn(root, [
      'dd',
      'add',
      `${tasksPath}#tasks`,
      JSON.stringify({
        title: 'do the work',
        phase: phaseId,
        state: 'unchecked',
        satisfies: [`../../../plan.dd.json#acceptance_criteria/${acId}`],
      }),
      '--mint',
      'tk',
    ]);
    expect(task.code).toBe(0);
    const taskId = (task.envelope?.data as { minted: string }).minted;

    const assertion = await runCliIn(root, [
      'dd',
      'add',
      `${tasksPath}#done_when/${taskId}`,
      '{"assertion":"it works","state":"unchecked","pressure":"not-applicable"}',
      '--mint',
      'dw',
    ]);
    expect(assertion.code, JSON.stringify(assertion.envelope?.error)).toBe(0);
    const dwId = (assertion.envelope?.data as { minted: string }).minted;

    // The sibling exists and is current — written by the verb, not by hand.
    expect(existsSync(abs(`${PLAN_DIR}/assets/tasks/phase-1/tasks.dd.md`))).toBe(true);
    const drift = await runCliIn(root, ['dd', 'build', tasksPath, '--check']);
    expect(drift.code).toBe(0);

    // --------------------------------------------------------------- REFUSE
    // Standing on phase-1 with the task open, departure is REFUSED.
    const onPhase = await runCliIn(root, [
      'flow',
      'nav',
      'set',
      '--path',
      flowPath,
      '--now',
      'phase-1',
      '--json',
    ]);
    expect(onPhase.code).toBe(0);

    const before = readFileSync(abs(flowPath), 'utf8');
    const refused = await runCliIn(root, [
      'flow',
      'nav',
      'set',
      '--path',
      flowPath,
      '--now',
      'review-1',
      '--json',
    ]);
    expect(refused.code).toBe(1);
    expect(refused.envelope?.error?.code).toBe('E440');
    // It names the outstanding row rather than a count — the reader is not sent
    // back to the command line to ask what is left.
    expect(refused.envelope?.error?.message).toContain(taskId);
    // NOTHING WRITTEN.
    expect(readFileSync(abs(flowPath), 'utf8')).toBe(before);
    // …and the refusal is EVIDENCE (tk-7169), not just a message on a terminal.
    const events = outcomeEvents(refused.out, '2026-08-04T09:00:00.000Z', true);
    expect(events.find((e) => e.kind === 'command_exit')).toMatchObject({ code: 'E440' });

    // ----------------------------------------------------------------- GREEN
    // Do the work the gate asked for, through the verbs.
    expect(
      (
        await runCliIn(root, [
          'dd',
          'set',
          `${tasksPath}#done_when/${taskId}/${dwId}/state`,
          'checked',
        ])
      ).code,
    ).toBe(0);
    expect(
      (await runCliIn(root, ['dd', 'set', `${tasksPath}#tasks/${taskId}/state`, 'checked'])).code,
    ).toBe(0);

    // ---------------------------------------------------------------- DEPART
    const departed = await runCliIn(root, [
      'flow',
      'nav',
      'set',
      '--path',
      flowPath,
      '--now',
      'review-1',
      '--json',
    ]);
    expect(departed.code).toBe(0);
    const moved = JSON.parse(readFileSync(abs(flowPath), 'utf8')) as { nav: { now: string } };
    expect(moved.nav.now).toBe('review-1');

    // ------------------------------------------------- THE SECOND GATE HOLDS
    // review-1 carries the CHECK gate, and the plan is not green yet: the AC is
    // still open. The two kinds are wired independently and both bite.
    const refusedCheck = await runCliIn(root, [
      'flow',
      'nav',
      'set',
      '--path',
      flowPath,
      '--now',
      'post-flight',
      '--json',
    ]);
    expect(refusedCheck.code).toBe(1);
    expect(refusedCheck.envelope?.error?.code).toBe('E440');
    expect(refusedCheck.envelope?.error?.message).toContain('plan-validate');

    // Close the criterion, and the whole plan goes green.
    expect(
      (
        await runCliIn(root, [
          'dd',
          'set',
          `${planPath}#acceptance_criteria/${acId}/state`,
          'checked',
        ])
      ).code,
    ).toBe(0);
    expect(
      (await runCliIn(root, ['dd', 'set', `${planPath}#phases/${phaseId}/state`, 'checked'])).code,
    ).toBe(0);

    const complete = await runCliIn(root, ['plan', 'validate', planPath, '--complete']);
    expect(complete.code).toBe(0);

    const departedCheck = await runCliIn(root, [
      'flow',
      'nav',
      'set',
      '--path',
      flowPath,
      '--now',
      'post-flight',
      '--json',
    ]);
    expect(departedCheck.code).toBe(0);
    const final = JSON.parse(readFileSync(abs(flowPath), 'utf8')) as { nav: { now: string } };
    expect(final.nav.now).toBe('post-flight');
  });

  it('the whole journey never hand-wrote a generated sibling', async () => {
    // The invariant the journey must not have bought its green with. Every
    // `.dd.md` in the corpus is exactly what `dd build --check` would produce.
    root = seedRepo();
    const scaffold = await runCliIn(root, [
      'plan',
      'new',
      'dry-run',
      '--title',
      'Dry run',
      '--dir',
      'docs/plans',
      '--phase',
      'Core',
    ]);
    expect(scaffold.code).toBe(0);
    const planPath = `${PLAN_DIR}/plan.dd.json`;

    await runCliIn(root, ['dd', 'set', `${planPath}#summary`, 'a summary written by the verb']);
    const check = await runCliIn(root, ['dd', 'build', planPath, '--check']);
    expect(check.code).toBe(0);
    expect(readFileSync(join(root, `${PLAN_DIR}/plan.dd.md`), 'utf8')).toContain(
      'a summary written by the verb',
    );
  });
});
