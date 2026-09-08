import { parse } from '@ai-substrate/dd';
import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixJoin, resolveInRepo } from '../shared/posix-path.js';
import { builderOwnsPath, committedDeliveryPaths, ownershipWarnings } from './ownership-service.js';
import {
  builderContext,
  builderFailure,
  builderRecordPath,
  digestBuilderFile,
  readBuilderDocument,
  readBuilderGitText,
  readBuilderRecord,
  relocatedRef,
  resolveDocumentAddresses,
  runBuilderCheck,
  sameBuilderDocumentIntent,
  sha256,
  verifyBuilderFilesAtCommit,
  writeBuilderRecord,
} from './records.js';
import type {
  AllocationRecord,
  BaselineReceipt,
  BuilderContext,
  BuilderDeps,
  BuilderResult,
  Check,
  CommandSpec,
  ComposeInput,
  CompositionDeps,
  CompositionReceipt,
  DispatchReceipt,
  FileDigest,
  Guide,
  IntegratedUnitProof,
  OwnershipWarning,
  Packet,
  Stored,
  Unit,
  UnitDelivery,
} from './types.js';

const SHA = /^[a-f0-9]{40}$/;

/** Shared only by the lifecycle services; all process boundaries remain argv-based. */
export async function builderCommand(
  deps: BuilderDeps,
  spec: CommandSpec,
  args: string[],
  cwd = deps.repoRoot,
): Promise<BuilderResult<string>> {
  try {
    const result = await deps.exec.run(spec.command, [...spec.args, ...args], {
      cwd,
      timeoutMs: 180000,
    });
    return result.code === 0
      ? { ok: true, value: result.stdout }
      : builderFailure(
          ErrorCodes.BUILDER_PROOF,
          `Command failed: ${spec.command} ${args.join(' ')}`,
          'Resolve the reported failure and retry; no force or rollback was performed.',
          result,
        );
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_RUNTIME,
      String(error),
      'Restore the named executable and retry.',
    );
  }
}

export function builderGit(
  deps: BuilderDeps,
  args: string[],
  cwd = deps.repoRoot,
): Promise<BuilderResult<string>> {
  return builderCommand(deps, { command: 'git', args: ['-c', 'core.hooksPath='] }, args, cwd);
}

export function loadBuilderGuide(
  deps: BuilderDeps,
  input: string,
): BuilderResult<{ context: BuilderContext; guide: Stored<Guide> }> {
  const context = builderContext(deps, input);
  if (!context.ok) return context;
  const document = readBuilderDocument(deps, context.value.guidePath, 'builder/impl-guide');
  if (!document.ok) return document;
  const guide = Object.fromEntries(
    document.value.value.sections.map((section) => [section.name, section.value]),
  ) as unknown as Guide;
  return {
    ok: true,
    value: { context: context.value, guide: { ref: document.value.ref, value: guide } },
  };
}

export async function loadBuilderBaseline(
  deps: BuilderDeps,
  context: BuilderContext,
  guide: Guide,
): Promise<BuilderResult<Stored<BaselineReceipt>>> {
  const path = resolveInRepo(guide.baseline.receipt, posixDirname(context.guidePath));
  if (!isWithin(context.planDir, path))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Baseline receipt escapes the plan.',
      'Keep the baseline receipt within the plan assets.',
    );
  const baseline = readBuilderRecord<BaselineReceipt>(deps, path, 'baseline');
  if (!baseline.ok) return baseline;
  if (
    baseline.value.value.files.length !== guide.baseline.files.length ||
    guide.baseline.files.some(
      (path) => baseline.value.value.files.filter((file) => file.path === path).length !== 1,
    )
  )
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'The declared baseline paths differ from the sealed file bindings.',
      'Restore the original guide or review and seal a new baseline; never relabel historical paths.',
    );
  const historical = await verifyBuilderFilesAtCommit(
    deps,
    baseline.value.value.source_sha,
    baseline.value.value.files,
  );
  if (!historical.ok) return historical;
  return baseline;
}

export function sameBuilderFile(deps: BuilderDeps, ref: FileDigest): BuilderResult<FileDigest> {
  const actual = digestBuilderFile(deps, ref.path);
  if (!actual.ok) return actual;
  return actual.value.sha256 === ref.sha256
    ? actual
    : builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Stale evidence: ${ref.path}`,
        'Refresh the evidence against the actual artifact; historical receipts must not be relabelled.',
      );
}

function nulPaths(text: string): string[] {
  return text.split('\0').filter(Boolean);
}

/** Compare historical byte bindings without requiring a receipt to commit its own digest. */
export async function verifyBuilderBasis(
  deps: BuilderDeps,
  context: BuilderContext,
  basis: { source_sha: string; plan: FileDigest; guide: FileDigest },
): Promise<BuilderResult<true>> {
  if (!SHA.test(basis.source_sha))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Invalid evidence source SHA.',
      'Supply the full committed source SHA.',
    );
  for (const [ref, current] of [
    [basis.plan, context.planPath],
    [basis.guide, context.guidePath],
  ] as const) {
    if (resolveInRepo(relocatedRef(ref, basis, context).path, deps.repoRoot) !== current)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'The evidence belongs to a different plan or guide.',
        'Use the original plan or its canonical archive relocation.',
      );
    const actual = readBuilderDocument(
      deps,
      current,
      current === context.planPath ? 'builder/plan' : 'builder/impl-guide',
    );
    if (!actual.ok) return actual;
    if (
      actual.value.ref.sha256 === ref.sha256 &&
      resolveInRepo(ref.path, deps.repoRoot) === current
    )
      continue;
    const saved = deps.fs.readText(posixJoin(context.teamDir, `basis-${ref.sha256}.json`));
    const historical =
      saved === null
        ? await readBuilderGitText(deps, ['show', `${basis.source_sha}:${ref.path}`])
        : { ok: true as const, value: saved };
    if (!historical.ok) return historical;
    if (sha256(historical.value) !== ref.sha256)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Historical binding cannot be recovered: ${ref.path}`,
        'Supply the original reachable document commit or immutable review input snapshot, not a newly labelled digest.',
      );
    try {
      const before = parse(historical.value);
      const after = actual.value.value;
      const planId = context.planDir.slice(context.planDir.lastIndexOf('/') + 1);
      if (
        Array.isArray(before) ||
        Array.isArray(after) ||
        !sameBuilderDocumentIntent(
          resolveDocumentAddresses(before, resolveInRepo(ref.path, deps.repoRoot), deps.repoRoot),
          resolveDocumentAddresses(after, current, deps.repoRoot),
          planId,
        )
      )
        return builderFailure(
          ErrorCodes.BUILDER_PROOF,
          `Material document drift: ${current}`,
          'Review the changed intent or guide and establish fresh evidence.',
        );
    } catch {
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        `Malformed bound document: ${current}`,
        'Repair the canonical DD JSON through its owning tools.',
      );
    }
  }
  return { ok: true, value: true };
}

export async function builderHead(deps: BuilderDeps): Promise<BuilderResult<string>> {
  const branch = await builderGit(deps, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch.ok) return branch;
  if (!branch.value.trim() || ['main', 'master'].includes(branch.value.trim()))
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Builder requires a named non-main plan branch.',
      'Run from the allocated plan branch; main is never a composition target.',
    );
  const head = await builderGit(deps, ['rev-parse', 'HEAD']);
  if (!head.ok) return head;
  return SHA.test(head.value.trim())
    ? { ok: true, value: head.value.trim() }
    : builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Git did not return a full HEAD SHA.',
        'Restore the plan repository before retrying.',
      );
}

/** The record writer's reserved data namespace, not executable harness extensions. */
function isHarnessRecord(repoRoot: string, path: string): boolean {
  return isWithin(posixJoin(repoRoot, '.harness/records'), resolveInRepo(path, repoRoot));
}

/** Plan and harness records may be uncommitted; executable source never is. */
export async function cleanBuilderSource(
  deps: BuilderDeps,
  context: BuilderContext,
  originalPlanDir = context.planDir,
): Promise<BuilderResult<true>> {
  for (const args of [
    ['diff', '--name-only', '-z'],
    ['diff', '--cached', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    const result = await builderGit(deps, args);
    if (!result.ok) return result;
    const dirty = nulPaths(result.value).filter(
      (path) =>
        !isHarnessRecord(deps.repoRoot, path) &&
        !isWithin(context.planDir, resolveInRepo(path, deps.repoRoot)) &&
        !isWithin(originalPlanDir, resolveInRepo(path, deps.repoRoot)),
    );
    if (dirty.length)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Uncommitted source would contaminate the artifact proof.',
        'Commit the source changes before verification. Plan and .harness/records receipts may remain uncommitted.',
        dirty,
      );
  }
  return { ok: true, value: true };
}

function compositionChecks(guide: Guide): BuilderResult<Check[]> {
  const checks: Check[] = [];
  for (const address of guide.composition.proof) {
    const id = address.match(/#checks\/([^/]+)$/)?.[1];
    const check = guide.checks.find((row) => row.id === id);
    if (!check)
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        `Unresolved composition proof: ${address}`,
        'Name executable guide checks, not prose evidence.',
      );
    if (!checks.some((row) => row.id === check.id)) checks.push(check);
  }
  return checks.length
    ? { ok: true, value: checks }
    : builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'No integration proof is declared.',
        'Declare the composition checks in the implementation guide.',
      );
}

async function validateDelivery(
  deps: BuilderDeps,
  context: BuilderContext,
  baseline: Stored<BaselineReceipt>,
  guide: Guide,
  unit: Unit,
  delivery: UnitDelivery,
  replay: boolean,
): Promise<BuilderResult<{ commits: string[]; paths: string[]; warnings: OwnershipWarning[] }>> {
  const source = baseline.value.source_sha;
  if (!SHA.test(source))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'The sealed baseline does not name a full source SHA.',
      'Restore a valid sealed baseline before accepting any delivery.',
    );
  const key = `${unit.id}-${source}`;
  const refused = (cause: string, fix: string) =>
    builderFailure(ErrorCodes.BUILDER_ACK, `${cause} for ${unit.id}.`, fix);
  if (delivery.baseline_sha !== source)
    return refused(
      'Delivery source differs from the current sealed baseline',
      `Deliver commits based on ${source}; do not select a historical baseline.`,
    );
  if (!SHA.test(delivery.commit_sha))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `Invalid committed SHA for ${unit.id}.`,
      'Deliver a full committed SHA descended from the frozen source baseline.',
    );
  const dispatchPath = builderRecordPath(context, 'dispatch', key);
  const packetPath = builderRecordPath(context, 'packet', key);
  const dispatch = readBuilderRecord<DispatchReceipt>(deps, dispatchPath, 'dispatch');
  if (!dispatch.ok)
    return refused(
      `Current dispatch is unreadable at ${dispatchPath}: ${dispatch.message}`,
      'Recover the dispatch qualified by the current unit and sealed source; historical dispatches cannot substitute.',
    );
  const d = dispatch.value.value;
  if (d.id !== `dispatch-${key}` || d.unit_id !== unit.id)
    return refused(
      'Dispatch identity does not match the current unit and source',
      `Use dispatch-${key} from the current dispatch path.`,
    );
  if (
    resolveInRepo(d.packet.path, deps.repoRoot) !== packetPath ||
    d.packet.sha256 !== delivery.packet_sha256
  )
    return refused(
      'Delivery packet binding differs from the current dispatch',
      'Use the exact current packet path and digest recorded by dispatch.',
    );
  if (
    d.observed.peer_id !== delivery.peer_id ||
    d.observed.root !== delivery.workspace ||
    !d.observed.ready
  )
    return refused(
      'Dispatch native observation does not identify the delivery peer and ready workspace',
      'Recover the observed dispatch for the allocated peer and its exact native checkout.',
    );
  if (
    d.baseline.sha256 !== baseline.ref.sha256 ||
    resolveInRepo(d.baseline.path, deps.repoRoot) !==
      resolveInRepo(baseline.ref.path, deps.repoRoot)
  )
    return refused(
      'Dispatch baseline binding differs from the current sealed source',
      'Use the dispatch bound to the current baseline path and digest.',
    );
  if (resolveInRepo(d.allocation.path, deps.repoRoot) !== d.allocation.path)
    return refused(
      'Dispatch allocation path is not absolute',
      'Use the absolute allocation authority path recorded when the workspace was allocated.',
    );
  for (const ref of [d.packet, d.allocation]) {
    const verified = sameBuilderFile(deps, ref);
    if (!verified.ok)
      return refused(
        `Dispatch evidence cannot be verified: ${verified.message}`,
        verified.next_action,
      );
  }
  const packet = readBuilderRecord<Packet>(deps, packetPath, 'packet');
  if (!packet.ok)
    return refused(`Current packet is unreadable: ${packet.message}`, packet.next_action);
  const allocation = readBuilderRecord<AllocationRecord>(deps, d.allocation.path, 'allocation');
  if (!allocation.ok)
    return refused(
      `Allocated workspace record is unreadable: ${allocation.message}`,
      allocation.next_action,
    );
  const p = packet.value.value;
  const a = allocation.value.value;
  if (
    p.id !== `packet-${key}` ||
    (p.source_sha !== undefined && p.source_sha !== source) ||
    p.baseline.sha256 !== baseline.ref.sha256 ||
    resolveInRepo(p.baseline.path, deps.repoRoot) !==
      resolveInRepo(baseline.ref.path, deps.repoRoot)
  )
    return refused(
      'Packet identity or source binding differs from the current sealed baseline',
      `Use packet-${key} bound to the current baseline path, digest and source ${source}.`,
    );
  if (
    p.allocation.sha256 !== d.allocation.sha256 ||
    resolveInRepo(p.allocation.path, deps.repoRoot) !== d.allocation.path
  )
    return refused(
      'Packet allocation binding differs from dispatch',
      'Use the same immutable allocation path and digest in the packet and dispatch.',
    );
  if (
    d.observed.harness !== p.requested.harness ||
    d.observed.model !== p.requested.model ||
    (p.requested.effort !== undefined && d.observed.effort !== p.requested.effort)
  )
    return refused(
      'Observed dispatch runtime differs from the packet request',
      'Use the native harness, model and requested effort observed for this packet.',
    );
  if (
    p.unit.id !== unit.id ||
    JSON.stringify(p.unit) !== JSON.stringify(unit) ||
    p.workspace !== delivery.workspace ||
    a.root !== delivery.workspace ||
    a.unit_id !== unit.id ||
    a.base_sha !== baseline.value.source_sha ||
    a.peer_id !== delivery.peer_id ||
    a.retired_at
  )
    return refused(
      'Packet unit or allocated peer, workspace or source does not match the delivery',
      'Use the current guide unit and its active allocation with the exact peer, checkout and sealed source.',
    );
  const root = await builderGit(deps, ['rev-parse', '--show-toplevel'], delivery.workspace);
  const branch = await builderGit(
    deps,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    delivery.workspace,
  );
  if (!root.ok) return root;
  if (!branch.ok) return branch;
  if (root.value.trim() !== delivery.workspace || branch.value.trim() !== a.branch)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      `Workspace identity changed for ${unit.id}.`,
      'Use the exact allocated native checkout and branch.',
    );
  const actualHead = await builderGit(deps, ['rev-parse', 'HEAD'], delivery.workspace);
  if (!actualHead.ok) return actualHead;
  if (!SHA.test(actualHead.value.trim()))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `The allocated checkout did not return a full HEAD SHA for ${unit.id}.`,
      'Restore the allocated checkout before importing the pinned delivery commit.',
    );
  const deliveredAncestor = await builderGit(
    deps,
    ['merge-base', '--is-ancestor', delivery.commit_sha, actualHead.value.trim()],
    delivery.workspace,
  );
  if (!deliveredAncestor.ok)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `The delivered commit is not reachable from the allocated checkout HEAD for ${unit.id}.`,
      'Deliver the intended committed artifact from this checkout’s history; later evidence commits may remain at HEAD.',
      deliveredAncestor,
    );
  const ancestor = await builderGit(
    deps,
    ['merge-base', '--is-ancestor', baseline.value.source_sha, delivery.commit_sha],
    delivery.workspace,
  );
  if (!ancestor.ok) return ancestor;
  if (replay) {
    const merges = await builderGit(
      deps,
      ['rev-list', '--merges', `${baseline.value.source_sha}..${delivery.commit_sha}`],
      delivery.workspace,
    );
    if (!merges.ok) return merges;
    if (merges.value.trim())
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Worker delivery contains merge commits that cannot be replayed without a mainline choice.',
        'Prepare an equivalent linear delivery on the sealed baseline, then retry; this is a Git replay limitation, not an ownership restriction.',
      );
  }
  const history = await committedDeliveryPaths(
    (args) => builderGit(deps, args, delivery.workspace),
    source,
    delivery.commit_sha,
  );
  if (!history.ok) return history;
  if (!history.value.commits.length)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `No committed work for ${unit.id}.`,
      'Deliver actual unit commits, not the baseline itself.',
    );
  return {
    ok: true,
    value: {
      commits: history.value.commits,
      paths: history.value.paths,
      warnings: ownershipWarnings(guide.units, history.value.paths, [unit], 'delivery', unit.id),
    },
  };
}

type TreeEntry = readonly [mode: string, type: string, objectId: string];

/** Read only tree metadata: Git object identity preserves binary bytes, modes and symlinks. */
async function committedTree(
  deps: BuilderDeps,
  sha: string,
  cwd = deps.repoRoot,
): Promise<BuilderResult<Map<string, TreeEntry>>> {
  const tree = await readBuilderGitText(deps, ['ls-tree', '-r', '-z', '--full-tree', sha], cwd);
  if (!tree.ok) return tree;
  if (tree.value && !tree.value.endsWith('\0'))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `Incomplete Git tree listing at ${sha} in ${cwd}.`,
      'Recover the complete committed tree observation before recording integration.',
    );
  const entries = new Map<string, TreeEntry>();
  for (const entry of nulPaths(tree.value)) {
    const match = /^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
    if (!match || entries.has(match[4]))
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Invalid Git tree entry at ${sha} in ${cwd}.`,
        'Restore readable, unique committed tree entries before observing integration.',
      );
    entries.set(match[4], [match[1], match[2], match[3]]);
  }
  return { ok: true, value: entries };
}

async function observeIntegratedUnit(
  deps: BuilderDeps,
  unit: Unit,
  delivery: UnitDelivery,
  touchedPaths: string[],
  baselineTree: Map<string, TreeEntry>,
  pmTree: Map<string, TreeEntry>,
): Promise<BuilderResult<IntegratedUnitProof>> {
  const delivered = await committedTree(deps, delivery.commit_sha, delivery.workspace);
  if (!delivered.ok) return delivered;
  // Include baseline-only paths (deletions) and PM-only paths (unexpected additions).
  const paths = [
    ...new Set([...baselineTree.keys(), ...delivered.value.keys(), ...pmTree.keys()]),
  ].filter((path) => builderOwnsPath(unit, path));
  const scope = paths.length ? 'unit-map' : 'delivery-changes';
  if (!paths.length) paths.push(...touchedPaths);
  if (!paths.length)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `No concrete file proof for already-integrated unit ${unit.id}.`,
      'Map concrete committed unit paths or supply a delivery with actual touched files; an empty projection cannot prove integration.',
    );
  const projection: Array<readonly [string, string | null, string | null, string | null]> = [];
  for (const path of paths.sort()) {
    const expected = delivered.value.get(path);
    const observed = pmTree.get(path);
    if (
      expected?.[0] !== observed?.[0] ||
      expected?.[1] !== observed?.[1] ||
      expected?.[2] !== observed?.[2]
    )
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Already-integrated tree mismatch for ${unit.id} at ${path}.`,
        `Commit the delivered path, mode, type and bytes (or deletion) from ${delivery.commit_sha} in the PM checkout, or use normal import if replay is intended.`,
        { unit_id: unit.id, path, delivery: expected ?? null, pm: observed ?? null },
      );
    projection.push([path, ...(expected ?? ([null, null, null] as const))]);
  }
  return {
    ok: true,
    value: {
      unit_id: unit.id,
      delivery_sha: delivery.commit_sha,
      scope,
      compared_paths: paths.length,
      // Canonical sorted tree projection, NOT a raw-file SHA256 or artifact-check proof.
      tree_sha256: sha256(JSON.stringify(projection)),
    },
  };
}

function compositionRoster(
  guide: Guide,
  units: UnitDelivery[],
  baseline: string,
): BuilderResult<true> {
  const order = guide.composition.order;
  const coders = guide.units.filter((unit) => unit.role === 'coder');
  if (
    coders.length !== order.length ||
    new Set(order).size !== order.length ||
    coders.some((unit) => !order.includes(unit.id)) ||
    units.length !== order.length ||
    units.some(
      (unit, index) =>
        unit.unit_id !== order[index] ||
        unit.baseline_sha !== baseline ||
        !SHA.test(unit.commit_sha),
    )
  )
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Composition does not contain the complete ordered coder roster on its frozen baseline.',
      'Import each declared coder exactly once, in the reviewed dependency order.',
    );
  return { ok: true, value: true };
}

async function integrationWarnings(
  deps: BuilderDeps,
  context: BuilderContext,
  guide: Guide,
  from: string,
  to: string,
  stage: OwnershipWarning['stage'],
): Promise<BuilderResult<OwnershipWarning[]>> {
  const ancestor = await builderGit(deps, ['merge-base', '--is-ancestor', from, to]);
  if (!ancestor.ok) return ancestor;
  const delta = await builderGit(deps, ['diff', '--name-only', '--no-renames', '-z', from, to]);
  if (!delta.ok) return delta;
  const pm = guide.units.filter((unit) => unit.role === 'pm');
  const paths = nulPaths(delta.value).filter(
    (file) => !isWithin(context.planDir, resolveInRepo(file, deps.repoRoot)),
  );
  return {
    ok: true,
    value: ownershipWarnings(guide.units, paths, pm, stage),
  };
}

export async function verifyBuilderComposition(
  deps: BuilderDeps,
  context: BuilderContext,
  guide: Guide,
): Promise<BuilderResult<Stored<CompositionReceipt>>> {
  const composition = readBuilderRecord<CompositionReceipt>(
    deps,
    builderRecordPath(context, 'composition'),
    'composition',
  );
  if (!composition.ok) return composition;
  const value = composition.value.value;
  const baseline = await loadBuilderBaseline(deps, context, guide);
  if (!baseline.ok) return baseline;
  if (
    !value.artifact_sha ||
    !SHA.test(value.artifact_sha) ||
    value.baseline.sha256 !== baseline.value.ref.sha256
  )
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Composition is imported but not verified against the current baseline.',
      'Commit PM integration, then run builder compose --verify with that SHA.',
    );
  const roster = compositionRoster(guide, value.units, baseline.value.value.source_sha);
  if (!roster.ok) return roster;
  const basis = await verifyBuilderBasis(deps, context, baseline.value.value);
  if (!basis.ok) return basis;
  const head = await builderHead(deps);
  if (!head.ok) return head;
  const ancestor = await builderGit(deps, [
    'merge-base',
    '--is-ancestor',
    value.artifact_sha,
    head.value,
  ]);
  if (!ancestor.ok) return ancestor;
  const delta = await builderGit(deps, [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    value.artifact_sha,
    head.value,
  ]);
  if (!delta.ok) return delta;
  // Later plan/record commits do not turn unchanged code into a new artifact.
  const originalDir = posixDirname(baseline.value.value.plan.path);
  if (
    nulPaths(delta.value).some(
      (path) =>
        !isHarnessRecord(deps.repoRoot, path) &&
        !isWithin(context.planDir, resolveInRepo(path, deps.repoRoot)) &&
        !isWithin(resolveInRepo(originalDir, deps.repoRoot), resolveInRepo(path, deps.repoRoot)),
    )
  )
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Code changed after composition proof.',
      'Verify and independently review the new committed artifact.',
    );
  const clean = await cleanBuilderSource(deps, context, resolveInRepo(originalDir, deps.repoRoot));
  if (!clean.ok) return clean;
  for (const ref of value.files) {
    // Historical snapshots may include records; do not rewrite those receipts.
    if (isHarnessRecord(deps.repoRoot, ref.path)) continue;
    const checked = sameBuilderFile(deps, ref);
    if (!checked.ok) return checked;
  }
  const checks = compositionChecks(guide);
  if (!checks.ok) return checks;
  if (
    checks.value.some(
      (check) =>
        !value.checks.some(
          (receipt) =>
            receipt.id === check.id &&
            receipt.exit_code === 0 &&
            receipt.command === check.command &&
            JSON.stringify(receipt.args) === JSON.stringify(check.args) &&
            receipt.cwd === resolveInRepo(check.cwd, deps.repoRoot),
        ),
    )
  )
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Composition check evidence is missing, changed or red.',
      'Run every guide-named check against the committed artifact.',
    );
  return composition;
}

export async function composeBuilderUnits(
  deps: CompositionDeps,
  input: ComposeInput,
): Promise<BuilderResult<Stored<CompositionReceipt>>> {
  if (input.mode === 'import' && input.alreadyIntegrated) {
    const exec = deps.exec;
    deps = {
      ...deps,
      exec: {
        run: (command, args, opts) =>
          exec.run(command, args, {
            ...opts,
            env: { ...opts.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' },
          }),
      },
    };
  }
  const loaded = loadBuilderGuide(deps, input.plan);
  if (!loaded.ok) return loaded;
  const { context, guide: storedGuide } = loaded.value;
  const guide = storedGuide.value;
  const baseline = await loadBuilderBaseline(deps, context, guide);
  if (!baseline.ok) return baseline;
  const basis = await verifyBuilderBasis(deps, context, baseline.value.value);
  if (!basis.ok) return basis;
  const head = await builderHead(deps);
  if (!head.ok) return head;
  const clean = await cleanBuilderSource(deps, context);
  if (!clean.ok) return clean;
  const path = builderRecordPath(context, 'composition');
  if (input.mode === 'import') {
    if (deps.fs.exists(path))
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        'A composition receipt already exists.',
        'Continue with committed-tree verification; never import the same units twice.',
      );
    const ready = await deps.readiness({ plan: input.plan });
    if (!ready.ok) return ready;
    if (ready.value.status !== 'ready')
      return builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        'The guide or baseline is not ready.',
        'Resolve every readiness issue before importing.',
        ready.value,
      );
    const integration = await integrationWarnings(
      deps,
      context,
      guide,
      baseline.value.value.source_sha,
      head.value,
      'import',
    );
    if (!integration.ok) return integration;
    const coders = guide.units.filter((unit) => unit.role === 'coder');
    const order = guide.composition.order;
    if (
      order.length !== coders.length ||
      new Set(order).size !== order.length ||
      coders.some((unit) => !order.includes(unit.id)) ||
      input.deliveries.length !== coders.length ||
      new Set(input.deliveries.map((row) => row.unit_id)).size !== coders.length
    )
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'Composition must contain each coder exactly once.',
        'Use the reviewed guide dependency order and an exact delivery set.',
      );
    if (
      new Set(input.deliveries.map((delivery) => delivery.peer_id)).size !== input.deliveries.length
    )
      return builderFailure(
        ErrorCodes.BUILDER_ACK,
        'Multiple coder deliveries identify the same native peer.',
        'Use each unit’s distinct allocated native peer and matching dispatch evidence before importing.',
      );
    const prepared: Array<{
      unit: Unit;
      delivery: UnitDelivery;
      commits: string[];
      paths: string[];
      warnings: OwnershipWarning[];
    }> = [];
    for (const id of order) {
      const unit = coders.find((row) => row.id === id);
      const delivery = input.deliveries.find((row) => row.unit_id === id);
      if (
        !unit ||
        !delivery ||
        unit.depends_on.some(
          (dependency) =>
            coders.some((row) => row.id === dependency) &&
            !prepared.some((row) => row.delivery.unit_id === dependency),
        )
      )
        return builderFailure(
          ErrorCodes.BUILDER_INVALID,
          `Invalid dependency order at ${id}.`,
          'Import dependencies before their consumers.',
        );
      const validated = await validateDelivery(
        deps,
        context,
        baseline.value,
        guide,
        unit,
        delivery,
        !input.alreadyIntegrated,
      );
      if (!validated.ok) return validated;
      prepared.push({ unit, delivery, ...validated.value });
    }
    const proofs: IntegratedUnitProof[] = [];
    if (input.alreadyIntegrated) {
      const baselineTree = await committedTree(deps, baseline.value.value.source_sha);
      if (!baselineTree.ok) return baselineTree;
      const pmTree = await committedTree(deps, head.value);
      if (!pmTree.ok) return pmTree;
      for (const { unit, delivery, paths } of prepared) {
        const proof = await observeIntegratedUnit(
          deps,
          unit,
          delivery,
          paths,
          baselineTree.value,
          pmTree.value,
        );
        if (!proof.ok) return proof;
        proofs.push(proof.value);
      }
    } else {
      for (const { delivery, commits } of prepared) {
        const fetched = await builderGit(deps, [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--',
          delivery.workspace,
          delivery.commit_sha,
        ]);
        if (!fetched.ok) return fetched;
        const imported = await builderGit(deps, ['cherry-pick', '-x', ...commits]);
        if (!imported.ok)
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            `Composition replay stopped at ${delivery.unit_id}; Git state is preserved.`,
            'Inspect the cherry-pick error and resolve its conflict, empty commit or other replay limitation; this is not an ownership refusal. Do not claim completed composition or reset unrelated work.',
            imported,
          );
      }
    }
    if (input.alreadyIntegrated) {
      const unchanged = await cleanBuilderSource(deps, context);
      if (!unchanged.ok) return unchanged;
    }
    const composed = await builderHead(deps);
    if (!composed.ok) return composed;
    if (input.alreadyIntegrated) {
      if (composed.value !== head.value)
        return builderFailure(
          ErrorCodes.BUILDER_PROOF,
          'PM HEAD changed while observing already-integrated deliveries.',
          'Keep the PM checkout at a stable committed HEAD and repeat the observation.',
        );
    }
    return writeBuilderRecord(deps, path, {
      record_type: 'composition',
      id: deps.nonce(),
      recorded_at: deps.clock.nowIso(),
      baseline: baseline.value.ref,
      units: prepared.map((row) => row.delivery),
      integration_sha: composed.value,
      integration_method: input.alreadyIntegrated ? 'already-integrated' : 'replayed',
      ...(input.alreadyIntegrated && { integration_proofs: proofs }),
      files: [],
      checks: [],
      warnings: [
        ...(baseline.value.value.warnings ?? []),
        ...(ready.value.warnings ?? []),
        ...integration.value,
        ...prepared.flatMap((row) => row.warnings),
      ],
    });
  }
  if (!SHA.test(input.sha) || input.sha !== head.value)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Verification must name the current committed HEAD exactly.',
      'Commit the intended PM integration and pass its full SHA.',
    );
  const imported = readBuilderRecord<CompositionReceipt>(deps, path, 'composition');
  if (!imported.ok) return imported;
  if (imported.value.value.baseline.sha256 !== baseline.value.ref.sha256)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'The imported baseline changed.',
      'Reconcile the historical evidence before verifying.',
    );
  const roster = compositionRoster(
    guide,
    imported.value.value.units,
    baseline.value.value.source_sha,
  );
  if (!roster.ok) return roster;
  const integration = await integrationWarnings(
    deps,
    context,
    guide,
    imported.value.value.integration_sha,
    input.sha,
    'verify',
  );
  if (!integration.ok) return integration;
  const checks = compositionChecks(guide);
  if (!checks.ok) return checks;
  const files = await builderGit(deps, ['ls-files', '-z']);
  if (!files.ok) return files;
  const snapshot: FileDigest[] = [];
  for (const file of nulPaths(files.value)) {
    if (
      isHarnessRecord(deps.repoRoot, file) ||
      isWithin(context.planDir, resolveInRepo(file, deps.repoRoot))
    )
      continue;
    const digest = digestBuilderFile(deps, file);
    if (!digest.ok) return digest;
    snapshot.push(digest.value);
  }
  const receipt: CompositionReceipt = {
    ...imported.value.value,
    recorded_at: deps.clock.nowIso(),
    artifact_sha: input.sha,
    files: snapshot,
    checks: [],
    warnings: [
      ...(imported.value.value.warnings ?? []).filter((warning) => warning.stage !== 'verify'),
      ...integration.value,
    ],
  };
  let failed = false;
  for (const check of checks.value) {
    const result = await runBuilderCheck(deps, check);
    if (!result.ok) return result;
    receipt.checks.push(result.value);
    failed ||= result.value.exit_code !== 0;
  }
  const after = await builderHead(deps);
  if (!after.ok) return after;
  const unchanged = await cleanBuilderSource(deps, context);
  if (!unchanged.ok) return unchanged;
  if (after.value !== input.sha)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'A check changed HEAD.',
      'Restore a stable committed artifact and repeat verification.',
    );
  const retainedSeal = sameBuilderFile(deps, baseline.value.ref);
  if (!retainedSeal.ok) return retainedSeal;
  const retainedBasis = await verifyBuilderBasis(deps, context, baseline.value.value);
  if (!retainedBasis.ok) return retainedBasis;
  for (const ref of snapshot) {
    const current = sameBuilderFile(deps, ref);
    if (!current.ok) return current;
  }
  const written = writeBuilderRecord(deps, path, receipt, {
    expectedSha256: imported.value.ref.sha256,
  });
  if (!written.ok) return written;
  return failed
    ? builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Composition proof is red; check outputs were persisted.',
        'Resolve the failing checks and verify the new committed artifact.',
        written.value,
      )
    : written;
}
