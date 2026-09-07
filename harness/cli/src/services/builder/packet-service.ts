import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixRelative, resolveInRepo } from '../shared/posix-path.js';
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
    ErrorCodes.BUILDER_NOT_READY,
    'Current sealed-baseline authorization is missing or mismatched.',
    'Read the current guide-bound seal and prepare its qualified attempt; historical records do not authorize work.',
  );
}

/** Resolve the dispatch baseline from the live guide, never a caller-supplied SHA. */
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
    // Missing seed files are immutable DD JSON or rendered text.
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
  const plan = readBuilderDocument(deps, context.planPath, 'builder/plan');
  if (!plan.ok) return plan;
  if (plan.value.ref.sha256 !== baseline.value.plan.sha256) return builderAttemptFailure();
  const criteria = plan.value.value.sections.find(
    (section) => section.name === 'acceptance_criteria',
  )?.value;
  const claims = new Map<string, string>();
  if (Array.isArray(criteria))
    for (const criterion of criteria)
      if (
        criterion !== null &&
        typeof criterion === 'object' &&
        'id' in criterion &&
        typeof criterion.id === 'string' &&
        'claim' in criterion &&
        typeof criterion.claim === 'string'
      )
        claims.set(criterion.id, criterion.claim);
  const acceptance = unit.acceptance.map((address) => {
    const [file, anchor, extra] = address.split('#');
    const id = /^acceptance_criteria\/([^/]+)$/.exec(anchor ?? '')?.[1];
    const claim =
      extra === undefined &&
      resolveInRepo(file, posixDirname(context.guidePath)) === context.planPath &&
      id
        ? claims.get(id)
        : undefined;
    return claim ? `${claim} (${address})` : address;
  });
  const packet: Packet = {
    record_type: 'packet',
    id: `packet-${attempt}`,
    recorded_at: deps.clock.nowIso(),
    nonce,
    unit,
    plan: baseline.value.plan,
    guide: baseline.value.guide,
    baseline: baseline.ref,
    source_sha: baseline.value.source_sha,
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
    instructions: [
      `You own ${unit.paths.join(', ')}.`,
      `You may read ${unit.reads.map((read) => `${read.paths.join(', ')} (owner ${read.owner})`).join('; ')}; immutable plan ${baseline.value.plan.path} and guide ${baseline.value.guide.path}.`,
      `Your job: ${unit.responsibility}`,
      `Done means ${acceptance.join('; ')}. Interface: ${unit.interface}. Proof: ${unit.proof.join(', ')}.`,
      `Work packet: ${posixRelative(deps.repoRoot, builderRecordPath(context, 'packet', attempt))}. Use the measured SHA-256 in the dispatch message for the optional advisory builder self-check.`,
      `Expected checkout ${root}; source commit ${baseline.value.source_sha}. A self-check warning names a mismatch to inspect; it is not permission or a second work grant.`,
      `Receiving this packet means do the unit within its map. Consume frozen reads rather than sibling implementation code. Return scoped commits and proof to ${parent}.`,
    ],
  };
  const stored = writeBuilderRecord(deps, builderRecordPath(context, 'packet', attempt), packet);
  if (!stored.ok) return stored;
  const seeds: FileDigest[] = [];
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
