import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { toPosix } from '../../src/services/shared/posix-path.js';

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
    // BARE ORDINAL under `assets/` — moved DELIBERATELY at plan 071 ac-7110.
    // The flight-plan template bakes this exact address as a departure gate
    // before any phase has a title, so a title-derived directory is unknowable
    // when the gate is authored; and retitling a phase must never relocate the
    // document a gate points at. The phase-2 joint-exit dry-run is what proved
    // the two halves have to agree.
    expect(scaffold.taskFiles.map((file) => file.relativePath)).toEqual([
      'assets/tasks/phase-1/tasks.dd.json',
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
    expect(phases[0]?.tasks).toBe('assets/tasks/phase-1/tasks.dd.json#tasks');
    expect(phases[1]?.tasks).toBe('assets/tasks/phase-2/tasks.dd.json#tasks');
  });

  it('gives every task file its done_when section up front', () => {
    // So the first task added has somewhere to put its proof, instead of having
    // to invent a section that workshop-002 already named.
    const scaffold = buildPlanScaffold({ slug: 'demo', phases: ['A'] });
    const sections = JSON.parse(scaffold.taskFiles[0]?.json ?? '{}').sections as Array<{
      name: string;
      value: unknown;
    }>;
    expect(sections.map((section) => section.name)).toEqual([
      'meta',
      'summary',
      'tasks',
      'done_when',
    ]);
    expect(sections[3]?.value).toEqual({});
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

describe('plan scaffold — the plan-new fixes bundle (plan 080 tk-0011)', () => {
  it('seeds every section the schema declares, not a fixed list', () => {
    // dogfood-ledger #1, harness half. The writer verbs cannot CREATE a section
    // (`dd add …#open_questions` → E450 `section-absent`, "the writer verbs
    // cannot create a section today"), so a scaffold that seeds fewer sections
    // than the schema declares hands every author the same manual workaround.
    const declared = {
      meta: {},
      summary: '',
      goals: [],
      open_questions: [],
      risks: [],
      gate_matrix: [],
      done_when: {},
    };
    const scaffold = buildPlanScaffold({ slug: 'demo', phases: ['A'], declaredSections: declared });
    const names = (JSON.parse(scaffold.plan.json) as { sections: { name: string }[] }).sections.map(
      (section) => section.name,
    );
    for (const name of Object.keys(declared)) expect(names).toContain(name);
  });

  it('seeds each declared section with an empty value of its own SHAPE', () => {
    // An array section seeded `{}` would refuse the first `dd add` just as hard
    // as an absent one — the fix has to carry the shape, not merely the name.
    const scaffold = buildPlanScaffold({
      slug: 'demo',
      phases: ['A'],
      declaredSections: { open_questions: [], risks_assumptions: {}, research_context: '' },
    });
    const sections = (
      JSON.parse(scaffold.plan.json) as { sections: { name: string; value: unknown }[] }
    ).sections;
    const byName = new Map(sections.map((section) => [section.name, section.value]));
    expect(byName.get('open_questions')).toEqual([]);
    expect(byName.get('risks_assumptions')).toEqual({});
    expect(byName.get('research_context')).toBe('');
  });

  it('never overwrites a section the scaffold already filled', () => {
    // `meta` arrives with a real title/slug. A naive "seed everything declared"
    // pass would flatten it to `{}` and the scaffold would emit a plan with no
    // identity — silently, because an empty meta is still schema-shaped.
    const scaffold = buildPlanScaffold({
      slug: 'demo',
      title: 'Demo Plan',
      phases: ['A'],
      declaredSections: { meta: {}, goals: [] },
    });
    const sections = (
      JSON.parse(scaffold.plan.json) as { sections: { name: string; value: unknown }[] }
    ).sections;
    const meta = sections.find((section) => section.name === 'meta')?.value as { title?: string };
    expect(meta.title).toBe('Demo Plan');
    expect(sections.filter((section) => section.name === 'meta')).toHaveLength(1);
  });

  it('records an ordinal on meta and leaves the slug CLEAN', () => {
    // dogfood-ledger #2's pre-agreed acceptance test. The defect was that the
    // number had to be typed into the slug, so `meta.slug` carried the prefix and
    // a later bare-slug run minted a SECOND folder whose meta disagreed.
    const scaffold = buildPlanScaffold({ slug: 'dd-consume-upgrade', ordinal: 80, phases: ['A'] });
    const meta = (
      JSON.parse(scaffold.plan.json) as { sections: { name: string; value: unknown }[] }
    ).sections.find((section) => section.name === 'meta')?.value as {
      slug?: string;
      ordinal?: number;
    };
    expect(meta.slug).toBe('dd-consume-upgrade');
    expect(meta.slug).not.toContain('80');
    expect(meta.ordinal).toBe(80);
  });

  it('omits ordinal entirely when none is given, rather than defaulting one', () => {
    // A plan with no number must not claim `ordinal: 0` — that is a fact nobody
    // asserted, and it would sort ahead of every real plan.
    const scaffold = buildPlanScaffold({ slug: 'demo', phases: ['A'] });
    const meta = (
      JSON.parse(scaffold.plan.json) as { sections: { name: string; value: unknown }[] }
    ).sections.find((section) => section.name === 'meta')?.value as Record<string, unknown>;
    expect('ordinal' in meta).toBe(false);
  });

  it('seeds the declared sections into the PHASE task files too', () => {
    // The task documents share `builder/plan`, so they inherit the same E450
    // hazard — a fix that only covered plan.dd.json would leave every phase file
    // needing the manual workaround.
    const scaffold = buildPlanScaffold({
      slug: 'demo',
      phases: ['A'],
      declaredSections: { open_questions: [] },
    });
    const names = (
      JSON.parse(scaffold.taskFiles[0]?.json ?? '{}') as { sections: { name: string }[] }
    ).sections.map((section) => section.name);
    expect(names).toContain('open_questions');
    expect(names).toContain('done_when');
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
    const sibling = join(repo, 'plans/drifty/assets/tasks/phase-1/tasks.dd.md');
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

  it('does not re-anchor a drive-rooted target below the repository', async () => {
    // `C:/…` is already root-anchored; treating it as relative silently rewrites
    // a Windows path into an in-repo one, and the error then names a location the
    // caller never asked about (review F004). `resolveInRepo` knows the difference.
    const drive = await run(['plan', 'validate', 'C:/elsewhere/plan']);
    expect(drive.code).toBe(1);
    expect(drive.envelope.error?.message).toContain('C:/elsewhere/plan/plan.dd.json');
    expect(drive.envelope.error?.message).not.toContain(repo);
  });

  it('does not re-anchor a root-anchored --dir below the repository', async () => {
    // A REAL root-anchored directory OUTSIDE the repo — `/…` on POSIX, `C:\…`
    // on Windows, both spellings coming from the host's own tmpdir.
    //
    // This used to pass the literal `C:/out`, which on a POSIX host is an inert
    // string that lands a `C:` directory inside the temp repo. On a WINDOWS host
    // it is a real drive-root location an unelevated process cannot create, so
    // `plan new` failed at the WRITE, returned an error envelope, and the
    // assertion read `.folder` off `undefined` (plan 077 · #108). Worse, on a
    // host where the drive root IS writable it would have littered a real `C:\out`
    // outside the sandbox. EXPECTED, UNVERIFIED — nobody here has a Windows box.
    //
    // The drive-letter SPELLING of root-anchored is not lost with it: the sibling
    // case above drives `plan validate C:/elsewhere/plan` through a real act on
    // every platform (it never writes, so it runs everywhere), and
    // `posix-path.test.ts` pins `resolveInRepo('c:/…')` lexically.
    const outside = toPosix(mkdtempSync(join(tmpdir(), 'harness-plan-outside-')));
    try {
      const created = await run(['plan', 'new', 'drive-rooted', '--phase', 'X', '--dir', outside]);
      expect((created.envelope.data as { folder: string }).folder).toBe(`${outside}/drive-rooted`);
      // Not just the computed string: the document actually landed out there,
      // and NOT under the repository the act was invoked from.
      expect(existsSync(join(outside, 'drive-rooted', 'plan.dd.json'))).toBe(true);
      expect(existsSync(join(repo, 'drive-rooted'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

/**
 * The `~/.dd` root, which `plan` dropped and every other dd verb searches.
 *
 * The corpus here has NO repo-local schema package on purpose: the only copy of
 * `builder/plan` lives under a temp HOME. That makes the home root load-bearing,
 * so a regression cannot pass by finding the schema somewhere else (review F003).
 */
describe('harness plan — the ~/.dd root', () => {
  let repo = '';
  let home = '';
  let previousCwd = '';
  let previousHome: string | undefined;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'harness-plan-home-repo-'));
    home = mkdtempSync(join(tmpdir(), 'harness-plan-home-'));
    const schemaPath = join(home, '.dd/schemas/builder/plan/schema.json');
    mkdirSync(dirname(schemaPath), { recursive: true });
    writeFileSync(schemaPath, REAL_SCHEMA, 'utf8');

    previousCwd = process.cwd();
    previousHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(repo);
    await run(['plan', 'new', 'home-schema', '--phase', 'One', '--phase', 'Two']);
  });

  afterAll(() => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.HOME = home;
    process.chdir(repo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates a plan whose schema resolves only from ~/.dd', async () => {
    const validated = await run(['plan', 'validate', 'docs/plans/home-schema']);
    expect(validated.code).toBe(0);
    expect((validated.envelope.data as { counts: { error: number } }).counts.error).toBe(0);
  });

  it('renders the WHOLE plan from a home-resolved schema, not just the plan document', async () => {
    // The bug this pins was not a crash: with the home root missing, the document
    // set silently narrowed to `plan.dd.json` and `--check` reported green while
    // never looking at a task file. Three documents, or the check checked nothing.
    const checked = await run(['plan', 'render', 'docs/plans/home-schema', '--check']);
    expect(checked.code).toBe(0);
    expect(checked.envelope.data).toMatchObject({ drifted: [] });
    expect((checked.envelope.data as { documents: string[] }).documents).toHaveLength(3);
  });

  it('FAILS LOUDLY when the schema resolves from nowhere, instead of checking less', async () => {
    // An EMPTY home rather than an absent one: unsetting HOME falls back to the
    // real `os.homedir()`, which would make this test's verdict depend on whose
    // machine it ran on.
    const barren = mkdtempSync(join(tmpdir(), 'harness-plan-barren-home-'));
    process.env.HOME = barren;
    try {
      const orphaned = await run(['plan', 'render', 'docs/plans/home-schema', '--check']);
      expect(orphaned.code).toBe(1);
      expect(orphaned.envelope.error?.code).toBe('E401');
      expect(orphaned.envelope.error?.message).toContain('builder/plan');
    } finally {
      process.env.HOME = home;
      rmSync(barren, { recursive: true, force: true });
    }
  });
});
