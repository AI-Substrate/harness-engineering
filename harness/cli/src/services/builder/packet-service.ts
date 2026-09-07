import { ErrorCodes } from '../../output/error-codes.js';
import {
  isWithin,
  posixDirname,
  posixJoin,
  posixRelative,
  resolveInRepo,
} from '../shared/posix-path.js';
import {
  builderFailure,
  builderRecordPath,
  digestBuilderFile,
  readBuilderDocument,
  readBuilderRecord,
  sha256,
  writeBuilderRecord,
} from './records.js';
import type {
  AllocationRecord,
  BaselineReceipt,
  BuilderContext,
  BuilderDeps,
  BuilderResult,
  FileDigest,
  Packet,
  RoleBinding,
  Stored,
  Unit,
} from './types.js';

export function builderAttemptFailure() {
  return builderFailure(
    ErrorCodes.BUILDER_ACK,
    'Current sealed-baseline authorization is missing or mismatched.',
    'Read the current guide-bound seal and prepare its qualified attempt; historical records do not authorize work.',
  );
}

/** Resolve authority from the live guide, never from a caller-supplied acknowledgement SHA. */
export function readCurrentBuilderBaseline(
  deps: BuilderDeps,
  context: BuilderContext,
): BuilderResult<Stored<BaselineReceipt>> {
  const guide = readBuilderDocument(deps, context.guidePath, 'builder/impl-guide');
  if (!guide.ok) return builderAttemptFailure();
  const sections = guide.value.value.sections.filter((section) => section.name === 'baseline');
  const declaration = sections[0]?.value;
  if (
    sections.length !== 1 ||
    declaration === null ||
    typeof declaration !== 'object' ||
    !('receipt' in declaration) ||
    typeof declaration.receipt !== 'string'
  )
    return builderAttemptFailure();
  const path = resolveInRepo(declaration.receipt, posixDirname(context.guidePath));
  if (!isWithin(deps.repoRoot, path)) return builderAttemptFailure();
  const baseline = readBuilderRecord<BaselineReceipt>(deps, path, 'baseline');
  if (!baseline.ok || !/^[0-9a-f]{40}$/.test(baseline.value.value.source_sha))
    return builderAttemptFailure();
  const sealed = baseline.value.value;
  if (
    resolveInRepo(sealed.plan.path, deps.repoRoot) !== context.planPath ||
    resolveInRepo(sealed.guide.path, deps.repoRoot) !== context.guidePath ||
    sealed.guide.sha256 !== guide.value.ref.sha256
  )
    return builderAttemptFailure();
  return baseline;
}

function unaliasedParent(deps: BuilderDeps, root: string, target: string): boolean {
  if (!isWithin(root, target) || deps.fs.realpath(root) !== root) return false;
  let parent = posixDirname(target);
  while (!deps.fs.exists(parent)) {
    const next = posixDirname(parent);
    if (next === parent || !isWithin(root, next)) return false;
    parent = next;
  }
  return deps.fs.realpath(parent) === parent;
}

/** Seed paths are relative to the isolated root, never broad untracked-file exemptions. */
export function seedBuilderFile(
  deps: BuilderDeps,
  root: string,
  ref: FileDigest,
): BuilderResult<FileDigest[]> {
  const source = resolveInRepo(ref.path, deps.repoRoot);
  if (!isWithin(deps.repoRoot, source)) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      `Cannot seed an external input: ${ref.path}`,
      'Keep immutable plan inputs inside the PM repository.',
    );
  }
  const relative = posixRelative(deps.repoRoot, source);
  const target = resolveInRepo(relative, root);
  const identity = deps.fs.normalizeBundleTargetIdentity(target);
  if (!isWithin(root, identity) || identity !== target || !unaliasedParent(deps, root, target)) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      `Seed target is aliased or outside the clone: ${relative}`,
      'Use a regular, isolated checkout without seed-path symlinks.',
    );
  }
  const bytes = deps.fs.readBytesNoFollow(source);
  if (bytes === null || sha256(bytes) !== ref.sha256) {
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      `Immutable input changed: ${ref.path}`,
      'Reassess readiness and freeze a new baseline before dispatch.',
    );
  }
  const existing = deps.fs.readBytesNoFollow(target);
  if (existing !== null) {
    if (sha256(existing) !== ref.sha256) {
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        `Seed conflicts with clone contents: ${relative}`,
        'Preserve the differing checkout; provision a clean workspace at the approved baseline.',
      );
    }
  } else {
    // Missing seed files are DD JSON, rendered text, or a plaintext root challenge.
    // Frozen source/binary files must already exist in the baseline checkout.
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        `Seed is not UTF-8 text: ${relative}`,
        'Commit binary inputs into the approved baseline rather than overlaying them.',
      );
    }
    deps.fs.mkdirp(posixDirname(target));
    if (!deps.fs.createExclusive(target, text)) {
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        `Cannot exclusively seed ${relative}.`,
        'Inspect the existing path; do not overwrite another writer.',
      );
    }
  }
  return { ok: true, value: [{ path: relative, sha256: ref.sha256 }] };
}

export function seedBuilderInputs(
  deps: BuilderDeps,
  root: string,
  baseline: Stored<BaselineReceipt>,
): BuilderResult<FileDigest[]> {
  const seeds: FileDigest[] = [];
  for (const ref of [
    baseline.value.plan,
    baseline.value.guide,
    baseline.ref,
    baseline.value.review,
  ]) {
    const copied = seedBuilderFile(deps, root, ref);
    if (!copied.ok) return copied;
    seeds.push(...copied.value);
    const face = ref.path.endsWith('.dd.json') ? `${ref.path.slice(0, -5)}.md` : undefined;
    if (face && deps.fs.exists(resolveInRepo(face, deps.repoRoot))) {
      const digest = digestBuilderFile(deps, face);
      if (!digest.ok) return digest;
      const copiedFace = seedBuilderFile(deps, root, digest.value);
      if (!copiedFace.ok) return copiedFace;
      seeds.push(...copiedFace.value);
    }
  }
  for (const ref of baseline.value.files) {
    const source = resolveInRepo(ref.path, deps.repoRoot);
    if (!isWithin(deps.repoRoot, source)) {
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        `Frozen source escapes repository: ${ref.path}`,
        'Keep baseline files repository-relative.',
      );
    }
    const target = resolveInRepo(posixRelative(deps.repoRoot, source), root);
    const bytes = deps.fs.readBytesNoFollow(target);
    if (bytes === null || sha256(bytes) !== ref.sha256) {
      return builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        `Clone does not contain frozen input ${ref.path}.`,
        'Provision from the exact baseline commit; never overlay changed source files.',
      );
    }
  }
  return { ok: true, value: seeds };
}

export function prepareBuilderPacket(
  deps: BuilderDeps,
  input: {
    context: BuilderContext;
    baseline: Stored<BaselineReceipt>;
    allocation: Stored<AllocationRecord>;
    unit: Unit;
    parent: string;
    requested: RoleBinding;
    nonce: string;
  },
): BuilderResult<{ packet: Stored<Packet>; seeds: FileDigest[] }> {
  const { context, baseline, allocation, unit, parent, requested, nonce } = input;
  const current = readCurrentBuilderBaseline(deps, context);
  if (!current.ok) return current;
  if (
    current.value.value.source_sha !== baseline.value.source_sha ||
    current.value.ref.sha256 !== baseline.ref.sha256 ||
    resolveInRepo(current.value.ref.path, deps.repoRoot) !==
      resolveInRepo(baseline.ref.path, deps.repoRoot) ||
    allocation.value.base_sha !== baseline.value.source_sha
  )
    return builderAttemptFailure();
  const attempt = `${unit.id}-${current.value.value.source_sha}`;
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Invalid packet nonce.',
      'Supply a unique filename-safe nonce.',
    );
  }
  const root = allocation.value.root;
  const canaryPath = posixRelative(
    deps.repoRoot,
    posixJoin(context.teamDir, `canary-${attempt}.txt`),
  );
  const canaryTarget = resolveInRepo(canaryPath, root);
  const challenge = deps.nonce();
  if (!challenge || challenge === nonce || !/^[A-Za-z0-9_-]+$/.test(challenge)) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Root challenge must be distinct from the public packet nonce.',
      'Provide independent unique nonces for packet and native-root challenge.',
    );
  }
  if (
    deps.fs.normalizeBundleTargetIdentity(canaryTarget) !== canaryTarget ||
    !unaliasedParent(deps, root, canaryTarget)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Root challenge target is aliased.',
      'Remove seed-path aliases before dispatch.',
    );
  }
  deps.fs.mkdirp(posixDirname(canaryTarget));
  if (!deps.fs.createExclusive(canaryTarget, challenge)) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      'Root challenge already exists or cannot be created.',
      'Keep the original challenge; investigate the interrupted dispatch before retrying.',
    );
  }
  const packet: Packet = {
    record_type: 'packet',
    id: `packet-${attempt}`,
    recorded_at: deps.clock.nowIso(),
    nonce,
    unit,
    plan: baseline.value.plan,
    guide: baseline.value.guide,
    baseline: baseline.ref,
    allocation: { ...allocation.ref, path: resolveInRepo(allocation.ref.path, deps.repoRoot) },
    workspace: root,
    parent,
    requested,
    forbidden: [
      '.the-flow-state.json',
      'the-flow.json',
      'the-flow.md',
      posixRelative(deps.repoRoot, context.planPath),
      posixRelative(deps.repoRoot, context.guidePath),
      posixRelative(deps.repoRoot, context.teamDir),
      '.harness/government/',
      'All source paths outside unit.paths; sibling implementations; global settings and deployed skills.',
      'Pushes, merges, canonical lifecycle mutations and nested peers without PM approval.',
    ],
    canary: { path: canaryPath },
    instructions: [
      'ACKNOWLEDGEMENT ONLY. Read this packet and the canary through native repository-relative file tools, not shell cwd or absolute-path substitution.',
      `Confirm HEAD ${baseline.value.source_sha}, native root ${root}, peer/session/PID and observed runtime configuration. Requested launch settings are not provider attestation; omit unspecified effort and name observation gaps.`,
      `Before work, write a raw AckReceipt JSON with record_type ack, id ack-${attempt}, nonce equal to packet.nonce, recorded_at, unit_id, peer_id, packet_sha256, baseline_sha (full Git SHA), native_root, shell_cwd, canary_nonce and observed. RuntimeObservation includes peer_id, root, ready, evidence, gaps and only actually observed harness/model/effort/native_session/pid/argv.`,
      `Send its path and SHA-256 to ${parent} for ingestion through builder ack <plan> --receipt <path>. Do not edit source until an IMPLEMENTATION RELEASE names your peer, unit, nonce and exact packet digest. Queued transport is not observed receipt.`,
      `Only after observing that exact release, natively re-read this packet and canary and create a NEW raw AckReceipt with id ack-${attempt}-release. Keep the same unit/peer/packet/baseline/root/canary and freshly observed runtime bindings; set nonce to the already-issued release.message_id, independently of packet.nonce. Use your actual receipt creation time as recorded_at: it must not precede release.recorded_at minus 5000 ms or exceed PM ingestion time plus 5000 ms. Never reuse or overwrite the pre-work receipt.`,
      `Send the new post-release receipt path and SHA-256 to ${parent} for the SAME builder ack <plan> --receipt <path> command before import. This confirms an existing grant; it never requests or sends a second grant. Continue the already-authorized scoped work without waiting for another release.`,
      'After release, implement the complete unit responsibility/interface/acceptance within unit.paths; consume frozen reads rather than sibling implementation code. Already-working descendants can confirm their retained release without replaying work. Report scoped committed delivery and evidence to the PM.',
    ],
  };
  const stored = writeBuilderRecord(deps, builderRecordPath(context, 'packet', attempt), packet);
  if (!stored.ok) return stored;
  const seeds: FileDigest[] = [{ path: canaryPath, sha256: sha256(challenge) }];
  const copied = seedBuilderFile(deps, root, stored.value.ref);
  if (!copied.ok) return copied;
  seeds.push(...copied.value);
  const face = digestBuilderFile(deps, `${stored.value.ref.path.slice(0, -5)}.md`);
  if (!face.ok) return face;
  const copiedFace = seedBuilderFile(deps, root, face.value);
  if (!copiedFace.ok) return copiedFace;
  seeds.push(...copiedFace.value);
  return { ok: true, value: { packet: stored.value, seeds } };
}
