import { ErrorCodes } from '../../output/error-codes.js';
import {
  isWithin,
  posixDirname,
  posixJoin,
  posixRelative,
  resolveInRepo,
} from '../shared/posix-path.js';
import {
  builderCommand,
  builderGit,
  builderHead,
  loadBuilderGuide,
  sameBuilderFile,
  verifyBuilderComposition,
} from './composition-service.js';
import {
  builderChoresSatisfied,
  readBuilderFlow,
  verifyBuilderPreservation,
} from './lifecycle-service.js';
import {
  builderFailure,
  isBuilderPreservationExcluded,
  readBuilderRecord,
  sha256,
  writeBuilderRecord,
} from './records.js';
import { verifyBuilderReview } from './review-service.js';
import { stageBuilderSchemas } from './schema-service.js';
import type {
  AllocationRecord,
  BuilderDeps,
  BuilderResult,
  CloseInput,
  CloseResult,
  PreservationReceipt,
  PreservedItem,
  PreservedRef,
} from './types.js';

/** Enumerate data rather than git-visible paths: ignored reports are still data. */
function workspaceFiles(
  deps: BuilderDeps,
  root: string,
  excluded: (relativePath: string) => boolean,
): BuilderResult<string[]> {
  const files: string[] = [];
  const pending = [''];
  while (pending.length) {
    const relative = pending.pop() as string;
    const directory = posixJoin(root, relative);
    const names = deps.fs.readdir(directory);
    if (!names.length && deps.fs.listRegularFilesNoFollow(directory) === null)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Cannot enumerate workspace directory: ${directory}`,
        'Restore readable regular data; non-regular data is not silently skipped.',
      );
    for (const name of names) {
      const child = posixJoin(relative, name);
      if (excluded(child)) continue;
      const path = posixJoin(root, child);
      const probe = deps.fs.probeRegularFileNoFollow(root, path, Number.MAX_SAFE_INTEGER);
      if (probe.status === 'ok') files.push(child);
      else if (probe.reason === 'non-file') pending.push(child);
      else
        return builderFailure(
          ErrorCodes.BUILDER_PRESERVATION,
          `Cannot preserve ${path}: ${probe.reason}`,
          'Restore a readable regular file or explicitly diagnose the non-regular entry before retirement.',
        );
    }
  }
  return { ok: true, value: files.sort() };
}

/** Archive and preservation are distinct: the former moves with the plan, the latter must survive it. */
export async function closeBuilderPlan(
  deps: BuilderDeps,
  input: CloseInput,
): Promise<BuilderResult<CloseResult>> {
  const loaded = loadBuilderGuide(deps, input.plan);
  if (!loaded.ok) return loaded;
  const { context, guide } = loaded.value;
  const head = await builderHead(deps);
  if (!head.ok) return head;
  const composed = await verifyBuilderComposition(deps, context, guide.value);
  if (!composed.ok) return composed;
  const reviewed = await verifyBuilderReview(deps, context, guide.value, 'composition');
  if (!reviewed.ok) return reviewed;
  const flow = await readBuilderFlow(deps, context);
  if (!flow.ok) return flow;
  const current = flow.value.nodes.find((node) => node.id === flow.value.nav?.now);
  const postFlight = flow.value.nodes.find(
    (node) => node.id === 'post-flight' || node.type === 'post-flight',
  );
  const archived = isWithin(posixJoin(deps.repoRoot, 'docs/plans/archive'), context.planDir);
  const refreshing =
    archived &&
    postFlight?.status === 'done' &&
    (current?.id === 'ship' || current?.type === 'ship');
  if (!current || !postFlight || (current.id !== postFlight.id && !refreshing))
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'Closeout requires post-flight, or an evidence refresh after archived post-flight completion.',
      'Complete review and advance to post-flight; refresh may run at ship but never authorizes shipping.',
    );
  const chores = builderChoresSatisfied(flow.value);
  if (!chores.ok) return chores;
  const unfinished = flow.value.nodes.filter(
    (node) =>
      !node.chore &&
      node.id !== postFlight.id &&
      node.type !== 'ship' &&
      node.id !== 'ship' &&
      node.type !== 'reconcile' &&
      node.status !== 'done' &&
      node.status !== 'skipped',
  );
  if (unfinished.length)
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'Earlier lifecycle work is not complete.',
      'Complete the preceding stages honestly before closing the plan.',
      unfinished.map((node) => node.id),
    );
  // Structural/semantic validity is required here; whole-plan completion belongs to post-flight EXIT.
  const valid = await builderCommand(deps, deps.harness, [
    'plan',
    'validate',
    context.planPath,
    '--json',
  ]);
  if (!valid.ok) return valid;
  if (
    !input.allocations.length ||
    new Set(input.allocations.map((row) => row.value.id)).size !== input.allocations.length
  )
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'Closeout requires an exact, non-duplicate allocation inventory.',
      'Supply every workspace that may be retired.',
    );
  const roots: string[] = [];
  for (const allocation of input.allocations) {
    const bound = sameBuilderFile(deps, allocation.ref);
    if (!bound.ok) return bound;
    const authorityRecord = readBuilderRecord<AllocationRecord>(
      deps,
      allocation.ref.path,
      'allocation',
    );
    if (!authorityRecord.ok) return authorityRecord;
    if (JSON.stringify(authorityRecord.value.value) !== JSON.stringify(allocation.value))
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        'Allocation input differs from its authoritative record.',
        'Use the exact persisted allocation, not a modified in-memory claim.',
      );
    const root = deps.fs.realpath(allocation.value.root);
    const authority = deps.fs.realpath(allocation.value.authority_root);
    if (
      !root ||
      !authority ||
      allocation.value.retired_at ||
      isWithin(root, resolveInRepo(allocation.ref.path, deps.repoRoot))
    )
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Invalid allocation authority: ${allocation.value.id}`,
        'Use the retained authoritative allocation record outside its removable workspace.',
      );
    roots.push(root);
  }
  const ownRoot = deps.fs.realpath(deps.repoRoot);
  if (!ownRoot)
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'The source repository root cannot be resolved.',
      'Restore the native repository before closeout.',
    );
  const retiring = [...new Set([...roots, ownRoot])];
  let survivor: string;
  try {
    survivor = deps.fs.normalizeBundleTargetIdentity(resolveInRepo(input.survivor, deps.repoRoot));
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      String(error),
      'Choose a resolvable surviving destination.',
    );
  }
  if (retiring.some((root) => isWithin(root, survivor) || isWithin(survivor, root)))
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'The survivor overlaps a removable workspace.',
      'Choose a separate destination outside every retiring root, not a symlink or an ancestor.',
    );
  const categories = new Set(input.evidence.map((item) => item.category));
  if (!categories.has('observation') || !categories.has('telemetry'))
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'Required observation/telemetry evidence was not named.',
      'Pass the actual observation and telemetry artifacts in --evidence, including explicit empty captures when no events occurred.',
    );
  const additional: Array<{
    source: string;
    bytes: Uint8Array;
    category: PreservedItem['category'];
  }> = [];
  for (const item of input.evidence) {
    const source = resolveInRepo(item.path, deps.repoRoot);
    const files = deps.fs.readBytesNoFollow(source);
    if (files === null)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        `Required evidence is unreadable: ${source}`,
        'Supply real regular-file evidence; missing or symlinked artifacts are not preserved.',
      );
    additional.push({ source, bytes: files, category: item.category });
  }
  const originalFiles = deps.fs.listRegularFilesNoFollow(context.planDir);
  if (!originalFiles?.length)
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      'The complete plan folder cannot be safely enumerated.',
      'Remove symlinks/non-regular entries or preserve them through an explicit supported capability.',
    );
  const slug = context.planDir.slice(context.planDir.lastIndexOf('/') + 1);
  const archive = posixJoin(deps.repoRoot, 'docs/plans/archive', slug);
  const isArchived = context.planDir === archive;
  if (!isArchived && deps.fs.exists(archive))
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Archive already exists: ${archive}`,
      'Use the existing archived plan explicitly; never overwrite another archive.',
    );
  const generation = deps.nonce();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(generation))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Invalid preservation generation identifier.',
      'Provide a path-safe nonce.',
    );
  const destination = posixJoin(survivor, generation);
  // Keep schema discovery for the control record separate from copied workspace data.
  const receiptRoot = posixJoin(destination, 'receipt');
  const receiptPath = posixJoin(receiptRoot, 'preservation.dd.json');
  if (deps.fs.exists(destination))
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      'Preservation generation already exists.',
      'Use a fresh generation; verified evidence is immutable.',
    );
  const inventory: PreservedItem[] = [];
  const refs: PreservedRef[] = [];
  try {
    deps.fs.mkdirp(destination);
    const actualSurvivor = deps.fs.realpath(destination);
    if (!actualSurvivor || retiring.some((root) => isWithin(root, actualSurvivor)))
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        'The destination resolves into a retiring root.',
        'Choose a real independent destination.',
      );
    deps.fs.mkdirp(receiptRoot);
    const receiptSchemas = stageBuilderSchemas(deps, receiptRoot);
    if (!receiptSchemas.ok) return receiptSchemas;
    const preserve = (
      source: string,
      relative: string,
      bytes: Uint8Array,
      category: PreservedItem['category'],
      live = true,
    ): void => {
      const target = posixJoin(destination, relative);
      deps.fs.mkdirp(posixDirname(target));
      deps.fs.writeBytes(target, bytes);
      const copied = deps.fs.readBytesNoFollow(target);
      if (!copied || sha256(copied) !== sha256(bytes))
        throw new Error(`Preservation verification failed: ${target}`);
      if (live)
        inventory.push({
          source,
          destination: target,
          sha256: sha256(bytes),
          bytes: bytes.byteLength,
          category,
        });
    };
    // Preserve all local refs, including attribution notes, plus HEAD for every participating root.
    const objectRepo = posixJoin(destination, 'git');
    const initialized = await builderGit(deps, ['init', '--bare', objectRepo]);
    if (!initialized.ok) return initialized;
    for (const [index, root] of retiring.entries()) {
      const listed = await builderGit(
        deps,
        ['for-each-ref', '--format=%(refname) %(objectname)'],
        root,
      );
      if (!listed.ok) return listed;
      const sourceHead = await builderGit(deps, ['rev-parse', 'HEAD'], root);
      if (!sourceHead.ok) return sourceHead;
      const required = [
        ['HEAD', sourceHead.value.trim()],
        ...listed.value
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split(' ')),
      ];
      if (root === ownRoot)
        required.push([
          composed.value.value.artifact_sha as string,
          composed.value.value.artifact_sha as string,
        ]);
      for (const [refIndex, pair] of required.entries()) {
        const [sourceRef, oid] = pair;
        if (!sourceRef || !oid || !/^[a-f0-9]{40}$/.test(oid))
          return builderFailure(
            ErrorCodes.BUILDER_PRESERVATION,
            'Git returned an invalid preservation ref.',
            'Restore the source repository refs before closeout.',
          );
        const target = `refs/builder/preserved/root-${index}/ref-${refIndex}`;
        const copied = await builderGit(
          deps,
          ['fetch', '--no-tags', '--no-write-fetch-head', '--', root, `${oid}:${target}`],
          objectRepo,
        );
        if (!copied.ok) return copied;
        refs.push({
          source_repo: root,
          source_ref: sourceRef,
          oid,
          destination_repo: objectRepo,
          destination_ref: target,
        });
      }
    }
    // The pre-move snapshot is recoverable even if the owning relocation command fails.
    for (const file of originalFiles) {
      const source = posixJoin(context.planDir, file);
      const bytes = deps.fs.readBytesNoFollow(source);
      if (!bytes) throw new Error(`Plan file disappeared before archive: ${source}`);
      preserve(source, `before-archive/${file}`, bytes, 'artifact', false);
    }
    if (!isArchived) {
      deps.fs.mkdirp(posixDirname(archive));
      deps.fs.rename(context.planDir, archive);
    }
    const archiveFlow = posixJoin(archive, 'the-flow.json');
    const relocated = await builderCommand(deps, deps.harness, [
      'flow',
      'relocate',
      '--path',
      archiveFlow,
      '--to',
      posixRelative(deps.repoRoot, archive),
      '--json',
    ]);
    if (!relocated.ok) return relocated;
    const links = await builderCommand(deps, deps.ddocs, ['doctor', '--path', archive, '--json']);
    if (!links.ok) return links;
    const postFlightPath = posixJoin(archive, 'assets/post-flight.json');
    const report = {
      recorded_at: deps.clock.nowIso(),
      composed_sha: composed.value.value.artifact_sha,
      composition: composed.value.ref,
      review: reviewed.value.ref,
      flow: archiveFlow,
      archive,
      survivor: destination,
      shipping_authorized: false,
      chores: flow.value.nodes
        .filter((node) => node.chore)
        .map((node) => ({ id: node.id, status: node.status, comments: node.comments })),
      evidence: input.evidence,
    };
    deps.fs.mkdirp(posixDirname(postFlightPath));
    deps.fs.writeText(postFlightPath, `${JSON.stringify(report, null, 2)}\n`);
    // Reserve discovery before measuring the final tree. This comment is only a
    // locator: the external record is written last and absence fails closed.
    const located = await builderCommand(deps, deps.harness, [
      'flow',
      'comment',
      '--path',
      archiveFlow,
      '--node',
      postFlight.id,
      '--kind',
      'builder-preservation',
      '--source',
      'agent',
      '--text',
      receiptPath,
      '--json',
    ]);
    if (!located.ok) return located;
    const finalFlow = await readBuilderFlow(deps, { ...context, flowPath: archiveFlow });
    if (!finalFlow.ok) return finalFlow;
    const locators = finalFlow.value.nodes
      .find((node) => node.id === postFlight.id)
      ?.comments?.filter((comment) => comment.kind === 'builder-preservation');
    if (locators?.[locators.length - 1]?.text !== receiptPath)
      return builderFailure(
        ErrorCodes.BUILDER_PRESERVATION,
        'The owning flow did not persist the external receipt locator.',
        'Inspect the flow command result; do not claim a completed closeout.',
      );
    const archivedFiles = deps.fs.listRegularFilesNoFollow(archive);
    if (!archivedFiles)
      throw new Error('Archived plan contains unreadable or non-regular entries.');
    for (const file of archivedFiles) {
      const source = posixJoin(archive, file);
      const bytes = deps.fs.readBytesNoFollow(source);
      if (!bytes) throw new Error(`Archived file disappeared: ${source}`);
      preserve(source, `plan/${file}`, bytes, source === postFlightPath ? 'report' : 'artifact');
    }
    for (const [index, item] of additional.entries()) {
      const source = isWithin(context.planDir, item.source)
        ? posixJoin(archive, posixRelative(context.planDir, item.source))
        : item.source;
      preserve(source, `evidence/${index}`, item.bytes, item.category);
    }
    // Capture AFTER archival/relocation: tidy repeats these exact recipes, so a
    // pre-archive diff would already be stale before close returned.
    for (const [index, root] of retiring.entries()) {
      const patch = await builderGit(deps, ['diff', '--binary'], root);
      if (!patch.ok) return patch;
      preserve(
        `git-diff:${root}#working-tree`,
        `workspaces/${index}/working-tree.patch`,
        new TextEncoder().encode(patch.value),
        'wip',
      );
      const staged = await builderGit(deps, ['diff', '--cached', '--binary'], root);
      if (!staged.ok) return staged;
      preserve(
        `git-diff:${root}#index`,
        `workspaces/${index}/index.patch`,
        new TextEncoder().encode(staged.value),
        'wip',
      );
      const workspace = workspaceFiles(deps, root, isBuilderPreservationExcluded);
      if (!workspace.ok) return workspace;
      for (const file of workspace.value) {
        const source = resolveInRepo(file, root);
        if (!isWithin(root, source))
          return builderFailure(
            ErrorCodes.BUILDER_PRESERVATION,
            'Inventory path escapes its workspace.',
            'Restore a confined workspace.',
          );
        if (isWithin(archive, source)) continue; // The full plan inventory owns these bytes.
        const bytes = deps.fs.readBytesNoFollow(source);
        if (!bytes)
          return builderFailure(
            ErrorCodes.BUILDER_PRESERVATION,
            `Workspace data cannot be preserved: ${source}`,
            'Preserve the actual file before retiring the workspace.',
          );
        preserve(source, `workspaces/${index}/files/${file}`, bytes, 'wip');
      }
    }
    const receipt: PreservationReceipt = {
      record_type: 'preservation',
      id: generation,
      recorded_at: deps.clock.nowIso(),
      allocation_ids: input.allocations.map((row) => row.value.id),
      source_root: deps.repoRoot,
      source_sha: head.value,
      composed_sha: composed.value.value.artifact_sha as string,
      archived_plan: archive,
      survivor_root: destination,
      retiring_roots: retiring,
      inventory,
      refs,
    };
    const verified = await verifyBuilderPreservation(deps, receipt);
    if (!verified.ok) return verified;
    const survivingReceipt = writeBuilderRecord(deps, receiptPath, receipt, { root: destination });
    if (!survivingReceipt.ok) return survivingReceipt;
    return { ok: true, value: { archive, preservation: survivingReceipt.value } };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_PRESERVATION,
      `Closeout did not complete: ${String(error)}`,
      'Inspect the retained source/archive and preservation generation; no workspace was removed and no rollback was attempted.',
      { archive, survivor: destination },
    );
  }
}
