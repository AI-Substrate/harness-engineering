import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPlanScaffold, slugify } from '../../src/acts/plan/scaffold.js';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

/**
 * The REAL shipped `builder/plan` package, copied into each temp corpus.
 *
 * Copied rather than re-declared: a hand-written twin would pass this suite while
 * the scaffold drifted away from the schema it actually names, which is precisely
 * the failure the exemplar exists to prevent.
 */
const REAL_SCHEMA = readFileSync(
  fileURLToPath(new URL('../../../../.dd/schemas/builder/plan/schema.json', import.meta.url)),
  'utf8',
);

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-04T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function run(argv: string[]): Promise<{ envelope: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await buildProgram('0.0.0-test', io, deps(), EMPTY).parseAsync(['node', 'harness', ...argv]);
    code = process.exitCode ?? 0;
  } catch (error) {
    if (!/^exit:\d+$/.test(error instanceof Error ? error.message : '')) throw error;
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
  return { envelope: JSON.parse(out.trim()) as Envelope, code };
}

describe('plan scaffold — pure', () => {
  it('splits every plan by phase, even a single-phase one', () => {
    const scaffold = buildPlanScaffold({ slug: 'demo', phases: ['Only phase'] });
    expect(scaffold.plan.relativePath).toBe('plan.dd.json');
    expect(scaffold.taskFiles.map((file) => file.relativePath)).toEqual([
      'tasks/phase-1-only-phase/tasks.dd.json',
    ]);
  });

  it('mints ids that are legal, unique, and REPRODUCIBLE', () => {
    // Reproducibility is the requirement a random mint would have broken: the
    // same arguments must produce the same bytes, or a re-scaffold reads as a diff.
    const once = buildPlanScaffold({ slug: 'demo', phases: ['A', 'B', 'C'] });
    const twice = buildPlanScaffold({ slug: 'demo', phases: ['A', 'B', 'C'] });
    expect(once.plan.json).toBe(twice.plan.json);

    const phases = JSON.parse(once.plan.json).sections.find(
      (section: { name: string }) => section.name === 'phases',
    ).value as Array<{ id: string }>;
    const ids = phases.map((phase) => phase.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^ph-[0-9a-f]{4}$/);
  });

  it('chains depends_on down the phase list and links each phase to its task file', () => {
    const scaffold = buildPlanScaffold({ slug: 'demo', phases: ['First', 'Second'] });
    const phases = JSON.parse(scaffold.plan.json).sections.find(
      (section: { name: string }) => section.name === 'phases',
    ).value as Array<{ id: string; depends_on?: string[]; tasks: string }>;

    expect(phases[0]?.depends_on).toBeUndefined();
    expect(phases[1]?.depends_on).toEqual([phases[0]?.id]);
    expect(phases[0]?.tasks).toBe('tasks/phase-1-first/tasks.dd.json#tasks');
    expect(phases[1]?.tasks).toBe('tasks/phase-2-second/tasks.dd.json#tasks');
  });

  it('gives every task file its evidence section up front', () => {
    // So the first task added has somewhere to put its proof, instead of having
    // to invent a section that workshop-002 already named.
    const scaffold = buildPlanScaffold({ slug: 'demo', phases: ['A'] });
    const sections = JSON.parse(scaffold.taskFiles[0]?.json ?? '{}').sections as Array<{
      name: string;
      value: unknown;
    }>;
    expect(sections.map((section) => section.name)).toEqual(['meta', 'tasks', 'evidence']);
    expect(sections[2]?.value).toEqual({});
  });

  it('records no basis for documents nobody has verified yet', () => {
    // A ledger entry is minted by verification, never by creation.
    expect(
      JSON.parse(buildPlanScaffold({ slug: 'demo', phases: ['A'] }).plan.json).references,
    ).toEqual([]);
  });

  it.each([
    ['Capture pipeline', 'capture-pipeline'],
    ['  Spaces  &  Symbols!  ', 'spaces-symbols'],
    ['', 'phase'],
    ['!!!', 'phase'],
  ])('slugifies %j to %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('harness plan — live over a real corpus', () => {
  let repo = '';
  let previousCwd = '';

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'harness-plan-live-'));
    const schemaPath = join(repo, '.dd/schemas/builder/plan/schema.json');
    mkdirSync(dirname(schemaPath), { recursive: true });
    writeFileSync(schemaPath, REAL_SCHEMA, 'utf8');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    previousCwd = process.cwd();
    // Every dd/plan verb takes the repo root from process.cwd(), so the corpus
    // only means what it says while cwd is pinned to it (the P2 idiom).
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
  });

  it('scaffolds a plan that validates and renders out of the box', async () => {
    const created = await run([
      'plan',
      'new',
      'telemetry-repair',
      '--title',
      'Telemetry repair',
      '--phase',
      'Capture pipeline',
      '--phase',
      'Remote sync',
      '--dir',
      'plans',
    ]);
    expect(created.code).toBe(0);
    expect(created.envelope.status).toBe('ok');
    const data = created.envelope.data as { documents: string[]; rendered: string[] };
    expect(data.documents).toHaveLength(3);
    expect(data.rendered).toHaveLength(3);

    const validated = await run(['plan', 'validate', 'plans/telemetry-repair']);
    expect(validated.code).toBe(0);
    expect((validated.envelope.data as { counts: { error: number } }).counts.error).toBe(0);

    // The whole plan renders, and every sibling already matches — `plan new`
    // rendered through the SAME path `dd build` uses, so it cannot disagree.
    const checked = await run(['plan', 'render', 'plans/telemetry-repair', '--check']);
    expect(checked.code).toBe(0);
    expect(checked.envelope.status).toBe('ok');
    expect(checked.envelope.data).toMatchObject({ drifted: [] });
  });

  it('renders the whole plan, not just the document it was pointed at', async () => {
    // The reason `plan` is a verb rather than a `dd` subcommand: `dd build` acts
    // on one file, and a plan is a folder of them.
    await run(['plan', 'new', 'many-phases', '--phase', 'One', '--phase', 'Two', '--dir', 'plans']);
    const rendered = await run(['plan', 'render', 'plans/many-phases']);
    expect(rendered.code).toBe(0);
    expect((rendered.envelope.data as { documents: string[] }).documents).toHaveLength(3);
  });

  it('catches drift in a task file when the plan document itself is untouched', async () => {
    await run(['plan', 'new', 'drifty', '--phase', 'Only', '--dir', 'plans']);
    const sibling = join(repo, 'plans/drifty/tasks/phase-1-only/tasks.dd.md');
    writeFileSync(sibling, '# hand-edited\n', 'utf8');

    const checked = await run(['plan', 'render', 'plans/drifty', '--check']);
    expect(checked.code).toBe(1);
    expect(checked.envelope.error?.code).toBe('E422');
    expect((checked.envelope.error?.details as { drifted: string[] }).drifted).toHaveLength(1);
  });

  it('accepts the plan document path as well as its folder', async () => {
    const byFile = await run(['plan', 'validate', 'plans/telemetry-repair/plan.dd.json']);
    const byFolder = await run(['plan', 'validate', 'plans/telemetry-repair']);
    expect(byFile.envelope.data).toMatchObject({
      path: (byFolder.envelope.data as { path: string }).path,
    });
  });

  it('refuses to overwrite an existing plan, before writing anything', async () => {
    const again = await run(['plan', 'new', 'telemetry-repair', '--phase', 'X', '--dir', 'plans']);
    expect(again.code).toBe(1);
    expect(again.envelope.error?.code).toBe('E152');
    // The refusal is total: the phase list it would have written is NOT there.
    const plan = JSON.parse(
      readFileSync(join(repo, 'plans/telemetry-repair/plan.dd.json'), 'utf8'),
    );
    const phases = plan.sections.find((s: { name: string }) => s.name === 'phases').value;
    expect(phases).toHaveLength(2);
  });

  it('rejects a slug that is not a plan folder name', async () => {
    const bad = await run(['plan', 'new', 'Not A Slug', '--dir', 'plans']);
    expect(bad.code).toBe(1);
    expect(bad.envelope.error?.code).toBe('E150');
  });

  it('reports an honest failure when there is no plan where it was pointed', async () => {
    const missing = await run(['plan', 'validate', 'plans/nothing-here']);
    expect(missing.code).toBe(1);
    expect(missing.envelope.error?.code).toBe('E400');
    expect(missing.envelope.next_action).toContain('harness plan new');
  });

  it('rejects a negative depth rather than guessing what was meant', async () => {
    const bad = await run(['plan', 'validate', 'plans/telemetry-repair', '--depth', '-1']);
    expect(bad.code).toBe(1);
    expect(bad.envelope.error?.code).toBe('E108');
  });
});
