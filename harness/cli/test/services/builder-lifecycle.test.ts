import { symlinkSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import type { ExecOptions, ExecResult } from '../../src/adapters/exec/exec-port.js';
import { NodeExec } from '../../src/adapters/exec/node-exec.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { closeBuilderPlan } from '../../src/services/builder/close-service.js';
import {
  composeBuilderUnits,
  loadBuilderGuide,
  verifyBuilderBasis,
  verifyBuilderComposition,
} from '../../src/services/builder/composition-service.js';
import {
  advanceBuilderStage,
  builderChoresSatisfied,
  verifyBuilderPreservation,
} from '../../src/services/builder/lifecycle-service.js';
import {
  builderContext,
  builderRecordPath,
  digestBuilderFile,
  readBuilderRecord,
  sha256,
  writeBuilderRecord,
} from '../../src/services/builder/records.js';
import {
  recordBuilderReview,
  verifyBuilderReview,
} from '../../src/services/builder/review-service.js';
import type {
  BuilderDeps,
  BuilderRecord,
  BuilderResult,
  CompositionDeps,
  CompositionReceipt,
  ReviewReceipt,
  Stored,
  UnitDelivery,
} from '../../src/services/builder/types.js';
import type { FlowDoc, FlowNode } from '../../src/services/flow/flow-events.js';
import { addComment, setNow } from '../../src/services/flow/flow-mutations.js';
import {
  readFlowDoc,
  relocateFlow,
  writeFlowAtomic,
} from '../../src/services/flow/flow-service.js';
import { posixDirname, posixJoin, toPosix } from '../../src/services/shared/posix-path.js';
import {
  BUILDER_FIXTURE_GUIDE,
  BUILDER_FIXTURE_PLAN,
  BUILDER_FIXTURE_SHA,
  BUILDER_FIXTURE_TIME,
  builderFixture,
  fixtureAck,
  fixtureAllocation,
  fixtureBaseline,
  fixtureCheck,
  fixtureComposition,
  fixtureDispatch,
  fixtureObservation,
  fixturePacket,
  fixturePreservation,
  fixtureReview,
} from '../fixtures/builder-contracts.js';
import { hermeticGitEnv } from '../support/hermetic-git.js';

const A = BUILDER_FIXTURE_SHA;
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const PLAN = '/repo/docs/plans/001-example';
const FLOW = `${PLAN}/the-flow.json`;
const TEAM = `${PLAN}/assets/team`;

function value<T>(result: BuilderResult<T>): T {
  if (!result.ok)
    throw new Error(
      `${result.code}: ${result.message}\n${JSON.stringify({ next_action: result.next_action, details: result.details }, null, 2)}`,
    );
  return result.value;
}

function node(id: string, next: string[] = [], overrides: Partial<FlowNode> = {}): FlowNode {
  return { id, type: id.replace(/-\d+$/, ''), label: id, status: 'done', next, ...overrides };
}

function scenario() {
  const f = builderFixture({
    '/repo/src/main.ts': 'export const main = true;\n',
    '/repo/review.json': '{}',
    '/repo/observations.json': '[]',
    '/repo/telemetry.json': '[]',
  });
  const scripts: Record<string, ExecResult> = {};
  const state = {
    head: C,
    dirty: '',
    delta: '',
    proofCode: 0,
    branch: 'builder/example',
    conflict: false,
    gate: false,
  };
  const calls = f.exec.calls;
  f.deps.env = new FakeEnv();
  f.fs.mkdirp('/reviewer');
  const doc: FlowDoc = {
    schema_version: 1,
    kind: 'flight-plan',
    slug: 'example',
    created_at: BUILDER_FIXTURE_TIME,
    provenance: {
      record_kind: 'flow',
      harness_version: '0.14.0',
      branch: 'builder/example',
      repo: null,
      created_at: BUILDER_FIXTURE_TIME,
      agent: 'builder',
      plan_id: '001-example',
    },
    events: [],
    nav: { now: 'plan', next: null },
    nodes: [
      node('plan', ['impl-guide']),
      node('impl-guide', ['phase-1']),
      node('phase-1', ['review-1']),
      node('review-1', ['post-flight']),
      node('post-flight', ['ship']),
      node('ship', [], { status: 'known' }),
    ],
    plan_dir: 'docs/plans/001-example',
  };
  f.fs.writeText(FLOW, JSON.stringify(doc));
  const success = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', ok: true });
  const whoami = success(
    JSON.stringify({ ok: true, command: 'pij whoami', v: 2, data: { id: 'peer-pm' } }),
  );
  f.deps.exec = {
    run: async (command: string, args: string[], opts: ExecOptions): Promise<ExecResult> => {
      await f.exec.run(command, args, opts);
      const key = [command, ...args].join(' ');
      if (scripts[key]) return scripts[key];
      if (
        command === f.deps.pij.command &&
        args.join(' ') === [...f.deps.pij.args, 'whoami', '--json'].join(' ')
      )
        return whoami;
      if (command === 'git') {
        const rest = args.slice(2);
        if (rest[0] === 'symbolic-ref')
          return success(
            opts.cwd === '/repo' ? state.branch : `builder/${opts.cwd.split('/').pop()}`,
          );
        if (rest.join(' ') === 'rev-parse HEAD') return success(state.head);
        if (rest.join(' ') === 'rev-parse --show-toplevel') return success(opts.cwd);
        if (rest[0] === 'rev-list')
          return success(rest.includes('--merges') ? '' : opts.cwd.endsWith('tk-0002') ? B : D);
        if (rest[0] === 'diff-tree')
          return success(opts.cwd.endsWith('tk-0002') ? 'src/parser.ts\0' : 'src/renderer.ts\0');
        if (rest[0] === 'diff')
          return success(
            rest.includes('--binary')
              ? ''
              : rest.includes('--no-renames')
                ? state.delta
                : state.dirty,
          );
        if (rest[0] === 'ls-files')
          return success(rest.includes('--others') ? '' : 'contracts.ts\0src/main.ts\0');
        if (rest[0] === 'cherry-pick')
          return state.conflict
            ? { code: 1, stdout: '', stderr: 'CONFLICT in src/main.ts', ok: false }
            : success();
        return success();
      }
      if (args.includes('flow')) {
        const path = args[args.indexOf('--path') + 1] as string;
        const current = JSON.parse(f.fs.readText(path) ?? '{}') as FlowDoc;
        if (args.includes('--now')) {
          if (state.gate)
            return { code: 1, stdout: '', stderr: 'E442 unsatisfied DD gate', ok: false };
          const mutation = setNow(current, args[args.indexOf('--now') + 1] as string, {
            clock: f.clock,
          });
          if (!mutation.ok) return { code: 1, stdout: '', stderr: mutation.message, ok: false };
          f.fs.writeText(path, JSON.stringify(mutation.doc));
          return success(JSON.stringify({ status: 'ok' }));
        }
        return success(JSON.stringify({ status: 'ok', data: { now: current.nav?.now } }));
      }
      if (args.includes('test/integration.mjs'))
        return {
          code: state.proofCode,
          stdout: 'actual integration output',
          stderr: state.proofCode ? 'integration failed' : '',
          ok: state.proofCode === 0,
        };
      return success(JSON.stringify({ status: 'ok' }));
    },
  };
  const context = value(builderContext(f.deps, BUILDER_FIXTURE_PLAN));
  const digest = (path: string) => value(digestBuilderFile(f.deps, path));
  const store = <T extends BuilderRecord>(
    record: T,
    path = builderRecordPath(context, record.record_type),
  ): Stored<T> => value(writeBuilderRecord(f.deps, path, record));
  const baseline = store(
    fixtureBaseline({
      plan: digest(BUILDER_FIXTURE_PLAN),
      guide: digest(BUILDER_FIXTURE_GUIDE),
      files: [digest('contracts.ts')],
    }),
  );
  const deps: CompositionDeps = {
    ...f.deps,
    readiness: async () => ({
      ok: true,
      value: { status: 'ready', issues: [], context, guide: f.guide, baseline },
    }),
  };
  const setFlow = (now: string, extras: FlowNode[] = []) => {
    const next = { ...doc, nav: { now, next: null }, nodes: [...doc.nodes, ...extras] };
    f.fs.writeText(FLOW, JSON.stringify(next));
    return next;
  };
  const review = (
    scope: ReviewReceipt['scope'] = 'decomposition',
    overrides: Partial<ReviewReceipt> = {},
  ) =>
    fixtureReview({
      scope,
      subject_sha: C,
      plan: digest(BUILDER_FIXTURE_PLAN),
      guide: digest(BUILDER_FIXTURE_GUIDE),
      report: digest('review.json'),
      observed: fixtureObservation({
        peer_id: 'peer-reviewer',
        root: '/reviewer',
        model: 'github-copilot/claude-opus-5',
        effort: 'high',
        native_session: 'reviewer-session',
        pid: 200,
      }),
      ...overrides,
    });
  const composition = (overrides: Partial<CompositionReceipt> = {}) => {
    const receipt = fixtureComposition({
      baseline: baseline.ref,
      units: f.guide.composition.order.map((id, index) => ({
        unit_id: id,
        peer_id: `peer-${id}`,
        workspace: `/workers/${id}`,
        commit_sha: index ? D : B,
        packet_sha256: 'a'.repeat(64),
        baseline_sha: A,
      })),
      integration_sha: C,
      artifact_sha: C,
      files: [digest('contracts.ts'), digest('src/main.ts')],
      checks: [
        fixtureCheck({
          id: 'vd-0004',
          command: 'node',
          args: ['test/integration.mjs'],
          cwd: '/repo',
        }),
      ],
      ...overrides,
    });
    // Imported-only evidence omits this optional field before DD validation.
    if (receipt.artifact_sha === undefined) delete receipt.artifact_sha;
    return store(receipt);
  };
  const deliveries = (): UnitDelivery[] =>
    f.guide.units
      .filter((unit) => unit.role === 'coder')
      .map((unit, index) => {
        const key = `${unit.id}-${baseline.value.source_sha}`;
        const root = `/workers/${unit.id}`;
        f.fs.mkdirp(root);
        const observation = fixtureObservation({
          peer_id: `peer-${unit.id}`,
          root,
          native_session: `session-${unit.id}`,
          pid: index + 10,
        });
        const allocationPath = `/repo/authority/${unit.id}.dd.json`;
        const allocation = store(
          fixtureAllocation({
            id: `al-${unit.id}`,
            root,
            branch: `builder/${unit.id}`,
            unit_id: unit.id,
            peer_id: observation.peer_id,
          }),
          allocationPath,
        );
        const allocationRef = { ...allocation.ref, path: allocationPath };
        const packet = store(
          fixturePacket({
            id: `packet-${key}`,
            nonce: `nonce-${unit.id}`,
            unit,
            workspace: root,
            baseline: baseline.ref,
            allocation: allocationRef,
            plan: baseline.value.plan,
            guide: baseline.value.guide,
          }),
          builderRecordPath(context, 'packet', key),
        );
        store(
          fixtureDispatch({
            id: `dispatch-${key}`,
            unit_id: unit.id,
            observed: observation,
            packet: packet.ref,
            allocation: allocationRef,
            baseline: baseline.ref,
            delivery: {
              message_id: 'message',
              outcome: 'queued',
              recorded_at: BUILDER_FIXTURE_TIME,
            },
          }),
          builderRecordPath(context, 'dispatch', key),
        );
        return {
          unit_id: unit.id,
          peer_id: observation.peer_id,
          workspace: root,
          commit_sha: index ? D : B,
          packet_sha256: packet.ref.sha256,
          baseline_sha: A,
        };
      });
  return {
    ...f,
    deps,
    scripts,
    state,
    calls,
    context,
    baseline,
    digest,
    store,
    setFlow,
    review,
    composition,
    deliveries,
    whoami,
  };
}

describe('Builder canonical advancement', () => {
  it('delegates adjacent movement to the existing flow kernel without requiring a future baseline', async () => {
    const s = scenario();
    s.fs.deleteFile(`${TEAM}/baseline.dd.json`);
    const result = await advanceBuilderStage(s.deps, {
      plan: BUILDER_FIXTURE_PLAN,
      now: 'impl-guide',
    });
    expect(result).toMatchObject({ ok: true, value: { now: 'impl-guide' } });
    expect(JSON.parse(s.fs.readText(FLOW) ?? '{}').nav.now).toBe('impl-guide');
    expect(s.calls.some((call) => call.args.includes('--force'))).toBe(false);
  });

  it('rejects non-adjacent movement before mutation', async () => {
    const s = scenario();
    expect(
      await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'post-flight' }),
    ).toMatchObject({ ok: false, code: 'E471' });
    expect(s.calls.some((call) => call.args.includes('--now'))).toBe(false);
  });

  it.each(['known', 'done', 'skipped'])('refuses an unreceipted %s chore', async (status) => {
    const s = scenario();
    s.setFlow('plan', [
      node('backpressure', [], {
        status,
        branch_of: 'plan',
        chore: { kind: 'skill', importance: 'required' },
      }),
    ]);
    expect(
      await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'impl-guide' }),
    ).toMatchObject({ ok: false, code: 'E471' });
    expect(s.calls.some((call) => call.args.includes('--now'))).toBe(false);
  });

  it('accepts only a human-authored decline for a skipped chore', () => {
    const s = scenario();
    const chore = node('backpressure', [], {
      status: 'skipped',
      branch_of: 'plan',
      chore: { kind: 'skill', importance: 'required' },
      comments: [
        { at: BUILDER_FIXTURE_TIME, kind: 'decision', source: 'agent', text: 'not needed' },
      ],
    });
    expect(builderChoresSatisfied(s.setFlow('plan', [chore]), 'plan').ok).toBe(false);
    chore.comments = [
      { at: BUILDER_FIXTURE_TIME, kind: 'decision', source: 'user', text: 'Skip this survey.' },
    ];
    expect(builderChoresSatisfied(s.setFlow('plan', [chore]), 'plan').ok).toBe(true);
  });

  it('preserves the position when the owning DD departure gate refuses', async () => {
    const s = scenario();
    s.state.gate = true;
    expect(
      await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'impl-guide' }),
    ).toMatchObject({ ok: false, code: 'E475' });
    expect(JSON.parse(s.fs.readText(FLOW) ?? '{}').nav.now).toBe('plan');
  });

  it('requires decomposition review before entering implementation but not its future baseline', async () => {
    const s = scenario();
    s.setFlow('impl-guide');
    s.fs.deleteFile(`${TEAM}/baseline.dd.json`);
    expect(
      (await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'phase-1' })).ok,
    ).toBe(false);
    value(await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }));
    expect(
      (await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'phase-1' })).ok,
    ).toBe(true);
  });

  it('does not depart implementation on imported-only evidence', async () => {
    const s = scenario();
    s.setFlow('phase-1');
    s.composition({ artifact_sha: undefined, checks: [] });
    expect(
      await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'review-1' }),
    ).toMatchObject({ ok: false, code: 'E475' });
  });
});

describe('Builder committed composition', () => {
  it.each([
    'unit-only',
    'older-qualified',
    'wrong-source-content',
  ])('refuses %s dispatch evidence without selecting historical records', async (kind) => {
    const s = scenario();
    const deliveries = s.deliveries();
    const current = builderRecordPath(s.context, 'dispatch', `tk-0002-${A}`);
    const original = s.fs.readText(current) as string;
    let retained = current;
    if (kind === 'wrong-source-content') {
      const doc = JSON.parse(original);
      doc.sections[0].value.baseline.sha256 = 'e'.repeat(64);
      s.fs.writeText(current, JSON.stringify(doc));
    } else {
      retained = builderRecordPath(
        s.context,
        'dispatch',
        kind === 'unit-only' ? 'tk-0002' : `tk-0002-${D}`,
      );
      s.fs.writeText(retained, original);
      s.fs.deleteFile(current);
    }
    const retainedBytes = s.fs.readText(retained);
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({
      ok: false,
      code: 'E474',
    });
    expect(s.fs.readText(retained)).toBe(retainedBytes);
    expect(
      s.calls.some((call) => call.args.includes('fetch') || call.args.includes('cherry-pick')),
    ).toBe(false);
  });

  it('does not let a delivery select an older sealed source', async () => {
    const s = scenario();
    const deliveries = s.deliveries();
    (deliveries[0] as UnitDelivery).baseline_sha = D;
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({
      ok: false,
      code: 'E474',
    });
    expect(s.calls.some((call) => call.args.includes('fetch'))).toBe(false);
  });

  it.each([
    'identity',
    'source-sha',
    'baseline-digest',
    'unit',
    'allocation-path',
    'allocation-digest',
  ])('rejects mismatched packet %s even when its digest is rebound', async (kind) => {
    const s = scenario();
    const deliveries = s.deliveries();
    const path = builderRecordPath(s.context, 'packet', `tk-0002-${A}`);
    const doc = JSON.parse(s.fs.readText(path) as string);
    const packet = doc.sections[0].value;
    if (kind === 'identity') packet.id = `packet-tk-0002-${D}`;
    if (kind === 'source-sha') packet.source_sha = D;
    if (kind === 'baseline-digest') packet.baseline.sha256 = 'e'.repeat(64);
    if (kind === 'unit') packet.unit.paths = ['unrelated.ts'];
    if (kind === 'allocation-path') packet.allocation.path = '/repo/authority/other.dd.json';
    if (kind === 'allocation-digest') packet.allocation.sha256 = 'e'.repeat(64);
    const changed = JSON.stringify(doc);
    s.fs.writeText(path, changed);
    const dispatchPath = builderRecordPath(s.context, 'dispatch', `tk-0002-${A}`);
    const dispatch = JSON.parse(s.fs.readText(dispatchPath) as string);
    dispatch.sections[0].value.packet.sha256 = sha256(changed);
    (deliveries[0] as UnitDelivery).packet_sha256 = sha256(changed);
    s.fs.writeText(dispatchPath, JSON.stringify(dispatch));
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E474' });
    expect(
      s.calls.some((call) => call.args.includes('fetch') || call.args.includes('cherry-pick')),
    ).toBe(false);
  });

  it('imports historical packets without source_sha while ignoring malformed old acknowledgement evidence', async () => {
    const s = scenario();
    const deliveries = s.deliveries();
    const retained: string[] = [];
    for (const delivery of deliveries) {
      const key = `${delivery.unit_id}-${A}`;
      const packetPath = builderRecordPath(s.context, 'packet', key);
      const dispatchPath = builderRecordPath(s.context, 'dispatch', key);
      const ackPath = builderRecordPath(s.context, 'ack', key);
      const packet = JSON.parse(s.fs.readText(packetPath) as string);
      packet.dd.schema = 'builder/packet';
      delete packet.sections[0].value.source_sha;
      packet.sections[0].value.canary = { path: '/missing/historical-canary.json' };
      packet.sections[0].value.nonce = 'historical-correlation-only';
      packet.sections[0].value.recorded_at = '2000-01-01T00:00:00.000Z';
      s.fs.writeText(packetPath, JSON.stringify(packet));
      delivery.packet_sha256 = s.digest(packetPath).sha256;
      const dispatch = JSON.parse(s.fs.readText(dispatchPath) as string);
      dispatch.sections[0].value.packet.sha256 = delivery.packet_sha256;
      dispatch.sections[0].value.acknowledgement = { path: ackPath, sha256: '0'.repeat(64) };
      dispatch.sections[0].value.release = {
        message_id: 'historical-queued-release',
        outcome: 'queued',
        recorded_at: '2000-01-01T00:00:00.000Z',
      };
      delete dispatch.sections[0].value.delivery;
      s.fs.writeText(dispatchPath, JSON.stringify(dispatch));
      s.fs.writeText(ackPath, '{malformed historical acknowledgement');
      retained.push(packetPath, dispatchPath, ackPath);
    }
    const before = retained.map((path) => s.fs.readText(path));
    const imported = value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    );
    expect(imported.value.units).toEqual(deliveries);
    expect(
      s.calls
        .filter((call) => call.args.includes('cherry-pick'))
        .map((call) => call.args[call.args.length - 1]),
    ).toEqual([B, D]);
    expect(retained.map((path) => s.fs.readText(path))).toEqual(before);
  });

  it.each(['packet', 'allocation'])('rejects changed %s bytes before importing', async (kind) => {
    const s = scenario();
    const deliveries = s.deliveries();
    const path =
      kind === 'packet'
        ? builderRecordPath(s.context, 'packet', `tk-0002-${A}`)
        : '/repo/authority/tk-0002.dd.json';
    s.fs.writeText(path, `${s.fs.readText(path)}\n`);
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E474' });
    expect(
      s.calls.some((call) => call.args.includes('fetch') || call.args.includes('cherry-pick')),
    ).toBe(false);
    expect(s.fs.exists(builderRecordPath(s.context, 'composition'))).toBe(false);
  });

  it.each([
    'source',
    'peer',
    'root',
    'unit',
    'retired',
  ])('rejects forged allocation %s even with matching packet and dispatch digests', async (kind) => {
    const s = scenario();
    const deliveries = s.deliveries();
    const path = '/repo/authority/tk-0002.dd.json';
    const doc = JSON.parse(s.fs.readText(path) as string);
    const allocation = doc.sections[0].value;
    if (kind === 'source') allocation.base_sha = D;
    if (kind === 'peer') allocation.peer_id = 'different-peer';
    if (kind === 'root') allocation.root = '/different-root';
    if (kind === 'unit') allocation.unit_id = 'tk-0003';
    if (kind === 'retired') allocation.retired_at = BUILDER_FIXTURE_TIME;
    s.fs.writeText(path, JSON.stringify(doc));
    const packetPath = builderRecordPath(s.context, 'packet', `tk-0002-${A}`);
    const packet = JSON.parse(s.fs.readText(packetPath) as string);
    packet.sections[0].value.allocation.sha256 = s.digest(path).sha256;
    s.fs.writeText(packetPath, JSON.stringify(packet));
    const dispatchPath = builderRecordPath(s.context, 'dispatch', `tk-0002-${A}`);
    const dispatch = JSON.parse(s.fs.readText(dispatchPath) as string);
    dispatch.sections[0].value.allocation.sha256 = s.digest(path).sha256;
    dispatch.sections[0].value.packet.sha256 = s.digest(packetPath).sha256;
    (deliveries[0] as UnitDelivery).packet_sha256 = s.digest(packetPath).sha256;
    s.fs.writeText(dispatchPath, JSON.stringify(dispatch));
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E474' });
    expect(
      s.calls.some((call) => call.args.includes('fetch') || call.args.includes('cherry-pick')),
    ).toBe(false);
  });

  it('rejects a native dispatch runtime that differs from the bound packet request', async () => {
    const s = scenario();
    const deliveries = s.deliveries();
    const path = builderRecordPath(s.context, 'dispatch', `tk-0002-${A}`);
    const doc = JSON.parse(s.fs.readText(path) as string);
    doc.sections[0].value.observed.model = 'different-model';
    s.fs.writeText(path, JSON.stringify(doc));
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E474' });
    expect(
      s.calls.some((call) => call.args.includes('fetch') || call.args.includes('cherry-pick')),
    ).toBe(false);
  });

  it.each([
    ['root', 'rev-parse --show-toplevel', '/different-root'],
    ['branch', 'symbolic-ref --quiet --short HEAD', 'builder/different-branch'],
    ['ancestry', `merge-base --is-ancestor ${A} ${B}`, ''],
  ])('rejects wrong actual Git %s before any import', async (kind, command, stdout) => {
    const s = scenario();
    const deliveries = s.deliveries();
    s.scripts[`git -c core.hooksPath= ${command}`] = {
      code: kind === 'ancestry' ? 1 : 0,
      stdout,
      stderr: '',
      ok: kind !== 'ancestry',
    };
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: kind === 'ancestry' ? 'E475' : 'E477' });
    expect(
      s.calls.some((call) => call.args.includes('fetch') || call.args.includes('cherry-pick')),
    ).toBe(false);
  });

  it('imports each coder once without acknowledgement or release despite queued transport, then advances after verification', async () => {
    const s = scenario();
    const deliveries = s.deliveries().reverse();
    const result = value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    );
    expect(result.value.units.map((unit) => unit.unit_id)).toEqual(['tk-0002', 'tk-0003']);
    expect(s.fs.exists(builderRecordPath(s.context, 'ack', `tk-0002-${A}`))).toBe(false);
    expect(result.value.artifact_sha).toBeUndefined();
    expect(result.value.checks).toEqual([]);
    expect(
      s.calls
        .filter((call) => call.args.includes('cherry-pick'))
        .map((call) => call.args[call.args.length - 1]),
    ).toEqual([B, D]);
    expect(s.calls.some((call) => call.args.includes('test/integration.mjs'))).toBe(false);
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E472' });
    value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    );
    s.setFlow('phase-1');
    expect(
      await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'review-1' }),
    ).toMatchObject({ ok: true, value: { now: 'review-1' } });
  });

  it.each([
    'duplicate',
    'missing',
    'wrong-baseline',
    'wrong-peer',
    'wrong-packet',
    'wrong-workspace',
  ])('rejects %s deliveries before any import', async (kind) => {
    const s = scenario();
    const deliveries = s.deliveries();
    if (kind === 'duplicate') deliveries[1] = deliveries[0] as UnitDelivery;
    if (kind === 'missing') deliveries.pop();
    if (kind === 'wrong-baseline') (deliveries[0] as UnitDelivery).baseline_sha = D;
    if (kind === 'wrong-peer') (deliveries[0] as UnitDelivery).peer_id = 'someone-else';
    if (kind === 'wrong-packet') (deliveries[0] as UnitDelivery).packet_sha256 = '0'.repeat(64);
    if (kind === 'wrong-workspace') (deliveries[0] as UnitDelivery).workspace = '/someone-else';
    expect(
      (
        await composeBuilderUnits(s.deps, {
          plan: BUILDER_FIXTURE_PLAN,
          mode: 'import',
          deliveries,
        })
      ).ok,
    ).toBe(false);
    expect(s.calls.some((call) => call.args.includes('cherry-pick'))).toBe(false);
  });

  it('rejects out-of-fence history even when the final tree could hide it', async () => {
    const s = scenario();
    const deliveries = s.deliveries();
    s.scripts[
      `git -c core.hooksPath= diff-tree --no-commit-id --name-only --no-renames -r -z ${B}`
    ] = { code: 0, stdout: 'unrelated.ts\0', stderr: '', ok: true };
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E477' });
    expect(s.calls.some((call) => call.args.includes('cherry-pick'))).toBe(false);
  });

  it('keeps conflict state visible and never resets or records completed composition', async () => {
    const s = scenario();
    const deliveries = s.deliveries();
    s.state.conflict = true;
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    ).toMatchObject({ ok: false, code: 'E472' });
    expect(s.fs.exists(`${TEAM}/composition.dd.json`)).toBe(false);
    expect(
      s.calls.some((call) => call.args.some((arg) => ['reset', '--abort', 'push'].includes(arg))),
    ).toBe(false);
  });

  it('runs guide proof only for the exact clean committed HEAD', async () => {
    const s = scenario();
    s.composition({ artifact_sha: undefined, checks: [] });
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: B }),
    ).toMatchObject({ ok: false, code: 'E475' });
    s.state.dirty = 'src/main.ts\0';
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    ).toMatchObject({ ok: false, code: 'E475' });
    s.state.dirty = '';
    const result = value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    );
    expect(result.value.artifact_sha).toBe(C);
    expect(result.value.checks).toMatchObject([
      { id: 'vd-0004', exit_code: 0, stdout: 'actual integration output' },
    ]);
    expect(result.value.files.map((file) => file.path)).toEqual(['contracts.ts', 'src/main.ts']);
  });

  it('persists red check evidence but refuses completion', async () => {
    const s = scenario();
    s.composition({ artifact_sha: undefined, checks: [] });
    s.state.proofCode = 1;
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    ).toMatchObject({ ok: false, code: 'E475' });
    const stored = value(
      readBuilderRecord<CompositionReceipt>(s.deps, `${TEAM}/composition.dd.json`, 'composition'),
    );
    expect(stored.value.checks[0]).toMatchObject({ exit_code: 1, stderr: 'integration failed' });
    expect((await verifyBuilderComposition(s.deps, s.context, s.guide)).ok).toBe(false);
  });

  it('warns on PM map deviations and still executes proof, retaining warnings across retries', async () => {
    /*
    Test Doc:
    - Why: a PM integration touching worker files used to stop before real checks.
    - Contract: mapped and unmapped files warn; verify refreshes its own observations
      without discarding import warnings or disguising a genuinely failing check.
    - Usage Notes: injected Git deltas exercise comparison branches, not real ancestry.
    - Quality Contribution: catches ownership vetoes, stale retry warnings and lost red evidence.
    */
    const s = scenario();
    const importWarning = {
      file: 'bootstrap.ts',
      owning_unit: 'unmapped',
      stage: 'import' as const,
    };
    s.composition({ artifact_sha: undefined, checks: [], warnings: [importWarning] });
    s.state.delta = 'src/parser.ts\0extra.ts\0';
    const result = value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    );
    expect(result.value.warnings).toEqual([
      importWarning,
      { file: 'src/parser.ts', owning_unit: 'tk-0002', stage: 'verify' },
      { file: 'extra.ts', owning_unit: 'unmapped', stage: 'verify' },
    ]);
    expect(result.value.checks).toMatchObject([
      { exit_code: 0, stdout: 'actual integration output' },
    ]);
    s.state.delta = 'src/parser.ts\0';
    s.state.proofCode = 1;
    expect(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    ).toMatchObject({ ok: false, code: 'E475' });
    const red = value(
      readBuilderRecord<CompositionReceipt>(s.deps, `${TEAM}/composition.dd.json`, 'composition'),
    );
    expect(red.value.warnings).toEqual([
      importWarning,
      { file: 'src/parser.ts', owning_unit: 'tk-0002', stage: 'verify' },
    ]);
    expect(red.value.checks[0]).toMatchObject({ exit_code: 1, stderr: 'integration failed' });
  });

  it('records PM warnings during import without blocking valid deliveries or independent review', async () => {
    /*
    Test Doc:
    - Why: the same PM comparison also runs before import and must not retain a veto there.
    - Contract: import records mapped warnings, a clean verify retains them, and an
      independent reviewer can record approval with those observations still present.
    - Usage Notes: native review identity is the existing injected fixture, not a live peer.
    - Quality Contribution: catches a one-callsite-only fix or an implicit warning review gate.
    */
    const s = scenario();
    const deliveries = s.deliveries();
    s.state.delta = 'src/parser.ts\0';
    const imported = value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'import', deliveries }),
    );
    expect(imported.value.warnings).toEqual([
      { file: 'src/parser.ts', owning_unit: 'tk-0002', stage: 'import' },
    ]);
    s.state.delta = '';
    value(
      await composeBuilderUnits(s.deps, { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: C }),
    );
    expect(
      (
        await recordBuilderReview(s.deps, {
          plan: BUILDER_FIXTURE_PLAN,
          receipt: s.review('composition'),
        })
      ).ok,
    ).toBe(true);
    expect(
      value(await verifyBuilderComposition(s.deps, s.context, s.guide)).value.warnings,
    ).toEqual(imported.value.warnings);
  });

  it('never imports or verifies on main', async () => {
    const s = scenario();
    s.state.branch = 'main';
    expect(
      await composeBuilderUnits(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        mode: 'import',
        deliveries: [],
      }),
    ).toMatchObject({ ok: false, code: 'E477' });
    expect(s.calls.some((call) => call.args.includes('fetch'))).toBe(false);
  });

  it('invalidates stale source bytes and post-proof code commits', async () => {
    const s = scenario();
    s.composition();
    s.fs.writeText('/repo/src/main.ts', 'changed');
    expect((await verifyBuilderComposition(s.deps, s.context, s.guide)).ok).toBe(false);
    s.fs.writeText('/repo/src/main.ts', 'export const main = true;\n');
    s.state.head = D;
    s.state.delta = 'src/new.ts\0';
    expect((await verifyBuilderComposition(s.deps, s.context, s.guide)).ok).toBe(false);
  });
});

describe('Builder caller identity transport', () => {
  const v2 = (id: unknown = 'caller-owner') => ({
    ok: true,
    command: 'pij whoami',
    v: 2,
    data: { id },
  });
  const reply = (s: ReturnType<typeof scenario>, stdout: string, code = 0) => {
    s.scripts[[s.deps.pij.command, ...s.deps.pij.args, 'whoami', '--json'].join(' ')] = {
      code,
      ok: code === 0,
      stdout,
      stderr: code ? 'E-NOID missing caller context' : '',
    };
  };

  it('records and re-observes review through the default v2 caller identity envelope', async () => {
    const s = scenario();
    expect(s.deps.env.get('PIJ_SESSION_ID')).toBeUndefined();
    const saved = value(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    );
    expect(
      value(await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ref,
    ).toEqual(saved.ref);
    expect(s.calls.some((call) => call.args.includes('whoami'))).toBe(true);
  });

  it('excludes the actual nested caller identity rather than a conflicting root id', async () => {
    const s = scenario();
    const receipt = s.review();
    reply(s, JSON.stringify({ ...v2(receipt.reviewer_id), id: 'not-the-caller' }));
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    ).toMatchObject({ ok: false, code: 'E475' });
    expect(s.fs.exists(builderRecordPath(s.context, 'review', `decomposition-${receipt.id}`))).toBe(
      false,
    );
  });

  it.each([
    ['malformed JSON', '{'],
    ['non-object payload', 'null'],
    ['unsupported version', JSON.stringify({ ...v2(), v: 3 })],
    ['wrong command', JSON.stringify({ ...v2(), command: 'pij list' })],
    [
      'missing success marker',
      JSON.stringify({ command: 'pij whoami', v: 2, data: { id: 'caller-owner' } }),
    ],
    [
      'error envelope with identity',
      JSON.stringify({ ...v2(), ok: false, error: { code: 'E-NOID' }, id: 'caller-owner' }),
    ],
    ['contradictory success and error', JSON.stringify({ ...v2(), error: { code: 'E-NOID' } })],
    ['absent data', JSON.stringify({ ok: true, command: 'pij whoami', v: 2, id: 'caller-owner' })],
    ['array data', JSON.stringify({ ...v2(), data: [] })],
    ['absent identity', JSON.stringify({ ...v2(), data: {} })],
    ['non-string identity', JSON.stringify(v2(123))],
    ['empty identity', JSON.stringify(v2(''))],
    ['padded identity', JSON.stringify(v2(' caller-owner '))],
    ['flat identity on default transport', JSON.stringify({ id: 'caller-owner' })],
  ])('refuses %s despite a zero transport exit', async (_name, stdout) => {
    const s = scenario();
    const receipt = s.review();
    reply(s, stdout);
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    ).toMatchObject({ ok: false, code: 'E473', next_action: expect.any(String) });
    expect(s.fs.exists(builderRecordPath(s.context, 'review', `decomposition-${receipt.id}`))).toBe(
      false,
    );
  });

  it('preserves a nonzero caller-context failure rather than treating it as a decoding success', async () => {
    const s = scenario();
    reply(s, JSON.stringify(v2()), 1);
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    ).toMatchObject({
      ok: false,
      code: 'E475',
      details: { code: 1, stderr: 'E-NOID missing caller context' },
    });
  });

  it.each([
    'pij',
    '/tools/pij',
    'C:\\Tools\\pij.cmd',
  ])('supports a flat identity only for configured public wrapper %s', async (command) => {
    const s = scenario();
    s.deps.pij = { command, args: [] };
    reply(
      s,
      JSON.stringify({
        id: 'wrapper-owner',
        folder: '/repo',
        dataDir: '/registry',
        state: 'idle',
        pid: 100,
        capabilitySchema: 2,
        verbs: {},
      }),
    );
    expect(
      (await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() })).ok,
    ).toBe(true);
  });

  it('does not guess a flat identity contract for another configured executable', async () => {
    const s = scenario();
    s.deps.pij = { command: '/tools/other-identity', args: [] };
    reply(s, JSON.stringify({ id: 'caller-owner' }));
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    ).toMatchObject({ ok: false, code: 'E473' });
  });

  it('does not reinterpret a failed versioned response as a flat wrapper identity', async () => {
    const s = scenario();
    s.deps.pij = { command: 'pij', args: [] };
    reply(s, JSON.stringify({ ...v2(), ok: false, id: 'caller-owner' }));
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    ).toMatchObject({ ok: false, code: 'E473' });
  });

  it.each([
    ['independent', 'explicit-owner', true],
    ['self-review', 'peer-reviewer', false],
  ] as const)('preserves the explicit environment path for %s caller identity', async (_name, caller, approved) => {
    const s = scenario();
    s.deps.env = new FakeEnv({ PIJ_SESSION_ID: caller });
    reply(s, '', 1);
    const result = await recordBuilderReview(s.deps, {
      plan: BUILDER_FIXTURE_PLAN,
      receipt: s.review(),
    });
    if (approved) expect(result.ok).toBe(true);
    else expect(result).toMatchObject({ ok: false, code: 'E475' });
    expect(s.calls.some((call) => call.args.includes('whoami'))).toBe(false);
  });
});

describe('Builder independent review', () => {
  const nextReviewTime = new Date(Date.parse(BUILDER_FIXTURE_TIME) + 1000).toISOString();

  it('preserves the original sealed review while selecting a revised guide review by timestamp instant', async () => {
    const s = scenario();
    const original = s.store(
      s.review('decomposition', {
        id: 'original-review',
        recorded_at: '2026-09-05T11:30:00+02:00',
      }),
      builderRecordPath(s.context, 'review', 'decomposition'),
    );
    const seal = s.store(
      fixtureBaseline({ ...s.baseline.value, id: 'original-seal', review: original.ref }),
      builderRecordPath(s.context, 'baseline', 'original'),
    );
    const originalPath = `${TEAM}/review-decomposition.dd.json`;
    const originalBytes = s.fs.readText(originalPath);
    const originalFace = s.fs.readText(`${TEAM}/review-decomposition.dd.md`);
    const sealBytes = s.fs.readText(`/repo/${seal.ref.path}`);
    expect(
      value(await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ref,
    ).toEqual(original.ref);
    const guide = JSON.parse(s.fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`) as string);
    guide.sections
      .find((section: { name: string }) => section.name === 'units')
      .value.find((unit: { role: string }) => unit.role === 'pm')
      .paths.push('src/c4-integration.ts');
    s.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, JSON.stringify(guide));
    s.setFlow('impl-guide');
    expect(
      (await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'phase-1' })).ok,
    ).toBe(false);
    const receipt = s.review('decomposition', {
      id: 'c4-review',
      recorded_at: '2026-09-05T10:00:00Z',
    });
    const revised = value(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    );
    expect(revised.ref.path).toMatch(/\/review-decomposition-c4-review\.dd\.json$/);
    expect(revised.ref.sha256).not.toBe(original.ref.sha256);
    const currentGuide = value(loadBuilderGuide(s.deps, BUILDER_FIXTURE_PLAN)).guide.value;
    expect(
      value(await verifyBuilderReview(s.deps, s.context, currentGuide, 'decomposition')).ref,
    ).toEqual(revised.ref);
    expect(
      (await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'phase-1' })).ok,
    ).toBe(true);
    const revisedBytes = s.fs.readText(`/repo/${revised.ref.path}`);
    expect(
      value(await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt })).ref,
    ).toEqual(revised.ref);
    expect(s.fs.readText(`/repo/${revised.ref.path}`)).toBe(revisedBytes);
    expect(s.fs.readText(originalPath)).toBe(originalBytes);
    expect(s.fs.readText(`${TEAM}/review-decomposition.dd.md`)).toBe(originalFace);
    expect(s.fs.readText(`/repo/${seal.ref.path}`)).toBe(sealBytes);
    expect(s.digest(original.ref.path)).toEqual(original.ref);
  });

  it.each([
    'older',
    'equal-offset',
    'identity',
    'timestamp',
    'claim',
  ])('refuses %s publication without changing the current review', async (kind) => {
    const s = scenario();
    const original = value(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    );
    const originalBytes = s.fs.readText(`/repo/${original.ref.path}`);
    const receipt = s.review('decomposition', { id: 'next-review', recorded_at: nextReviewTime });
    if (kind === 'older')
      receipt.recorded_at = new Date(Date.parse(BUILDER_FIXTURE_TIME) - 1000).toISOString();
    if (kind === 'equal-offset')
      receipt.recorded_at = new Date(Date.parse(BUILDER_FIXTURE_TIME) + 3600000)
        .toISOString()
        .replace('Z', '+01:00');
    if (kind === 'identity') receipt.id = original.value.id;
    if (kind === 'timestamp') receipt.recorded_at = 'not-an-instant';
    const lock = `${builderRecordPath(s.context, 'review', 'decomposition')}.publish.lock`;
    if (kind === 'claim') expect(s.fs.createExclusive(lock, 'other-publisher')).toBe(true);
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    ).toMatchObject({
      ok: false,
      code:
        kind === 'identity' || kind === 'claim' ? 'E472' : kind === 'timestamp' ? 'E470' : 'E475',
    });
    expect(s.fs.readText(`/repo/${original.ref.path}`)).toBe(originalBytes);
    expect(s.fs.exists(builderRecordPath(s.context, 'review', 'decomposition-next-review'))).toBe(
      false,
    );
    expect(
      value(await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ref,
    ).toEqual(original.ref);
    if (kind === 'claim') expect(s.fs.readText(lock)).toBe('other-publisher');
  });

  it.each([
    ['decomposition', 'blocked'],
    ['decomposition', 'stale-report'],
    ['composition', 'blocked'],
    ['composition', 'stale-report'],
  ] as const)('does not fall back from a newest %s %s review', async (scope, failure) => {
    const s = scenario();
    if (scope === 'composition') s.composition();
    const original = value(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review(scope) }),
    );
    s.fs.writeText('/repo/later-review.json', 'independent later report');
    const receipt = s.review(scope, {
      id: 'later-review',
      recorded_at: nextReviewTime,
      report: s.digest('later-review.json'),
      verdict: failure === 'blocked' ? 'blocked' : 'approved',
    });
    value(await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }));
    if (failure === 'stale-report')
      s.fs.writeText('/repo/later-review.json', 'changed after review');
    expect(await verifyBuilderReview(s.deps, s.context, s.guide, scope)).toMatchObject({
      ok: false,
      code: 'E475',
    });
    s.setFlow(scope === 'decomposition' ? 'impl-guide' : 'review-1');
    expect(
      await advanceBuilderStage(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        now: scope === 'decomposition' ? 'phase-1' : 'post-flight',
      }),
    ).toMatchObject({ ok: false, code: 'E475' });
    if (scope === 'composition') {
      s.setFlow('post-flight');
      expect(
        await closeBuilderPlan(s.deps, {
          plan: BUILDER_FIXTURE_PLAN,
          survivor: '/survivor',
          allocations: [],
          evidence: [],
        }),
      ).toMatchObject({ ok: false, code: 'E475' });
    }
    expect(s.digest(original.ref.path)).toEqual(original.ref);
  });

  it.each([
    'timestamp-tie',
    'identity',
    'malformed',
    'unreadable',
  ])('refuses ambiguous %s history instead of selecting an older approval', async (kind) => {
    const s = scenario();
    const original = value(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    );
    const conflicting = s.store(
      s.review('decomposition', {
        id: kind === 'identity' ? original.value.id : 'conflicting-review',
        recorded_at: kind === 'timestamp-tie' ? BUILDER_FIXTURE_TIME : nextReviewTime,
      }),
      builderRecordPath(s.context, 'review', 'conflicting-history'),
    );
    if (kind === 'malformed') s.fs.writeText(`/repo/${conflicting.ref.path}`, '{broken JSON');
    if (kind === 'unreadable') s.fs.nonRegularPaths.add(`/repo/${conflicting.ref.path}`);
    expect((await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ok).toBe(false);
    const resolved = s.review('decomposition', {
      id: 'resolved-review',
      recorded_at: new Date(Date.parse(nextReviewTime) + 1000).toISOString(),
    });
    const publication = await recordBuilderReview(s.deps, {
      plan: BUILDER_FIXTURE_PLAN,
      receipt: resolved,
    });
    if (kind === 'timestamp-tie') {
      expect(
        value(await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ref,
      ).toEqual(value(publication).ref);
      expect(s.digest(conflicting.ref.path)).toEqual(conflicting.ref);
    } else expect(publication.ok).toBe(false);
    expect(s.digest(original.ref.path)).toEqual(original.ref);
  });

  it('serializes competing attempts before either can claim the same current instant', async () => {
    const s = scenario();
    value(await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }));
    const receipts = ['first-review', 'second-review'].map((id) =>
      s.review('decomposition', { id, recorded_at: nextReviewTime }),
    );
    const results = await Promise.all(
      receipts.map((receipt) =>
        recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
      ),
    );
    expect(results[0]?.ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, code: 'E472' });
    expect(
      value(await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).value.id,
    ).toBe('first-review');
    expect(s.fs.exists(builderRecordPath(s.context, 'review', 'decomposition-second-review'))).toBe(
      false,
    );
  });

  it.each([
    'peer',
    'session',
    'pid',
  ])('excludes historical implementation %s identity without a new baseline', async (binding) => {
    const s = scenario();
    s.fs.deleteFile(`${TEAM}/baseline.dd.json`);
    const previous = fixtureObservation({
      peer_id: binding === 'peer' ? 'peer-reviewer' : 'retired-worker',
      native_session: binding === 'session' ? 'reviewer-session' : 'retired-session',
      pid: binding === 'pid' ? 200 : 99,
    });
    s.store(
      fixtureDispatch({
        id: `dispatch-retired-unit-${D}`,
        unit_id: 'retired-unit',
        observed: previous,
      }),
      builderRecordPath(s.context, 'dispatch', `retired-unit-${D}`),
    );
    const receipt = s.review();
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    ).toMatchObject({ ok: false, code: 'E475' });
    expect(s.fs.exists(builderRecordPath(s.context, 'review', `decomposition-${receipt.id}`))).toBe(
      false,
    );
  });

  it('excludes an acknowledged historical implementation identity even without a dispatch file', async () => {
    const s = scenario();
    s.fs.deleteFile(`${TEAM}/baseline.dd.json`);
    s.store(
      fixtureAck({
        id: `ack-retired-unit-${D}`,
        unit_id: 'retired-unit',
        peer_id: 'peer-reviewer',
        baseline_sha: D,
        observed: fixtureObservation({
          peer_id: 'peer-reviewer',
          native_session: 'old-session',
          pid: 99,
        }),
      }),
      builderRecordPath(s.context, 'ack', `retired-unit-${D}`),
    );
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }),
    ).toMatchObject({ ok: false, code: 'E475' });
  });

  it('refuses review when historical records cannot be safely enumerated', async () => {
    const s = scenario();
    s.fs.nonRegularPaths.add(`${TEAM}/unreadable-history`);
    const receipt = s.review();
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    ).toMatchObject({ ok: false, code: 'E475' });
    expect(s.fs.exists(builderRecordPath(s.context, 'review', `decomposition-${receipt.id}`))).toBe(
      false,
    );
  });

  it('records negative findings honestly without allowing review completion', async () => {
    const s = scenario();
    const receipt = s.review('decomposition', {
      verdict: 'changes-requested',
      findings: [
        { id: 'F1', severity: 'high', description: 'Broken contract', disposition: 'open' },
      ],
    });
    expect((await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt })).ok).toBe(
      true,
    );
    expect(await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).toMatchObject({
      ok: false,
      code: 'E475',
    });
  });

  it.each([
    'pm',
    'material',
    'subject',
    'basis',
    'report',
  ])('rejects invalid %s review evidence', async (kind) => {
    const s = scenario();
    const receipt = s.review();
    if (kind === 'pm') {
      receipt.reviewer_id = 'peer-pm';
      receipt.observed.peer_id = 'peer-pm';
    }
    if (kind === 'material')
      receipt.findings = [
        { id: 'F1', severity: 'medium', description: 'Unresolved', disposition: 'open' },
      ];
    if (kind === 'subject') receipt.subject_sha = B;
    if (kind === 'basis') receipt.plan.sha256 = '0'.repeat(64);
    if (kind === 'report') receipt.report.sha256 = '0'.repeat(64);
    expect((await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt })).ok).toBe(
      false,
    );
    expect(s.fs.exists(builderRecordPath(s.context, 'review', `decomposition-${receipt.id}`))).toBe(
      false,
    );
  });

  it('rejects an implementation peer even with a different display name', async () => {
    const s = scenario();
    s.deliveries();
    const receipt = s.review();
    receipt.observed.native_session = 'session-tk-0002';
    expect(
      await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }),
    ).toMatchObject({ ok: false, code: 'E475' });
  });

  it('permits factual progress without relabelling historical review inputs', async () => {
    const s = scenario();
    const receipt = s.review();
    const saved = value(await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt }));
    const plan = JSON.parse(s.fs.readText(`/repo/${BUILDER_FIXTURE_PLAN}`) ?? '{}');
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.status =
      'in-progress';
    s.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect((await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ok).toBe(true);
    expect(
      value(readBuilderRecord<ReviewReceipt>(s.deps, saved.ref.path, 'review')).value.plan.sha256,
    ).toBe(receipt.plan.sha256);
    plan.sections.find((section: { name: string }) => section.name === 'meta').value.title =
      'Different intent';
    s.fs.writeText(`/repo/${BUILDER_FIXTURE_PLAN}`, JSON.stringify(plan));
    expect((await verifyBuilderReview(s.deps, s.context, s.guide, 'decomposition')).ok).toBe(false);
  });

  it('does not allow changed guide architecture through the progress exception', async () => {
    const s = scenario();
    value(await recordBuilderReview(s.deps, { plan: BUILDER_FIXTURE_PLAN, receipt: s.review() }));
    const doc = JSON.parse(s.fs.readText(`/repo/${BUILDER_FIXTURE_GUIDE}`) ?? '{}');
    doc.sections.find(
      (section: { name: string }) => section.name === 'architecture',
    ).value.principles = 'Completely different architecture';
    s.fs.writeText(`/repo/${BUILDER_FIXTURE_GUIDE}`, JSON.stringify(doc));
    expect(
      (
        await verifyBuilderBasis(s.deps, s.context, {
          source_sha: C,
          plan: s.baseline.value.plan,
          guide: s.baseline.value.guide,
        })
      ).ok,
    ).toBe(false);
  });
});

describe('Builder closeout and preservation refusal boundaries', () => {
  it('rejects closeout before post-flight without archiving or authorizing shipping', async () => {
    const s = scenario();
    s.composition();
    value(
      await recordBuilderReview(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        receipt: s.review('composition'),
      }),
    );
    const result = await closeBuilderPlan(s.deps, {
      plan: BUILDER_FIXTURE_PLAN,
      survivor: '/survivor',
      allocations: [],
      evidence: [],
    });
    expect(result).toMatchObject({ ok: false, code: 'E471' });
    expect(s.fs.renames.some((rename) => rename.startsWith(`${PLAN}->`))).toBe(false);
    expect(s.calls.some((call) => call.args.includes('push'))).toBe(false);
  });

  it('rejects a false allocation value even when its file digest is genuine', async () => {
    const s = scenario();
    s.composition();
    value(
      await recordBuilderReview(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        receipt: s.review('composition'),
      }),
    );
    s.setFlow('post-flight');
    const allocation = s.store(fixtureAllocation(), '/repo/authority/unit.dd.json');
    allocation.value = { ...allocation.value, root: '/someone-else' };
    expect(
      await closeBuilderPlan(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        survivor: '/survivor',
        allocations: [allocation],
        evidence: [],
      }),
    ).toMatchObject({ ok: false, code: 'E477' });
  });

  it('rejects missing and altered surviving evidence and mismatched Git refs', async () => {
    const s = scenario();
    const receipt = fixturePreservation();
    s.fs.mkdirp('/workers/example');
    s.fs.mkdirp('/survivor/example');
    expect((await verifyBuilderPreservation(s.deps, receipt)).ok).toBe(false);
    s.fs.writeText('/workers/example/report.json', '{}');
    s.fs.writeText('/survivor/example/report.json', '{}');
    receipt.refs[0] = {
      source_repo: '/workers/example',
      source_ref: 'HEAD',
      oid: A,
      destination_repo: '/survivor/example/git',
      destination_ref: 'refs/preserved',
    };
    s.fs.mkdirp('/survivor/example/git');
    expect((await verifyBuilderPreservation(s.deps, receipt)).ok).toBe(false);
    s.scripts['git -c core.hooksPath= rev-parse --verify refs/preserved'] = {
      code: 0,
      stdout: A,
      stderr: '',
      ok: true,
    };
    s.scripts['git -c core.hooksPath= rev-parse --verify HEAD'] = {
      code: 0,
      stdout: A,
      stderr: '',
      ok: true,
    };
    expect((await verifyBuilderPreservation(s.deps, receipt)).ok).toBe(true);
    s.fs.writeText('/survivor/example/report.json', 'corrupt');
    expect((await verifyBuilderPreservation(s.deps, receipt)).ok).toBe(false);
  });

  it('rejects a survivor inside the removable source even with intact bytes', async () => {
    const s = scenario();
    const receipt = fixturePreservation({ survivor_root: '/workers/example/archive' });
    s.fs.mkdirp('/workers/example');
    s.fs.mkdirp('/workers/example/archive');
    expect(await verifyBuilderPreservation(s.deps, receipt)).toMatchObject({
      ok: false,
      code: 'E476',
    });
  });

  it('replays the named WIP recipe and rejects a later edit before teardown', async () => {
    const s = scenario();
    s.fs.mkdirp('/workers/example');
    s.fs.mkdirp('/survivor/example/git');
    s.fs.writeText('/survivor/example/work.patch', 'first diff');
    const receipt = fixturePreservation({
      inventory: [
        {
          source: 'git-diff:/workers/example#working-tree',
          destination: '/survivor/example/work.patch',
          bytes: 10,
          sha256: sha256('first diff'),
          category: 'wip',
        },
      ],
      refs: [
        {
          source_repo: '/workers/example',
          source_ref: 'HEAD',
          oid: A,
          destination_repo: '/survivor/example/git',
          destination_ref: 'refs/preserved',
        },
      ],
    });
    s.scripts['git -c core.hooksPath= rev-parse --verify HEAD'] = {
      code: 0,
      stdout: A,
      stderr: '',
      ok: true,
    };
    s.scripts['git -c core.hooksPath= rev-parse --verify refs/preserved'] = {
      code: 0,
      stdout: A,
      stderr: '',
      ok: true,
    };
    s.scripts['git -c core.hooksPath= diff --binary'] = {
      code: 0,
      stdout: 'first diff',
      stderr: '',
      ok: true,
    };
    expect((await verifyBuilderPreservation(s.deps, receipt)).ok).toBe(true);
    s.scripts['git -c core.hooksPath= diff --binary'] = {
      code: 0,
      stdout: 'later diff',
      stderr: '',
      ok: true,
    };
    expect(await verifyBuilderPreservation(s.deps, receipt)).toMatchObject({
      ok: false,
      code: 'E476',
    });
  });
});

describe('Builder preservation locator semantics', () => {
  it('does not treat a locator without a verified external receipt as completed closeout', async () => {
    const s = scenario();
    s.composition();
    value(
      await recordBuilderReview(s.deps, {
        plan: BUILDER_FIXTURE_PLAN,
        receipt: s.review('composition'),
      }),
    );
    const doc = s.setFlow('post-flight');
    const closing = doc.nodes.find((row) => row.id === 'post-flight') as FlowNode;
    closing.comments = [
      {
        kind: 'builder-preservation',
        text: '/survivor/missing.dd.json',
        at: BUILDER_FIXTURE_TIME,
        source: 'agent',
      },
    ];
    s.fs.writeText(FLOW, JSON.stringify(doc));
    expect(
      (await advanceBuilderStage(s.deps, { plan: BUILDER_FIXTURE_PLAN, now: 'ship' })).ok,
    ).toBe(false);
    expect(s.calls.some((call) => call.args.includes('--now'))).toBe(false);
  });
});

describe('Builder archival through real filesystem and local Git adapters', () => {
  it('refuses unsafe aliases and missing evidence, then archives and preserves the full final workspace', async () => {
    const fs = new NodeFs();
    const exec = new NodeExec();
    const temporary = toPosix(fs.realpath(fs.mkdtemp('builder-close-')) as string);
    const repo = posixJoin(temporary, 'repo');
    const authority = posixJoin(temporary, 'authority');
    const reviewer = posixJoin(temporary, 'reviewer');
    const fixture = scenario();
    const calls: string[][] = [];
    try {
      fs.mkdirp(repo);
      fs.mkdirp(authority);
      fs.mkdirp(reviewer);
      for (const file of fixture.fs.listRegularFilesNoFollow('/repo') ?? []) {
        if (
          file.startsWith('authority/') ||
          file === 'review.json' ||
          file === 'observations.json' ||
          file === 'telemetry.json' ||
          file === 'docs/plans/001-example/assets/team/baseline.dd.json' ||
          file === 'docs/plans/001-example/assets/team/baseline.dd.md'
        )
          continue;
        const target = posixJoin(repo, file);
        fs.mkdirp(posixDirname(target));
        const bytes = fixture.fs.readBytesNoFollow(`/repo/${file}`);
        if (bytes) fs.writeBytes(target, bytes);
      }
      const planDir = posixJoin(repo, 'docs/plans/001-example');
      const guide = {
        ...fixture.guide,
        fan_out: { decision: 'solo-pm', rationale: 'Exercise PM-only archival.' },
        units: fixture.guide.units.filter((unit) => unit.role === 'pm'),
        composition: { ...fixture.guide.composition, order: [] },
        isolation: { ...fixture.guide.isolation, mode: 'solo' },
      };
      fs.writeText(
        posixJoin(repo, BUILDER_FIXTURE_GUIDE),
        JSON.stringify({
          dd: { schema: 'builder/impl-guide' },
          sections: Object.entries(guide).map(([name, content]) => ({ name, value: content })),
        }),
      );
      const flow = JSON.parse(fs.readText(posixJoin(planDir, 'the-flow.json')) ?? '{}') as FlowDoc;
      flow.nav = { now: 'post-flight', next: null };
      fs.writeText(posixJoin(planDir, 'the-flow.json'), JSON.stringify(flow));
      fs.mkdirp(posixJoin(repo, 'test'));
      fs.writeText(posixJoin(repo, 'test/integration.mjs'), 'console.log("integration passed");\n');
      fs.writeText(
        posixJoin(repo, '.gitignore'),
        'scratch/\ndist/\nbuild/\noutput/\nnode_modules/\nsurvivor-link\ndestination-link\n',
      );
      const ignoredReports = [
        'scratch/only.pdf',
        'dist/report.pdf',
        'build/results.json',
        'output/report.json',
      ];
      for (const relative of [
        ...ignoredReports,
        'node_modules/cache.dat',
        'node_modules/required-report.json',
      ]) {
        const path = posixJoin(repo, relative);
        fs.mkdirp(posixDirname(path));
        fs.writeText(path, `unique bytes: ${relative}`);
      }
      for (const name of ['review', 'observations', 'telemetry'])
        fs.writeText(posixJoin(planDir, `assets/${name}.json`), '{}');
      // NodeExec overlays process.env; retain the helper's removal of ambient keys.
      const gitEnv = {
        ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])),
        ...hermeticGitEnv(),
      };
      const runGit = async (args: string[], cwd = repo) => {
        const result = await exec.run('git', ['-c', 'core.hooksPath=', ...args], {
          cwd,
          timeoutMs: 30000,
          env: gitEnv,
        });
        if (!result.ok) throw new Error(result.stderr);
        return result.stdout.trim();
      };
      await runGit(['init', '-b', 'builder/example']);
      await runGit(['add', '.']);
      await runGit(['commit', '-m', 'fixture baseline']);
      const sourceSha = await runGit(['rev-parse', 'HEAD']);
      const flowDeps = {
        fs,
        clock: fixture.clock,
        git: new FakeGit({ isRepo: true, branch: 'builder/example' }),
        env: fixture.deps.env,
      };
      const deps: BuilderDeps = {
        ...fixture.deps,
        fs,
        repoRoot: repo,
        schemasDir: toPosix(
          fileURLToPath(new URL('../../../../.dd/schemas/builder', import.meta.url)),
        ),
        harness: { command: 'fixture-harness', args: [] },
        ddocs: { command: 'fixture-ddocs', args: [] },
        exec: {
          run: async (command, args, opts) => {
            calls.push([command, ...args]);
            if (command === 'git' || command === 'node')
              return exec.run(command, args, { ...opts, env: { ...gitEnv, ...opts.env } });
            if (
              command === fixture.deps.pij.command &&
              args.join(' ') === [...fixture.deps.pij.args, 'whoami', '--json'].join(' ')
            )
              return fixture.whoami;
            if (command === 'fixture-harness' && args[0] === 'flow') {
              const path = args[args.indexOf('--path') + 1] as string;
              if (args[1] === 'relocate') {
                const moved = relocateFlow(
                  { path, repoRoot: repo, to: args[args.indexOf('--to') + 1] as string },
                  flowDeps,
                );
                if (!moved.ok) return { code: 1, stdout: '', stderr: moved.message, ok: false };
                const written = writeFlowAtomic(path, repo, moved.doc, flowDeps);
                if (!written.ok) return { code: 1, stdout: '', stderr: written.message, ok: false };
                return { code: 0, stdout: JSON.stringify({ status: 'ok' }), stderr: '', ok: true };
              }
              const read = readFlowDoc(path, flowDeps);
              if (!read.ok) return { code: 1, stdout: '', stderr: read.message, ok: false };
              if (args[1] === 'comment') {
                const commented = addComment(
                  read.doc,
                  args[args.indexOf('--node') + 1] as string,
                  args[args.indexOf('--text') + 1] as string,
                  { clock: fixture.clock },
                  { kind: args[args.indexOf('--kind') + 1], source: 'agent' },
                );
                if (!commented.ok)
                  return { code: 1, stdout: '', stderr: commented.message, ok: false };
                const written = writeFlowAtomic(path, repo, commented.doc, flowDeps);
                if (!written.ok) return { code: 1, stdout: '', stderr: written.message, ok: false };
              }
              return {
                code: 0,
                stdout: JSON.stringify({ status: 'ok', data: { now: read.doc.nav?.now } }),
                stderr: '',
                ok: true,
              };
            }
            // DD semantic validation is separately covered by its owning suite. This
            // case exercises the archive/ref/content contract at the command boundary.
            return { code: 0, stdout: JSON.stringify({ status: 'ok' }), stderr: '', ok: true };
          },
        },
      };
      const context = value(builderContext(deps, BUILDER_FIXTURE_PLAN));
      const digest = (path: string) => value(digestBuilderFile(deps, path));
      const baseline = value(
        writeBuilderRecord(
          deps,
          builderRecordPath(context, 'baseline'),
          fixtureBaseline({
            source_sha: sourceSha,
            plan: digest(BUILDER_FIXTURE_PLAN),
            guide: digest(BUILDER_FIXTURE_GUIDE),
            files: [digest('contracts.ts')],
          }),
        ),
      );
      const imported = value(
        writeBuilderRecord(
          deps,
          builderRecordPath(context, 'composition'),
          fixtureComposition({
            baseline: baseline.ref,
            units: [],
            integration_sha: sourceSha,
            checks: [],
          }),
        ),
      );
      const typedGuide = value(loadBuilderGuide(deps, BUILDER_FIXTURE_PLAN)).guide.value;
      const composed = value(
        await composeBuilderUnits(
          {
            ...deps,
            readiness: async () => ({
              ok: true,
              value: { status: 'ready', context, guide: typedGuide, baseline, issues: [] },
            }),
          },
          { plan: BUILDER_FIXTURE_PLAN, mode: 'verify', sha: sourceSha },
        ),
      );
      expect(imported.value.artifact_sha).toBeUndefined();
      expect(composed.value.checks[0]?.stdout).toContain('integration passed');
      const review = fixtureReview({
        scope: 'composition',
        subject_sha: sourceSha,
        plan: digest(BUILDER_FIXTURE_PLAN),
        guide: digest(BUILDER_FIXTURE_GUIDE),
        report: digest(posixJoin(planDir, 'assets/review.json')),
        observed: fixtureObservation({
          peer_id: 'peer-reviewer',
          root: reviewer,
          model: 'github-copilot/claude-opus-5',
          effort: 'high',
          native_session: 'independent-review',
          pid: 22,
        }),
      });
      value(await recordBuilderReview(deps, { plan: BUILDER_FIXTURE_PLAN, receipt: review }));
      const allocation = value(
        writeBuilderRecord(
          deps,
          posixJoin(authority, 'allocation.dd.json'),
          fixtureAllocation({
            id: 'plan-allocation',
            purpose: 'plan',
            root: repo,
            authority_root: authority,
            git_dir: posixJoin(repo, '.git'),
            branch: 'builder/example',
            base_sha: sourceSha,
          }),
          { root: authority },
        ),
      );
      const evidence = [
        { path: posixJoin(planDir, 'assets/observations.json'), category: 'observation' as const },
        { path: posixJoin(planDir, 'assets/telemetry.json'), category: 'telemetry' as const },
        { path: posixJoin(repo, 'node_modules/required-report.json'), category: 'report' as const },
      ];
      const otherRetiring = posixJoin(temporary, 'another-retiring-root');
      fs.mkdirp(otherRetiring);
      const otherAllocation = value(
        writeBuilderRecord(
          deps,
          posixJoin(authority, 'other-allocation.dd.json'),
          fixtureAllocation({
            id: 'other-allocation',
            root: otherRetiring,
            authority_root: authority,
            git_dir: posixJoin(otherRetiring, '.git'),
            base_sha: sourceSha,
          }),
          { root: authority },
        ),
      );
      const alias = posixJoin(repo, 'survivor-link');
      symlinkSync(otherRetiring, alias, 'junction');
      const escaped = await closeBuilderPlan(deps, {
        plan: BUILDER_FIXTURE_PLAN,
        survivor: 'survivor-link/preserved',
        allocations: [allocation, otherAllocation],
        evidence,
      });
      expect(escaped).toMatchObject({ ok: false, code: 'E476' });
      expect(fs.exists(planDir)).toBe(true);
      expect(fs.exists(otherRetiring)).toBe(true);
      expect(fs.exists(posixJoin(otherRetiring, 'preserved'))).toBe(false);
      expect(fs.exists(posixJoin(planDir, 'assets/team/preservation.dd.json'))).toBe(false);
      unlinkSync(alias);
      expect(fs.exists(otherRetiring)).toBe(true);
      const requiredCacheEvidence = evidence[2]?.path as string;
      const originalCacheEvidence = fs.readText(requiredCacheEvidence) as string;
      fs.deleteFile(requiredCacheEvidence);
      expect(
        await closeBuilderPlan(deps, {
          plan: BUILDER_FIXTURE_PLAN,
          survivor: posixJoin(temporary, 'missing-evidence-survivor'),
          allocations: [allocation],
          evidence,
        }),
      ).toMatchObject({ ok: false, code: 'E476' });
      expect(fs.exists(planDir)).toBe(true);
      expect(fs.exists(posixJoin(temporary, 'missing-evidence-survivor'))).toBe(false);
      fs.writeText(requiredCacheEvidence, originalCacheEvidence);
      const result = value(
        await closeBuilderPlan(deps, {
          plan: BUILDER_FIXTURE_PLAN,
          survivor: posixJoin(temporary, 'survivor'),
          allocations: [allocation],
          evidence,
        }),
      );
      expect(result.archive).toBe(posixJoin(repo, 'docs/plans/archive/001-example'));
      expect(fs.exists(planDir)).toBe(false);
      const relocated = JSON.parse(fs.readText(posixJoin(result.archive, 'the-flow.json')) ?? '{}');
      expect(relocated.plan_dir).toBe('docs/plans/archive/001-example');
      expect(relocated.nav.now).toBe('post-flight');
      expect(
        result.preservation.value.inventory.some((item) => item.category === 'telemetry'),
      ).toBe(true);
      expect(
        result.preservation.value.inventory.some((item) => item.category === 'observation'),
      ).toBe(true);
      for (const relative of ignoredReports)
        expect(
          result.preservation.value.inventory.some(
            (item) => item.source === posixJoin(repo, relative),
          ),
        ).toBe(true);
      expect(
        result.preservation.value.inventory.some(
          (item) => item.source === posixJoin(repo, 'node_modules/required-report.json'),
        ),
      ).toBe(true);
      expect(
        result.preservation.value.inventory.some(
          (item) => item.source === posixJoin(repo, 'node_modules/cache.dat'),
        ),
      ).toBe(false);
      const locator = relocated.nodes
        .find((row: FlowNode) => row.id === 'post-flight')
        .comments.filter((comment: { kind: string }) => comment.kind === 'builder-preservation');
      expect(locator[locator.length - 1].text).toBe(result.preservation.ref.path);
      expect(fs.exists(posixJoin(result.archive, 'assets/team/preservation.dd.json'))).toBe(false);
      fs.writeText(requiredCacheEvidence, 'modified explicit evidence');
      expect((await verifyBuilderPreservation(deps, result.preservation.value)).ok).toBe(false);
      fs.writeText(requiredCacheEvidence, originalCacheEvidence);
      const inventoryAlias = posixJoin(repo, 'destination-link');
      symlinkSync(posixJoin(result.archive, 'assets'), inventoryAlias, 'junction');
      const aliasedReceipt = structuredClone(result.preservation.value);
      const observation = aliasedReceipt.inventory.find((item) => item.category === 'observation');
      if (!observation) throw new Error('Missing explicitly preserved observation.');
      observation.destination = 'destination-link/observations.json';
      expect(await verifyBuilderPreservation(deps, aliasedReceipt)).toMatchObject({
        ok: false,
        code: 'E476',
      });
      expect(fs.exists(repo)).toBe(true);
      unlinkSync(inventoryAlias);
      expect(fs.exists(posixJoin(result.archive, 'assets'))).toBe(true);
      const advanced = setNow(relocated, 'ship', { clock: fixture.clock });
      if (!advanced.ok) throw new Error(advanced.message);
      expect(
        writeFlowAtomic(posixJoin(result.archive, 'the-flow.json'), repo, advanced.doc, flowDeps)
          .ok,
      ).toBe(true);
      expect((await verifyBuilderPreservation(deps, result.preservation.value)).ok).toBe(false);
      const refreshed = value(
        await closeBuilderPlan(deps, {
          plan: result.archive,
          survivor: posixJoin(temporary, 'survivor'),
          allocations: [allocation],
          evidence: [
            {
              path: posixJoin(result.archive, 'assets/observations.json'),
              category: 'observation',
            },
            { path: posixJoin(result.archive, 'assets/telemetry.json'), category: 'telemetry' },
            { path: posixJoin(repo, 'node_modules/required-report.json'), category: 'report' },
          ],
        }),
      );
      expect(refreshed.preservation.ref.path).not.toBe(result.preservation.ref.path);
      expect((await verifyBuilderPreservation(deps, refreshed.preservation.value)).ok).toBe(true);
      expect(calls.some((args) => args.includes('push') || args.includes('--force'))).toBe(false);
      fs.removeDir(repo);
      for (const item of result.preservation.value.inventory)
        expect(sha256(fs.readBytesNoFollow(item.destination) as Uint8Array)).toBe(item.sha256);
      for (const ref of result.preservation.value.refs)
        expect(await runGit(['rev-parse', ref.destination_ref], ref.destination_repo)).toBe(
          ref.oid,
        );
    } finally {
      fs.removeDir(temporary);
    }
  }, 30000);
});
