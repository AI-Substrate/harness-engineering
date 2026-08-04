import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root, so a synthetic corpus can borrow the REAL `builder/*` schemas. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * The section holding per-task assertion lists. Named once because it was renamed
 * once (`evidence` → `done_when`, tk-7015) and a factory that spelled it inline
 * in four places would have been four places to miss.
 */
export const ASSERTIONS_SECTION = 'done_when';

export interface SyntheticAssertion {
  id: string;
  assertion: string;
  state?: string;
  note?: string;
  receipt?: string;
  /**
   * The instrument this assertion names: a `bp-` row id, the literal
   * `not-applicable`, or `undefined` to plant the missing-pressure bad case.
   */
  pressure?: string;
  proven_by?: string;
}

export interface SyntheticTask {
  id: string;
  title: string;
  state?: string;
  note?: string;
  receipt?: string;
  done?: string;
  /** AC ids, rewritten to the task file's relative depth; a raw string plants a bad shape. */
  satisfies?: string[] | string;
  assertions?: SyntheticAssertion[];
}

export interface SyntheticPhase {
  id: string;
  title: string;
  state?: string;
  note?: string;
  receipt?: string;
  /** Task rows JIT-expanded into their own file. Omit for a phase whose file is unborn. */
  tasks?: SyntheticTask[];
}

export interface SyntheticAcceptance {
  id: string;
  claim: string;
  state?: string;
  note?: string;
  receipt?: string;
  pressure?: string;
  proven_by?: string;
}

export interface SyntheticPlanOptions {
  slug?: string;
  title?: string;
  status?: string;
  acceptance?: SyntheticAcceptance[];
  phases?: SyntheticPhase[];
  /** Extra sections merged into the plan document verbatim — the planted-bad seam. */
  sections?: Array<{ name: string; value: unknown }>;
}

export interface SyntheticCorpus {
  /** Absolute path of the temp repository root. */
  root: string;
  /** Absolute path of the plan folder. */
  folder: string;
  /** Absolute path of `plan.dd.json`. */
  plan: string;
  /** Absolute path of each JIT-born task file, by phase id. */
  taskFiles: Record<string, string>;
  /** Repo-relative POSIX path of the plan document — what a CLI argument looks like. */
  planRelative: string;
  /** Repo-relative POSIX path of a phase's task file. */
  taskFileRelative(phaseId: string): string;
  cleanup(): void;
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** The relative prefix from `assets/tasks/phase-N/` back to the plan folder. */
const UP_TO_PLAN = '../../../';

function taskRow(task: SyntheticTask, phaseId: string) {
  const hasAssertions = task.assertions !== undefined && task.assertions.length > 0;
  return {
    id: task.id,
    title: task.title,
    phase: phaseId,
    state: task.state ?? 'unchecked',
    ...(task.note !== undefined && { note: task.note }),
    ...(task.receipt !== undefined && { receipt: task.receipt }),
    ...(hasAssertions
      ? { done: `#${ASSERTIONS_SECTION}/${task.id}` }
      : task.done !== undefined && { done: task.done }),
    ...(task.satisfies !== undefined && {
      satisfies: Array.isArray(task.satisfies)
        ? task.satisfies.map((ac) => `${UP_TO_PLAN}plan.dd.json#acceptance_criteria/${ac}`)
        : task.satisfies,
    }),
  };
}

function assertionRow(assertion: SyntheticAssertion) {
  return {
    id: assertion.id,
    assertion: assertion.assertion,
    state: assertion.state ?? 'unchecked',
    ...(assertion.note !== undefined && { note: assertion.note }),
    ...(assertion.receipt !== undefined && { receipt: assertion.receipt }),
    ...(assertion.pressure !== undefined && {
      pressure:
        assertion.pressure === 'not-applicable'
          ? 'not-applicable'
          : `${UP_TO_PLAN}backpressure.dd.json#rows/${assertion.pressure}`,
    }),
    ...(assertion.proven_by !== undefined && {
      proven_by: `${UP_TO_PLAN}execution-log.dd.json#entries/${assertion.proven_by}`,
    }),
  };
}

/**
 * Build a throwaway plan corpus on disk: real `builder/*` schemas, a plan
 * document, and one JIT-born task file per phase that declares tasks.
 *
 * The schemas are COPIED from the repo rather than mocked, and that is the point
 * (tk-7027). A factory with its own private schema would prove the engine works
 * against a fixture nobody ships; copying the real package makes every mutation
 * suite ALSO a test of the shipped `builder/plan` declarations — so a rel that
 * stops being declared, or a `pressure` rule that stops firing, fails here too.
 */
export function createSyntheticPlan(options: SyntheticPlanOptions = {}): SyntheticCorpus {
  const root = mkdtempSync(join(tmpdir(), 'dd-corpus-'));
  cpSync(join(REPO_ROOT, '.dd', 'schemas'), join(root, '.dd', 'schemas'), { recursive: true });

  const slug = options.slug ?? 'synthetic-plan';
  const folder = join(root, 'docs', 'plans', slug);
  const phases = options.phases ?? [];
  const acceptance = options.acceptance ?? [];

  const taskFiles: Record<string, string> = {};
  const relativeTaskFiles: Record<string, string> = {};
  const phaseRows = phases.map((phase, index) => {
    const ordinal = index + 1;
    const relative = `assets/tasks/phase-${ordinal}/tasks.dd.json`;
    if (phase.tasks !== undefined) {
      taskFiles[phase.id] = join(folder, 'assets', 'tasks', `phase-${ordinal}`, 'tasks.dd.json');
      relativeTaskFiles[phase.id] = `docs/plans/${slug}/${relative}`;
    }
    return {
      id: phase.id,
      title: phase.title,
      state: phase.state ?? 'unchecked',
      ...(phase.note !== undefined && { note: phase.note }),
      ...(phase.receipt !== undefined && { receipt: phase.receipt }),
      ...(phase.tasks !== undefined && { tasks: `${relative}#tasks` }),
    };
  });

  write(join(folder, 'plan.dd.json'), {
    dd: { schema: 'builder/plan' },
    sections: [
      {
        name: 'meta',
        value: {
          title: options.title ?? 'Synthetic plan',
          slug,
          status: options.status ?? 'draft',
        },
      },
      { name: 'summary', value: options.title ?? 'A synthetic plan for tests.' },
      {
        name: 'acceptance_criteria',
        value: acceptance.map((row) => ({
          id: row.id,
          claim: row.claim,
          state: row.state ?? 'unchecked',
          ...(row.note !== undefined && { note: row.note }),
          ...(row.receipt !== undefined && { receipt: row.receipt }),
          ...(row.pressure !== undefined && { pressure: row.pressure }),
          ...(row.proven_by !== undefined && { proven_by: row.proven_by }),
        })),
      },
      { name: 'phases', value: phaseRows },
      ...(options.sections ?? []),
    ],
  });

  for (const [index, phase] of phases.entries()) {
    if (phase.tasks === undefined) continue;
    const ordinal = index + 1;
    const path = join(folder, 'assets', 'tasks', `phase-${ordinal}`, 'tasks.dd.json');
    const withAssertions = phase.tasks.filter(
      (task) => task.assertions !== undefined && task.assertions.length > 0,
    );
    write(path, {
      dd: { schema: 'builder/plan' },
      sections: [
        {
          name: 'meta',
          value: {
            title: `Phase ${ordinal} — ${phase.title}`,
            slug: `phase-${ordinal}`,
            status: 'in-progress',
          },
        },
        { name: 'summary', value: `Task detail for ${phase.id}.` },
        { name: 'tasks', value: phase.tasks.map((task) => taskRow(task, phase.id)) },
        ...(withAssertions.length > 0
          ? [
              {
                name: ASSERTIONS_SECTION,
                value: Object.fromEntries(
                  withAssertions.map((task) => [
                    task.id,
                    (task.assertions ?? []).map(assertionRow),
                  ]),
                ),
              },
            ]
          : []),
      ],
    });
  }

  return {
    root,
    folder,
    plan: join(folder, 'plan.dd.json'),
    taskFiles,
    planRelative: `docs/plans/${slug}/plan.dd.json`,
    taskFileRelative: (phaseId: string) => {
      const path = relativeTaskFiles[phaseId];
      if (path === undefined) throw new Error(`no task file for phase "${phaseId}"`);
      return path;
    },
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
