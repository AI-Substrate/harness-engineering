import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DdDoc } from '@ai-substrate/dd';
import picomatch from 'picomatch';
import { builderRecordPath, sameBuilderDocumentIntent } from '../../../harness/cli/src/services/builder/records.js';
import type { AckReceipt, AllocationRecord, BaselineReceipt, BuilderContext, CompositionReceipt, DispatchReceipt, FileDigest, Guide, Packet, ReviewReceipt, RuntimeObservation } from '../../../harness/cli/src/services/builder/types.js';
import type { ResolveContext, VerdictWithNote } from './resolvers.js';
import { json, object } from './native-evidence.js';
import { pdfCapability } from './pdf-capability.js';

export interface SubjectBinding {
  plan: string;
  base: string;
  peer: string;
  requestedModel?: string;
  /** CLI executables come from the evaluator, not subject-authored wrapper code. */
  harness: { command: string; args: string[] };
  ddocs: string;
  save(name: string, text: string): void;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const oid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const fail = (note: string): VerdictWithNote => ({ verdict: 'fail', note });
const unknown = (note: string): VerdictWithNote => ({ verdict: 'unknown', note });
const pass = (note: string): VerdictWithNote => ({ verdict: 'pass', note });
function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}
/** Local loading only; semantic/link validation remains the existing CLI's job. */
function document(text: string | null): DdDoc | null {
  const doc = text === null ? null : json(text);
  if (!object(doc) || !object(doc.dd) || typeof doc.dd.schema !== 'string' || !Array.isArray(doc.sections)) return null;
  const names = new Set<string>();
  for (const section of doc.sections) {
    if (!object(section) || typeof section.name !== 'string' || names.has(section.name)) return null;
    names.add(section.name);
  }
  return doc as unknown as DdDoc;
}
function sections(text: string | null): Record<string, unknown> | null {
  const doc = document(text);
  return doc ? Object.fromEntries(doc.sections.map((section) => [section.name, section.value])) : null;
}
function record<T>(text: string | null, kind: string): T | null {
  const values = sections(text);
  const value = values?.[kind];
  return values && Object.keys(values).length === 1 && object(value) && value.record_type === kind ? value as T : null;
}
function observed(value: RuntimeObservation, peer: string, root: string, model: string): boolean {
  return value?.ready === true && value.peer_id === peer && resolve(value.root) === resolve(root) &&
    value.harness === 'omp' && value.model === model && typeof value.native_session === 'string' && value.native_session.length > 0 &&
    Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && Array.isArray(value.evidence) && value.evidence.length > 0;
}
async function git(rc: ResolveContext, args: string[], root = rc.worktree) {
  return rc.exec('git', args, { cwd: root });
}
async function validate(rc: ResolveContext, binding: SubjectBinding, path: string, complete = false): Promise<VerdictWithNote> {
  const contents = rc.fs.readText(path);
  if (contents !== null) binding.save(`documents/${hash(contents)}.dd.json`, contents);
  const command = complete ? binding.harness.command : binding.ddocs;
  const args = complete ? [...binding.harness.args, 'plan', 'validate', path, '--complete', '--json'] : ['validate', path, '--json'];
  const result = await rc.exec(command, args, { cwd: rc.worktree });
  binding.save(`validation-${hash(path + String(complete)).slice(0, 12)}.json`, JSON.stringify({ command, args, result }, null, 2));
  const envelope = json(result.stdout);
  if (!object(envelope) || typeof envelope.status !== 'string') return unknown(`validator unavailable or unreadable: ${path}`);
  if (!result.ok || envelope.status !== 'ok') return fail(`existing ${complete ? 'complete plan' : 'DD'} validator rejected ${path}`);
  if (!object(envelope.data) || !object(envelope.data.counts) || envelope.data.counts.error !== 0 || envelope.data.counts.warn !== 0) return unknown(`validator lacks exact zero error/warning evidence: ${path}`);
  return pass(`existing validator accepted ${path}`);
}

export async function subjectPlanComplete(rc: ResolveContext): Promise<VerdictWithNote> {
  const b = rc.subject;
  if (!b) return unknown('select --subject-plan and an explicit full --base-ref');
  const plan = resolve(rc.worktree, b.plan);
  if (!inside(rc.worktree, plan) || !plan.endsWith('/plan.dd.json') || !oid(b.base)) return fail('subject plan/base binding is invalid');
  // Native Git metadata can be unsupported. Never substitute it for the
  // independently selected preparation base, but refuse an observed conflict.
  if (rc.native?.base_sha != null && rc.native.base_sha !== b.base) return fail('native subject session is bound to a different Git base');
  if (b.requestedModel && !rc.native?.model) return unknown('native subject model configuration unavailable');
  if (b.requestedModel && rc.native?.model !== b.requestedModel) return fail('native subject model differs from requested cohort configuration');
  const base = await git(rc, ['rev-parse', '--verify', `${b.base}^{commit}`]);
  const ancestor = await git(rc, ['merge-base', '--is-ancestor', b.base, 'HEAD']);
  if (!base.ok || base.stdout.trim() !== b.base || !ancestor.ok) return fail('selected base is not an exact ancestor commit');
  const rel = relative(rc.worktree, plan);
  const old = await git(rc, ['ls-tree', '-r', '--name-only', b.base, '--', rel]);
  if (!old.ok) return unknown('cannot inspect selected base tree');
  if (old.stdout.trim()) return fail('selected plan is inherited from the base');
  const current = sections(rc.fs.readText(plan));
  const currentDoc = document(rc.fs.readText(plan));
  if (!currentDoc || !current || !object(current.meta) || !Array.isArray(current.acceptance_criteria) || current.acceptance_criteria.length === 0) return fail('selected new plan is missing real DD acceptance criteria');
  // A rename of an inherited plan is not new work. Compare identity and material intent.
  const priorPaths = await git(rc, ['ls-tree', '-r', '--name-only', b.base, '--', 'docs/plans']);
  if (!priorPaths.ok) return unknown('cannot inspect inherited plan identities');
  for (const priorPath of priorPaths.stdout.split('\n').filter((p) => p.endsWith('/plan.dd.json'))) {
    const prior = await git(rc, ['show', `${b.base}:${priorPath}`]);
    if (!prior.ok) return unknown(`cannot inspect inherited plan ${priorPath}`);
    const parsed = sections(prior.stdout);
    const priorDoc = document(prior.stdout);
    if (parsed && ((priorDoc && sameBuilderDocumentIntent(priorDoc, currentDoc, basename(dirname(plan)))) ||
      (object(parsed.meta) && parsed.meta.ordinal !== undefined && parsed.meta.ordinal === current.meta.ordinal))) return fail('subject plan reuses an inherited plan identity or intent');
  }
  const dd = await validate(rc, b, plan);
  if (dd.verdict !== 'pass') return dd;
  return validate(rc, b, plan, true);
}

export async function builderTeamBound(rc: ResolveContext): Promise<VerdictWithNote> {
  try {
  const b = rc.subject;
  if (!b) return unknown('selected subject plan/base required');
  const planCheck = await subjectPlanComplete(rc);
  if (planCheck.verdict !== 'pass') return planCheck;
  const plan = resolve(rc.worktree, b.plan);
  const guidePath = resolve(dirname(plan), 'assets/impl-guide.dd.json');
  const team = resolve(dirname(plan), 'assets/team');
  const context: BuilderContext = { repoRoot: rc.worktree, planDir: dirname(plan), planPath: plan, guidePath,
    flowPath: resolve(dirname(plan), 'the-flow.json'), teamDir: team };
  const planId = basename(context.planDir);
  const currentPlan = document(rc.fs.readText(plan));
  const currentGuide = document(rc.fs.readText(guidePath));
  const guide = sections(rc.fs.readText(guidePath)) as unknown as Guide | null;
  if (!guide || guide.fan_out?.decision !== 'coders' || !guide.fan_out.rationale?.trim() ||
      !guide.architecture?.principles?.trim() || !guide.architecture.contracts?.length ||
      !Array.isArray(guide.units) || !Array.isArray(guide.capabilities)) return fail('missing architecture-supported implementation fan-out');
  const coders = guide.units.filter((unit) => unit.role === 'coder');
  // Separate implementation means more than one implementation owner, not a quota.
  if (coders.length < 2 || new Set(coders.map((unit) => unit.id)).size !== coders.length) return fail('no distinct independent implementation units');
  const guideCheck = await validate(rc, b, guidePath);
  if (guideCheck.verdict !== 'pass') return guideCheck;
  const baselinePath = resolve(dirname(guidePath), guide.baseline.receipt);
  const baselineText = rc.fs.readText(baselinePath);
  const baseline = record<BaselineReceipt>(baselineText, 'baseline');
  const compositionPath = resolve(team, 'composition.dd.json');
  const composition = record<CompositionReceipt>(rc.fs.readText(compositionPath), 'composition');
  const reviewPath = resolve(team, 'review-composition.dd.json');
  const review = record<ReviewReceipt>(rc.fs.readText(reviewPath), 'review');
  if (!baseline || !composition || !review || !oid(baseline.source_sha) || !oid(composition.artifact_sha)) return fail('missing baseline, verified composition or composed-SHA review');
  const referencePath = (path: string): string => {
    const absolute = resolve(rc.worktree, path);
    const historicalRoot = resolve(rc.worktree, dirname(baseline.plan.path));
    return !rc.fs.exists(absolute) && inside(historicalRoot, absolute)
      ? resolve(dirname(plan), relative(historicalRoot, absolute)) : absolute;
  };
  const checkRef = (ref: FileDigest | undefined, expectedPath?: string) => {
    if (!ref || typeof ref.path !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) return false;
    const path = referencePath(ref.path);
    const text = rc.fs.readText(path);
    return (!expectedPath || path === expectedPath) && text !== null && hash(text) === ref.sha256;
  };
  const readRef = <T>(ref: FileDigest | undefined, kind: string): T | null => checkRef(ref) ? record<T>(rc.fs.readText(referencePath(ref!.path)), kind) : null;
  const reviewedPlan = await git(rc, ['show', `${review.subject_sha}:${review.plan.path}`]);
  const reviewedGuide = await git(rc, ['show', `${review.subject_sha}:${review.guide.path}`]);
  const reviewedPlanDoc = document(reviewedPlan.stdout);
  const reviewedGuideDoc = document(reviewedGuide.stdout);
  if (!reviewedPlan.ok || !reviewedGuide.ok || hash(reviewedPlan.stdout) !== review.plan.sha256 || hash(reviewedGuide.stdout) !== review.guide.sha256 ||
      basename(dirname(review.plan.path)) !== planId || referencePath(review.plan.path) !== plan || referencePath(review.guide.path) !== guidePath ||
      !currentPlan || !currentGuide || !reviewedPlanDoc || !reviewedGuideDoc ||
      !sameBuilderDocumentIntent(reviewedPlanDoc, currentPlan, planId) ||
      !sameBuilderDocumentIntent(reviewedGuideDoc, currentGuide, planId)) return fail('review is bound to different plan or guide intent');
  if (!checkRef(composition.baseline, baselinePath) ||
      !checkRef(review.report) || review.scope !== 'composition' || review.subject_sha !== composition.artifact_sha ||
      review.verdict !== 'approved' || !Array.isArray(review.findings) || review.findings.some((f) => f.disposition === 'open')) return fail('stale composition/review or unresolved findings');
  if (!await git(rc, ['merge-base', '--is-ancestor', b.base, baseline.source_sha]).then((r) => r.ok)) return fail('team baseline predates or diverges from subject base');
  const head = await git(rc, ['rev-parse', 'HEAD']);
  if (!head.ok) return unknown('cannot resolve composed HEAD');
  const tree = await git(rc, ['diff', '--name-only', composition.artifact_sha, 'HEAD']);
  const dirty = await git(rc, ['status', '--porcelain', '--untracked-files=all']);
  if (!tree.ok || !dirty.ok) return unknown('cannot inspect post-review changes');
  const planRel = relative(rc.worktree, dirname(plan));
  // Progress/receipt commits may follow review; code changes may not.
  const documentRoots = [planRel, dirname(baseline.plan.path)];
  const factualDocument = (path: string) => documentRoots.some((dir) => path.startsWith(`${dir}/`)) && /\.(?:json|md)$/.test(path);
  if (tree.stdout.split('\n').some((p) => p && !factualDocument(p)) || dirty.stdout.trim()) return fail('uncommitted changes or code changed after composed-SHA review');
  const frozenPlan = await git(rc, ['show', `${baseline.source_sha}:${baseline.plan.path}`]);
  const frozenGuide = await git(rc, ['show', `${baseline.source_sha}:${baseline.guide.path}`]);
  const frozenPlanDoc = document(frozenPlan.stdout);
  const frozenGuideDoc = document(frozenGuide.stdout);
  if (!frozenPlan.ok || !frozenGuide.ok || hash(frozenPlan.stdout) !== baseline.plan.sha256 || hash(frozenGuide.stdout) !== baseline.guide.sha256 ||
      basename(dirname(baseline.plan.path)) !== planId || referencePath(baseline.plan.path) !== plan || referencePath(baseline.guide.path) !== guidePath ||
      !frozenPlanDoc || !frozenGuideDoc ||
      !sameBuilderDocumentIntent(frozenPlanDoc, currentPlan, planId) ||
      !sameBuilderDocumentIntent(frozenGuideDoc, currentGuide, planId)) return fail('material plan/guide drift from frozen baseline');
  if (!baseline.files?.length || !baseline.checks?.length || baseline.checks.some((c) => c.exit_code !== 0) ||
      !composition.checks?.length || composition.checks.some((c) => c.exit_code !== 0)) return fail('baseline/composition proof missing or failed');
  for (const contract of baseline.files) {
    const file = await git(rc, ['show', `${baseline.source_sha}:${contract.path}`]);
    if (!file.ok || hash(file.stdout) !== contract.sha256) return fail(`frozen contract mismatch: ${contract.path}`);
  }
  if (!composition.files?.length) return fail('verified composition has no committed artifact digests');
  for (const artifactFile of composition.files) {
    const file = await rc.exec('node', [fileURLToPath(new URL('./git-digest.mjs', import.meta.url)), rc.worktree, composition.artifact_sha, artifactFile.path], { cwd: rc.worktree });
    const digest = json(file.stdout);
    if (!file.ok || !object(digest) || digest.sha256 !== artifactFile.sha256) return fail(`composed artifact digest mismatch: ${artifactFile.path}`);
  }
  for (const path of [baselinePath, compositionPath, reviewPath]) {
    const v = await validate(rc, b, path);
    if (v.verdict !== 'pass') return v;
  }
  if (!Array.isArray(composition.units) || composition.units.length !== coders.length) return fail('composition does not account for every implementation unit');
  const peers = new Set<string>([b.peer]);
  const roots = new Set<string>([resolve(rc.worktree)]);
  const sessions = new Set<string>();
  const nonces = new Set<string>();
  const implemented = new Set<string>();
  if (rc.pdfProbe) {
    const capability = await pdfCapability(rc);
    if (capability.verdict !== 'pass') return capability;
  }
  if (!rc.capabilityFiles?.length) return unknown('independent invocation has no source-execution coverage; team contribution is unproven');
  for (const unit of coders) {
    if (!unit.responsibility?.trim() || !unit.interface?.trim() || !unit.acceptance?.length || !unit.proof?.length ||
        !guide.capabilities.some((c) => c.owner === unit.id && c.path && c.proof?.length)) return fail(`unit ${unit.id} has no implemented capability responsibility`);
    // The loaded seal selects the attempt, never caller-provided delivery/ack SHAs.
    const key = `${unit.id}-${baseline.source_sha}`;
    const dispatchPath = builderRecordPath(context, 'dispatch', key);
    const packetPath = builderRecordPath(context, 'packet', key);
    const ackPath = builderRecordPath(context, 'ack', key);
    const authorizationRefusal = () => fail(`builder-authorization-unverified: ${unit.id} requires packet, ack and dispatch for sealed source ${baseline.source_sha}`);
    const dispatch = record<DispatchReceipt>(rc.fs.readText(dispatchPath), 'dispatch');
    if (!dispatch || dispatch.id !== `dispatch-${key}` || dispatch.unit_id !== unit.id ||
        !checkRef(dispatch.baseline, baselinePath) || !checkRef(dispatch.packet, packetPath) ||
        !checkRef(dispatch.acknowledgement, ackPath)) return authorizationRefusal();
    const packet = readRef<Packet>(dispatch.packet, 'packet');
    const ack = readRef<AckReceipt>(dispatch.acknowledgement, 'ack');
    const allocation = readRef<AllocationRecord>(dispatch.allocation, 'allocation');
    const delivery = composition.units.find((d) => d.unit_id === unit.id);
    if (!packet || !ack || packet.id !== `packet-${key}` || ack.id !== `ack-${key}` ||
        packet.unit?.id !== unit.id || ack.unit_id !== unit.id ||
        !checkRef(packet.baseline, baselinePath) || ack.baseline_sha !== baseline.source_sha ||
        !delivery || delivery.baseline_sha !== baseline.source_sha ||
        !allocation || allocation.base_sha !== baseline.source_sha) return authorizationRefusal();
    if (!oid(delivery.commit_sha)) return fail(`invalid implementation commit ${unit.id}`);
    if (typeof packet.nonce !== 'string' || !packet.nonce.trim() || nonces.has(packet.nonce) || ack.nonce !== packet.nonce) return fail(`missing or replayed packet nonce ${unit.id}`);
    nonces.add(packet.nonce);
    const root = resolve(delivery.workspace);
    if (peers.has(delivery.peer_id) || roots.has(root) || sessions.has(ack.observed?.native_session ?? '')) return fail('implementation peers reuse PM/worker identity, native session or root');
    peers.add(delivery.peer_id); roots.add(root); sessions.add(ack.observed?.native_session ?? '');
    if (delivery.packet_sha256 !== dispatch.packet.sha256 ||
        packet.allocation.sha256 !== dispatch.allocation.sha256 ||
        packet.plan.sha256 !== baseline.plan.sha256 || packet.guide.sha256 !== baseline.guide.sha256 ||
        packet.parent !== b.peer || JSON.stringify(packet.unit) !== JSON.stringify(unit) || resolve(packet.workspace) !== root ||
        ack.peer_id !== delivery.peer_id || ack.packet_sha256 !== dispatch.packet.sha256 ||
        resolve(ack.native_root) !== root || resolve(ack.shell_cwd) !== root || resolve(allocation.root) !== root ||
        allocation.unit_id !== unit.id ||
        !observed(ack.observed, delivery.peer_id, root, 'github-copilot/gpt-6-astra') ||
        !observed(dispatch.observed, delivery.peer_id, root, 'github-copilot/gpt-6-astra') ||
        packet.requested.harness !== 'omp' || packet.requested.model !== 'github-copilot/gpt-6-astra' ||
        JSON.stringify(packet.requested) !== JSON.stringify(dispatch.requested) ||
        (packet.requested.effort !== undefined && packet.requested.effort !== ack.observed.effort)) return fail(`stale or inconsistent team binding ${unit.id}`);
    if (!Number.isFinite(Date.parse(ack.recorded_at)) || Date.parse(ack.recorded_at) < Date.parse(packet.recorded_at) ||
        (dispatch.release && Date.parse(dispatch.release.recorded_at) < Date.parse(ack.recorded_at))) return fail(`stale acknowledgement chronology ${unit.id}`);
    const canary = dispatch.seed_files.find((f) => f.path === packet.canary.path || resolve(root, f.path) === resolve(root, packet.canary.path));
    if (!canary || hash(ack.canary_nonce) !== canary.sha256 || !dispatch.release?.message_id || dispatch.release.outcome !== 'delivered') return fail(`root acknowledgement/release not proven ${unit.id}`);
    for (const path of [dispatchPath, referencePath(dispatch.packet.path), referencePath(dispatch.acknowledgement!.path), referencePath(dispatch.allocation.path)]) {
      const v = await validate(rc, b, path);
      if (v.verdict !== 'pass') return v;
    }
    const native = rc.nativePeers?.get(delivery.peer_id);
    if (!native?.complete) return unknown(`complete native worker evidence unavailable: ${delivery.peer_id}`);
    if (native.native_session !== ack.observed.native_session || resolve(native.root) !== root || native.model !== ack.observed.model) return fail(`native worker differs from acknowledgement: ${delivery.peer_id}`);
    const nativeRoot = await git(rc, ['rev-parse', '--show-toplevel'], root);
    if (!nativeRoot.ok || resolve(nativeRoot.stdout.trim()) !== root) return fail(`unit root is not its native Git root ${unit.id}`);
    const ancestor = await git(rc, ['merge-base', '--is-ancestor', baseline.source_sha, delivery.commit_sha], root);
    const files = await git(rc, ['diff', '--name-only', baseline.source_sha, delivery.commit_sha], root);
    if (!ancestor.ok || !files.ok) return unknown(`unit Git evidence unavailable ${unit.id}; preserve roots/bundles before cleanup`);
    const changed = files.stdout.trim().split('\n').filter(Boolean);
    const inFence = picomatch(unit.paths, { dot: true });
    if (!changed.length || changed.some((p) => !inFence(p))) return fail(`empty or out-of-fence implementation commit ${unit.id}`);
    const code = changed.filter((p) => /\.(?:[cm]?[jt]sx?|py|rs|go|java|cs)$/.test(p) && !/(?:^|\/)(?:tests?|fixtures)(?:\/)|\.(?:test|spec)\./.test(p));
    if (code.some((path) => !/\.[cm]?[jt]sx?$/.test(path)) && !code.some((path) => rc.capabilityFiles!.includes(resolve(rc.worktree, path)))) return unknown(`non-JavaScript capability execution is not measured for ${unit.id}`);
    if (!code.length || !code.some((path) => rc.capabilityFiles!.includes(resolve(rc.worktree, path)))) return fail(`checker-only or non-exercised capability padding ${unit.id}`);
    const writtenPaths = native.turns.flatMap((turn) => turn.items.flatMap((item) => {
      if (item.kind !== 'tool_call' || !object(item.input)) return [];
      if (item.input.kind === 'elided' && typeof item.input.path === 'string') return [resolve(root, item.input.path)];
      return [];
    }));
    if (!code.some((path) => writtenPaths.includes(resolve(root, path)))) return unknown(`native source does not expose implementation write paths for ${unit.id}`);
    for (const path of code) {
      if (implemented.has(path)) return fail(`overlapping implementation ownership ${path}`);
      implemented.add(path);
      const contribution = await git(rc, ['diff', '--numstat', baseline.source_sha, delivery.commit_sha, '--', path], root);
      const composed = await git(rc, ['diff', '--numstat', baseline.source_sha, composition.artifact_sha, '--', path]);
      if (!contribution.ok || !composed.ok || !contribution.stdout.trim() || !composed.stdout.trim()) return fail(`unit contribution absent from composed artifact ${path}`);
    }
  }
  if (peers.has(review.reviewer_id) || !observed(review.observed, review.reviewer_id, review.observed.root, 'github-copilot/claude-opus-5') ||
      review.requested.role !== 'reviewer' || review.requested.harness !== 'omp' || review.requested.model !== 'github-copilot/claude-opus-5' ||
      review.requested.effort !== 'high' || review.observed.effort !== 'high') return fail('reviewer is not independent or requested/observed configuration mismatches');
  const reviewer = rc.nativePeers?.get(review.reviewer_id);
  if (!reviewer?.complete) return unknown('complete native reviewer evidence unavailable');
  if (reviewer.native_session !== review.observed.native_session || reviewer.model !== review.observed.model || reviewer.effort !== 'high' ||
      !reviewer.turns.some((turn) => turn.body.includes(composition.artifact_sha!))) return fail('native review is detached from composed SHA');
  return pass('distinct capability-owning implementations, immutable bindings and independent composed-SHA review; provider identity remains unverified');
  } catch (error) {
    return fail(`malformed team evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
}
