import { ErrorCodes } from '../../output/error-codes.js';
import type { FlowDoc, FlowNode } from '../flow/flow-events.js';
import { listChores } from '../flow/flow-mutations.js';
import { isWithin, resolveInRepo } from '../shared/posix-path.js';
import {
  builderCommand,
  builderGit,
  builderHead,
  loadBuilderGuide,
  verifyBuilderComposition,
} from './composition-service.js';
import { builderContext, builderFailure, readBuilderRecord, sha256 } from './records.js';
import { verifyBuilderReview } from './review-service.js';
import type {
  AdvanceInput,
  AdvanceResult,
  BuilderContext,
  BuilderDeps,
  BuilderResult,
  PreservationReceipt,
} from './types.js';

/** The owning CLI reads the canonical flow; no second lifecycle state is maintained. */
export async function readBuilderFlow(
  deps: BuilderDeps,
  context: BuilderContext,
): Promise<BuilderResult<FlowDoc>> {
  const observed = await builderCommand(deps, deps.harness, [
    'flow',
    'nav',
    'show',
    '--path',
    context.flowPath,
    '--json',
  ]);
  if (!observed.ok) return observed;
  try {
    const response = JSON.parse(observed.value) as { status?: string; data?: { now?: string } };
    const raw = deps.fs.readText(context.flowPath);
    const doc = raw === null ? null : (JSON.parse(raw) as FlowDoc);
    if (
      response.status !== 'ok' ||
      !doc?.provenance ||
      !Array.isArray(doc.nodes) ||
      !doc.nav?.now ||
      response.data?.now !== doc.nav.now
    )
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Canonical flow observation is absent or changed during the read.',
        'Restore the owning flow and retry; do not create team-local phase state.',
      );
    return { ok: true, value: doc };
  } catch {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'The flow reader returned malformed evidence.',
      'Use a compatible harness flow CLI and a valid canonical flow document.',
    );
  }
}

export function builderChoresSatisfied(doc: FlowDoc, at?: string): BuilderResult<true> {
  const unreceipted = listChores(doc, at).filter((chore) => {
    const node = doc.nodes.find((candidate) => candidate.id === chore.id);
    if (chore.status !== 'done' && chore.status !== 'skipped') return true;
    return !node?.comments?.some(
      (comment) =>
        comment.text.trim().length > 0 &&
        Number.isFinite(Date.parse(comment.at)) &&
        (chore.status === 'skipped'
          ? comment.kind === 'decision' && comment.source === 'user'
          : comment.kind === 'validation' &&
            (comment.source === 'agent' || comment.source === 'system')),
    );
  });
  return unreceipted.length
    ? builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        'Required harness chores are due or lack a real attempt/decline receipt.',
        'Run each due chore and append its real validation receipt, or record the human decision before skipping.',
        unreceipted,
      )
    : { ok: true, value: true };
}

function stage(node: FlowNode, prefix: string): boolean {
  return node.type === prefix || node.id === prefix || node.id.startsWith(`${prefix}-`);
}

export async function verifyBuilderPreservation(
  deps: BuilderDeps,
  receipt: PreservationReceipt,
): Promise<BuilderResult<true>> {
  const survivor = deps.fs.realpath(resolveInRepo(receipt.survivor_root, deps.repoRoot));
  const retiring = receipt.retiring_roots.map((root) =>
    deps.fs.realpath(resolveInRepo(root, deps.repoRoot)),
  );
  const sourceRoot = deps.fs.realpath(resolveInRepo(receipt.source_root, deps.repoRoot));
  if (
    !survivor ||
    !sourceRoot ||
    !retiring.includes(sourceRoot) ||
    retiring.some((root) => !root || isWithin(root, survivor) || isWithin(survivor, root))
  )
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'The surviving copy is missing or overlaps a retiring root.',
      'Preserve evidence in a real destination outside every removable workspace.',
    );
  if (!receipt.inventory.length || !receipt.refs.length)
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'Preservation contains no inventory or Git refs.',
      'Preserve both evidence bytes and reachable Git objects before teardown.',
    );
  for (const item of receipt.inventory) {
    const destination = resolveInRepo(item.destination, deps.repoRoot);
    const path = deps.fs.realpath(destination);
    const bytes =
      path && isWithin(survivor, path) && !retiring.some((root) => root && isWithin(root, path))
        ? deps.fs.readBytesNoFollow(destination)
        : null;
    if (!bytes || bytes.byteLength !== item.bytes || sha256(bytes) !== item.sha256)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Preserved evidence is missing or changed: ${item.destination}`,
        'Refresh and verify preservation before removing any workspace.',
      );
    let source: Uint8Array | null;
    if (item.source.startsWith('git-diff:')) {
      const recipe = /^git-diff:(.+)#(working-tree|index)$/.exec(item.source);
      if (!recipe?.[1] || !recipe[2] || resolveInRepo(recipe[1], deps.repoRoot) !== recipe[1])
        return builderFailure(
          ErrorCodes.BUILDER_PRESERVATION,
          'Unknown computed evidence recipe.',
          'Use the explicit git-diff:<absolute repo>#working-tree or #index recipe.',
        );
      const root = deps.fs.realpath(recipe[1]);
      if (!root || !retiring.includes(root))
        return builderFailure(
          ErrorCodes.BUILDER_PRESERVATION,
          'Computed evidence names an unrelated repository.',
          'Bind WIP to an actual retiring root.',
        );
      const replay = await builderGit(
        deps,
        recipe[2] === 'index' ? ['diff', '--cached', '--binary'] : ['diff', '--binary'],
        root,
      );
      if (!replay.ok) return replay;
      source = new TextEncoder().encode(replay.value);
    } else source = deps.fs.readBytesNoFollow(resolveInRepo(item.source, deps.repoRoot));
    if (!source || source.byteLength !== item.bytes || sha256(source) !== item.sha256)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Source evidence changed after preservation: ${item.source}`,
        'Refresh preservation from the final source state before teardown.',
      );
  }
  for (const ref of receipt.refs) {
    const source = await builderGit(
      deps,
      ['rev-parse', '--verify', ref.source_ref],
      resolveInRepo(ref.source_repo, deps.repoRoot),
    );
    if (!source.ok) return source;
    if (source.value.trim() !== ref.oid)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Source ref changed after preservation: ${ref.source_ref}`,
        'Refresh the retained objects and receipt from the final source refs.',
      );
    const repository = deps.fs.realpath(resolveInRepo(ref.destination_repo, deps.repoRoot));
    if (
      !repository ||
      !isWithin(survivor, repository) ||
      retiring.some((root) => root && isWithin(root, repository))
    )
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        'A preserved ref is not in the surviving repository.',
        'Copy the referenced objects into the named survivor.',
      );
    const actual = await builderGit(
      deps,
      ['rev-parse', '--verify', ref.destination_ref],
      repository,
    );
    if (!actual.ok) return actual;
    if (actual.value.trim() !== ref.oid)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Preserved ref changed: ${ref.destination_ref}`,
        'Restore and re-verify the required Git objects.',
      );
    const exists = await builderGit(deps, ['cat-file', '-e', `${ref.oid}^{object}`], repository);
    if (!exists.ok) return exists;
  }
  return { ok: true, value: true };
}

export async function advanceBuilderStage(
  deps: BuilderDeps,
  input: AdvanceInput,
): Promise<BuilderResult<AdvanceResult>> {
  const loaded = loadBuilderGuide(deps, input.plan);
  // Research/plan may legitimately precede the first implementation guide.
  const contextResult = loaded.ok ? { ok: true as const, value: loaded.value.context } : undefined;
  const context = contextResult ?? builderContext(deps, input.plan);
  if (!context.ok) return context;
  const head = await builderHead(deps);
  if (!head.ok) return head;
  const flow = await readBuilderFlow(deps, context.value);
  if (!flow.ok) return flow;
  const current = flow.value.nodes.find((node) => node.id === flow.value.nav?.now);
  const destination = flow.value.nodes.find((node) => node.id === input.now);
  if (!current || !destination || destination.chore || !current.next.includes(destination.id))
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'Builder advances only to an adjacent canonical stage.',
      'Use the current flow successor; stage jumps and team-local phases are not supported.',
    );
  const chores = builderChoresSatisfied(flow.value, current.id);
  if (!chores.ok) return chores;
  if (stage(current, 'impl-guide') || stage(destination, 'phase')) {
    if (!loaded.ok) return loaded;
    const checked = await builderCommand(deps, deps.harness, [
      'builder',
      'guide',
      input.plan,
      '--check',
      '--json',
    ]);
    if (!checked.ok) return checked;
    const reviewed = await verifyBuilderReview(
      deps,
      context.value,
      loaded.value.guide.value,
      'decomposition',
    );
    if (!reviewed.ok) return reviewed;
    // Baseline sealing is an implementation substep, not a prerequisite for entering it.
  }
  if (stage(current, 'phase') || stage(current, 'review') || stage(current, 'post-flight')) {
    if (!loaded.ok) return loaded;
    const composed = await verifyBuilderComposition(deps, context.value, loaded.value.guide.value);
    if (!composed.ok) return composed;
  }
  if (stage(current, 'review') || stage(current, 'post-flight')) {
    if (!loaded.ok) return loaded;
    const reviewed = await verifyBuilderReview(
      deps,
      context.value,
      loaded.value.guide.value,
      'composition',
    );
    if (!reviewed.ok) return reviewed;
  }
  if (stage(current, 'post-flight')) {
    const locators = current.comments?.filter((comment) => comment.kind === 'builder-preservation');
    const locator = locators?.[locators.length - 1];
    if (!locator?.text.trim())
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        'Post-flight has no external preservation locator.',
        'Run builder close; a locator is not proof until its external receipt verifies.',
      );
    const receiptPath = resolveInRepo(locator.text, deps.repoRoot);
    const preserved = readBuilderRecord<PreservationReceipt>(deps, receiptPath, 'preservation');
    if (!preserved.ok) return preserved;
    if (!isWithin(resolveInRepo(preserved.value.value.survivor_root, deps.repoRoot), receiptPath))
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        'The preservation receipt is not stored in its survivor.',
        'Use the verified external receipt, not a mutable in-tree mirror.',
      );
    if (resolveInRepo(preserved.value.value.archived_plan, deps.repoRoot) !== context.value.planDir)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        'Post-flight has not archived this complete plan.',
        'Run builder close and use the re-anchored archive path.',
      );
    const verified = await verifyBuilderPreservation(deps, preserved.value.value);
    if (!verified.ok) return verified;
  }
  const moved = await builderCommand(deps, deps.harness, [
    'flow',
    'nav',
    'set',
    '--path',
    context.value.flowPath,
    '--now',
    input.now,
    '--json',
  ]);
  if (!moved.ok) return moved;
  const after = await readBuilderFlow(deps, context.value);
  if (!after.ok) return after;
  return after.value.nav?.now === input.now
    ? { ok: true, value: { flow: context.value.flowPath, now: input.now } }
    : builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'The owning flow did not reach the requested stage.',
        'Inspect the canonical flow result; no shipping action was authorized or performed.',
      );
}
