import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ExecScript, FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { NodeExec } from '../../src/adapters/exec/node-exec.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import {
  checkBuilderPeerReleased,
  dispatchBuilderUnit,
  verifyBuilderParentWorktreeAuthority,
} from '../../src/services/builder/dispatch-service.js';
import { checkBuilderGuide } from '../../src/services/builder/guide-service.js';
import {
  prepareBuilderPacket,
  seedBuilderFile,
} from '../../src/services/builder/packet-service.js';
import {
  builderContext,
  builderRecordPath,
  digestBuilderFile,
  readBuilderDocument,
  readBuilderRecord,
  sha256,
  writeBuilderDocument,
  writeBuilderRecord,
} from '../../src/services/builder/records.js';
import { resolveBuilderRoles } from '../../src/services/builder/role-settings.js';
import type {
  AllocationRecord,
  BuilderResult,
  DispatchDeps,
  DispatchInput,
  DispatchReceipt,
  DispatchResult,
  Guide,
  WorkspaceInput,
} from '../../src/services/builder/types.js';
import { resolve } from '../../src/services/settings/settings.js';
import { toPosix } from '../../src/services/shared/posix-path.js';
import {
  BUILDER_FIXTURE_GUIDE,
  BUILDER_FIXTURE_PLAN,
  BUILDER_FIXTURE_SHA,
  builderFixture,
  fixtureAllocation,
  fixtureBaseline,
  fixtureCommittedGit,
  fixtureGuide,
  fixtureReview,
  fixtureRole,
} from '../fixtures/builder-contracts.js';

function value<T>(result: BuilderResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.code}: ${result.message} ${JSON.stringify(result.details)}`);
  return result.value;
}

const ROOT = '/workers/example';
const PEER = 'peer-coder';
const PARENT = 'peer-pm';
const MODEL = 'github-copilot/gpt-6-astra';

function scenario(configureGuide?: (guide: Guide) => void) {
  const unit = 'tk-0002';
  const fixture = builderFixture();
  const { fs, clock, guide } = fixture;
  if (configureGuide) {
    configureGuide(guide);
    fs.writeText(
      `/repo/${BUILDER_FIXTURE_GUIDE}`,
      JSON.stringify({
        dd: { schema: 'builder/impl-guide' },
        sections: Object.entries(guide).map(([name, value]) => ({ name, value })),
        references: [],
      }),
    );
  }
  const product = JSON.parse(fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`)!);
  product.sections.find(
    (section: { name: string }) => section.name === 'acceptance_criteria',
  ).value = [
    {
      id: 'ac-0001',
      claim: 'Input text produces the contracted parsed document.',
      state: 'unchecked',
    },
    { id: 'ac-0002', claim: 'The parsed document renders to output bytes.', state: 'unchecked' },
  ];
  fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(product));
  const context = value(builderContext(fixture.deps, BUILDER_FIXTURE_PLAN));
  const review = value(
    writeBuilderRecord(
      fixture.deps,
      builderRecordPath(context, 'review', 'decomposition'),
      fixtureReview(),
    ),
  );
  let baseline = value(
    writeBuilderRecord(
      fixture.deps,
      builderRecordPath(context, 'baseline'),
      fixtureBaseline({
        plan: value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_PLAN)),
        guide: value(digestBuilderFile(fixture.deps, BUILDER_FIXTURE_GUIDE)),
        files: [value(digestBuilderFile(fixture.deps, 'contracts.ts'))],
        review: review.ref,
      }),
    ),
  );
  const parent: Record<string, unknown> = {
    id: PARENT,
    folder: '/repo',
    session: 'native-pm',
    pane: '%4',
  };
  const seat: Record<string, unknown> = {
    id: PEER,
    folder: ROOT,
    session: 'native-coder',
    pane: '%5',
    harness: 'omp',
    model: MODEL,
    parent: PARENT,
    proc: { pid: 123, proc_start: 456 },
  };
  const state: Record<string, unknown> = {
    id: PEER,
    cwd: ROOT,
    harness: 'omp',
    boundModel: MODEL,
    parent: PARENT,
    pid: 123,
    procStart: 456,
    state: 'idle',
    liveness: 'active',
    effort: null,
    tombstonedAt: null,
    tombstoneReason: null,
  };
  const spawn: Record<string, unknown> = { ...seat, dispatched: true, bound: true, pid: 123 };
  const otherSeats: Record<string, unknown>[] = [];
  const otherStates: Record<string, Record<string, unknown>> = {};
  const unavailable: string[] = [];
  const scripts: Record<string, ExecScript> = {};
  const exec = new FakeExec(scripts, clock);
  const flags = {
    readiness: 'ready',
    delivery: 'queued',
    malformed: '',
    rootSha: BUILDER_FIXTURE_SHA,
    planSha: BUILDER_FIXTURE_SHA,
    rootBranch: 'builder/example/parser',
    rootPath: ROOT,
    ancestor: true,
    provisionKind: 'clone',
    spawnFailure: false,
    mutateAllocation: false,
    peerAbsent: false,
    omitPeer: false,
  };
  const provisioned: WorkspaceInput[] = [];
  const adopted: WorkspaceInput[] = [];
  const sealedContract = fs.readBytesNoFollow('/repo/contracts.ts');
  if (sealedContract === null) throw new Error('Missing sealed fixture contract.');
  const sealedTree = new Map([['contracts.ts', new Uint8Array(sealedContract)]]);
  for (const path of [BUILDER_FIXTURE_PLAN, BUILDER_FIXTURE_GUIDE]) {
    const bytes = fs.readBytesNoFollow(`/repo/${path}`);
    if (bytes === null) throw new Error(`Missing sealed fixture document: ${path}`);
    sealedTree.set(path, new Uint8Array(bytes));
  }
  const commits = new Map([[BUILDER_FIXTURE_SHA, sealedTree]]);
  const json = (command: string, data: unknown): ExecScript => ({
    code: 0,
    stdout: JSON.stringify({ ok: true, v: 2, command, data }),
  });
  const deps: DispatchDeps = {
    ...fixture.deps,
    exec: {
      async run(command, args, options) {
        const gitArgs = args[0] === '-c' && args[1] === 'core.hooksPath=' ? args.slice(2) : args;
        const committed =
          command === 'git' ? fixtureCommittedGit(commits, gitArgs, options) : undefined;
        if (committed) {
          await exec.run(command, args, options);
          return committed;
        }
        let script: ExecScript = { code: 0 };
        if (command === 'pij-rs') {
          if (flags.malformed === args[0]) script = { code: 0, stdout: '{not-json' };
          else if (args[0] === 'whoami') script = json('pij whoami', parent);
          else if (args[0] === 'spawn') {
            script = flags.spawnFailure
              ? { code: 2, stderr: 'unknown model' }
              : json('pij spawn', spawn);
            if (flags.mutateAllocation)
              fs.writeText('/repo/.git/harness/builder/allocations/al-0001.dd.json', '{}');
          } else if (args[0] === 'state') {
            const observed =
              args[1] === PEER
                ? flags.peerAbsent
                  ? undefined
                  : state
                : otherStates[args[1] ?? ''];
            script = observed ? json('pij state', observed) : { code: 3, stderr: 'seat not found' };
          } else if (args[0] === 'list')
            script = json('pij seats', {
              seats: [...(flags.omitPeer ? [] : [seat]), ...otherSeats],
              unavailable,
            });
          else if (args[0] === 'send')
            script = json('pij send', {
              msg_id: args[args.indexOf('--msg-id') + 1],
              outcome: {
                outcome: flags.delivery,
                ...(flags.delivery === 'delivered' && { origin: 'native' }),
              },
              at: 1234,
            });
        } else if (command === 'git') {
          if (args.includes('--git-common-dir'))
            script = { code: 0, stdout: `${options.cwd}\n/repo/.git\n` };
          else if (args[0] === 'worktree')
            script = {
              code: 0,
              stdout: `worktree ${String(parent.folder)}\0HEAD ${BUILDER_FIXTURE_SHA}\0\0worktree /repo\0HEAD ${BUILDER_FIXTURE_SHA}\0\0`,
            };
          else if (args[0] === 'rev-parse')
            script = {
              code: 0,
              stdout: `${options.cwd === ROOT ? flags.rootPath : options.cwd}\n${options.cwd === ROOT ? flags.rootSha : options.cwd === '/repo' ? flags.planSha : BUILDER_FIXTURE_SHA}\n`,
            };
          else if (args[0] === 'merge-base') script = { code: flags.ancestor ? 0 : 1 };
          else if (args[0] === 'symbolic-ref') script = { code: 0, stdout: flags.rootBranch };
        } else if (command === 'tmux') script = { code: 0, stdout: 'observed-session\n' };
        scripts[[command, ...args].join(' ')] = script;
        return exec.run(command, args, options);
      },
    },
    readiness: async () =>
      flags.readiness === 'ready'
        ? {
            ok: true,
            value: {
              status: 'ready',
              issues: [],
              context,
              guide,
              baseline,
              warnings: checkBuilderGuide(guide, [{ id: 'ac-0001' }, { id: 'ac-0002' }]).warnings,
            },
          }
        : {
            ok: true,
            value: {
              status: 'not-ready',
              issues: [
                {
                  code: 'missing-contracts',
                  message: 'Contracts are not frozen.',
                  next_action: 'Freeze contracts.',
                },
              ],
            },
          },
    provision: async (input) => {
      provisioned.push(input);
      fs.mkdirp(ROOT);
      fs.mkdirp(`${ROOT}/.git`);
      const tree = commits.get(input.base ?? BUILDER_FIXTURE_SHA);
      if (!tree) throw new Error('Missing explicit fixture source commit.');
      for (const [path, bytes] of tree) fs.writeBytes(`${ROOT}/${path}`, bytes);
      const record = fixtureAllocation({
        kind: flags.provisionKind as 'clone' | 'worktree',
        unit_id: unit,
      });
      const stored = writeBuilderRecord(
        deps,
        '/repo/.git/harness/builder/allocations/al-0001.dd.json',
        record,
      );
      return stored.ok
        ? {
            ok: true,
            value: { allocation: stored.value, plan: BUILDER_FIXTURE_PLAN, flow: 'the-flow.json' },
          }
        : stored;
    },
    adoptUnit: async (input) => {
      adopted.push(input);
      const stored = readBuilderRecord<AllocationRecord>(
        deps,
        '/repo/.git/harness/builder/allocations/al-0001.dd.json',
        'allocation',
      );
      return stored.ok
        ? {
            ok: true,
            value: { allocation: stored.value, plan: BUILDER_FIXTURE_PLAN, flow: 'the-flow.json' },
          }
        : stored;
    },
  };
  const input: DispatchInput = {
    plan: BUILDER_FIXTURE_PLAN,
    unit,
    workspace: ROOT,
    parent: PARENT,
    role: fixtureRole(),
  };
  function advanceSeal(sourceSha: string) {
    commits.set(sourceSha, sealedTree);
    const current = value(readBuilderDocument(deps, BUILDER_FIXTURE_GUIDE, 'builder/impl-guide'));
    const path = builderRecordPath(context, 'baseline', sourceSha);
    guide.baseline.receipt = `team/baseline-${sourceSha}.dd.json`;
    const updated = value(
      writeBuilderDocument(
        deps,
        BUILDER_FIXTURE_GUIDE,
        {
          ...current.value,
          sections: current.value.sections.map((section) =>
            section.name === 'baseline' ? { ...section, value: guide.baseline } : section,
          ),
        },
        { expectedSha256: current.ref.sha256 },
      ),
    );
    baseline = value(
      writeBuilderRecord(deps, path, {
        ...baseline.value,
        id: `baseline-${sourceSha}`,
        source_sha: sourceSha,
        guide: updated.ref,
      }),
    );
    const committedGuide = fs.readBytesNoFollow(`/repo/${BUILDER_FIXTURE_GUIDE}`);
    if (committedGuide === null) throw new Error('Missing revised fixture guide.');
    commits.set(sourceSha, new Map([...sealedTree, [BUILDER_FIXTURE_GUIDE, committedGuide]]));
    return baseline;
  }
  return {
    ...fixture,
    deps,
    exec,
    guide,
    context,
    baseline,
    parent,
    seat,
    state,
    spawn,
    otherSeats,
    otherStates,
    unavailable,
    flags,
    provisioned,
    adopted,
    input,
    advanceSeal,
  };
}

function sends(s: ReturnType<typeof scenario>) {
  return s.exec.calls.filter((call) => call.command === 'pij-rs' && call.args[0] === 'send');
}

describe('Builder PM sibling-worktree authority', () => {
  it('routes an existing native PM through verified target authority without relabeling or moving workers', async () => {
    const s = scenario();
    s.parent.folder = '/native-pm';
    s.fs.mkdirp('/native-pm');
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(s.parent.folder).toBe('/native-pm');
    expect(result.packet.value.parent).toBe(PARENT);
    expect(result.packet.value.workspace).toBe(ROOT);
    expect(s.provisioned[0]?.actor).toBe(PARENT);
    const authorityReads = s.exec.calls.filter(
      (call) => call.command === 'git' && call.args.includes('--git-common-dir'),
    );
    expect(authorityReads.map((call) => call.cwd)).toEqual(['/native-pm', '/repo']);
    expect(s.exec.calls.find((call) => call.args[0] === 'spawn')?.args).toContain(ROOT);
    expect(s.exec.calls.some((call) => ['adopt', 'register'].includes(call.args[0] ?? ''))).toBe(
      false,
    );
  });

  it.each([
    'id',
    'session',
    'pane',
  ])('does not relax native parent %s while admitting a sibling worktree', async (field) => {
    const s = scenario();
    s.parent.folder = '/native-pm';
    s.fs.mkdirp('/native-pm');
    s.parent[field] = field === 'id' ? 'wrong-parent' : '';
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(s.provisioned).toHaveLength(0);
    expect(s.exec.calls.some((call) => call.args.includes('--git-common-dir'))).toBe(false);
  });

  it('retains the existing same-root path without sibling authority probes', async () => {
    const s = scenario();
    value(await dispatchBuilderUnit(s.deps, s.input));
    expect(
      s.exec.calls.some(
        (call) => call.args.includes('--git-common-dir') || call.args[0] === 'worktree',
      ),
    ).toBe(false);
  });

  it.each([
    'registered',
    'clone',
    'unrelated',
    'subdirectory',
    'unregistered gitfile',
    'target symlink',
    'parent symlink',
    'lexical alias',
  ] as const)('checks real Git roots, common directory and exact registration: %s', async (kind) => {
    const temp = toPosix(realpathSync(mkdtempSync(join(tmpdir(), 'builder-authority-'))));
    const fs = new NodeFs();
    const exec = new NodeExec();
    const main = toPosix(join(temp, 'repo'));
    const sibling = toPosix(join(temp, 'plan worktree'));
    const hooks = toPosix(join(temp, 'empty-hooks'));
    const env = {
      GIT_CONFIG_GLOBAL: toPosix(join(temp, 'no-global-config')),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '0',
      GIT_CONFIG_PARAMETERS: undefined,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_COMMON_DIR: undefined,
    };
    const git = async (cwd: string, args: string[]) => {
      const result = await exec.run(
        'git',
        [
          '-c',
          `core.hooksPath=${hooks}`,
          '-c',
          'user.name=Builder fixture',
          '-c',
          'user.email=builder-fixture@example.test',
          '-c',
          'commit.gpgSign=false',
          ...args,
        ],
        { cwd, timeoutMs: 10000, env },
      );
      if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
      return result.stdout;
    };
    try {
      fs.mkdirp(main);
      fs.mkdirp(hooks);
      await git(main, ['init', '--quiet']);
      await git(main, ['commit', '--quiet', '--allow-empty', '-m', 'authority fixture']);
      await git(main, ['worktree', 'add', '--detach', sibling, 'HEAD']);
      let target = sibling;
      let nativeFolder = main;
      if (kind === 'clone') {
        target = toPosix(join(temp, 'repo-copy'));
        await git(temp, ['clone', '--quiet', '--no-hardlinks', '--', main, target]);
      } else if (kind === 'unrelated') {
        target = toPosix(join(temp, 'repo-unrelated'));
        fs.mkdirp(target);
        await git(target, ['init', '--quiet']);
        await git(target, ['commit', '--quiet', '--allow-empty', '-m', 'unrelated fixture']);
      } else if (kind === 'subdirectory') {
        target = toPosix(join(main, 'unregistered'));
        fs.mkdirp(target);
      } else if (kind === 'unregistered gitfile') {
        target = toPosix(join(temp, 'unregistered'));
        fs.mkdirp(target);
        const pointer = fs.readText(toPosix(join(sibling, '.git')));
        if (pointer === null) throw new Error('Missing fixture worktree pointer.');
        fs.writeText(toPosix(join(target, '.git')), pointer);
      } else if (kind === 'target symlink') {
        target = toPosix(join(temp, 'target-alias'));
        symlinkSync(sibling, target, 'junction');
      } else if (kind === 'parent symlink') {
        nativeFolder = toPosix(join(temp, 'parent-alias'));
        symlinkSync(main, nativeFolder, 'junction');
      } else if (kind === 'lexical alias') target = `${sibling}/.`;
      const deps = {
        ...builderFixture().deps,
        fs,
        repoRoot: target,
        exec: {
          run: (command: string, args: string[], options: Parameters<NodeExec['run']>[2]) =>
            exec.run(command, args, { ...options, env: { ...env, ...options.env } }),
        },
      };
      const result = await verifyBuilderParentWorktreeAuthority(deps, nativeFolder);
      if (kind === 'registered') expect(result).toEqual({ ok: true, value: true });
      else expect(result).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_RUNTIME });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// These tests consume the actual settings resolver rather than a parallel raw-JSON parser.
describe('Builder role settings', () => {
  it('resolves repo < guide < explicit per field and records each provenance', () => {
    const fixture = builderFixture();
    const settings = resolve(
      JSON.stringify({
        schema_version: 1,
        governance: {
          builder: {
            roles: {
              coder: { harness: 'repo-harness', model: 'repo-model', effort: 'medium' },
              reviewer: { harness: 'repo-reviewer', model: 'repo-review-model' },
            },
          },
        },
      }),
      null,
      fixture.env,
    );
    if (!settings.ok) throw new Error(settings.message);
    const resolved = value(
      resolveBuilderRoles(settings.settings, fixtureGuide(), {
        coder: { model: 'override-model' },
        reviewer: { effort: 'max' },
      }),
    );
    expect(resolved[0]).toEqual({
      role: 'coder',
      harness: 'omp',
      model: 'override-model',
      effort: 'medium',
      source: { harness: 'guide', model: 'override', effort: 'repo' },
    });
    expect(resolved[1]).toMatchObject({
      effort: 'max',
      source: { harness: 'guide', model: 'guide', effort: 'override' },
    });
  });
  it('preserves omitted effort and uses repo defaults when the guide has no role', () => {
    const fixture = builderFixture();
    const settings = resolve(
      JSON.stringify({
        schema_version: 1,
        governance: {
          builder: {
            roles: {
              coder: { harness: 'omp', model: MODEL },
              reviewer: { harness: 'omp', model: 'review-model' },
            },
          },
        },
      }),
      null,
      fixture.env,
    );
    if (!settings.ok) throw new Error(settings.message);
    const result = value(resolveBuilderRoles(settings.settings, fixtureGuide({ roles: [] })));
    expect(result[0]).toEqual({
      role: 'coder',
      harness: 'omp',
      model: MODEL,
      source: { harness: 'repo', model: 'repo' },
    });
    expect(Object.hasOwn(result[0] ?? {}, 'effort')).toBe(false);
  });
  it('names missing, malformed and duplicate role settings instead of inventing defaults', () => {
    const fixture = builderFixture();
    const settings = resolve(null, null, fixture.env);
    if (!settings.ok) throw new Error(settings.message);
    expect(resolveBuilderRoles(settings.settings, fixtureGuide({ roles: [] }))).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_NOT_READY,
    });
    expect(
      resolveBuilderRoles(settings.settings, fixtureGuide(), { coder: { effort: '' } }),
    ).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_INVALID });
    const guide = fixtureGuide();
    guide.roles.push({ id: 'duplicate', role: 'coder', harness: 'omp', model: MODEL });
    expect(resolveBuilderRoles(settings.settings, guide)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_INVALID,
    });
  });
});

describe('Builder existing-peer dispatch', () => {
  function existingPeer(s: ReturnType<typeof scenario>, alreadyBound = false) {
    s.fs.mkdirp(ROOT);
    s.fs.mkdirp(`${ROOT}/.git`);
    s.fs.writeText(`${ROOT}/contracts.ts`, s.fs.readText('/repo/contracts.ts') ?? '');
    s.fs.writeText(`${ROOT}/src/parser.ts`, 'Existing committed implementation.\n');
    s.fs.writeText(`${ROOT}/draft.txt`, 'Uncommitted work remains here.\n');
    s.flags.rootSha = 'b'.repeat(40);
    s.input.adoptPeer = PEER;
    for (const ref of [s.baseline.value.plan, s.baseline.value.guide])
      value(seedBuilderFile(s.deps, ROOT, ref));
    return value(
      writeBuilderRecord(
        s.deps,
        '/repo/.git/harness/builder/allocations/al-0001.dd.json',
        fixtureAllocation({
          owner: 'pij',
          actor: 'original-allocation-creator',
          journal: ['adopted-existing-workspace'],
          ...(alreadyBound && { peer_id: PEER }),
        }),
      ),
    );
  }

  it('binds progressed existing work without a spawn, provisioning, or source rewrite', async () => {
    const s = scenario();
    existingPeer(s);
    delete s.parent.pane; // Existing workers do not need a new tmux launch target.
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(result.dispatch.value.observed).toMatchObject({
      peer_id: PEER,
      root: ROOT,
      ready: true,
      native_session: 'native-coder',
      pid: 123,
    });
    expect(result.packet.value.source_sha).toBe(BUILDER_FIXTURE_SHA);
    const allocation = value(
      readBuilderRecord<AllocationRecord>(
        s.deps,
        result.dispatch.value.allocation.path,
        'allocation',
      ),
    );
    expect(allocation.value).toMatchObject({
      owner: 'pij',
      actor: 'original-allocation-creator',
      peer_id: PEER,
      base_sha: BUILDER_FIXTURE_SHA,
    });
    expect(result.dispatch.value.warnings).toContainEqual(
      expect.objectContaining({
        code: 'adopted-allocation-owner',
        owning_unit: s.input.unit,
      }),
    );
    expect(s.fs.readText(`${ROOT}/src/parser.ts`)).toBe('Existing committed implementation.\n');
    expect(s.fs.readText(`${ROOT}/draft.txt`)).toBe('Uncommitted work remains here.\n');
    expect(s.adopted).toHaveLength(1);
    expect(s.provisioned).toHaveLength(0);
    expect(
      s.exec.calls.some((call) =>
        ['spawn', 'clone', 'checkout', 'reset', 'cherry-pick'].includes(call.args[0] ?? ''),
      ),
    ).toBe(false);
    expect(s.exec.calls.some((call) => call.command === 'tmux')).toBe(false);
    expect(sends(s)).toHaveLength(1);
    expect(
      value(digestBuilderFile({ ...s.deps, repoRoot: ROOT }, result.packet.ref.path)).sha256,
    ).toBe(result.dispatch.value.packet.sha256);
  });

  it('keeps sealed worker inputs while PM baseline files change for either dispatch mode', async () => {
    for (const adopting of [false, true]) {
      const s = scenario();
      const original = s.fs.readText('/repo/contracts.ts');
      if (adopting) existingPeer(s);
      s.fs.writeText('/repo/contracts.ts', 'PM integration is free to change this source.\n');
      const result = value(await dispatchBuilderUnit(s.deps, s.input));
      expect(result.packet.value.baseline).toEqual(s.baseline.ref);
      expect(s.fs.readText('/repo/contracts.ts')).toBe(
        'PM integration is free to change this source.\n',
      );
      expect(s.fs.readText(`${ROOT}/contracts.ts`)).toBe(original);
      expect(result.dispatch.value.observed.ready).toBe(true);
    }
  });

  it('binds historical clone inputs without overwriting factual PM plan progress', async () => {
    const s = scenario();
    existingPeer(s);
    const originalPlan = s.fs.readText(`${ROOT}/${BUILDER_FIXTURE_PLAN}`);
    const current = value(readBuilderDocument(s.deps, BUILDER_FIXTURE_PLAN, 'builder/plan'));
    const updated = structuredClone(current.value);
    updated.sections.push({
      name: 'implementation_summary',
      value: 'Completed implementation; this is factual evidence, not new requirements.',
    });
    value(
      writeBuilderDocument(s.deps, BUILDER_FIXTURE_PLAN, updated, {
        expectedSha256: current.ref.sha256,
      }),
    );
    s.fs.writeText(
      `${ROOT}/${BUILDER_FIXTURE_PLAN.replace('.json', '.md')}`,
      'Original clone view.\n',
    );
    const currentPlan = s.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`);
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(result.packet.value.plan.sha256).toBe(s.baseline.value.plan.sha256);
    expect(s.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`)).toBe(currentPlan);
    expect(s.fs.readText(`${ROOT}/${BUILDER_FIXTURE_PLAN}`)).toBe(originalPlan);
    expect(s.fs.readText(`${ROOT}/${BUILDER_FIXTURE_PLAN.replace('.json', '.md')}`)).toBe(
      'Original clone view.\n',
    );
  });

  it('still refuses changed product intent before adopting an existing peer', async () => {
    const s = scenario();
    existingPeer(s);
    const current = value(readBuilderDocument(s.deps, BUILDER_FIXTURE_PLAN, 'builder/plan'));
    const changed = structuredClone(current.value);
    const summary = changed.sections.find((section) => section.name === 'summary');
    if (!summary) throw new Error('Missing fixture product summary.');
    summary.value = 'A different product is now requested.';
    value(
      writeBuilderDocument(s.deps, BUILDER_FIXTURE_PLAN, changed, {
        expectedSha256: current.ref.sha256,
      }),
    );
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({ ok: false, code: 'E475' });
    expect(s.adopted).toHaveLength(0);
    expect(sends(s)).toHaveLength(0);
  });

  it('keeps an already-bound allocation immutable and never duplicates a durable dispatch', async () => {
    const s = scenario();
    const original = existingPeer(s, true);
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(result.dispatch.value.allocation.sha256).toBe(original.ref.sha256);
    expect(
      value(readBuilderRecord<AllocationRecord>(s.deps, original.ref.path, 'allocation')),
    ).toEqual(original);
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({ ok: false, code: 'E472' });
    expect(s.adopted).toHaveLength(1);
    expect(sends(s)).toHaveLength(1);
    expect(s.exec.calls.some((call) => call.args[0] === 'spawn')).toBe(false);
  });

  it.each([
    'dead',
    'parent',
    'root',
    'model',
    'process',
  ] as const)('rejects a mismatched %s observation before binding existing work', async (failure) => {
    const s = scenario();
    existingPeer(s);
    if (failure === 'dead') s.state.liveness = 'dead';
    if (failure === 'parent') s.state.parent = 'another-parent';
    if (failure === 'root') s.state.cwd = '/another-root';
    if (failure === 'model') s.state.boundModel = 'another-model';
    if (failure === 'process') s.state.pid = 999;
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({ ok: false, code: 'E473' });
    expect(s.adopted).toHaveLength(0);
    expect(s.provisioned).toHaveLength(0);
    expect(sends(s)).toHaveLength(0);
    expect(
      s.fs.exists(builderRecordPath(s.context, 'packet', `tk-0002-${BUILDER_FIXTURE_SHA}`)),
    ).toBe(false);
  });

  it('retains work when sealed ancestry, branch identity or frozen inputs disagree', async () => {
    const unrelated = scenario();
    existingPeer(unrelated);
    unrelated.flags.ancestor = false;
    expect(await dispatchBuilderUnit(unrelated.deps, unrelated.input)).toMatchObject({
      ok: false,
      code: 'E473',
    });
    expect(unrelated.adopted).toHaveLength(0);
    const wrongBranch = scenario();
    existingPeer(wrongBranch);
    wrongBranch.flags.rootBranch = 'different-branch';
    expect(await dispatchBuilderUnit(wrongBranch.deps, wrongBranch.input)).toMatchObject({
      ok: false,
      code: 'E473',
    });
    const changed = scenario();
    existingPeer(changed);
    changed.fs.writeText(`${ROOT}/contracts.ts`, 'Changed frozen contract.\n');
    expect(await dispatchBuilderUnit(changed.deps, changed.input)).toMatchObject({
      ok: false,
      code: 'E471',
    });
    expect(changed.fs.readText(`${ROOT}/contracts.ts`)).toBe('Changed frozen contract.\n');
    expect(changed.fs.readText(`${ROOT}/draft.txt`)).toBe('Uncommitted work remains here.\n');
    expect(sends(changed)).toHaveLength(0);
  });

  it('refuses binding one existing peer to two independent units', async () => {
    const s = scenario();
    existingPeer(s);
    value(await dispatchBuilderUnit(s.deps, s.input));
    expect(await dispatchBuilderUnit(s.deps, { ...s.input, unit: 'tk-0003' })).toMatchObject({
      ok: false,
      code: 'E474',
    });
    expect(s.adopted).toHaveLength(1);
    expect(sends(s)).toHaveLength(1);
  });

  it('serializes concurrent bindings of the same existing peer', async () => {
    const s = scenario();
    existingPeer(s);
    const results = await Promise.all([
      dispatchBuilderUnit(s.deps, s.input),
      dispatchBuilderUnit(s.deps, { ...s.input, unit: 'tk-0003' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, code: 'E472' });
    expect(s.adopted).toHaveLength(1);
    expect(sends(s)).toHaveLength(1);
  });
});

describe('Builder isolated dispatch', () => {
  it('delivers scoped work and its measured packet digest from the verified native launch', async () => {
    const s = scenario();
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    const attempt = `${s.input.unit}-${BUILDER_FIXTURE_SHA}`;
    expect(result.packet.value.id).toBe(`packet-${attempt}`);
    expect(result.dispatch.value.id).toBe(`dispatch-${attempt}`);
    expect(`/repo/${result.packet.ref.path}`).toBe(builderRecordPath(s.context, 'packet', attempt));
    expect(`/repo/${result.dispatch.ref.path}`).toBe(
      builderRecordPath(s.context, 'dispatch', attempt),
    );
    expect(result.packet.ref.path).not.toContain(result.packet.value.nonce);
    expect(s.provisioned).toEqual([
      {
        purpose: 'unit',
        slug: 'example',
        target: ROOT,
        kind: 'clone',
        actor: PARENT,
        base: BUILDER_FIXTURE_SHA,
        plan: BUILDER_FIXTURE_PLAN,
        unit: 'tk-0002',
      },
    ]);
    const launch = s.exec.calls.find((call) => call.args[0] === 'spawn');
    expect(launch?.args).toEqual([
      'spawn',
      '--harness',
      'omp',
      '--bin',
      'omp',
      '--model',
      MODEL,
      '--cwd',
      ROOT,
      '--parent',
      PARENT,
      '--session',
      'observed-session',
      '--json',
    ]);
    expect(s.exec.calls.some((call) => call.command === 'tmux' && call.args.includes('%4'))).toBe(
      true,
    );
    expect(result.dispatch.value.observed).toMatchObject({
      ready: true,
      pid: 123,
      native_session: 'native-coder',
      model: MODEL,
    });
    expect(result.dispatch.value.observed.gaps.join(' ')).toContain('unverified');
    expect(result.dispatch.value.requested).not.toHaveProperty('effort');
    expect(result.dispatch.value.observed).not.toHaveProperty('effort');
    expect(result.packet.value.source_sha).toBe(BUILDER_FIXTURE_SHA);
    expect(result.packet.value.canary).toBeUndefined();
    expect(result.dispatch.value.seed_files.some((seed) => seed.path.includes('canary-'))).toBe(
      false,
    );
    expect(s.fs.readText(`${ROOT}/${result.packet.ref.path}`)).toBe(
      s.fs.readText(`/repo/${result.packet.ref.path}`),
    );
    for (const seed of result.dispatch.value.seed_files)
      expect(sha256(s.fs.readText(`${ROOT}/${seed.path}`) ?? '')).toBe(seed.sha256);
    expect(result.dispatch.value.seed_files.some((seed) => seed.path.endsWith('.dd.md'))).toBe(
      true,
    );
    const allocation = value(
      readBuilderRecord<AllocationRecord>(
        s.deps,
        result.dispatch.value.allocation.path,
        'allocation',
      ),
    );
    expect(allocation.value.peer_id).toBe(PEER);
    expect(result.packet.value.allocation.sha256).toBe(allocation.ref.sha256);
    const body = sends(s)[0]?.args[sends(s)[0]!.args.indexOf('--body') + 1] ?? '';
    for (const path of result.packet.value.unit.paths) expect(body).toContain(path);
    for (const read of result.packet.value.unit.reads)
      for (const path of read.paths) expect(body).toContain(path);
    expect(body).toContain(result.packet.value.unit.responsibility);
    expect(body).toContain(result.packet.value.unit.interface);
    expect(body).toContain(result.packet.ref.sha256);
    expect(body).toContain(result.packet.ref.path);
    const plan = value(readBuilderDocument(s.deps, BUILDER_FIXTURE_PLAN, 'builder/plan'));
    const criteria = plan.value.sections.find((section) => section.name === 'acceptance_criteria')!
      .value as Array<{ id: string; claim: string }>;
    expect(body).toContain(criteria.find((criterion) => criterion.id === 'ac-0001')!.claim);
    expect(result.packet.value.instructions[0]).toContain(result.packet.value.unit.paths[0]);
    expect(result.packet.value.instructions[1]).toContain('contracts.ts');
    expect(result.packet.value.instructions[2]).toContain(result.packet.value.unit.responsibility);
    expect(result.packet.value.instructions[3]).toContain(result.packet.value.unit.interface);
    expect(result.dispatch.value.delivery).toMatchObject({
      outcome: 'queued',
      message_id: sends(s)[0]?.args[sends(s)[0]!.args.indexOf('--msg-id') + 1],
    });
    expect(sends(s)).toHaveLength(1);
    expect(result.dispatch.value).not.toHaveProperty('acknowledgement');
    expect(result.dispatch.value).not.toHaveProperty('release');
  });
  it('dispatches ownership-only guide drift and retains its warnings in the delivered receipt', async () => {
    const s = scenario((guide) => {
      guide.units[1].paths = [];
      guide.units[1].reads[0].owner = '';
      guide.capabilities[0].owner = '';
      guide.composition.owner = 'tk-0002';
    });
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(result.dispatch.value.delivery?.outcome).toBe('queued');
    const receipt = value(
      readBuilderRecord<DispatchReceipt>(s.deps, result.dispatch.ref.path, 'dispatch'),
    );
    expect(receipt.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'map-empty',
          file: '<guide:units/tk-0002/paths>',
          owning_unit: 'tk-0002',
          stage: 'guide',
        }),
        expect.objectContaining({
          code: 'read-owner',
          file: 'contracts.ts',
          owning_unit: 'unmapped',
          stage: 'guide',
        }),
        expect.objectContaining({
          code: 'capability-owner',
          file: '<guide:capabilities/cp-0001/owner>',
          owning_unit: 'unmapped',
          stage: 'guide',
        }),
        expect.objectContaining({
          code: 'composition-owner',
          file: '<guide:composition/owner>',
          owning_unit: 'tk-0002',
          stage: 'guide',
        }),
      ]),
    );
    expect(result.packet.value.unit.paths).toEqual([]);
  });

  it('retains map warnings when actual work-packet delivery is refused', async () => {
    const s = scenario((guide) => {
      guide.units[1].paths = [];
    });
    s.flags.delivery = 'refused';
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: 'map-empty',
          file: '<guide:units/tk-0002/paths>',
          owning_unit: 'tk-0002',
        }),
      ]),
    });
  });
  it('accepts an explicit clone override, but refuses solo and unsupported worktree before allocation', async () => {
    const overridden = scenario();
    overridden.guide.isolation.mode = 'worktree-per-coder';
    expect(
      (await dispatchBuilderUnit(overridden.deps, { ...overridden.input, kind: 'clone' })).ok,
    ).toBe(true);
    for (const mode of ['solo', 'worktree-per-coder'] as const) {
      const s = scenario();
      s.guide.isolation.mode = mode;
      const result = await dispatchBuilderUnit(s.deps, s.input);
      expect(result).toMatchObject({
        ok: false,
        code: mode === 'solo' ? ErrorCodes.BUILDER_NOT_READY : ErrorCodes.BUILDER_RUNTIME,
      });
      expect(s.provisioned).toHaveLength(0);
    }
  });
  it('accepts an early spawn receipt only after independent native session readiness is observed', async () => {
    const s = scenario();
    s.spawn.bound = false;
    s.spawn.session = null;
    delete s.spawn.pid;
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(result.dispatch.value.observed).toMatchObject({
      ready: true,
      native_session: 'native-coder',
      pid: 123,
    });
    expect(sends(s)).toHaveLength(1);
  });
  it('refuses seed conflicts without overwriting the target', () => {
    const s = scenario();
    s.fs.mkdirp(ROOT);
    const ref = value(digestBuilderFile(s.deps, BUILDER_FIXTURE_PLAN));
    const target = `${ROOT}/${BUILDER_FIXTURE_PLAN}`;
    s.fs.writeText(target, 'different checkout content');
    expect(seedBuilderFile(s.deps, ROOT, ref)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
    });
    expect(s.fs.readText(target)).toBe('different checkout content');
  });
  it('refuses a real ancestor symlink before writing a seed outside its clone', () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'builder-seed-')));
    try {
      const repoRoot = join(temp, 'repo');
      const root = join(temp, 'clone');
      const outside = join(temp, 'outside');
      mkdirSync(join(repoRoot, 'nested'), { recursive: true });
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(repoRoot, 'nested/input.txt'), 'immutable');
      symlinkSync(outside, join(root, 'nested'), 'junction');
      const deps = { ...builderFixture().deps, fs: new NodeFs(), repoRoot };
      expect(
        seedBuilderFile(deps, root, { path: 'nested/input.txt', sha256: sha256('immutable') }),
      ).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_OWNERSHIP });
      expect(existsSync(join(outside, 'input.txt'))).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it('refuses not-ready, wrong actor, unsupported harness and mismatched allocation', async () => {
    const notReady = scenario();
    notReady.flags.readiness = 'not-ready';
    expect(await dispatchBuilderUnit(notReady.deps, notReady.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_NOT_READY,
    });
    expect(notReady.provisioned).toHaveLength(0);
    const actor = scenario();
    actor.parent.id = 'different-parent';
    expect(await dispatchBuilderUnit(actor.deps, actor.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(actor.provisioned).toHaveLength(0);
    const runtime = scenario();
    runtime.input.role.harness = 'unknown';
    expect(await dispatchBuilderUnit(runtime.deps, runtime.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(runtime.provisioned).toHaveLength(0);
    const allocation = scenario();
    allocation.flags.provisionKind = 'worktree';
    expect(await dispatchBuilderUnit(allocation.deps, allocation.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_OWNERSHIP,
    });
    expect(allocation.exec.calls.some((call) => call.args[0] === 'spawn')).toBe(false);
  });
  it('records accepted-but-unbound launch without sending a work packet', async () => {
    const s = scenario();
    s.spawn.bound = false;
    s.state.liveness = 'dead';
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    const stored = value(
      readBuilderRecord<DispatchReceipt>(
        s.deps,
        builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`),
        'dispatch',
      ),
    );
    expect(stored.value.observed).toMatchObject({ ready: false, peer_id: PEER, root: '' });
    expect(sends(s)).toHaveLength(0);
  });
  it('refuses rewritten seals, stale Git baseline and aliased native roots before launch', async () => {
    const changed = scenario();
    changed.fs.writeText(`/repo/${changed.baseline.ref.path}`, 'rewritten seal');
    expect((await dispatchBuilderUnit(changed.deps, changed.input)).ok).toBe(false);
    expect(changed.provisioned).toHaveLength(0);
    // The pristine coder clone must start from EXACTLY the sealed source.
    const stale = scenario();
    stale.flags.rootSha = 'b'.repeat(40);
    expect(await dispatchBuilderUnit(stale.deps, stale.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(stale.exec.calls.some((call) => call.args[0] === 'spawn')).toBe(false);
    // A plan-root HEAD that is NOT a descendant of the sealed source (rewritten
    // baseline, or a checkout moved off its history) is stale and refuses.
    const rewritten = scenario();
    rewritten.flags.planSha = 'b'.repeat(40);
    rewritten.flags.ancestor = false;
    expect(await dispatchBuilderUnit(rewritten.deps, rewritten.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(rewritten.exec.calls.some((call) => call.args[0] === 'spawn')).toBe(false);
    const nested = scenario();
    nested.input.workspace = '/repo/nested';
    expect(await dispatchBuilderUnit(nested.deps, nested.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_OWNERSHIP,
    });
  });
  it('dispatches from a plan-root HEAD that is a descendant of the sealed source and records that HEAD (row 45)', async () => {
    /*
    Test Doc:
    - Why: the PM commits the seal receipt and review evidence ON TOP of the sealed
      source (contracts-service allows exactly that), so at dispatch HEAD is a
      descendant of source_sha, not equal to it. Requiring equality refused every
      real dispatch the moment evidence was committed (Unisphere Plan001, E473 ×3).
    - Contract: same root + sealed source is an ancestor of HEAD + frozen digests
      unchanged ⇒ dispatch proceeds; the dispatch record's observed evidence names
      the plan-root HEAD and the sealed source. The coder clone check stays exact.
    - Usage Notes: `flags.planSha` moves the plan-root (/repo) HEAD — `rootSha` is the coder clone; `flags.ancestor` scripts
      `git merge-base --is-ancestor <source> <head>`.
    - Quality Contribution: the opposite is visible — the stale case above sets
      ancestor=false on the same moved HEAD and is refused before any spawn.
    */
    const moved = scenario();
    const head = 'c'.repeat(40);
    moved.flags.planSha = head;
    moved.flags.ancestor = true;
    const result = await dispatchBuilderUnit(moved.deps, moved.input);
    expect(result.ok).toBe(true);
    expect(
      moved.exec.calls.find(
        (call) => call.args[0] === 'merge-base' && call.args[2] === BUILDER_FIXTURE_SHA,
      )?.args,
    ).toEqual(['merge-base', '--is-ancestor', BUILDER_FIXTURE_SHA, head]);
    if (result.ok) {
      const evidence = result.value.dispatch.value.observed.evidence.join('\n');
      expect(evidence).toContain(`plan root HEAD at dispatch: ${head}`);
      expect(evidence).toContain(`sealed source ${BUILDER_FIXTURE_SHA}`);
      expect(evidence).toContain('descendant');
    }
  });
  it('never duplicates a dispatch and detects allocation CAS races', async () => {
    const s = scenario();
    value(await dispatchBuilderUnit(s.deps, s.input));
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
    });
    expect(s.exec.calls.filter((call) => call.args[0] === 'spawn')).toHaveLength(1);
    const raced = scenario();
    raced.flags.mutateAllocation = true;
    expect(await dispatchBuilderUnit(raced.deps, raced.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
      details: { launched_peer: PEER },
    });
    expect(sends(raced)).toHaveLength(0);
  });
  it('preserves explicit effort without silently substituting an unsupported model', async () => {
    const s = scenario();
    s.input.role.effort = 'high';
    s.input.role.source.effort = 'override';
    s.state.effort = 'high';
    s.seat.effort = 'high';
    s.spawn.effort = 'high';
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(result.dispatch.value.observed.effort).toBe('high');
    expect(s.exec.calls.find((call) => call.args[0] === 'spawn')?.args).toContain('--effort');
    const refused = scenario();
    refused.flags.spawnFailure = true;
    expect(await dispatchBuilderUnit(refused.deps, refused.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(refused.exec.calls.filter((call) => call.args[0] === 'spawn')).toHaveLength(1);
    expect(sends(refused)).toHaveLength(0);
  });
});

describe('Builder direct work transport', () => {
  it.each([
    'queued',
    'delivered',
  ] as const)('records native launch before sending and retains the observed %s transport outcome', async (outcome) => {
    const s = scenario();
    s.flags.delivery = outcome;
    const run = s.deps.exec.run.bind(s.deps.exec);
    let beforeSend: DispatchReceipt | undefined;
    s.deps.exec.run = async (command, args, options) => {
      if (command === 'pij-rs' && args[0] === 'send')
        beforeSend = value(
          readBuilderRecord<DispatchReceipt>(
            s.deps,
            builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`),
            'dispatch',
          ),
        ).value;
      return run(command, args, options);
    };
    const result = value(await dispatchBuilderUnit(s.deps, s.input));
    expect(beforeSend?.observed).toMatchObject({ ready: true, peer_id: PEER, root: ROOT });
    expect(beforeSend?.delivery).toBeUndefined();
    expect(result.dispatch.value.delivery?.outcome).toBe(outcome);
    expect(
      value(readBuilderRecord<DispatchReceipt>(s.deps, result.dispatch.ref.path, 'dispatch')).value
        .delivery?.outcome,
    ).toBe(outcome);
    expect(sends(s)).toHaveLength(1);
  });

  it.each([
    'held',
    'refused',
    'malformed',
  ])('preserves the launched peer without inventing successful %s delivery or duplicating work', async (outcome) => {
    const s = scenario();
    if (outcome === 'malformed') s.flags.malformed = 'send';
    else s.flags.delivery = outcome;
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    const recorded = value(
      readBuilderRecord<DispatchReceipt>(
        s.deps,
        builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`),
        'dispatch',
      ),
    );
    expect(recorded.value.observed).toMatchObject({ ready: true, peer_id: PEER });
    expect(recorded.value.delivery).toBeUndefined();
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
    });
    expect(sends(s)).toHaveLength(1);
    expect(s.exec.calls.filter((call) => call.args[0] === 'spawn')).toHaveLength(1);
  });

  it('preserves competing dispatch bytes when delivery recording loses its CAS', async () => {
    const s = scenario();
    const run = s.deps.exec.run.bind(s.deps.exec);
    const path = builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`);
    let competing = '';
    s.deps.exec.run = async (command, args, options) => {
      const result = await run(command, args, options);
      if (command === 'pij-rs' && args[0] === 'send') {
        competing = `${s.fs.readText(path)} `;
        s.fs.writeText(path, competing);
      }
      return result;
    };
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
      details: { peer: PEER, delivery: { outcome: 'queued' } },
    });
    expect(s.fs.readText(path)).toBe(competing);
    expect(
      value(readBuilderRecord<DispatchReceipt>(s.deps, path, 'dispatch')).value.delivery,
    ).toBeUndefined();
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
    });
    expect(sends(s)).toHaveLength(1);
    expect(s.exec.calls.filter((call) => call.args[0] === 'spawn')).toHaveLength(1);
  });

  it('holds the unit operation claim until asynchronous delivery is recorded', async () => {
    const s = scenario();
    let entered!: () => void;
    let resume!: () => void;
    const sending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const run = s.deps.exec.run.bind(s.deps.exec);
    s.deps.exec.run = async (command, args, options) => {
      if (command === 'pij-rs' && args[0] === 'send') {
        entered();
        await gate;
      }
      return run(command, args, options);
    };
    const pending = dispatchBuilderUnit(s.deps, s.input);
    await sending;
    let competing: BuilderResult<DispatchResult>;
    try {
      competing = await dispatchBuilderUnit(s.deps, s.input);
    } finally {
      resume();
    }
    const completed = value(await pending);
    expect(competing).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_CONFLICT });
    expect(completed.dispatch.value.delivery?.outcome).toBe('queued');
    expect(sends(s)).toHaveLength(1);
  });

  it.each([
    'model',
    'root',
    'session',
    'pid',
    'parent',
    'duplicate roster',
  ])('records but never sends work to a forged or changed native %s binding', async (drift) => {
    const s = scenario();
    if (drift === 'model') s.state.boundModel = 'different-model';
    if (drift === 'root') s.state.cwd = '/other-root';
    if (drift === 'session') s.seat.session = 'different-session';
    if (drift === 'pid') s.state.pid = 999;
    if (drift === 'parent') s.state.parent = 'different-parent';
    if (drift === 'duplicate roster') s.otherSeats.push({ ...s.seat });
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(sends(s)).toHaveLength(0);
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
    });
    expect(s.exec.calls.filter((call) => call.args[0] === 'spawn')).toHaveLength(1);
  });

  it.each([
    'current seal',
    'allocation',
    'packet',
  ])('does not send work when the bound %s changes during native readiness observation', async (changed) => {
    const s = scenario();
    const run = s.deps.exec.run.bind(s.deps.exec);
    s.deps.exec.run = async (command, args, options) => {
      const result = await run(command, args, options);
      if (command === 'pij-rs' && args[0] === 'list') {
        if (changed === 'current seal') s.advanceSeal('b'.repeat(40));
        else {
          const path =
            changed === 'allocation'
              ? '/repo/.git/harness/builder/allocations/al-0001.dd.json'
              : builderRecordPath(s.context, 'packet', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`);
          s.fs.writeText(path, `${s.fs.readText(path)} `);
        }
      }
      return result;
    };
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_NOT_READY,
    });
    expect(sends(s)).toHaveLength(0);
  });
});

describe('Builder current sealed-baseline authorization', () => {
  const newer = 'b'.repeat(40);
  const refusal = {
    ok: false,
    code: ErrorCodes.BUILDER_NOT_READY,
  };

  it('does not let a stale injected baseline select an old producer attempt', async () => {
    const s = scenario();
    s.advanceSeal(newer);
    const stale: DispatchDeps = {
      ...s.deps,
      readiness: async () => ({
        ok: true,
        value: {
          status: 'ready',
          issues: [],
          context: s.context,
          guide: s.guide,
          baseline: s.baseline,
        },
      }),
    };
    expect(await dispatchBuilderUnit(stale, s.input)).toMatchObject(refusal);
    expect(s.provisioned).toHaveLength(0);
    expect(
      prepareBuilderPacket(s.deps, {
        context: s.context,
        baseline: s.baseline,
        allocation: {
          value: fixtureAllocation(),
          ref: { path: 'allocation.dd.json', sha256: 'a'.repeat(64) },
        },
        unit: s.guide.units[1]!,
        parent: PARENT,
        requested: fixtureRole(),
        nonce: 'fresh-nonce',
      }),
    ).toMatchObject(refusal);
  });

  it('keeps operation locks unit-scoped across sealed-baseline attempts', async () => {
    const s = scenario();
    s.advanceSeal(newer);
    const lock = `${builderRecordPath(s.context, 'dispatch', s.input.unit)}.operation-lock`;
    s.fs.createExclusive(lock, 'prior-attempt-owner');
    expect(await dispatchBuilderUnit(s.deps, s.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_CONFLICT,
    });
    expect(s.fs.readText(lock)).toBe('prior-attempt-owner');
    expect(s.provisioned).toHaveLength(0);
  });

  it('preserves legacy and historical records while creating only a current-qualified attempt', async () => {
    const s = scenario();
    const historical = ['packet', 'ack', 'dispatch'].flatMap((kind) => [
      builderRecordPath(s.context, kind as 'packet' | 'ack' | 'dispatch', s.input.unit),
      builderRecordPath(
        s.context,
        kind as 'packet' | 'ack' | 'dispatch',
        `${s.input.unit}-${newer}`,
      ),
    ]);
    for (const path of historical) s.fs.writeText(path, `preserved:${path}`);
    value(await dispatchBuilderUnit(s.deps, s.input));
    for (const path of historical) expect(s.fs.readText(path)).toBe(`preserved:${path}`);
    expect(sends(s)).toHaveLength(1);
  });
});

describe('Builder native release observation', () => {
  it('keeps active peers unreleased regardless of idle activity or tombstones', async () => {
    const s = scenario();
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toEqual({ ok: true, value: false });
    Object.assign(s.state, {
      tombstonedAt: 1000,
      tombstoneReason: 'superseded while process lives',
    });
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toEqual({ ok: true, value: false });
  });
  it.each([
    'dead',
    'recycled',
  ])('accepts observed %s without requiring a tombstone or process kill', async (liveness) => {
    const s = scenario();
    s.state.liveness = liveness;
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toEqual({ ok: true, value: true });
    expect(
      s.exec.calls.every(
        (call) => call.command === 'pij-rs' && ['state', 'list'].includes(call.args[0] ?? ''),
      ),
    ).toBe(true);
  });
  it('refuses unbound, absent and unobservable native peers', async () => {
    const s = scenario();
    s.state.liveness = 'unbound';
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    s.flags.peerAbsent = true;
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    s.flags.peerAbsent = false;
    s.flags.malformed = 'state';
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
  });
  it.each([
    'dead',
    'recycled',
  ])('keeps a %s peer root held while another native seat is active or unbound', async (liveness) => {
    const s = scenario();
    s.state.liveness = liveness;
    s.otherSeats.push({ id: 'replacement', folder: ROOT });
    s.otherStates.replacement = { id: 'replacement', cwd: ROOT, liveness: 'active', state: 'idle' };
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toEqual({ ok: true, value: false });
    s.otherStates.replacement.liveness = 'unbound';
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    s.otherStates.replacement.liveness = 'dead';
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toEqual({ ok: true, value: true });
  });
  it('ignores activity in a different native root', async () => {
    const s = scenario();
    s.state.liveness = 'dead';
    s.otherSeats.push({ id: 'unrelated', folder: '/workers/unrelated' });
    s.otherStates.unrelated = { id: 'unrelated', cwd: '/workers/unrelated', liveness: 'active' };
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toEqual({ ok: true, value: true });
    expect(s.exec.calls.some((call) => call.args.includes('unrelated'))).toBe(false);
  });
  it('fails closed when roster or same-root state evidence is incomplete or changes', async () => {
    const s = scenario();
    s.state.liveness = 'dead';
    s.unavailable.push('unreachable native registry');
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    s.unavailable.length = 0;
    s.flags.omitPeer = true;
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    s.flags.omitPeer = false;
    s.otherSeats.push({ id: 'replacement', folder: ROOT });
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    s.otherStates.replacement = { id: 'replacement', cwd: '/different-root', liveness: 'dead' };
    expect(await checkBuilderPeerReleased(s.deps, PEER)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
  });
});
