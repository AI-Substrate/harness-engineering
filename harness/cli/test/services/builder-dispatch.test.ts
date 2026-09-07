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
  acknowledgeBuilderUnit,
  checkBuilderPeerReleased,
  dispatchBuilderUnit,
  verifyBuilderParentWorktreeAuthority,
} from '../../src/services/builder/dispatch-service.js';
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
  AckReceipt,
  AllocationRecord,
  BuilderResult,
  DispatchDeps,
  DispatchInput,
  DispatchReceipt,
  DispatchResult,
  WorkspaceInput,
} from '../../src/services/builder/types.js';
import { resolve } from '../../src/services/settings/settings.js';
import { toPosix } from '../../src/services/shared/posix-path.js';
import {
  BUILDER_FIXTURE_GUIDE,
  BUILDER_FIXTURE_PLAN,
  BUILDER_FIXTURE_SHA,
  builderFixture,
  fixtureAck,
  fixtureAllocation,
  fixtureBaseline,
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

function scenario(unit = 'tk-0002') {
  const fixture = builderFixture();
  const { fs, clock, guide } = fixture;
  if (unit !== 'tk-0002') {
    guide.units = guide.units.map((entry) =>
      entry.id === 'tk-0002' ? { ...entry, id: unit } : entry,
    );
    const doc = value(
      readBuilderDocument(fixture.deps, BUILDER_FIXTURE_GUIDE, 'builder/impl-guide'),
    );
    value(
      writeBuilderDocument(
        fixture.deps,
        BUILDER_FIXTURE_GUIDE,
        {
          ...doc.value,
          sections: doc.value.sections.map((section) =>
            section.name === 'units' ? { ...section, value: guide.units } : section,
          ),
        },
        { expectedSha256: doc.ref.sha256 },
      ),
    );
  }
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
    gitStatus: '',
    rootSha: BUILDER_FIXTURE_SHA,
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
  const json = (command: string, data: unknown): ExecScript => ({
    code: 0,
    stdout: JSON.stringify({ ok: true, v: 2, command, data }),
  });
  const deps: DispatchDeps = {
    ...fixture.deps,
    exec: {
      async run(command, args, options) {
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
              stdout: `${options.cwd === ROOT ? flags.rootPath : options.cwd}\n${options.cwd === ROOT ? flags.rootSha : BUILDER_FIXTURE_SHA}\n${args.includes('--abbrev-ref') ? `${flags.rootBranch}\n` : ''}`,
            };
          else if (args[0] === 'merge-base') script = { code: flags.ancestor ? 0 : 1 };
          else if (args[0] === 'status') script = { code: 0, stdout: flags.gitStatus };
        } else if (command === 'tmux') script = { code: 0, stdout: 'observed-session\n' };
        scripts[[command, ...args].join(' ')] = script;
        return exec.run(command, args, options);
      },
    },
    readiness: async () =>
      flags.readiness === 'ready'
        ? { ok: true, value: { status: 'ready', issues: [], context, guide, baseline } }
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
      fs.writeText(`${ROOT}/contracts.ts`, fs.readText('/repo/contracts.ts') ?? '');
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
  };
  const input: DispatchInput = {
    plan: BUILDER_FIXTURE_PLAN,
    unit,
    workspace: ROOT,
    parent: PARENT,
    role: fixtureRole(),
  };
  const ackPath = `${ROOT}/scratch/ack.json`;
  function acknowledgement(result: DispatchResult, override: Partial<AckReceipt> = {}) {
    const ack = fixtureAck({
      id: `ack-${result.packet.value.unit.id}-${baseline.value.source_sha}`,
      unit_id: result.packet.value.unit.id,
      peer_id: result.dispatch.value.observed.peer_id,
      nonce: result.packet.value.nonce,
      packet_sha256: result.packet.ref.sha256,
      baseline_sha: baseline.value.source_sha,
      native_root: ROOT,
      shell_cwd: ROOT,
      canary_nonce: fs.readText(`${ROOT}/${result.packet.value.canary.path}`) ?? '',
      observed: result.dispatch.value.observed,
      ...override,
    });
    fs.mkdirp(`${ROOT}/scratch`);
    fs.writeText(ackPath, JSON.stringify(ack));
    return ack;
  }
  function advanceSeal(sourceSha: string) {
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
    input,
    ackPath,
    acknowledgement,
    advanceSeal,
  };
}

function sends(s: ReturnType<typeof scenario>) {
  return s.exec.calls.filter((call) => call.command === 'pij-rs' && call.args[0] === 'send');
}
function releases(s: ReturnType<typeof scenario>) {
  return sends(s).filter((call) =>
    call.args.some((arg) => arg.startsWith('IMPLEMENTATION RELEASE')),
  );
}

async function releasedScenario(delivery = 'queued', unit = 'tk-0002') {
  const s = scenario(unit);
  s.flags.delivery = delivery;
  const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
  const primary = s.acknowledgement(dispatched);
  let released = value(
    await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
  );
  const confirmationPath = `${ROOT}/scratch/release-ack.json`;
  const canonicalPath = builderRecordPath(
    s.context,
    'ack',
    `${s.input.unit}-${BUILDER_FIXTURE_SHA}-release`,
  );
  function confirmation(overrides: Partial<AckReceipt> = {}) {
    const ack: AckReceipt = {
      ...primary,
      id: `${primary.id}-release`,
      nonce: released.dispatch.value.release!.message_id,
      recorded_at: s.clock.nowIso(),
      observed: {
        ...released.dispatch.value.observed,
        evidence: ['Native peer observed the exact retained release.'],
      },
      ...overrides,
    };
    s.fs.writeText(confirmationPath, JSON.stringify(ack));
    return ack;
  }
  function replaceDispatch(change: Partial<DispatchReceipt>) {
    const updated = { ...released.dispatch.value, ...change };
    for (const field of ['release', 'acknowledgement'] as const)
      if (updated[field] === undefined) delete updated[field];
    released = {
      ...released,
      dispatch: value(
        writeBuilderRecord(s.deps, released.dispatch.ref.path, updated, {
          expectedSha256: released.dispatch.ref.sha256,
        }),
      ),
    };
    return released;
  }
  const submit = () =>
    acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: confirmationPath });
  const storedDispatch = () =>
    value(readBuilderRecord<DispatchReceipt>(s.deps, released.dispatch.ref.path, 'dispatch'));
  s.clock.advance(1000);
  return {
    ...s,
    dispatched,
    primary,
    released,
    confirmationPath,
    canonicalPath,
    confirmation,
    replaceDispatch,
    submit,
    storedDispatch,
  };
}

describe('Builder release-phase namespace', () => {
  it('keeps primary and release identities distinct for a release-prefixed unit', async () => {
    const s = await releasedScenario('queued', 'release-tk-0002');
    expect(s.primary.id).toBe(`ack-release-tk-0002-${BUILDER_FIXTURE_SHA}`);
    expect(
      value(
        await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
      ).dispatch.value.release?.outcome,
    ).toBe('queued');
    const confirmation = s.confirmation();
    expect(confirmation.id).toBe(`ack-release-tk-0002-${BUILDER_FIXTURE_SHA}-release`);
    expect(value(await s.submit()).dispatch.value.release?.outcome).toBe('delivered');
    expect(value(readBuilderRecord<AckReceipt>(s.deps, s.canonicalPath, 'ack')).value.id).toBe(
      confirmation.id,
    );
    expect(releases(s)).toHaveLength(1);
  });

  it('does not treat a post-release receipt as permission to issue the first grant', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched, { id: `ack-${s.input.unit}-${BUILDER_FIXTURE_SHA}-release` });
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(releases(s)).toHaveLength(0);
    expect(
      value(readBuilderRecord<DispatchReceipt>(s.deps, dispatched.dispatch.ref.path, 'dispatch'))
        .value.release,
    ).toBeUndefined();
  });
});

describe('Builder retained release transport guard', () => {
  it.each([
    'held',
    'refused',
  ])('never promotes retained %s transport to observed delivery', async (outcome) => {
    const s = await releasedScenario();
    s.confirmation();
    const path = `/repo/${s.released.dispatch.ref.path}`;
    const doc = JSON.parse(s.fs.readText(path)!);
    doc.sections[0].value.release.outcome = outcome;
    s.fs.writeText(path, JSON.stringify(doc));
    expect((await s.submit()).ok).toBe(false);
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
    expect(JSON.parse(s.fs.readText(path)!).sections[0].value.release.outcome).toBe(outcome);
    expect(releases(s)).toHaveLength(1);
  });
});

describe('Builder post-release acknowledgement confirmation', () => {
  it('teaches exact phase ids, independent nonces and the same public acknowledgement command', async () => {
    const s = await releasedScenario();
    const instructions = s.dispatched.packet.value.instructions.join('\n');
    expect(instructions).toContain(`id ${s.primary.id}, nonce equal to packet.nonce`);
    expect(instructions).toContain(`id ${s.primary.id}-release`);
    expect(instructions).toContain('nonce to the already-issued release.message_id');
    expect(instructions.match(/builder ack <plan> --receipt <path>/g)).toHaveLength(2);
    expect(instructions).toContain('minus 5000 ms');
    expect(instructions).toContain('plus 5000 ms');
    expect(instructions).toContain('without waiting for another release');
  });

  it.each([
    'queued',
    'delivered',
  ])('records actual receipt after %s transport without sending another grant', async (transport) => {
    const s = await releasedScenario(transport);
    const originalRelease = s.released.dispatch.value.release;
    const refs = [
      s.released.packet.ref,
      s.released.dispatch.value.acknowledgement!,
      s.released.dispatch.value.allocation,
    ];
    const before = refs.map((ref) =>
      s.fs.readText(ref.path.startsWith('/') ? ref.path : `/repo/${ref.path}`),
    );
    const seedBytes = s.released.dispatch.value.seed_files.map((ref) =>
      s.fs.readText(`${ROOT}/${ref.path}`),
    );
    const ack = s.confirmation();
    const ingestionStart = Date.parse(s.clock.nowIso());
    const confirmed = value(await s.submit());
    expect(confirmed.dispatch.value.release).toEqual({ ...originalRelease, outcome: 'delivered' });
    expect(confirmed.dispatch.value.acknowledgement).toEqual(
      s.released.dispatch.value.acknowledgement,
    );
    const canonical = value(readBuilderRecord<AckReceipt>(s.deps, s.canonicalPath, 'ack'));
    expect(canonical.value).toEqual(ack);
    const evidence = confirmed.dispatch.value.observed.evidence.find((entry) =>
      entry.startsWith('builder release confirmation: '),
    );
    const proof = JSON.parse(evidence!.slice('builder release confirmation: '.length));
    expect(proof).toMatchObject({
      transport: originalRelease,
      confirmation: canonical.ref,
      observed_at: ack.recorded_at,
    });
    expect(Date.parse(proof.ingested_at)).toBeGreaterThanOrEqual(ingestionStart);
    expect(Date.parse(proof.ingested_at)).toBeLessThanOrEqual(Date.parse(s.clock.nowIso()));
    expect(
      refs.map((ref) => s.fs.readText(ref.path.startsWith('/') ? ref.path : `/repo/${ref.path}`)),
    ).toEqual(before);
    expect(
      s.released.dispatch.value.seed_files.map((ref) => s.fs.readText(`${ROOT}/${ref.path}`)),
    ).toEqual(seedBytes);
    expect(releases(s)).toHaveLength(1);
  });

  it('does not promote a queued release when its strict-prefix primary receipt is retried', async () => {
    const s = await releasedScenario();
    s.flags.rootSha = 'b'.repeat(40);
    s.flags.gitStatus = ' M src/parser.ts\0';
    const retry = value(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    );
    expect(`${s.primary.id}-release`.startsWith(s.primary.id)).toBe(true);
    expect(retry).toEqual(s.released);
    expect(retry.dispatch.value.release?.outcome).toBe('queued');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
    expect(releases(s)).toHaveLength(1);
  });

  it('derives the post-release nonce from the retained message rather than the packet nonce', async () => {
    const s = await releasedScenario();
    const changed = s.replaceDispatch({
      release: { ...s.released.dispatch.value.release!, message_id: 'independent-release-message' },
    });
    expect(changed.dispatch.value.release?.message_id).not.toBe(s.primary.nonce);
    s.confirmation({ nonce: s.primary.nonce });
    expect(await s.submit()).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    expect(
      value(
        await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
      ).dispatch.value.release?.outcome,
    ).toBe('queued');
    s.confirmation();
    expect(value(await s.submit()).dispatch.value.release).toEqual({
      ...changed.dispatch.value.release,
      outcome: 'delivered',
    });
    expect(releases(s)).toHaveLength(1);
  });

  it('confirms an already-working descendant on its allocated branch without pristine-source checks', async () => {
    const s = await releasedScenario();
    s.confirmation();
    s.flags.rootSha = 'b'.repeat(40);
    s.flags.gitStatus = ' M src/parser.ts\0?? source-in-progress.ts\0';
    s.fs.mkdirp(`${ROOT}/src`);
    s.fs.writeText(`${ROOT}/src/parser.ts`, 'already authorized work');
    const start = s.exec.calls.length;
    expect(value(await s.submit()).dispatch.value.release?.outcome).toBe('delivered');
    const calls = s.exec.calls.slice(start);
    expect(calls.find((call) => call.args[0] === 'merge-base')?.args).toEqual([
      'merge-base',
      '--is-ancestor',
      BUILDER_FIXTURE_SHA,
      'b'.repeat(40),
    ]);
    expect(calls.some((call) => call.command === 'git' && call.args[0] === 'status')).toBe(false);
    expect(s.fs.readText(`${ROOT}/src/parser.ts`)).toBe('already authorized work');
    expect(releases(s)).toHaveLength(1);
  });

  it.each([
    'primary',
    'extra suffix',
    'release prefix',
    'other source',
  ])('refuses an inexact post-release phase id: %s', async (kind) => {
    const s = await releasedScenario();
    const id =
      kind === 'primary'
        ? s.primary.id
        : kind === 'extra suffix'
          ? `${s.primary.id}-release-extra`
          : kind === 'release prefix'
            ? `ack-release-${s.input.unit}-${BUILDER_FIXTURE_SHA}`
            : `ack-${s.input.unit}-${'b'.repeat(40)}-release`;
    s.confirmation({ id });
    expect(await s.submit()).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
  });

  it.each([
    'unit_id',
    'peer_id',
    'nonce',
    'packet_sha256',
    'baseline_sha',
    'native_root',
    'shell_cwd',
    'canary_nonce',
  ] as const)('refuses mismatched post-release %s without promotion', async (field) => {
    const s = await releasedScenario();
    s.confirmation({ [field]: 'different' });
    expect(await s.submit()).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
    expect(releases(s)).toHaveLength(1);
  });

  it.each([
    'peer_id',
    'root',
    'ready',
    'harness',
    'model',
    'effort',
    'native_session',
    'pid',
  ] as const)('refuses mismatched post-release observation %s', async (field) => {
    const s = await releasedScenario();
    s.confirmation({
      observed: {
        ...s.released.dispatch.value.observed,
        [field]: field === 'pid' ? 999 : field === 'ready' ? false : 'different',
      },
    });
    expect((await s.submit()).ok).toBe(false);
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
  });

  it.each([
    'session',
    'model',
    'pid',
    'liveness',
    'parent',
    'branch',
    'root',
    'ancestry',
  ])('re-observes live %s before accepting confirmation', async (drift) => {
    const s = await releasedScenario();
    s.confirmation();
    if (drift === 'session') s.seat.session = 'replacement-session';
    if (drift === 'model') s.state.boundModel = 'replacement-model';
    if (drift === 'pid') s.state.pid = 999;
    if (drift === 'liveness') s.state.liveness = 'dead';
    if (drift === 'parent') s.parent.id = 'different-pm';
    if (drift === 'branch') s.flags.rootBranch = 'different-branch';
    if (drift === 'root') s.flags.rootPath = '/other-root';
    if (drift === 'ancestry') s.flags.ancestor = false;
    expect((await s.submit()).ok).toBe(false);
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
  });

  it.each([
    'release',
    'acknowledgement',
    'canonical acknowledgement',
    'canary',
    'packet',
  ])('requires the retained %s before recording confirmation', async (missing) => {
    const s = await releasedScenario();
    s.confirmation();
    if (missing === 'release') s.replaceDispatch({ release: undefined });
    if (missing === 'acknowledgement') s.replaceDispatch({ acknowledgement: undefined });
    if (missing === 'canonical acknowledgement')
      s.fs.deleteFile(`/repo/${s.released.dispatch.value.acknowledgement!.path}`);
    if (missing === 'canary')
      s.fs.writeText(`${ROOT}/${s.released.packet.value.canary.path}`, 'changed');
    if (missing === 'packet') s.fs.writeText(`/repo/${s.released.packet.ref.path}`, '{}');
    expect((await s.submit()).ok).toBe(false);
    expect(s.storedDispatch().value.release?.outcome).not.toBe('delivered');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
  });

  it.each([
    'nonce',
    'baseline_sha',
    'native_root',
    'canary_nonce',
  ] as const)('revalidates accepted primary %s instead of trusting a matching digest alone', async (field) => {
    const s = await releasedScenario();
    s.confirmation();
    const prior = value(
      readBuilderRecord<AckReceipt>(s.deps, s.released.dispatch.value.acknowledgement!.path, 'ack'),
    );
    const changed = value(
      writeBuilderRecord(
        s.deps,
        prior.ref.path,
        { ...prior.value, [field]: field === 'baseline_sha' ? 'b'.repeat(40) : 'different' },
        { expectedSha256: prior.ref.sha256 },
      ),
    );
    s.replaceDispatch({ acknowledgement: changed.ref });
    expect(await s.submit()).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
  });

  it('keeps successful retries immutable and side-effect free except for the unit claim', async () => {
    const s = await releasedScenario();
    s.confirmation();
    const confirmed = value(await s.submit());
    const bytes = s.fs.readText(s.canonicalPath);
    const created: string[] = [];
    const create = s.fs.createExclusive.bind(s.fs);
    s.fs.createExclusive = (path, content) => {
      created.push(path);
      return create(path, content);
    };
    const start = s.exec.calls.length;
    expect(
      value(
        await acknowledgeBuilderUnit(s.deps, {
          plan: BUILDER_FIXTURE_PLAN,
          receipt: s.canonicalPath,
        }),
      ),
    ).toEqual(confirmed);
    expect(created).toEqual([
      `${builderRecordPath(s.context, 'dispatch', s.input.unit)}.operation-lock`,
    ]);
    expect(s.exec.calls.slice(start).some((call) => call.args[0] === 'state')).toBe(true);
    expect(s.fs.readText(s.canonicalPath)).toBe(bytes);
    expect(releases(s)).toHaveLength(1);
  });

  it.each([
    'raw content',
    'canonical bytes',
    'evidence binding',
  ])('refuses changed immutable confirmation %s on retry', async (changed) => {
    const s = await releasedScenario();
    const ack = s.confirmation();
    const confirmed = value(await s.submit());
    if (changed === 'raw content')
      s.confirmation({
        ...ack,
        observed: { ...ack.observed, evidence: ['different observation'] },
      });
    if (changed === 'canonical bytes')
      s.fs.writeText(s.canonicalPath, `${s.fs.readText(s.canonicalPath)} `);
    if (changed === 'evidence binding') {
      const evidence = confirmed.dispatch.value.observed.evidence.map((entry) => {
        if (!entry.startsWith('builder release confirmation: ')) return entry;
        const proof = JSON.parse(entry.slice('builder release confirmation: '.length));
        return `builder release confirmation: ${JSON.stringify({ ...proof, confirmation: { ...proof.confirmation, sha256: '0'.repeat(64) } })}`;
      });
      value(
        writeBuilderRecord(
          s.deps,
          confirmed.dispatch.ref.path,
          {
            ...confirmed.dispatch.value,
            observed: { ...confirmed.dispatch.value.observed, evidence },
          },
          { expectedSha256: confirmed.dispatch.ref.sha256 },
        ),
      );
    }
    const retained = s.fs.readText(s.canonicalPath);
    expect(await s.submit()).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(s.fs.readText(s.canonicalPath)).toBe(retained);
    expect(releases(s)).toHaveLength(1);
  });

  it('recovers an identical immutable acknowledgement after dispatch compare-and-swap fails', async () => {
    const s = await releasedScenario();
    s.confirmation();
    const dispatchPath = `/repo/${s.released.dispatch.ref.path}`;
    const create = s.fs.createExclusive.bind(s.fs);
    let raced = false;
    s.fs.createExclusive = (path, content) => {
      if (!raced && path === `${dispatchPath}.lock`) {
        raced = true;
        s.fs.writeText(dispatchPath, `${s.fs.readText(dispatchPath)} `);
      }
      return create(path, content);
    };
    expect(await s.submit()).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_CONFLICT });
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    const preserved = s.fs.readText(s.canonicalPath);
    expect(preserved).not.toBeNull();
    expect(value(await s.submit()).dispatch.value.release?.outcome).toBe('delivered');
    expect(s.fs.readText(s.canonicalPath)).toBe(preserved);
    expect(releases(s)).toHaveLength(1);
  });

  it('retains the unit operation lock across asynchronous confirmation observation', async () => {
    const s = await releasedScenario();
    s.confirmation();
    let entered!: () => void;
    let resume!: () => void;
    const observing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const run = s.deps.exec.run.bind(s.deps.exec);
    let paused = false;
    s.deps.exec.run = async (command, args, options) => {
      if (!paused && command === 'git' && args[0] === 'merge-base') {
        paused = true;
        entered();
        await gate;
      }
      return run(command, args, options);
    };
    const pending = s.submit();
    await observing;
    let competing: BuilderResult<DispatchResult>;
    try {
      competing = await s.submit();
    } finally {
      resume();
    }
    const completed = await pending;
    expect(competing).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_CONFLICT });
    expect(completed.ok).toBe(true);
    expect(releases(s)).toHaveLength(1);
  });

  it.each([
    'current seal',
    'allocation',
    'dispatch',
  ])('rechecks %s changed during native observation', async (changed) => {
    const s = await releasedScenario();
    s.confirmation();
    const run = s.deps.exec.run.bind(s.deps.exec);
    let mutated = false;
    s.deps.exec.run = async (command, args, options) => {
      const result = await run(command, args, options);
      if (!mutated && command === 'pij-rs' && args[0] === 'whoami') {
        mutated = true;
        if (changed === 'current seal') s.advanceSeal('b'.repeat(40));
        else {
          const ref =
            changed === 'allocation'
              ? s.released.dispatch.value.allocation
              : s.released.dispatch.ref;
          const path = ref.path.startsWith('/') ? ref.path : `/repo/${ref.path}`;
          s.fs.writeText(path, `${s.fs.readText(path)} `);
        }
      }
      return result;
    };
    expect((await s.submit()).ok).toBe(false);
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
  });

  it('does not return historical confirmation success after the guide-bound seal changes', async () => {
    const s = await releasedScenario();
    s.confirmation();
    value(await s.submit());
    const preserved = s.fs.readText(s.canonicalPath);
    s.advanceSeal('b'.repeat(40));
    expect(await s.submit()).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_ACK,
      message: 'Current sealed-baseline authorization is missing or mismatched.',
    });
    expect(s.fs.readText(s.canonicalPath)).toBe(preserved);
    expect(releases(s)).toHaveLength(1);
  });

  it.each([
    ['sent minus tolerance', 'sent', -5000, true],
    ['before sent boundary', 'sent', -5001, false],
    ['ingestion plus tolerance', 'ingested', 5000, true],
    ['after ingestion boundary', 'ingested', 5001, false],
  ] as const)('enforces explicit clock skew at %s', async (_label, origin, offset, accepted) => {
    const s = await releasedScenario();
    const reference =
      origin === 'sent' ? s.released.dispatch.value.release!.recorded_at : s.clock.nowIso();
    s.confirmation({ recorded_at: new Date(Date.parse(reference) + offset).toISOString() });
    const result = await s.submit();
    expect(result.ok).toBe(accepted);
    if (!accepted)
      expect(result).toMatchObject({
        code: ErrorCodes.BUILDER_ACK,
        message: expect.stringContaining('5000 ms clock-skew'),
        next_action: expect.stringContaining('clock skew'),
      });
    expect(s.storedDispatch().value.release?.outcome).toBe(accepted ? 'delivered' : 'queued');
  });

  it.each([
    'peer',
    'sent',
  ])('refuses invalid %s timestamps with clock-skew or incorrect-receipt guidance', async (source) => {
    const s = await releasedScenario();
    if (source === 'sent')
      s.replaceDispatch({
        release: { ...s.released.dispatch.value.release!, recorded_at: 'not-a-timestamp' },
      });
    s.confirmation(source === 'peer' ? { recorded_at: 'not-a-timestamp' } : {});
    expect(await s.submit()).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_ACK,
      next_action: expect.stringContaining('incorrect or tampered timestamp'),
    });
    expect(s.storedDispatch().value.release?.outcome).toBe('queued');
    expect(s.fs.exists(s.canonicalPath)).toBe(false);
  });
});

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

describe('Builder isolated dispatch', () => {
  it('uses injected provisioning, observed session bootstrap, immutable seeds and acknowledgement-only delivery', async () => {
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
    expect(result.packet.value.canary).toEqual({ path: expect.any(String) });
    const challenge = s.fs.readText(`${ROOT}/${result.packet.value.canary.path}`);
    expect(challenge).not.toBe(result.packet.value.nonce);
    expect(JSON.stringify(result.packet.value)).not.toContain(challenge);
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
    expect(releases(s)).toHaveLength(0);
    expect(sends(s)).toHaveLength(1);
    expect(result.dispatch.value).not.toHaveProperty('acknowledgement');
    expect(result.dispatch.value).not.toHaveProperty('release');
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
    expect(releases(s)).toHaveLength(0);
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
  it('records accepted-but-unbound launch without sending a packet or releasing work', async () => {
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
  it('refuses changed source, stale Git baseline and aliased native roots before launch', async () => {
    const changed = scenario();
    changed.fs.writeText('/repo/contracts.ts', 'changed');
    expect((await dispatchBuilderUnit(changed.deps, changed.input)).ok).toBe(false);
    expect(changed.provisioned).toHaveLength(0);
    const stale = scenario();
    stale.flags.rootSha = 'b'.repeat(40);
    expect(await dispatchBuilderUnit(stale.deps, stale.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
    });
    expect(stale.exec.calls.some((call) => call.args[0] === 'spawn')).toBe(false);
    const nested = scenario();
    nested.input.workspace = '/repo/nested';
    expect(await dispatchBuilderUnit(nested.deps, nested.input)).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_OWNERSHIP,
    });
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

describe('Builder exact acknowledgement release', () => {
  it('persists an exact acknowledgement before truthful queued release and makes replay a no-op', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched);
    const released = value(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    );
    expect(released.dispatch.value.release).toMatchObject({
      message_id: dispatched.packet.value.nonce,
      outcome: 'queued',
    });
    expect(released.dispatch.value.acknowledgement).toBeDefined();
    const ackPath = builderRecordPath(s.context, 'ack', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`);
    expect(`/repo/${released.dispatch.value.acknowledgement?.path}`).toBe(ackPath);
    expect(value(readBuilderRecord<AckReceipt>(s.deps, ackPath, 'ack')).value.id).toBe(
      `ack-${s.input.unit}-${BUILDER_FIXTURE_SHA}`,
    );
    expect(releases(s)).toHaveLength(1);
    expect(
      value(
        await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
      ),
    ).toEqual(released);
    expect(releases(s)).toHaveLength(1);
    expect(s.fs.readText(`/repo/${dispatched.packet.ref.path}`)).toBe(
      s.fs.readText(`${ROOT}/${dispatched.packet.ref.path}`),
    );
  });
  it.each([
    'nonce',
    'packet_sha256',
    'baseline_sha',
    'peer_id',
    'unit_id',
    'native_root',
    'shell_cwd',
    'canary_nonce',
  ] as const)('does not release a mismatched %s', async (field) => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched, { [field]: 'different' });
    expect(
      (await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath })).ok,
    ).toBe(false);
    expect(releases(s)).toHaveLength(0);
  });
  it.each([
    'harness',
    'model',
    'effort',
    'native_session',
    'pid',
    'root',
    'ready',
  ] as const)('does not release a false observed %s', async (field) => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched, {
      observed: {
        ...dispatched.dispatch.value.observed,
        [field]: field === 'pid' ? 999 : field === 'ready' ? false : 'different',
      },
    });
    expect(
      (await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath })).ok,
    ).toBe(false);
    expect(releases(s)).toHaveLength(0);
  });
  it('refuses missing and malformed ack, tampered packet, seed and contract bytes', async () => {
    for (const changed of ['missing', 'malformed', 'packet', 'seed', 'contract'] as const) {
      const s = scenario();
      const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
      s.acknowledgement(dispatched);
      if (changed === 'missing') s.fs.deleteFile(s.ackPath);
      if (changed === 'malformed') s.fs.writeText(s.ackPath, '{}');
      if (changed === 'packet') s.fs.writeText(`/repo/${dispatched.packet.ref.path}`, '{}');
      if (changed === 'seed')
        s.fs.writeText(`${ROOT}/${dispatched.packet.value.canary.path}`, 'tampered');
      if (changed === 'contract') s.fs.writeText(`${ROOT}/contracts.ts`, 'changed before release');
      expect(
        (await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }))
          .ok,
      ).toBe(false);
      expect(releases(s)).toHaveLength(0);
    }
  });
  it('permits only exact seed files as untracked and rejects pre-release edits', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched);
    s.flags.gitStatus = `?? ${dispatched.packet.value.canary.path}\0?? unrelated.txt\0`;
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_ACK });
    expect(releases(s)).toHaveLength(0);
    s.flags.gitStatus = ` M src/parser.ts\0`;
    expect(
      (await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath })).ok,
    ).toBe(false);
    s.flags.gitStatus = `?? ${dispatched.packet.value.canary.path}\0`;
    expect(
      (await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath })).ok,
    ).toBe(true);
  });
  it('rechecks live session identity, model and HEAD rather than trusting an old ack', async () => {
    for (const drift of ['session', 'model', 'head']) {
      const s = scenario();
      const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
      s.acknowledgement(dispatched);
      if (drift === 'session') s.seat.session = 'replacement-session';
      if (drift === 'model') s.state.boundModel = 'replacement-model';
      if (drift === 'head') s.flags.rootSha = 'b'.repeat(40);
      expect(
        (await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }))
          .ok,
      ).toBe(false);
      expect(releases(s)).toHaveLength(0);
    }
  });
  it('keeps a held release distinct from delivery and supports exact retry after the native prerequisite changes', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched);
    s.flags.delivery = 'held';
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_RUNTIME });
    const recorded = value(
      readBuilderRecord<DispatchReceipt>(
        s.deps,
        builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`),
        'dispatch',
      ),
    );
    expect(recorded.value.acknowledgement).toBeDefined();
    expect(recorded.value.release).toBeUndefined();
    s.flags.delivery = 'delivered';
    expect(
      value(
        await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
      ).dispatch.value.release?.outcome,
    ).toBe('delivered');
  });
  it('names recipient refusal without claiming delivered release', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched);
    s.flags.delivery = 'refused';
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toMatchObject({
      ok: false,
      code: ErrorCodes.BUILDER_RUNTIME,
      next_action: expect.stringContaining('Do not retry'),
    });
    expect(
      value(
        readBuilderRecord<DispatchReceipt>(
          s.deps,
          builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${BUILDER_FIXTURE_SHA}`),
          'dispatch',
        ),
      ).value.release,
    ).toBeUndefined();
  });
});

describe('Builder current sealed-baseline authorization', () => {
  const newer = 'b'.repeat(40);
  it.each([
    'packet',
    'ack',
  ] as const)('does not fall back when the current-qualified %s is absent', async (kind) => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched);
    const released = value(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    );
    const path = builderRecordPath(s.context, kind, `${s.input.unit}-${BUILDER_FIXTURE_SHA}`);
    const legacy = builderRecordPath(s.context, kind, s.input.unit);
    const historical = s.fs.readText(path) ?? '';
    s.fs.writeText(legacy, historical);
    s.fs.deleteFile(path);
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toEqual(refusal);
    expect(s.fs.readText(legacy)).toBe(historical);
    expect(releases(s)).toHaveLength(1);
    expect(released.dispatch.value.release).toBeDefined();
  });
  const refusal = {
    ok: false,
    code: ErrorCodes.BUILDER_ACK,
    message: 'Current sealed-baseline authorization is missing or mismatched.',
    next_action:
      'Read the current guide-bound seal and prepare its qualified attempt; historical records do not authorize work.',
  };

  it.each([
    'unit-only record',
    'older qualified record',
    'wrong-source current filename',
  ])('refuses %s with the same named current-authorization outcome', async (history) => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    const original = s.fs.readText(`/repo/${dispatched.dispatch.ref.path}`);
    if (history === 'unit-only record') {
      value(
        writeBuilderRecord(s.deps, builderRecordPath(s.context, 'dispatch', s.input.unit), {
          ...dispatched.dispatch.value,
          id: `dispatch-${s.input.unit}`,
        }),
      );
      s.fs.deleteFile(`/repo/${dispatched.dispatch.ref.path}`);
    } else {
      s.advanceSeal(newer);
      if (history === 'wrong-source current filename')
        value(
          writeBuilderRecord(
            s.deps,
            builderRecordPath(s.context, 'dispatch', `${s.input.unit}-${newer}`),
            { ...dispatched.dispatch.value, id: `dispatch-${s.input.unit}-${newer}` },
          ),
        );
    }
    s.acknowledgement(dispatched);
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toEqual(refusal);
    expect(releases(s)).toHaveLength(0);
    if (history !== 'unit-only record')
      expect(s.fs.readText(`/repo/${dispatched.dispatch.ref.path}`)).toBe(original);
  });

  it('checks the current seal before returning an already released historical attempt', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    s.acknowledgement(dispatched);
    const released = value(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    );
    const original = s.fs.readText(`/repo/${released.dispatch.ref.path}`);
    s.advanceSeal(newer);
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toEqual(refusal);
    expect(releases(s)).toHaveLength(1);
    expect(s.fs.readText(`/repo/${released.dispatch.ref.path}`)).toBe(original);
  });

  it.each([
    'packet id',
    'packet path',
    'dispatch id',
    'raw ack id',
    'stored ack id',
    'stored ack path',
    'stored ack source',
  ])('requires uniform attempt identity for %s before release or replay', async (broken) => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    let ack = s.acknowledgement(dispatched);
    let dispatch = dispatched.dispatch;
    if (broken.startsWith('stored ack')) {
      dispatch = value(
        await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
      ).dispatch;
      const recorded = value(
        readBuilderRecord<AckReceipt>(s.deps, dispatch.value.acknowledgement?.path ?? '', 'ack'),
      );
      const path =
        broken === 'stored ack path'
          ? builderRecordPath(s.context, 'ack', s.input.unit)
          : recorded.ref.path;
      const changed = value(
        writeBuilderRecord(
          s.deps,
          path,
          {
            ...recorded.value,
            ...(broken === 'stored ack id' && { id: `ack-${s.input.unit}` }),
            ...(broken === 'stored ack source' && { baseline_sha: newer }),
          },
          broken === 'stored ack path' ? undefined : { expectedSha256: recorded.ref.sha256 },
        ),
      );
      value(
        writeBuilderRecord(
          s.deps,
          dispatch.ref.path,
          { ...dispatch.value, acknowledgement: changed.ref },
          { expectedSha256: dispatch.ref.sha256 },
        ),
      );
    } else if (broken === 'packet id' || broken === 'packet path') {
      const path =
        broken === 'packet path'
          ? builderRecordPath(s.context, 'packet', s.input.unit)
          : dispatched.packet.ref.path;
      const changed = value(
        writeBuilderRecord(
          s.deps,
          path,
          {
            ...dispatched.packet.value,
            ...(broken === 'packet id' && { id: `packet-${s.input.unit}` }),
          },
          broken === 'packet path' ? undefined : { expectedSha256: dispatched.packet.ref.sha256 },
        ),
      );
      value(
        writeBuilderRecord(
          s.deps,
          dispatch.ref.path,
          { ...dispatch.value, packet: changed.ref },
          { expectedSha256: dispatch.ref.sha256 },
        ),
      );
      ack = { ...ack, packet_sha256: changed.ref.sha256 };
    } else if (broken === 'dispatch id') {
      value(
        writeBuilderRecord(
          s.deps,
          dispatch.ref.path,
          { ...dispatch.value, id: `dispatch-${s.input.unit}` },
          { expectedSha256: dispatch.ref.sha256 },
        ),
      );
    } else ack = { ...ack, id: `ack-${s.input.unit}` };
    s.fs.writeText(s.ackPath, JSON.stringify(ack));
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toEqual(refusal);
    expect(releases(s)).toHaveLength(broken.startsWith('stored ack') ? 1 : 0);
  });

  it('rejects an old packet baseline even beneath a correctly qualified packet filename', async () => {
    const s = scenario();
    const dispatched = value(await dispatchBuilderUnit(s.deps, s.input));
    const historical = value(
      writeBuilderRecord(s.deps, builderRecordPath(s.context, 'baseline', 'historical'), {
        ...s.baseline.value,
        source_sha: newer,
      }),
    );
    const packet = value(
      writeBuilderRecord(
        s.deps,
        dispatched.packet.ref.path,
        { ...dispatched.packet.value, baseline: historical.ref },
        { expectedSha256: dispatched.packet.ref.sha256 },
      ),
    );
    value(
      writeBuilderRecord(
        s.deps,
        dispatched.dispatch.ref.path,
        { ...dispatched.dispatch.value, packet: packet.ref },
        { expectedSha256: dispatched.dispatch.ref.sha256 },
      ),
    );
    s.acknowledgement({ ...dispatched, packet });
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toEqual(refusal);
    expect(releases(s)).toHaveLength(0);
  });

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
    expect(await dispatchBuilderUnit(stale, s.input)).toEqual(refusal);
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
    ).toEqual(refusal);
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
    s.fs.mkdirp(`${ROOT}/scratch`);
    s.fs.writeText(
      s.ackPath,
      JSON.stringify(fixtureAck({ id: `ack-${s.input.unit}-${newer}`, baseline_sha: newer })),
    );
    expect(
      await acknowledgeBuilderUnit(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.ackPath }),
    ).toMatchObject({ ok: false, code: ErrorCodes.BUILDER_CONFLICT });
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
    expect(releases(s)).toHaveLength(0);
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
