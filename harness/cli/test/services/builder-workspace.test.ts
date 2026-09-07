import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlanScaffold } from '../../src/acts/plan/scaffold.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import type { ExecOptions, ExecResult } from '../../src/adapters/exec/exec-port.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import {
  allocationAuthority,
  allocationPath,
  listAllocations,
  reserveAllocation,
  saveAllocation,
} from '../../src/services/builder/allocation-store.js';
import { isBuilderPreservationExcluded, sha256 } from '../../src/services/builder/records.js';
import {
  stageBuilderPlanAssets,
  stageBuilderSchemas,
} from '../../src/services/builder/schema-service.js';
import type {
  AllocationRecord,
  BuilderResult,
  PreservationReceipt,
  Stored,
  TidyDeps,
  WorkspaceInput,
} from '../../src/services/builder/types.js';
import {
  adoptBuilderWorkspace,
  provisionBuilderWorkspace,
  tidyBuilderWorkspace,
} from '../../src/services/builder/workspace-service.js';
import {
  BUILDER_FIXTURE_PLAN,
  BUILDER_FIXTURE_TIME,
  builderFixture,
  fixtureGuide,
} from '../fixtures/builder-contracts.js';
import { hermeticGitEnv } from '../support/hermetic-git.js';

const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});
const packagedSchemas = fileURLToPath(
  new URL('../../../../.dd/schemas/builder', import.meta.url),
).replaceAll('\\', '/');
const flowTemplate = JSON.parse(
  readFileSync(
    new URL('../../../../skills/builder/references/flight-plan.template.json', import.meta.url),
    'utf8',
  ),
);

function unwrap<T>(result: BuilderResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
function put(path: string, text: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function seedPlan(root: string, slug = 'example', ordinal = 1) {
  const scaffold = buildPlanScaffold({ slug, ordinal, title: slug, phases: ['Implementation'] });
  const directory = join(root, 'docs/plans', `${String(ordinal).padStart(3, '0')}-${slug}`);
  put(join(directory, 'plan.dd.json'), scaffold.plan.json);
  for (const file of scaffold.taskFiles) put(join(directory, file.relativePath), file.json);
  put(join(directory, 'the-flow.json'), JSON.stringify(flowTemplate));
  return directory;
}

async function realFixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'builder-workspace-'))).replaceAll(
    '\\',
    '/',
  );
  temporary.push(home);
  const root = `${home}/source`;
  mkdirSync(root);
  cpSync(packagedSchemas, `${root}/.dd/schemas/builder`, { recursive: true });
  seedPlan(root);
  put(`${root}/content.txt`, 'original\n');
  put(`${root}/.gitignore`, 'node_modules/\n.cache/\ndist/\nreports/\n');
  const templates = `${home}/templates`;
  const shared = builderFixture();
  const templateSource = shared.deps.templatesDir;
  if (templateSource === undefined)
    throw new Error('Shared fixture must declare its packaged templates');
  for (const name of shared.fs.readdir(templateSource)) {
    const text = shared.fs.readText(`${templateSource}/${name}`);
    if (text === null) throw new Error(`Missing shared template ${name}`);
    put(`${templates}/${name}`, text);
  }
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runtime: {
    intercept?: (command: string, args: string[], opts: ExecOptions) => ExecResult | undefined;
  } = {};
  let nonce = 0;
  const deps: TidyDeps = {
    repoRoot: root,
    fs: new NodeFs(),
    clock: new FakeClock(BUILDER_FIXTURE_TIME),
    env: new FakeEnv({}, home),
    schemasDir: packagedSchemas,
    templatesDir: templates,
    nonce: () => `test-${++nonce}`,
    harness: { command: 'fixture-harness', args: [] },
    ddocs: { command: 'fixture-ddocs', args: [] },
    pij: { command: 'pij-rs', args: [] },
    peerReleased: async () => ({ ok: true, value: true }),
    exec: {
      async run(command, args, opts) {
        calls.push({ command, args: [...args], cwd: opts.cwd });
        const intercepted = runtime.intercept?.(command, args, opts);
        if (intercepted) return intercepted;
        if (command === 'fixture-harness') {
          const option = (flag: string) => args[args.indexOf(flag) + 1] as string;
          if (args[0] === 'plan' && args[1] === 'new') {
            const slug = args[2] as string;
            const ordinal = Number(option('--ordinal'));
            const output = join(
              opts.cwd,
              option('--dir'),
              `${String(ordinal).padStart(3, '0')}-${slug}`,
            );
            const scaffold = buildPlanScaffold({
              slug,
              ordinal,
              title: args.includes('--title') ? option('--title') : slug,
              phases: args.flatMap((arg, index) =>
                arg === '--phase' ? [args[index + 1] as string] : [],
              ),
            });
            put(join(output, 'plan.dd.json'), scaffold.plan.json);
            for (const file of scaffold.taskFiles) put(join(output, file.relativePath), file.json);
          } else if (args[0] === 'builder' && args[1] === 'guide') {
            const directory = dirname(join(opts.cwd, args[2] as string));
            const guide = join(directory, 'assets/impl-guide.dd.json');
            if (!existsSync(guide))
              put(
                guide,
                JSON.stringify({
                  dd: { schema: 'builder/impl-guide' },
                  sections: Object.entries(fixtureGuide()).map(([name, value]) => ({
                    name,
                    value,
                  })),
                }),
              );
          } else if (args[0] === 'flow' && args[1] === 'create')
            put(join(opts.cwd, option('--path')), JSON.stringify(flowTemplate));
          else throw new Error(`Unexpected harness invocation: ${args.join(' ')}`);
          return { ok: true, code: 0, stdout: '', stderr: '' };
        }
        const result = spawnSync(command, args, {
          cwd: opts.cwd,
          env: hermeticGitEnv(opts.env),
          encoding: 'utf8',
          timeout: 20_000,
        });
        return {
          ok: result.status === 0,
          code: result.status ?? 127,
          stdout: result.stdout ?? '',
          stderr: result.stderr || String(result.error ?? ''),
        };
      },
    },
  };
  const git = async (args: string[], cwd = root) => {
    const result = await deps.exec.run('git', args, { cwd });
    if (!result.ok) throw new Error(JSON.stringify({ args, cwd, result }));
    return result.stdout.trim();
  };
  await git(['init', '-b', 'main']);
  await git(['add', '.']);
  await git(['commit', '-m', 'Fixture baseline']);
  await git(['init', '--bare', `${home}/remote.git`]);
  await git(['remote', 'add', 'origin', `${home}/remote.git`]);
  await git(['push', '-u', 'origin', 'main']);
  const head = await git(['rev-parse', 'HEAD']);
  const parent = unwrap(
    await adoptBuilderWorkspace(deps, {
      plan: BUILDER_FIXTURE_PLAN,
      owner: 'external',
      actor: 'operator',
    }),
  ).allocation;
  const unitInput = (kind: 'clone' | 'worktree', name: string = kind): WorkspaceInput => ({
    purpose: 'unit',
    slug: 'example',
    target: `${home}/${name}`,
    kind,
    actor: 'worker',
    parent: parent.value,
    plan: BUILDER_FIXTURE_PLAN,
    unit: `tk-${name}`,
  });
  return { deps, root, home, calls, runtime, git, head, parent, unitInput };
}

type Fixture = Awaited<ReturnType<typeof realFixture>>;
async function preserve(
  fixture: Fixture,
  allocation: Stored<AllocationRecord>,
): Promise<PreservationReceipt> {
  const { deps, home, git } = fixture;
  const root = allocation.value.root;
  const survivor = `${home}/survivor-${deps.nonce()}`;
  mkdirSync(survivor);
  const inventory: PreservationReceipt['inventory'] = [];
  const walk = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${item.name}`;
      if (isBuilderPreservationExcluded(path.slice(root.length + 1))) continue;
      if (item.isDirectory()) walk(path);
      else if (item.isFile()) {
        const bytes = readFileSync(path);
        const destination = `${survivor}/files/${path.slice(root.length + 1)}`;
        put(destination, bytes);
        inventory.push({
          source: path,
          destination,
          sha256: sha256(bytes),
          bytes: bytes.length,
          category: 'artifact',
        });
      } else throw new Error(`Unsafe fixture material: ${path}`);
    }
  };
  walk(root);
  for (const mode of ['working-tree', 'index'] as const) {
    const result = await deps.exec.run(
      'git',
      mode === 'index' ? ['diff', '--cached', '--binary'] : ['diff', '--binary'],
      { cwd: root },
    );
    if (!result.ok) throw new Error(result.stderr);
    const bytes = Buffer.from(result.stdout);
    const destination = `${survivor}/${mode}.patch`;
    put(destination, bytes);
    inventory.push({
      source: `git-diff:${root}#${mode}`,
      destination,
      sha256: sha256(bytes),
      bytes: bytes.length,
      category: 'wip',
    });
  }
  const bare = `${survivor}/preserved.git`;
  await git(['init', '--bare', bare]);
  const head = await git(['rev-parse', 'HEAD'], root);
  const entries = [
    ['HEAD', head],
    ...(await git(['for-each-ref', '--format=%(refname) %(objectname)'], root))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')),
  ];
  const refs: PreservationReceipt['refs'] = [];
  for (const [index, [sourceRef, oid]] of entries.entries()) {
    const destinationRef = `refs/preserved/ref-${index}`;
    await git(['fetch', '--no-tags', root, `${oid}:${destinationRef}`], bare);
    refs.push({
      source_repo: root,
      source_ref: sourceRef as string,
      oid: oid as string,
      destination_repo: bare,
      destination_ref: destinationRef,
    });
  }
  return {
    record_type: 'preservation',
    id: `pv-${deps.nonce()}`,
    recorded_at: deps.clock.nowIso(),
    allocation_ids: [allocation.value.id],
    source_root: root,
    source_sha: head,
    composed_sha: head,
    archived_plan: dirname(`${root}/${allocation.value.plan_path}`),
    survivor_root: survivor,
    retiring_roots: [root],
    inventory,
    refs,
  };
}

function freshAllocation(fixture: Fixture, id: string) {
  const records = unwrap(listAllocations(fixture.deps, `${fixture.root}/.git`));
  const record = records.find((item) => item.value.id === id);
  if (!record) throw new Error(`Missing allocation: ${id}`);
  return record;
}

describe('Builder durable workspace allocation', () => {
  it('reserves distinct ordinals concurrently across active/archive sibling plans before Git mutation', async () => {
    const fixture = await realFixture();
    const sibling = `${fixture.home}/sibling`;
    await fixture.git(['worktree', 'add', '-b', 'sibling', sibling]);
    mkdirSync(`${sibling}/docs/plans/archive/040-old`, { recursive: true });
    const before = fixture.calls.length;
    const inputs = ['one', 'two'].map((name) => ({
      purpose: 'plan' as const,
      kind: 'worktree' as const,
      slug: name,
      target: `${fixture.home}/${name}`,
      actor: name,
    }));
    const allocations = (
      await Promise.all(inputs.map((input) => reserveAllocation(fixture.deps, input)))
    ).map(unwrap);
    expect(allocations.map((item) => item.value.ordinal).sort()).toEqual([41, 42]);
    for (const allocation of allocations) {
      expect(allocation.value.journal).toContain('reserved');
      expect(existsSync(allocation.value.root)).toBe(false);
      expect(allocation.ref.path).toBe(allocationPath(`${fixture.root}/.git`, allocation.value.id));
    }
    expect(
      fixture.calls
        .slice(before)
        .some((call) => call.args.includes('add') || call.args.includes('clone')),
    ).toBe(false);
  });

  it('retains reservations after failed creation and never reuses tombstone ordinals or targets', async () => {
    const fixture = await realFixture();
    const input = fixture.unitInput('worktree');
    fixture.runtime.intercept = (_command, args) =>
      args[0] === 'worktree' && args[1] === 'add'
        ? { ok: false, code: 1, stdout: '', stderr: 'simulated create failure' }
        : undefined;
    expect(await provisionBuilderWorkspace(fixture.deps, input)).toMatchObject({
      ok: false,
      code: 'E472',
    });
    const first = unwrap(listAllocations(fixture.deps, `${fixture.root}/.git`)).find(
      (record) => record.value.root === input.target,
    ) as Stored<AllocationRecord>;
    expect(first.value.journal).toContain('workspace-create-started');
    fixture.runtime.intercept = undefined;
    const resumed = unwrap(await provisionBuilderWorkspace(fixture.deps, input));
    expect(resumed.allocation.value.id).toBe(first.value.id);
    const retired = unwrap(
      saveAllocation(
        fixture.deps,
        { ...resumed.allocation.value, retired_at: fixture.deps.clock.nowIso() },
        resumed.allocation,
      ),
    );
    expect(await reserveAllocation(fixture.deps, input)).toMatchObject({ ok: false, code: 'E472' });
    const next = unwrap(await reserveAllocation(fixture.deps, fixture.unitInput('clone', 'next')));
    expect(next.value.ordinal).toBeGreaterThan(retired.value.ordinal);
  });

  it('refuses existing and escaping targets without touching their contents', async () => {
    const fixture = await realFixture();
    const input = fixture.unitInput('clone');
    put(`${input.target}/keep.txt`, 'mine');
    expect(await provisionBuilderWorkspace(fixture.deps, input)).toMatchObject({
      ok: false,
      code: 'E472',
    });
    expect(readFileSync(`${input.target}/keep.txt`, 'utf8')).toBe('mine');
    expect(await reserveAllocation(fixture.deps, { ...input, target: '../escape' })).toMatchObject({
      ok: false,
      code: 'E477',
    });
    expect(await reserveAllocation(fixture.deps, { ...input, target: fixture.root })).toMatchObject(
      { ok: false, code: 'E477' },
    );
  });

  it.each([
    'clone',
    'worktree',
  ] as const)('provisions an actual %s at the recorded base without creating a second unit plan', async (kind) => {
    const fixture = await realFixture();
    const result = unwrap(await provisionBuilderWorkspace(fixture.deps, fixture.unitInput(kind)));
    expect(await fixture.git(['rev-parse', 'HEAD'], result.allocation.value.root)).toBe(
      fixture.head,
    );
    expect(lstatSync(`${result.allocation.value.root}/.git`).isDirectory()).toBe(kind === 'clone');
    expect(result.allocation.value.owner).toBe('harness');
    expect(result.allocation.value.parent_id).toBe(fixture.parent.value.id);
    expect(result.plan).toBe(`${result.allocation.value.root}/${BUILDER_FIXTURE_PLAN}`);
    expect(fixture.calls.some((call) => call.command === 'fixture-harness')).toBe(false);
    const locator = `${result.allocation.value.git_dir}/builder/allocation-ref`;
    expect(JSON.parse(readFileSync(locator, 'utf8'))).toEqual({
      path: result.allocation.ref.path,
      id: result.allocation.value.id,
    });
    expect(
      await adoptBuilderWorkspace(
        { ...fixture.deps, repoRoot: result.allocation.value.root },
        { plan: result.plan, owner: 'external', actor: 'operator' },
      ),
    ).toMatchObject({ ok: false, code: 'E477' });
    const again = unwrap(await provisionBuilderWorkspace(fixture.deps, fixture.unitInput(kind)));
    expect(again.allocation.ref).toEqual(result.allocation.ref);
    expect(JSON.parse(readFileSync(locator, 'utf8'))).toEqual({
      path: result.allocation.ref.path,
      id: result.allocation.value.id,
    });
  });

  it('stages missing packages but leaves a customized package byte-for-byte intact', async () => {
    const fixture = await realFixture();
    const target = `${fixture.home}/schemas`;
    put(`${target}/.dd/schemas/builder/plan/custom.txt`, 'consumer package');
    const staged = unwrap(stageBuilderSchemas(fixture.deps, target));
    expect(staged).toContain('allocation');
    expect(staged).not.toContain('plan');
    expect(readFileSync(`${target}/.dd/schemas/builder/plan/custom.txt`, 'utf8')).toBe(
      'consumer package',
    );
    expect(existsSync(`${target}/.dd/schemas/builder/plan/schema.json`)).toBe(false);
    expect(unwrap(stageBuilderSchemas(fixture.deps, target))).toEqual([]);
  });

  it('seeds honest survey and packet/model templates once, links the plan and leaves guide authorship to its owner', async () => {
    const fixture = await realFixture();
    const staged = unwrap(stageBuilderPlanAssets(fixture.deps, BUILDER_FIXTURE_PLAN));
    const planDir = dirname(`${fixture.root}/${BUILDER_FIXTURE_PLAN}`);
    expect(staged).toHaveLength(4);
    const surveyPath = `${planDir}/assets/backpressure.dd.json`;
    const survey = JSON.parse(readFileSync(surveyPath, 'utf8'));
    const meta = survey.sections.find((section: { name: string }) => section.name === 'meta').value;
    expect(meta.certainty).toBe('Partial');
    expect(meta).not.toHaveProperty('basis_sha');
    expect(
      survey.sections.find((section: { name: string }) => section.name === 'rows').value,
    ).toEqual([]);
    expect(existsSync(`${planDir}/assets/backpressure.dd.md`)).toBe(true);
    expect(
      JSON.parse(readFileSync(`${fixture.root}/${BUILDER_FIXTURE_PLAN}`, 'utf8')).sections.find(
        (section: { name: string }) => section.name === 'meta',
      ).value.backpressure,
    ).toBe('assets/backpressure.dd.json#rows');
    expect(existsSync(`${planDir}/assets/impl-guide.dd.json`)).toBe(false);
    for (const [source, destination] of [
      ['coder-packet.template.md', 'coder-packet.template.md'],
      ['reviewer-packet.template.md', 'reviewer-packet.template.md'],
      ['roles.template.json', 'model-settings.template.json'],
    ]) {
      expect(readFileSync(`${planDir}/assets/team/${destination}`, 'utf8')).toBe(
        readFileSync(`${fixture.deps.templatesDir}/${source}`, 'utf8'),
      );
    }
    meta.title = 'Authored survey; keep me';
    const authoredSurvey = JSON.stringify(survey);
    put(surveyPath, authoredSurvey);
    put(`${planDir}/assets/team/model-settings.template.json`, '{"authored":true}\n');
    expect(unwrap(stageBuilderPlanAssets(fixture.deps, BUILDER_FIXTURE_PLAN))).toEqual([]);
    expect(readFileSync(surveyPath, 'utf8')).toBe(authoredSurvey);
    expect(readFileSync(`${planDir}/assets/team/model-settings.template.json`, 'utf8')).toBe(
      '{"authored":true}\n',
    );
  });

  it('names unavailable templates and refuses to replace an existing survey backlink', async () => {
    const fixture = await realFixture();
    expect(
      stageBuilderPlanAssets({ ...fixture.deps, templatesDir: undefined }, BUILDER_FIXTURE_PLAN),
    ).toMatchObject({ ok: false, code: 'E471' });
    const path = `${fixture.root}/${BUILDER_FIXTURE_PLAN}`;
    const plan = JSON.parse(readFileSync(path, 'utf8'));
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.backpressure =
      'assets/other-survey.dd.json#rows';
    put(path, JSON.stringify(plan));
    expect(stageBuilderPlanAssets(fixture.deps, BUILDER_FIXTURE_PLAN)).toMatchObject({ ok: false });
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(plan));
    expect(existsSync(`${dirname(path)}/assets/backpressure.dd.json`)).toBe(false);
  });

  it('creates the numbered plan, guide and canonical flow through explicit injected commands and recovers without overwriting edits', async () => {
    const fixture = await realFixture();
    const input: WorkspaceInput = {
      purpose: 'plan',
      kind: 'worktree',
      slug: 'new-plan',
      target: `${fixture.home}/new-plan`,
      actor: 'pm',
      title: 'A real title',
      phases: ['First', 'Second'],
    };
    fixture.runtime.intercept = (command, args) =>
      command === 'fixture-harness' && args[0] === 'builder'
        ? { ok: false, code: 1, stdout: '', stderr: 'guide prerequisite missing' }
        : undefined;
    expect(await provisionBuilderWorkspace(fixture.deps, input)).toMatchObject({
      ok: false,
      code: 'E471',
    });
    const path = `${input.target}/docs/plans/002-new-plan/plan.dd.json`;
    const edited = JSON.parse(readFileSync(path, 'utf8'));
    edited.sections.find((section: { name: string }) => section.name === 'meta').value.summary =
      'preserve this authored content';
    put(path, JSON.stringify(edited));
    fixture.runtime.intercept = undefined;
    const result = unwrap(await provisionBuilderWorkspace(fixture.deps, input));
    expect(
      JSON.parse(readFileSync(path, 'utf8')).sections.find(
        (section: { name: string }) => section.name === 'meta',
      ).value.summary,
    ).toBe('preserve this authored content');
    expect(existsSync(result.flow)).toBe(true);
    expect(existsSync(`${dirname(result.plan)}/assets/impl-guide.dd.json`)).toBe(true);
    expect(fixture.calls).toContainEqual(
      expect.objectContaining({
        command: 'fixture-harness',
        args: ['builder', 'guide', 'docs/plans/002-new-plan/plan.dd.json', '--init'],
      }),
    );
    expect(fixture.calls.find((call) => call.args[0] === 'flow')?.args).toContain('--plan-dir');
  });

  it('adopts observed external provenance without reallocating or granting teardown authority', async () => {
    const fixture = await realFixture();
    const before = fixture.calls.length;
    const adopted = unwrap(
      await adoptBuilderWorkspace(fixture.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        actor: 'operator',
        owner: 'external',
      }),
    );
    expect(adopted.allocation.value).toMatchObject({
      owner: 'external',
      root: fixture.root,
      kind: 'clone',
      ordinal: 1,
      branch: 'main',
      base_sha: fixture.head,
      journal: ['adopted'],
    });
    expect(adopted.allocation.ref).toEqual(fixture.parent.ref);
    expect(
      fixture.calls
        .slice(before)
        .some((call) => ['clone', 'checkout', 'add'].includes(call.args[0] ?? '')),
    ).toBe(false);
    expect(
      await adoptBuilderWorkspace(fixture.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        actor: 'operator',
        owner: 'harness' as 'external',
      }),
    ).toMatchObject({ ok: false, code: 'E470' });
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: adopted.allocation,
        preservation: {} as PreservationReceipt,
      }),
    ).toMatchObject({ ok: false, code: 'E477' });
  });

  it.each([
    'entered',
    'origin-removed',
    'pre-locator',
  ] as const)('preserves a managed clone creator identity when %s instead of adopting it externally', async (mode) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, {
        purpose: 'plan',
        kind: 'clone',
        slug: 'managed',
        target: `${fixture.home}/managed`,
        actor: 'pm',
      }),
    );
    const root = workspace.allocation.value.root;
    const locator = `${workspace.allocation.value.git_dir}/builder/allocation-ref`;
    expect(JSON.parse(readFileSync(locator, 'utf8'))).toEqual({
      path: workspace.allocation.ref.path,
      id: workspace.allocation.value.id,
    });
    if (mode === 'origin-removed') await fixture.git(['remote', 'remove', 'origin'], root);
    if (mode === 'pre-locator') rmSync(locator);
    const original = readFileSync(workspace.allocation.ref.path, 'utf8');
    for (const owner of ['external', 'pij'] as const) {
      expect(
        await adoptBuilderWorkspace(
          { ...fixture.deps, repoRoot: root },
          { plan: workspace.plan, owner, actor: 'operator' },
        ),
      ).toMatchObject({ ok: false, code: 'E477' });
    }
    expect(readFileSync(workspace.allocation.ref.path, 'utf8')).toBe(original);
    expect(existsSync(`${root}/.git/builder/allocations`)).toBe(false);
  });

  it.each([
    'malformed',
    'hash-draft',
    'conflicting',
    'missing-authority',
    'aliased-authority',
  ] as const)('refuses %s managed locators without creating clone-local ownership', async (damage) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const root = workspace.allocation.value.root;
    const locator = `${workspace.allocation.value.git_dir}/builder/allocation-ref`;
    if (damage === 'malformed') put(locator, 'not a path/id locator');
    if (damage === 'hash-draft') put(locator, JSON.stringify(workspace.allocation.ref));
    if (damage === 'conflicting')
      put(locator, JSON.stringify({ path: fixture.parent.ref.path, id: fixture.parent.value.id }));
    if (damage === 'missing-authority') rmSync(workspace.allocation.ref.path);
    if (damage === 'aliased-authority') {
      symlinkSync(
        dirname(workspace.allocation.ref.path),
        `${fixture.home}/authority-link`,
        'junction',
      );
      put(
        locator,
        JSON.stringify({
          id: workspace.allocation.value.id,
          path: `${fixture.home}/authority-link/${workspace.allocation.ref.path.split('/').at(-1)}`,
        }),
      );
    }
    expect(
      await adoptBuilderWorkspace(
        { ...fixture.deps, repoRoot: root },
        { plan: workspace.plan, owner: 'external', actor: 'operator' },
      ),
    ).toMatchObject({ ok: false, code: 'E477' });
    expect(existsSync(`${root}/.git/builder/allocations`)).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it('keeps a normally created external clone adoptable without borrowing its origin owner', async () => {
    const fixture = await realFixture();
    const root = `${fixture.home}/external-clone`;
    await fixture.git(['clone', fixture.root, root]);
    const adopted = unwrap(
      await adoptBuilderWorkspace(
        { ...fixture.deps, repoRoot: root },
        { plan: BUILDER_FIXTURE_PLAN, owner: 'external', actor: 'operator' },
      ),
    );
    expect(adopted.allocation.value).toMatchObject({
      owner: 'external',
      root,
      kind: 'clone',
      authority_root: `${root}/.git`,
    });
    expect(existsSync(`${root}/.git/builder/allocation-ref`)).toBe(false);
  });

  it('publishes no locator before initialization completes and preserves the finalized reference on retry', async () => {
    const fixture = await realFixture();
    const input: WorkspaceInput = {
      purpose: 'plan',
      kind: 'clone',
      slug: 'pending',
      target: `${fixture.home}/pending`,
      actor: 'pm',
    };
    fixture.runtime.intercept = (command, args) =>
      command === 'fixture-harness' && args[0] === 'builder'
        ? { ok: false, code: 1, stdout: '', stderr: 'guide unavailable' }
        : undefined;
    expect(await provisionBuilderWorkspace(fixture.deps, input)).toMatchObject({ ok: false });
    expect(existsSync(`${input.target}/.git/builder/allocation-ref`)).toBe(false);
    fixture.runtime.intercept = undefined;
    const completed = unwrap(await provisionBuilderWorkspace(fixture.deps, input));
    const locator = `${input.target}/.git/builder/allocation-ref`;
    const reference = readFileSync(locator, 'utf8');
    expect(JSON.parse(reference)).toEqual({
      path: completed.allocation.ref.path,
      id: completed.allocation.value.id,
    });
    expect(unwrap(await provisionBuilderWorkspace(fixture.deps, input)).allocation.ref).toEqual(
      completed.allocation.ref,
    );
    expect(readFileSync(locator, 'utf8')).toBe(reference);
  });

  it.each([
    'clone',
    'worktree',
  ] as const)('preserves the %s locator through peer-binding CAS and returns the current allocation on retry', async (kind) => {
    const fixture = await realFixture();
    const input = fixture.unitInput(kind);
    const workspace = unwrap(await provisionBuilderWorkspace(fixture.deps, input));
    const locator = `${workspace.allocation.value.git_dir}/builder/allocation-ref`;
    const originalLocator = readFileSync(locator, 'utf8');
    const bound = unwrap(
      saveAllocation(
        fixture.deps,
        {
          ...workspace.allocation.value,
          peer_id: 'bound-peer',
          journal: [...workspace.allocation.value.journal, 'peer-bound'],
        },
        workspace.allocation,
      ),
    );
    expect(bound.ref.sha256).not.toBe(workspace.allocation.ref.sha256);
    const entered = { ...fixture.deps, repoRoot: workspace.allocation.value.root };
    expect(unwrap(await allocationAuthority(entered))).toBe(
      workspace.allocation.value.authority_root,
    );
    expect(
      await adoptBuilderWorkspace(entered, {
        plan: workspace.plan,
        owner: 'external',
        actor: 'operator',
      }),
    ).toMatchObject({
      ok: false,
      code: 'E477',
      message: expect.stringContaining('different allocation provenance'),
    });
    const retried = unwrap(await provisionBuilderWorkspace(fixture.deps, input));
    expect(retried.allocation).toEqual(bound);
    expect(retried.allocation.value.peer_id).toBe('bound-peer');
    expect(readFileSync(locator, 'utf8')).toBe(originalLocator);
  });

  it.each([
    'owner',
    'id',
    'root',
    'retired',
    'kind',
    'branch',
    'git-dir',
  ] as const)('refuses a changed authoritative %s while retaining the stable locator', async (changed) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const locator = `${workspace.allocation.value.git_dir}/builder/allocation-ref`;
    const originalLocator = readFileSync(locator, 'utf8');
    const doc = JSON.parse(readFileSync(workspace.allocation.ref.path, 'utf8'));
    const value = doc.sections[0].value;
    if (changed === 'owner') value.owner = 'external';
    if (changed === 'id') value.id = 'al-changed-identity';
    if (changed === 'root') value.root = `${fixture.home}/another-root`;
    if (changed === 'retired') value.retired_at = fixture.deps.clock.nowIso();
    if (changed === 'kind') value.kind = 'worktree';
    if (changed === 'branch') value.branch = 'another-branch';
    if (changed === 'git-dir') value.git_dir = `${fixture.home}/another-git-dir`;
    put(workspace.allocation.ref.path, JSON.stringify(doc));
    const entered = { ...fixture.deps, repoRoot: workspace.allocation.value.root };
    expect(await allocationAuthority(entered)).toMatchObject({ ok: false, code: 'E477' });
    expect(
      await adoptBuilderWorkspace(entered, {
        plan: workspace.plan,
        owner: 'external',
        actor: 'operator',
      }),
    ).toMatchObject({ ok: false, code: 'E477' });
    expect(readFileSync(locator, 'utf8')).toBe(originalLocator);
    expect(existsSync(`${workspace.allocation.value.root}/.git/builder/allocations`)).toBe(false);
  });

  it.each([
    'clone',
    'worktree',
  ] as const)('reserves a %s child from a full plan clone against its original shared authority and explicit new baseline', async (kind) => {
    const fixture = await realFixture();
    const parent = unwrap(
      await provisionBuilderWorkspace(fixture.deps, {
        purpose: 'plan',
        kind: 'clone',
        slug: 'parent',
        target: `${fixture.home}/parent`,
        actor: 'pm',
      }),
    );
    const parentRoot = parent.allocation.value.root;
    await fixture.git(['add', '.'], parentRoot);
    await fixture.git(['commit', '-m', 'Commit plan baseline'], parentRoot);
    const baseline = await fixture.git(['rev-parse', 'HEAD'], parentRoot);
    const deps = { ...fixture.deps, repoRoot: parentRoot };
    const child = unwrap(
      await provisionBuilderWorkspace(deps, {
        purpose: 'unit',
        kind,
        slug: 'child',
        target: `${fixture.home}/child`,
        actor: 'worker',
        parent: parent.allocation.value,
        plan: parent.allocation.value.plan_path,
        unit: 'tk-child',
        base: baseline,
      }),
    );
    expect(child.allocation.value.authority_root).toBe(`${fixture.root}/.git`);
    expect(child.allocation.value.ordinal).toBeGreaterThan(parent.allocation.value.ordinal);
    expect(child.allocation.value.base_sha).toBe(baseline);
    expect(await fixture.git(['rev-parse', 'HEAD'], child.allocation.value.root)).toBe(baseline);
    expect(child.allocation.ref.path.startsWith(`${fixture.root}/.git/builder/allocations/`)).toBe(
      true,
    );
    expect(existsSync(`${parentRoot}/.git/builder/allocations`)).toBe(false);
  });
});

describe('Builder safe reclamation', () => {
  it.each([
    'clone',
    'worktree',
  ] as const)('reclaims only the owned preserved %s and retains its tombstone', async (kind) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput(kind)),
    );
    put(`${workspace.allocation.value.root}/dist/report.pdf`, 'preserved ignored output');
    put(`${workspace.allocation.value.root}/node_modules/disposable/cache`, 'not evidence');
    const receipt = await preserve(fixture, workspace.allocation);
    const result = unwrap(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    );
    expect(result.removed).toBe(true);
    expect(existsSync(workspace.allocation.value.root)).toBe(false);
    expect(result.allocation.value.retired_at).toBe(BUILDER_FIXTURE_TIME);
    expect(existsSync(result.allocation.ref.path)).toBe(true);
    expect(await fixture.git(['rev-parse', 'main'])).toBe(fixture.head);
    for (const item of receipt.inventory)
      expect(sha256(readFileSync(item.destination))).toBe(item.sha256);
    expect(
      unwrap(
        await tidyBuilderWorkspace(fixture.deps, {
          allocation: result.allocation,
          preservation: receipt,
        }),
      ).removed,
    ).toBe(false);
  });

  it('requires every ignored report including dist output, but not disposable dependency caches', async () => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const root = workspace.allocation.value.root;
    put(`${root}/dist/report.pdf`, 'sole report');
    put(`${root}/node_modules/cache/ignored`, 'cache');
    const receipt = await preserve(fixture, workspace.allocation);
    receipt.inventory = receipt.inventory.filter(
      (item) => item.source !== `${root}/dist/report.pdf`,
    );
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E476' });
    expect(existsSync(root)).toBe(true);
  });

  it.each([
    'working-tree',
    'index',
  ] as const)('remeasures the exact %s binary diff and refuses drift despite an archived patch', async (mode) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    put(`${workspace.allocation.value.root}/content.txt`, 'changed after preservation');
    if (mode === 'index')
      await fixture.git(['add', 'content.txt'], workspace.allocation.value.root);
    const before = fixture.calls.length;
    // Hide the ordinary file from the forged receipt: the computed patch still catches drift.
    receipt.inventory = receipt.inventory.filter((item) => !item.source.endsWith('/content.txt'));
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E476', message: expect.stringContaining(`#${mode}`) });
    expect(fixture.calls.slice(before)).toContainEqual({
      command: 'git',
      args: mode === 'index' ? ['diff', '--cached', '--binary'] : ['diff', '--binary'],
      cwd: workspace.allocation.value.root,
    });
  });

  it.each([
    'dirty',
    'unmerged',
    'unpushed',
  ] as const)('refuses %s work even when all files and refs were preserved', async (state) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('worktree')),
    );
    const root = workspace.allocation.value.root;
    put(`${root}/content.txt`, 'new work');
    if (state !== 'dirty') {
      await fixture.git(['add', '.'], root);
      await fixture.git(['commit', '-m', 'Unpublished work'], root);
    }
    if (state === 'unpushed')
      await fixture.git(['merge', '--ff-only', workspace.allocation.value.branch]);
    const receipt = await preserve(fixture, workspace.allocation);
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E472' });
    expect(existsSync(root)).toBe(true);
  });

  it.each([
    'missing-file',
    'corrupt-file',
    'wrong-ref',
    'dependent-storage',
    'inside-root',
  ] as const)('refuses %s preservation without mutating the owned workspace', async (damage) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    const item = receipt.inventory[0];
    const ref = receipt.refs[0];
    if (!item || !ref) throw new Error('Incomplete preservation fixture');
    if (damage === 'missing-file') rmSync(item.destination);
    if (damage === 'corrupt-file') put(item.destination, 'wrong');
    if (damage === 'wrong-ref')
      await fixture.git(['update-ref', '-d', ref.destination_ref], ref.destination_repo);
    if (damage === 'dependent-storage')
      put(
        `${ref.destination_repo}/objects/info/alternates`,
        `${workspace.allocation.value.git_dir}/objects\n`,
      );
    if (damage === 'inside-root') receipt.survivor_root = workspace.allocation.value.root;
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E476' });
    expect(existsSync(workspace.allocation.value.root)).toBe(true);
  });

  it('fails closed for unavailable, false and missing peer release observations', async () => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const allocation = unwrap(
      saveAllocation(
        fixture.deps,
        { ...workspace.allocation.value, peer_id: 'live-peer' },
        workspace.allocation,
      ),
    );
    const receipt = await preserve(fixture, allocation);
    for (const peerReleased of [
      async () => ({ ok: true as const, value: false }),
      async () => ({
        ok: false as const,
        code: 'E473' as const,
        message: 'Unavailable',
        next_action: 'Observe release',
      }),
      undefined,
    ]) {
      const deps = { ...fixture.deps, peerReleased } as TidyDeps;
      expect(await tidyBuilderWorkspace(deps, { allocation, preservation: receipt })).toMatchObject(
        { ok: false, code: 'E473' },
      );
    }
    expect(existsSync(allocation.value.root)).toBe(true);
  });

  it('rejects copied authority and forged ownership before touching resources', async () => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    const copy = {
      ...workspace.allocation,
      ref: { ...workspace.allocation.ref, path: `${fixture.home}/copied.dd.json` },
    };
    expect(
      await tidyBuilderWorkspace(fixture.deps, { allocation: copy, preservation: receipt }),
    ).toMatchObject({ ok: false, code: 'E477' });
    const forged = {
      ...fixture.parent,
      value: { ...fixture.parent.value, owner: 'harness' as const },
    };
    expect(
      await tidyBuilderWorkspace(fixture.deps, { allocation: forged, preservation: receipt }),
    ).toMatchObject({ ok: false, code: 'E472' });
  });

  it('resumes a branch-removal failure from the surviving receipt and authoritative journal', async () => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('worktree')),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    fixture.runtime.intercept = (_command, args) =>
      args.includes('update-ref') && args.includes('-d')
        ? { ok: false, code: 1, stdout: '', stderr: 'simulated branch lock' }
        : undefined;
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E472' });
    expect(existsSync(workspace.allocation.value.root)).toBe(false);
    const allocation = freshAllocation(fixture, workspace.allocation.value.id);
    expect(allocation.value.journal).toContain('workspace-removed');
    fixture.runtime.intercept = undefined;
    expect(
      unwrap(await tidyBuilderWorkspace(fixture.deps, { allocation, preservation: receipt }))
        .allocation.value.journal,
    ).toContain('retired');
  });

  it('does not let preservation override a Git worktree lock', async () => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('worktree')),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    await fixture.git(['worktree', 'lock', workspace.allocation.value.root]);
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E472' });
    expect(existsSync(workspace.allocation.value.root)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses symlinked required material rather than following or silently dropping it',
    async () => {
      const fixture = await realFixture();
      const workspace = unwrap(
        await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
      );
      const receipt = await preserve(fixture, workspace.allocation);
      symlinkSync(`${fixture.root}/content.txt`, `${workspace.allocation.value.root}/reports-link`);
      expect(
        await tidyBuilderWorkspace(fixture.deps, {
          allocation: workspace.allocation,
          preservation: receipt,
        }),
      ).toMatchObject({ ok: false, code: 'E476', message: expect.stringContaining('Symlinked') });
    },
  );

  it.each([
    'missing',
    'modified',
    'missing-copy',
    'intact',
  ] as const)('keeps explicit cache-path evidence required when %s', async (state) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const path = `${workspace.allocation.value.root}/.cache/required-report.json`;
    const bytes = Buffer.from('{"proof":"actual evidence"}\n');
    put(path, bytes);
    const receipt = await preserve(fixture, workspace.allocation);
    const destination = `${receipt.survivor_root}/explicit-report.json`;
    put(destination, bytes);
    receipt.inventory.push({
      source: path,
      destination,
      sha256: sha256(bytes),
      bytes: bytes.length,
      category: 'report',
    });
    if (state === 'missing') rmSync(path);
    if (state === 'modified') put(path, 'changed required report');
    if (state === 'missing-copy') rmSync(destination);
    const result = await tidyBuilderWorkspace(fixture.deps, {
      allocation: workspace.allocation,
      preservation: receipt,
    });
    if (state === 'intact') expect(unwrap(result).removed).toBe(true);
    else {
      expect(result).toMatchObject({ ok: false, code: 'E476' });
      expect(existsSync(workspace.allocation.value.root)).toBe(true);
    }
  });

  it.each([
    'survivor',
    'inventory',
  ] as const)('refuses a canonical relative %s destination whose ancestor symlink enters a retiring root', async (kind) => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, fixture.unitInput('clone')),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    symlinkSync(workspace.allocation.value.root, `${fixture.root}/retiring-link`, 'junction');
    const before = readFileSync(workspace.allocation.ref.path, 'utf8');
    if (kind === 'survivor') {
      mkdirSync(`${workspace.allocation.value.root}/archive`);
      receipt.survivor_root = 'retiring-link/archive';
    } else {
      const item = receipt.inventory[0];
      if (!item) throw new Error('Missing fixture item');
      put(`${workspace.allocation.value.root}/only-copy.dat`, readFileSync(item.destination));
      item.destination = 'retiring-link/only-copy.dat';
    }
    const result = await tidyBuilderWorkspace(fixture.deps, {
      allocation: workspace.allocation,
      preservation: receipt,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'E476',
      message: expect.stringMatching(/retiring root|does not survive/),
    });
    expect(existsSync(workspace.allocation.value.root)).toBe(true);
    expect(readFileSync(workspace.allocation.ref.path, 'utf8')).toBe(before);
    expect(result).not.toHaveProperty('value');
  });

  it('refuses a canonical relative survivor that directly names a retiring descendant', async () => {
    const fixture = await realFixture();
    const workspace = unwrap(
      await provisionBuilderWorkspace(fixture.deps, {
        ...fixture.unitInput('clone'),
        target: `${fixture.root}/disposable`,
      }),
    );
    const receipt = await preserve(fixture, workspace.allocation);
    mkdirSync(`${workspace.allocation.value.root}/archive`);
    receipt.survivor_root = 'disposable/archive';
    const before = readFileSync(workspace.allocation.ref.path, 'utf8');
    expect(
      await tidyBuilderWorkspace(fixture.deps, {
        allocation: workspace.allocation,
        preservation: receipt,
      }),
    ).toMatchObject({ ok: false, code: 'E476', message: expect.stringContaining('retiring root') });
    expect(existsSync(workspace.allocation.value.root)).toBe(true);
    expect(readFileSync(workspace.allocation.ref.path, 'utf8')).toBe(before);
  });
});
