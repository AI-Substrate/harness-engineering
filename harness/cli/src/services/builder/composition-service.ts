import { parse } from '@ai-substrate/dd';
import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixJoin, resolveInRepo } from '../shared/posix-path.js';
import {
  builderContext,
  builderFailure,
  builderRecordPath,
  digestBuilderFile,
  readBuilderDocument,
  readBuilderRecord,
  runBuilderCheck,
  sameBuilderDocumentIntent,
  sha256,
  writeBuilderRecord,
} from './records.js';
import type {
  AckReceipt,
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

export function loadBuilderBaseline(
  deps: BuilderDeps,
  context: BuilderContext,
  guide: Guide,
): BuilderResult<Stored<BaselineReceipt>> {
  const path = resolveInRepo(guide.baseline.receipt, posixDirname(context.guidePath));
  if (!isWithin(context.planDir, path))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Baseline receipt escapes the plan.',
      'Keep the baseline receipt within the plan assets.',
    );
  const baseline = readBuilderRecord<BaselineReceipt>(deps, path, 'baseline');
  if (!baseline.ok) return baseline;
  for (const file of baseline.value.value.files) {
    const actual = sameBuilderFile(deps, file);
    if (!actual.ok) return actual;
  }
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

export function builderOwnsPath(unit: Unit, path: string): boolean {
  return unit.paths.some(
    (fence) =>
      fence === path ||
      (fence.endsWith('/**') && path.startsWith(fence.slice(0, -2))) ||
      (fence.endsWith('/') && path.startsWith(fence)),
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
    const actual = readBuilderDocument(
      deps,
      current,
      current === context.planPath ? 'builder/plan' : 'builder/impl-guide',
    );
    if (!actual.ok) return actual;
    if (actual.value.ref.sha256 === ref.sha256) continue;
    const saved = deps.fs.readText(posixJoin(context.teamDir, `basis-${ref.sha256}.json`));
    const historical =
      saved === null
        ? await builderGit(deps, ['show', `${basis.source_sha}:${ref.path}`])
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
        !sameBuilderDocumentIntent(before, after, planId)
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

/** Plan evidence is deliberately uncommitted; executable source never is. */
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
        !isWithin(context.planDir, resolveInRepo(path, deps.repoRoot)) &&
        !isWithin(originalPlanDir, resolveInRepo(path, deps.repoRoot)),
    );
    if (dirty.length)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Uncommitted source would contaminate the artifact proof.',
        'Commit the declared source changes before verification. Plan receipts may remain uncommitted.',
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
  unit: Unit,
  delivery: UnitDelivery,
): Promise<BuilderResult<string[]>> {
  const source = baseline.value.source_sha;
  if (!SHA.test(source))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'The sealed baseline does not name a full source SHA.',
      'Restore a valid sealed baseline before accepting any delivery.',
    );
  const key = `${unit.id}-${source}`;
  const refused = () =>
    builderFailure(
      ErrorCodes.BUILDER_ACK,
      `No matching current-baseline authorization for ${unit.id}.`,
      'Use the packet, acknowledgement and dispatch qualified by the current sealed source; historical records never authorize this attempt.',
    );
  if (delivery.baseline_sha !== source) return refused();
  if (!SHA.test(delivery.commit_sha))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `Invalid committed SHA for ${unit.id}.`,
      'Deliver a full committed SHA descended from the frozen source baseline.',
    );
  const dispatchPath = builderRecordPath(context, 'dispatch', key);
  const packetPath = builderRecordPath(context, 'packet', key);
  const ackPath = builderRecordPath(context, 'ack', key);
  const dispatch = readBuilderRecord<DispatchReceipt>(deps, dispatchPath, 'dispatch');
  if (!dispatch.ok) return refused();
  const d = dispatch.value.value;
  if (
    d.id !== `dispatch-${key}` ||
    d.unit_id !== unit.id ||
    resolveInRepo(d.packet.path, deps.repoRoot) !== packetPath ||
    d.packet.sha256 !== delivery.packet_sha256 ||
    d.observed.peer_id !== delivery.peer_id ||
    !d.observed.ready ||
    d.observed.root !== delivery.workspace ||
    d.baseline.sha256 !== baseline.ref.sha256 ||
    resolveInRepo(d.baseline.path, deps.repoRoot) !==
      resolveInRepo(baseline.ref.path, deps.repoRoot) ||
    !d.acknowledgement ||
    resolveInRepo(d.acknowledgement.path, deps.repoRoot) !== ackPath
  )
    return refused();
  for (const ref of [d.packet, d.allocation, d.acknowledgement]) {
    const verified = sameBuilderFile(deps, ref);
    if (!verified.ok) return refused();
  }
  if (resolveInRepo(d.allocation.path, deps.repoRoot) !== d.allocation.path) return refused();
  const packet = readBuilderRecord<Packet>(deps, packetPath, 'packet');
  const allocation = readBuilderRecord<AllocationRecord>(deps, d.allocation.path, 'allocation');
  const ack = readBuilderRecord<AckReceipt>(deps, ackPath, 'ack');
  if (!packet.ok || !allocation.ok || !ack.ok) return refused();
  const p = packet.value.value;
  const a = allocation.value.value;
  const receipt = ack.value.value;
  if (
    p.id !== `packet-${key}` ||
    receipt.id !== `ack-${key}` ||
    receipt.baseline_sha !== source ||
    p.baseline.sha256 !== baseline.ref.sha256 ||
    resolveInRepo(p.baseline.path, deps.repoRoot) !==
      resolveInRepo(baseline.ref.path, deps.repoRoot)
  )
    return refused();
  if (
    a.peer_id !== delivery.peer_id ||
    receipt.unit_id !== unit.id ||
    p.allocation.sha256 !== d.allocation.sha256 ||
    p.baseline.sha256 !== d.baseline.sha256 ||
    receipt.observed.harness !== p.requested.harness ||
    receipt.observed.model !== p.requested.model ||
    (p.requested.effort !== undefined && receipt.observed.effort !== p.requested.effort)
  )
    return builderFailure(
      ErrorCodes.BUILDER_ACK,
      `Allocation or runtime binding changed for ${unit.id}.`,
      'Use the CAS-bound peer allocation and its matching native acknowledgement.',
    );
  if (
    p.unit.id !== unit.id ||
    JSON.stringify(p.unit) !== JSON.stringify(unit) ||
    p.workspace !== delivery.workspace ||
    a.root !== delivery.workspace ||
    a.unit_id !== unit.id ||
    a.base_sha !== baseline.value.source_sha ||
    a.retired_at ||
    receipt.nonce !== p.nonce ||
    receipt.packet_sha256 !== delivery.packet_sha256 ||
    receipt.baseline_sha !== baseline.value.source_sha ||
    receipt.peer_id !== delivery.peer_id ||
    receipt.native_root !== delivery.workspace ||
    receipt.shell_cwd !== delivery.workspace ||
    !receipt.observed.ready ||
    receipt.observed.peer_id !== delivery.peer_id ||
    receipt.observed.root !== delivery.workspace
  )
    return builderFailure(
      ErrorCodes.BUILDER_ACK,
      `Packet, allocation or acknowledgement mismatch for ${unit.id}.`,
      'Recover the accepted immutable records; do not infer provenance from a branch name.',
    );
  if (d.release?.outcome !== 'delivered') {
    const confirmationId = `ack-${key}-release`;
    const harnessCommand = [deps.harness.command, ...deps.harness.args]
      .map((argument) => JSON.stringify(argument))
      .join(' ');
    return builderFailure(
      ErrorCodes.BUILDER_ACK,
      `Release delivery confirmation is ${d.release ? 'queued' : 'missing'} for ${unit.id}.`,
      `${d.release ? '' : 'No release is recorded; recover its issuance through the owning acknowledgement flow first. '}After ${delivery.peer_id} observes the exact issued release, collect a fresh raw AckReceipt with id ${confirmationId} and nonce derived from dispatch.release.message_id. Run ${harnessCommand} builder ack ${JSON.stringify(context.planPath)} --receipt <path-to-fresh-release-ack.json>, then retry composition only after the dispatch records delivered. A queued send, pre-work acknowledgement retry or delivered-code claim is not confirmation.`,
      {
        unit_id: unit.id,
        baseline_sha: source,
        dispatch_path: dispatch.value.ref.path,
        release_outcome: d.release?.outcome ?? 'missing',
        release_message_id: d.release?.message_id ?? null,
        confirmation_id: confirmationId,
        canonical_confirmation_path: builderRecordPath(context, 'ack', `${key}-release`),
      },
    );
  }
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
  const ancestor = await builderGit(
    deps,
    ['merge-base', '--is-ancestor', baseline.value.source_sha, delivery.commit_sha],
    delivery.workspace,
  );
  if (!ancestor.ok) return ancestor;
  const merges = await builderGit(
    deps,
    ['rev-list', '--merges', `${baseline.value.source_sha}..${delivery.commit_sha}`],
    delivery.workspace,
  );
  if (!merges.ok) return merges;
  if (merges.value.trim())
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Worker delivery contains merge commits.',
      'Deliver a linear sequence of fenced unit commits.',
    );
  const commits = await builderGit(
    deps,
    ['rev-list', '--reverse', `${baseline.value.source_sha}..${delivery.commit_sha}`],
    delivery.workspace,
  );
  if (!commits.ok) return commits;
  const sequence = commits.value.trim().split(/\s+/).filter(Boolean);
  if (!sequence.length || sequence.some((commit) => !SHA.test(commit)))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `No committed work for ${unit.id}.`,
      'Deliver actual unit commits, not the baseline itself.',
    );
  for (const commit of sequence) {
    const files = await builderGit(
      deps,
      ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', commit],
      delivery.workspace,
    );
    if (!files.ok) return files;
    const outside = nulPaths(files.value).filter((path) => !builderOwnsPath(unit, path));
    if (outside.length)
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        `Out-of-fence history in ${unit.id}.`,
        'Remove unrelated commits from the delivery history; reverted writes are still outside ownership.',
        outside,
      );
  }
  return { ok: true, value: sequence };
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

async function integrationFence(
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
  const outside = nulPaths(delta.value).filter(
    (file) =>
      !isWithin(context.planDir, resolveInRepo(file, deps.repoRoot)) &&
      !pm.some((unit) => builderOwnsPath(unit, file)),
  );
  return {
    ok: true,
    value: outside.flatMap((file) => {
      const owners = guide.units.filter((unit) => builderOwnsPath(unit, file));
      return owners.length
        ? owners.map((unit) => ({ file, owning_unit: unit.id, stage }))
        : [{ file, owning_unit: 'unmapped', stage }];
    }),
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
  const baseline = loadBuilderBaseline(deps, context, guide);
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
  // Later factual plan/receipt commits do not turn unchanged code into a new artifact.
  const originalDir = posixDirname(baseline.value.value.plan.path);
  if (
    nulPaths(delta.value).some(
      (path) =>
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
  const loaded = loadBuilderGuide(deps, input.plan);
  if (!loaded.ok) return loaded;
  const { context, guide: storedGuide } = loaded.value;
  const guide = storedGuide.value;
  const baseline = loadBuilderBaseline(deps, context, guide);
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
    const integration = await integrationFence(
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
    const prepared: Array<{ delivery: UnitDelivery; commits: string[] }> = [];
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
      const validated = await validateDelivery(deps, context, baseline.value, unit, delivery);
      if (!validated.ok) return validated;
      prepared.push({ delivery, commits: validated.value });
    }
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
          `Composition stopped at ${delivery.unit_id}; Git conflict state is preserved.`,
          'Inspect and resolve the visible cherry-pick state; do not claim completed composition or reset unrelated work.',
          imported,
        );
    }
    const composed = await builderHead(deps);
    if (!composed.ok) return composed;
    return writeBuilderRecord(deps, path, {
      record_type: 'composition',
      id: deps.nonce(),
      recorded_at: deps.clock.nowIso(),
      baseline: baseline.value.ref,
      units: prepared.map((row) => row.delivery),
      integration_sha: composed.value,
      files: [],
      checks: [],
      warnings: integration.value,
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
  const integration = await integrationFence(
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
    if (isWithin(context.planDir, resolveInRepo(file, deps.repoRoot))) continue;
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
      ...(imported.value.value.warnings ?? []).filter((warning) => warning.stage === 'import'),
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
