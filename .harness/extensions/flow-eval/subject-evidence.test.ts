import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builderTeamBound, subjectPlanComplete } from './subject-evidence.js';
import type { ResolveContext } from './resolvers.js';
import type { NativeEvidence } from './native-evidence.js';
import { fixtureGuide, fixtureUnit, fixtureRole, fixtureObservation, fixtureCheck } from '../../../harness/cli/test/fixtures/builder-contracts.js';
import { builderRecordPath } from '../../../harness/cli/src/services/builder/records.js';

const root = '/subject';
const planPath = 'docs/plans/001-document/plan.dd.json';
const guidePath = 'docs/plans/001-document/assets/impl-guide.dd.json';
const team = 'docs/plans/001-document/assets/team';
const base = 'a'.repeat(40);
const baselineSha = 'b'.repeat(40);
const artifact = 'c'.repeat(40);
const time = '2026-09-05T00:00:00.000Z';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const doc = (schema: string, values: Record<string, unknown>) => JSON.stringify({ dd: { schema }, sections: Object.entries(values).map(([name, value]) => ({ name, value })), references: [] });
const result = (stdout = '', code = 0) => ({ ok: code === 0, code, stdout, stderr: '' });
const attemptKey = (i: number, source = baselineSha) => `unit-${i}-${source}`;
const attemptPath = (kind: 'packet' | 'ack' | 'dispatch', i: number, source = baselineSha) => builderRecordPath({
  repoRoot: root, planDir: resolve(root, 'docs/plans/001-document'), planPath: resolve(root, planPath),
  guidePath: resolve(root, guidePath), flowPath: resolve(root, 'docs/plans/001-document/the-flow.json'), teamDir: resolve(root, team),
}, kind, attemptKey(i, source));

function fixture() {
  const files = new Map<string, string>();
  const frozen = new Map<string, string>();
  const saved = new Map<string, string>();
  const nativePeers = new Map<string, NativeEvidence>();
  const paths = ['.harness/extensions/pdf/render.ts', '.harness/extensions/pdf/mermaid.ts'];
  const units = paths.map((path, i) => fixtureUnit({ id: `unit-${i}`, paths: [path], name: `Capability ${i}`, responsibility: `Implement capability ${i}`, interface: 'convert(input): bytes' }));
  const guide = fixtureGuide({ units, fan_out: { decision: 'coders', rationale: 'Independent parser and diagram rendering implementations' },
    capabilities: units.map((unit, i) => ({ id: `cap-${i}`, criterion: 'ac-0001', owner: unit.id, path: `CLI reaches independent renderer ${i}`, proof: ['checks/render'] })),
    baseline: { files: ['contracts.ts'], proof: ['contract-check'], receipt: 'team/baseline.dd.json' } });
  const plan = doc('builder/plan', { meta: { ordinal: 1, title: 'Document workbench' }, acceptance_criteria: [{ id: 'ac-0001', claim: 'PDF works', state: 'checked', pressure: 'assets/pressure.dd.json#rows/bp-1' }] });
  files.set(resolve(root, planPath), plan);
  files.set(resolve(root, guidePath), doc('builder/impl-guide', guide as unknown as Record<string, unknown>));
  files.set(resolve(root, 'contracts.ts'), 'export interface Render { convert(input: string): Uint8Array }');
  for (const path of paths) files.set(resolve(root, path), 'export const convert = (input: string) => input;');
  const ref = (path: string) => ({ path, sha256: hash(files.get(resolve(root, path))!) });
  const put = (path: string, kind: string, value: unknown) => {
    files.set(resolve(root, path), doc(kind === 'packet' ? 'builder/packet' : kind === 'allocation' ? 'builder/allocation' : 'builder/team', { [kind]: value }));
    return ref(path);
  };
  const baseline = { record_type: 'baseline', id: 'baseline', recorded_at: time, source_sha: baselineSha, plan: ref(planPath), guide: ref(guidePath),
    files: [ref('contracts.ts')], checks: [fixtureCheck()], review: { path: 'decomposition.json', sha256: hash('review') } };
  const baselineRef = put(`${team}/baseline.dd.json`, 'baseline', baseline);
  const deliveries: any[] = [];
  const packets: any[] = [];
  const acks: any[] = [];
  const dispatches: any[] = [];
  for (let i = 0; i < units.length; i++) {
    const peer = `pij-worker-${i}`;
    const workspace = `/workers/${i}`;
    const commit = String(i + 1).repeat(40);
    const observation = fixtureObservation({ peer_id: peer, root: workspace, native_session: `session-${i}`, pid: 100 + i, model: 'github-copilot/gpt-6-astra' });
    const allocation = put(`${team}/allocation-${i}.dd.json`, 'allocation', { record_type: 'allocation', id: `alloc-${i}`, root: workspace, base_sha: baselineSha, unit_id: units[i].id });
    const packet = { record_type: 'packet', id: `packet-${attemptKey(i)}`, recorded_at: time, nonce: `nonce-${i}`, unit: units[i], plan: ref(planPath), guide: ref(guidePath),
      baseline: baselineRef, allocation, workspace, parent: 'pij-pm', requested: fixtureRole(), canary: { path: 'canary.txt' }, forbidden: [], instructions: [] };
    const packetRef = put(attemptPath('packet', i), 'packet', packet);
    const ack = { record_type: 'ack', id: `ack-${attemptKey(i)}`, recorded_at: time, unit_id: units[i].id, peer_id: peer, nonce: packet.nonce,
      packet_sha256: packetRef.sha256, baseline_sha: baselineSha, native_root: workspace, shell_cwd: workspace, canary_nonce: `canary-${i}`, observed: observation };
    const ackRef = put(attemptPath('ack', i), 'ack', ack);
    const dispatch = { record_type: 'dispatch', id: `dispatch-${attemptKey(i)}`, recorded_at: time, unit_id: units[i].id, packet: packetRef, baseline: baselineRef,
      allocation, requested: packet.requested, observed: observation, seed_files: [{ path: 'canary.txt', sha256: hash(ack.canary_nonce) }],
      acknowledgement: ackRef, release: { message_id: `release-${i}`, outcome: 'delivered', recorded_at: time } };
    put(attemptPath('dispatch', i), 'dispatch', dispatch);
    const delivery = { unit_id: units[i].id, peer_id: peer, workspace, commit_sha: commit, packet_sha256: packetRef.sha256, baseline_sha: baselineSha };
    deliveries.push(delivery); packets.push(packet); acks.push(ack); dispatches.push(dispatch);
    nativePeers.set(peer, { source: 'flowspace', peer_id: peer, native_session: observation.native_session!, root: workspace,
      model: observation.model!, provider_attestation: 'unverified', guid: `guid-${i}`, base_sha: baselineSha, complete: true, cutoff: { turns: 1, last_turn_at: time },
      turns: [{ address: `conv:guid-${i}#t1`, turn_no: 1, role: 'agent', source: 'system', head_sha: commit, at: time, body: '',
        items: [{ kind: 'tool_call', tool: 'write', input: { kind: 'elided', path: paths[i], bytes: 30 } }] }], tools: { write: 1 }, commands: [], gaps: [], receipts: [] });
  }
  const composition = { record_type: 'composition', id: 'composition', recorded_at: time, baseline: baselineRef, units: deliveries,
    integration_sha: artifact, artifact_sha: artifact, files: paths.map(ref), checks: [fixtureCheck()] };
  put(`${team}/composition.dd.json`, 'composition', composition);
  files.set(resolve(root, 'review.txt'), 'Independent review of working rendering implementations');
  const review = { record_type: 'review', id: 'review', recorded_at: time, scope: 'composition', subject_sha: artifact,
    plan: ref(planPath), guide: ref(guidePath), reviewer_id: 'pij-reviewer', requested: fixtureRole('reviewer', { model: 'github-copilot/claude-opus-5', effort: 'high' }),
    observed: fixtureObservation({ peer_id: 'pij-reviewer', root: '/review', native_session: 'review-session', pid: 999, model: 'github-copilot/claude-opus-5', effort: 'high' }),
    verdict: 'approved', report: ref('review.txt'), findings: [] };
  put(`${team}/review-composition.dd.json`, 'review', review);
  nativePeers.set('pij-reviewer', { ...nativePeers.get('pij-worker-0')!, peer_id: 'pij-reviewer', native_session: 'review-session', root: '/review',
    model: 'github-copilot/claude-opus-5', effort: 'high', turns: [{ ...nativePeers.get('pij-worker-0')!.turns[0], body: `Reviewed ${artifact}` }] });
  for (const [path, text] of files) frozen.set(path, text);
  let override: (command: string, args: string[], cwd: string) => ReturnType<typeof result> | undefined = () => undefined;
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const rc: ResolveContext = {
    evidence: null, worktree: root, nativePeers, capabilityFiles: paths.map((path) => resolve(root, path)),
    subject: { plan: planPath, base, peer: 'pij-pm', harness: { command: 'node', args: ['/trusted/harness.js'] }, ddocs: '/trusted/ddocs', save: (name, text) => saved.set(name, text) },
    fs: { exists: (p) => files.has(p), readText: (p) => files.get(p) ?? null, readdir: () => [] },
    exec: async (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      const overridden = override(command, args, opts.cwd);
      if (overridden) return overridden;
      if (command === 'node' && args[0].endsWith('/git-digest.mjs')) return result(JSON.stringify({ sha256: hash(frozen.get(resolve(root, args[3]))!) }));
      if (command !== 'git') return result(JSON.stringify({ status: 'ok', data: { counts: { error: 0, warn: 0 } } }));
      if (args[0] === 'rev-parse') return result(args.includes('--show-toplevel') ? opts.cwd : args.includes('HEAD') ? artifact : base);
      if (args[0] === 'merge-base' || args[0] === 'status' || args[0] === 'ls-tree') return result();
      if (args[0] === 'show') {
        const path = args[1].slice(args[1].indexOf(':') + 1);
        return result(frozen.get(resolve(root, path)) ?? '', frozen.has(resolve(root, path)) ? 0 : 128);
      }
      if (args[0] === 'diff') {
        if (args.includes('--numstat')) return result(`10\t0\t${args[args.length - 1]}\n`);
        if (args.includes('HEAD')) return result();
        const i = Number(opts.cwd.split('/').pop());
        return result(paths[i]);
      }
      return result('', 128);
    },
  };
  return { rc, files, frozen, saved, calls, plan, guide, baseline, composition, review, deliveries, packets, acks, dispatches, put, ref,
    override: (fn: typeof override) => { override = fn; } };
}

/** Rebind raw digests so negative cases cannot pass by hitting unrelated stale hashes. */
function persistAttempt(f: ReturnType<typeof fixture>, i = 0) {
  const dispatch = f.dispatches[i];
  dispatch.packet = f.put(dispatch.packet.path, 'packet', f.packets[i]);
  f.acks[i].packet_sha256 = dispatch.packet.sha256;
  dispatch.acknowledgement = f.put(dispatch.acknowledgement.path, 'ack', f.acks[i]);
  f.put(attemptPath('dispatch', i), 'dispatch', dispatch);
  f.deliveries[i].packet_sha256 = dispatch.packet.sha256;
  f.put(`${team}/composition.dd.json`, 'composition', f.composition);
}

describe('current sealed authorization attempts', () => {
  const refusal = { verdict: 'fail', note: `builder-authorization-unverified: unit-0 requires packet, ack and dispatch for sealed source ${baselineSha}` };
  const kinds = ['packet', 'ack', 'dispatch'] as const;
  const records = (f: ReturnType<typeof fixture>) => ({ packet: f.packets[0], ack: f.acks[0], dispatch: f.dispatches[0] });
  it.each(kinds)('refuses absent qualified %s even when an old unit-only record exists', async (kind) => {
    const f = fixture();
    const historical = resolve(root, `${team}/${kind}-unit-0.dd.json`);
    f.files.set(historical, f.files.get(attemptPath(kind, 0))!);
    f.files.delete(attemptPath(kind, 0));
    const before = [...f.files];
    expect(await builderTeamBound(f.rc)).toEqual(refusal);
    expect([...f.files]).toEqual(before);
  });
  it.each(kinds)('refuses %s qualified for another source, including rebound pointers', async (kind) => {
    const f = fixture();
    const wrongPath = attemptPath(kind, 0, 'd'.repeat(40));
    records(f)[kind].id = `${kind}-${attemptKey(0, 'd'.repeat(40))}`;
    const wrongRef = f.put(wrongPath, kind, records(f)[kind]);
    if (kind === 'packet') f.dispatches[0].packet = wrongRef;
    if (kind === 'ack') f.dispatches[0].acknowledgement = wrongRef;
    persistAttempt(f);
    if (kind === 'dispatch') f.files.delete(attemptPath(kind, 0));
    expect(await builderTeamBound(f.rc)).toEqual(refusal);
  });
  it.each(kinds)('refuses current-name %s whose payload binds another sealed source', async (kind) => {
    const f = fixture();
    const oldSha = 'd'.repeat(40);
    const oldBaseline = f.put(`${team}/baseline-old.dd.json`, 'baseline', { ...f.baseline, source_sha: oldSha });
    if (kind === 'ack') f.acks[0].baseline_sha = oldSha;
    else records(f)[kind].baseline = oldBaseline;
    persistAttempt(f);
    expect(await builderTeamBound(f.rc)).toEqual(refusal);
  });
  it.each(kinds)('refuses current-name %s with an old payload identity', async (kind) => {
    const f = fixture();
    records(f)[kind].id = `${kind}-unit-0`;
    persistAttempt(f);
    expect(await builderTeamBound(f.rc)).toEqual(refusal);
  });
  it('never lets delivery and acknowledgement SHAs select an older attempt', async () => {
    const f = fixture();
    const oldSha = 'd'.repeat(40);
    f.acks[0].baseline_sha = oldSha;
    f.deliveries[0].baseline_sha = oldSha;
    persistAttempt(f);
    for (const kind of kinds) {
      const path = attemptPath(kind, 0);
      f.files.set(attemptPath(kind, 0, oldSha), f.files.get(path)!);
      f.files.delete(path);
    }
    expect(await builderTeamBound(f.rc)).toEqual(refusal);
  });
  it('uses the current authority while retaining old records unchanged', async () => {
    const f = fixture();
    for (const kind of kinds) {
      const contents = f.files.get(attemptPath(kind, 0))!;
      f.files.set(resolve(root, `${team}/${kind}-unit-0.dd.json`), contents);
      f.files.set(attemptPath(kind, 0, 'd'.repeat(40)), contents);
    }
    const before = [...f.files];
    expect((await builderTeamBound(f.rc)).verdict).toBe('pass');
    expect([...f.files]).toEqual(before);
    expect(f.calls).toContainEqual({ command: '/trusted/ddocs', args: ['validate', `${root}/${team}/dispatch-unit-0-${baselineSha}.dd.json`, '--json'], cwd: root });
  });
  it.each(['', '   ', 'nonce-1'])('rejects missing or reused packet nonce %j with matching ack', async (nonce) => {
    const f = fixture();
    f.packets[0].nonce = nonce;
    f.acks[0].nonce = nonce;
    persistAttempt(f);
    expect(await builderTeamBound(f.rc)).toMatchObject({ verdict: 'fail', note: expect.stringContaining('packet nonce') });
  });
});

describe('shared Builder intent with independent validity checks', () => {
  it('accepts factual plan progress and guide timestamps without relabelling historical digests', async () => {
    const f = fixture();
    const current = JSON.parse(f.plan);
    current.sections[0].value.status = 'completed';
    current.sections[1].value[0].state = 'unchecked';
    current.sections[1].value[0].proven_by = ['retained proof'];
    f.files.set(resolve(root, planPath), JSON.stringify(current));
    f.files.set(resolve(root, guidePath), doc('builder/impl-guide', { ...f.guide, meta: { ...f.guide.meta, updated: time } }));
    const frozen = [...f.frozen];
    const historicalDigests = [f.baseline.plan.sha256, f.baseline.guide.sha256, f.review.plan.sha256, f.review.guide.sha256];
    expect((await builderTeamBound(f.rc)).verdict).toBe('pass');
    expect([...f.frozen]).toEqual(frozen);
    expect([f.baseline.plan.sha256, f.baseline.guide.sha256, f.review.plan.sha256, f.review.guide.sha256]).toEqual(historicalDigests);
  });
  it('does not mistake intent equality for completion or semantic approval', async () => {
    const f = fixture();
    const current = JSON.parse(f.plan);
    current.sections[1].value[0].state = 'unchecked';
    f.files.set(resolve(root, planPath), JSON.stringify(current));
    f.override((command, args) => command === 'node' && args.includes('--complete')
      ? result(JSON.stringify({ status: 'error', data: { counts: { error: 1, warn: 0 } } }), 1) : undefined);
    expect(await builderTeamBound(f.rc)).toMatchObject({ verdict: 'fail', note: expect.stringContaining('complete plan') });
  });
  it.each(['state', 'receipt', 'updated', 'recorded_at'])('retains material plan metadata field %s', async (field) => {
    const f = fixture();
    const current = JSON.parse(f.plan);
    current.sections[0].value[field] = 'changed requirement';
    f.files.set(resolve(root, planPath), JSON.stringify(current));
    expect(await builderTeamBound(f.rc)).toMatchObject({ verdict: 'fail', note: 'review is bound to different plan or guide intent' });
  });
  it('retains document-level references instead of comparing only section values', async () => {
    const f = fixture();
    const current = JSON.parse(f.plan);
    current.references.push({ id: 'different-pressure', path: 'assets/different.dd.json' });
    f.files.set(resolve(root, planPath), JSON.stringify(current));
    expect(await builderTeamBound(f.rc)).toMatchObject({ verdict: 'fail', note: 'review is bound to different plan or guide intent' });
  });
  it.each(['baseline', 'review'] as const)('rejects a different plan identity in the %s even with identical document bytes', async (kind) => {
    const f = fixture();
    const foreign = 'docs/plans/002-foreign/plan.dd.json';
    f.frozen.set(resolve(root, foreign), f.plan);
    if (kind === 'baseline') {
      f.baseline.plan.path = foreign;
      const changedRef = f.put(`${team}/baseline.dd.json`, 'baseline', f.baseline);
      f.composition.baseline = changedRef;
      f.put(`${team}/composition.dd.json`, 'composition', f.composition);
    } else {
      f.review.plan.path = foreign;
      f.put(`${team}/review-composition.dd.json`, 'review', f.review);
    }
    expect(await builderTeamBound(f.rc)).toMatchObject({ verdict: 'fail', note: expect.stringContaining(kind === 'baseline' ? 'frozen baseline' : 'different plan') });
  });
  it.each(['baseline', 'review'] as const)('checks the %s historical raw digest before accepting intent equality', async (kind) => {
    const f = fixture();
    if (kind === 'baseline') {
      f.baseline.plan.sha256 = 'd'.repeat(64);
      f.composition.baseline = f.put(`${team}/baseline.dd.json`, 'baseline', f.baseline);
      f.put(`${team}/composition.dd.json`, 'composition', f.composition);
    } else {
      f.review.plan.sha256 = 'd'.repeat(64);
      f.put(`${team}/review-composition.dd.json`, 'review', f.review);
    }
    expect((await builderTeamBound(f.rc)).verdict).toBe('fail');
  });
});

describe('new subject semantic binding', () => {
  it('invokes the existing DD and complete plan validators with exact argv', async () => {
    const f = fixture(); expect((await subjectPlanComplete(f.rc)).verdict).toBe('pass');
    expect(f.calls).toContainEqual({ command: '/trusted/ddocs', args: ['validate', resolve(root, planPath), '--json'], cwd: root });
    expect(f.calls).toContainEqual({ command: 'node', args: ['/trusted/harness.js', 'plan', 'validate', resolve(root, planPath), '--complete', '--json'], cwd: root });
  });
  it.each([null, base])('checks the independent preparation/Git base with native base %s', async (nativeBase) => {
    const f = fixture();
    const native = f.rc.nativePeers!.get('pij-worker-0')!;
    f.rc.native = { ...native, peer_id: 'pij-pm', root, base_sha: nativeBase,
      turns: native.turns.map((turn) => ({ ...turn, head_sha: null })) };
    expect((await subjectPlanComplete(f.rc)).verdict).toBe('pass');
    expect(f.calls).toContainEqual({ command: 'git', args: ['rev-parse', '--verify', `${base}^{commit}`], cwd: root });
    expect(f.calls).toContainEqual({ command: 'git', args: ['merge-base', '--is-ancestor', base, 'HEAD'], cwd: root });
    expect(f.rc.native.base_sha).toBe(nativeBase);
    expect(f.rc.native.turns[0].head_sha).toBeNull();
  });
  it('does not let unsupported native Git fields excuse a conflicting preparation/Git base', async () => {
    const f = fixture();
    f.rc.native = { ...f.rc.nativePeers!.get('pij-worker-0')!, peer_id: 'pij-pm', root, base_sha: null };
    f.override((command, args) => command === 'git' && args[0] === 'merge-base' ? result('', 1) : undefined);
    expect((await subjectPlanComplete(f.rc)).verdict).toBe('fail');
  });
  it.each([true, false])('refuses a non-null conflicting native base even when complete=%s', async (complete) => {
    const f = fixture();
    f.rc.native = { ...f.rc.nativePeers!.get('pij-worker-0')!, peer_id: 'pij-pm', root, complete, base_sha: 'd'.repeat(40) };
    expect(await subjectPlanComplete(f.rc)).toMatchObject({ verdict: 'fail', note: 'native subject session is bound to a different Git base' });
  });
  it('rejects inherited plan paths and renamed inherited identities', async () => {
    const f = fixture();
    f.override((c, a) => c === 'git' && a[0] === 'ls-tree' ? result(planPath) : undefined);
    expect((await subjectPlanComplete(f.rc)).verdict).toBe('fail');
    const g = fixture();
    g.override((c, a) => c === 'git' && a[0] === 'ls-tree' && a[a.length - 1] === 'docs/plans' ? result('docs/plans/old/plan.dd.json') : c === 'git' && a[0] === 'show' ? result(g.plan) : undefined);
    expect((await subjectPlanComplete(g.rc)).verdict).toBe('fail');
  });
  it.each(['error', 'degraded'])('rejects unresolved semantic links/incomplete completion returned as %s', async (status) => {
    const f = fixture(); f.override((c) => c !== 'git' ? result(JSON.stringify({ status, data: { counts: { error: status === 'error' ? 1 : 0, warn: 1 } } })) : undefined);
    expect((await subjectPlanComplete(f.rc)).verdict).toBe('fail');
  });
  it('does not call missing or malformed validator output a pass', async () => {
    const f = fixture(); f.override((c) => c !== 'git' ? result('ok') : undefined);
    expect((await subjectPlanComplete(f.rc)).verdict).toBe('unknown');
  });
  it('rejects a wrong or abbreviated base', async () => {
    const f = fixture(); f.rc.subject!.base = 'abc123';
    expect((await subjectPlanComplete(f.rc)).verdict).toBe('fail');
  });
});

describe('authentic Builder team bindings', () => {
  it('accepts distinct source-writing peers with exact receipts and composed-SHA review', async () => {
    const f = fixture(); expect(await builderTeamBound(f.rc)).toMatchObject({ verdict: 'pass' });
  });
  it('uses independent delivery/Git bindings when native per-turn heads are unsupported', async () => {
    const f = fixture();
    for (const native of f.rc.nativePeers!.values()) {
      native.base_sha = null;
      native.turns = native.turns.map((turn) => ({ ...turn, head_sha: null }));
    }
    expect((await builderTeamBound(f.rc)).verdict).toBe('pass');
    expect(f.calls.some((call) => call.command === 'git' && call.args[0] === 'diff' && call.cwd.startsWith('/workers/'))).toBe(true);
  });
  it('retains historical packet digests across a factual archive relocation', async () => {
    const f = fixture();
    const oldDirectory = resolve(root, 'docs/plans/001-document');
    const newDirectory = resolve(root, 'docs/plans/archive/001-document');
    for (const [path, contents] of [...f.files]) {
      if (path.startsWith(`${oldDirectory}/`)) {
        f.files.set(path.replace(oldDirectory, newDirectory), contents);
        f.files.delete(path);
      }
    }
    f.rc.subject!.plan = 'docs/plans/archive/001-document/plan.dd.json';
    expect((await builderTeamBound(f.rc)).verdict).toBe('pass');
  });
  it.each([
    ['solo PM', (f: ReturnType<typeof fixture>) => { f.guide.fan_out.decision = 'solo-pm'; f.files.set(resolve(root, guidePath), doc('builder/impl-guide', f.guide as any)); }],
    ['missing composition', (f: ReturnType<typeof fixture>) => { f.files.delete(resolve(root, `${team}/composition.dd.json`)); }],
    ['shared peer', (f: ReturnType<typeof fixture>) => { f.deliveries[1].peer_id = f.deliveries[0].peer_id; f.put(`${team}/composition.dd.json`, 'composition', f.composition); }],
    ['shared root', (f: ReturnType<typeof fixture>) => { f.deliveries[1].workspace = f.deliveries[0].workspace; f.put(`${team}/composition.dd.json`, 'composition', f.composition); }],
    ['stale packet', (f: ReturnType<typeof fixture>) => { f.files.set(attemptPath('packet', 0), 'tampered'); }],
    ['stale nonce', (f: ReturnType<typeof fixture>) => { f.acks[0].nonce = 'wrong'; f.dispatches[0].acknowledgement = f.put(attemptPath('ack', 0), 'ack', f.acks[0]); f.put(attemptPath('dispatch', 0), 'dispatch', f.dispatches[0]); }],
    ['queued release', (f: ReturnType<typeof fixture>) => { f.dispatches[0].release.outcome = 'queued'; f.put(attemptPath('dispatch', 0), 'dispatch', f.dispatches[0]); }],
    ['detached review', (f: ReturnType<typeof fixture>) => { f.review.subject_sha = 'd'.repeat(40); f.put(`${team}/review-composition.dd.json`, 'review', f.review); }],
    ['uncommitted files', (f: ReturnType<typeof fixture>) => { f.override((c, a) => c === 'git' && a[0] === 'status' ? result(' M render.ts') : undefined); }],
    ['post-review code change', (f: ReturnType<typeof fixture>) => { f.override((c, a) => c === 'git' && a[0] === 'diff' && a.includes('HEAD') ? result('render.ts') : undefined); }],
    ['empty unit commit', (f: ReturnType<typeof fixture>) => { f.override((c, a, cwd) => c === 'git' && a[0] === 'diff' && cwd.startsWith('/workers/') ? result() : undefined); }],
    ['out-of-fence code', (f: ReturnType<typeof fixture>) => { f.override((c, a, cwd) => c === 'git' && a[0] === 'diff' && cwd.startsWith('/workers/') ? result('unowned.ts') : undefined); }],
    ['validator-only padding', (f: ReturnType<typeof fixture>) => { f.rc.capabilityFiles = [resolve(root, '.harness/extensions/pdf/render.ts')]; }],
  ] as const)('rejects %s', async (_name, mutate) => {
    const f = fixture(); mutate(f); expect((await builderTeamBound(f.rc)).verdict).toBe('fail');
  });
  it('keeps missing native implementation or review evidence unknown', async () => {
    const f = fixture(); f.rc.nativePeers!.delete('pij-worker-0');
    expect((await builderTeamBound(f.rc)).verdict).toBe('unknown');
    const g = fixture(); g.rc.nativePeers!.delete('pij-reviewer');
    expect((await builderTeamBound(g.rc)).verdict).toBe('unknown');
  });
});
