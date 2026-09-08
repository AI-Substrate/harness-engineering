import { ErrorCodes } from '../../output/error-codes.js';
import {
  isWithin,
  posixDirname,
  posixJoin,
  posixRelative,
  resolveInRepo,
  toPosix,
} from '../shared/posix-path.js';
import {
  allocationAuthority,
  bindWorkspaceAllocation,
  isGitOid,
  listAllocations,
  reserveAllocation,
  saveAllocation,
  verifyAllocationAuthority,
  withAllocationLock,
  workspaceGit,
} from './allocation-store.js';
import {
  builderContext,
  builderFailure,
  isBuilderPreservationExcluded,
  readBuilderDocument,
  sha256,
} from './records.js';
import { stageBuilderPlanAssets, stageBuilderSchemas } from './schema-service.js';
import type {
  AdoptInput,
  AllocationRecord,
  BuilderDeps,
  BuilderResult,
  PreservationReceipt,
  Stored,
  TidyDeps,
  TidyInput,
  TidyResult,
  WorkspaceInput,
  WorkspaceResult,
} from './types.js';

function journal(
  deps: BuilderDeps,
  allocation: Stored<AllocationRecord>,
  event: string,
  changes: Partial<AllocationRecord> = {},
): BuilderResult<Stored<AllocationRecord>> {
  return saveAllocation(
    deps,
    { ...allocation.value, ...changes, journal: [...allocation.value.journal, event] },
    allocation,
  );
}

async function inspectWorkspace(
  deps: BuilderDeps,
  root: string,
): Promise<BuilderResult<{ branch: string; head: string; gitDir: string; commonDir: string }>> {
  const top = await workspaceGit(deps, root, ['rev-parse', '--show-toplevel']);
  const realRoot = deps.fs.realpath(root);
  if (!top.ok || realRoot === null || deps.fs.realpath(toPosix(top.stdout.trim())) !== realRoot)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'The target is not the exact root of a Git checkout.',
      'Use the actual workspace root; nested directories and aliases confer no authority.',
      top,
    );
  const branch = await workspaceGit(deps, root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const head = await workspaceGit(deps, root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const git = await workspaceGit(deps, root, ['rev-parse', '--absolute-git-dir']);
  const common = await workspaceGit(deps, root, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const gitDir = git.ok && git.stdout.trim() ? deps.fs.realpath(toPosix(git.stdout.trim())) : null;
  const commonDir =
    common.ok && common.stdout.trim() ? deps.fs.realpath(toPosix(common.stdout.trim())) : null;
  if (
    !branch.ok ||
    !branch.stdout.trim() ||
    !head.ok ||
    !isGitOid(head.stdout.trim()) ||
    gitDir === null ||
    commonDir === null
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace branch, commit or Git directory is ambiguous.',
      'Restore a live attached branch and readable Git metadata.',
    );
  return {
    ok: true,
    value: {
      branch: branch.stdout.trim(),
      head: head.stdout.trim(),
      gitDir: toPosix(gitDir),
      commonDir: toPosix(commonDir),
    },
  };
}

async function harnessCommand(
  deps: BuilderDeps,
  root: string,
  args: string[],
): Promise<BuilderResult<true>> {
  const result = await deps.exec.run(deps.harness.command, [...deps.harness.args, ...args], {
    cwd: root,
    timeoutMs: 120_000,
  });
  return result.ok
    ? { ok: true, value: true }
    : builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        `Workspace initialization failed: harness ${args.join(' ')}`,
        'Repair the reported prerequisite, then retry the same allocation; existing content is retained.',
        result,
      );
}

async function scaffoldPlan(
  deps: BuilderDeps,
  allocation: AllocationRecord,
  input: WorkspaceInput,
): Promise<BuilderResult<true>> {
  const plan = resolveInRepo(allocation.plan_path as string, allocation.root);
  const planDir = posixDirname(plan);
  // Regenerate into a private directory, then copy ONLY missing files. This recovers
  // partial plan-new writes without teaching this service the plan/task schema.
  const temp = deps.fs.createSiblingTempDir(planDir, '.builder-plan-');
  try {
    const args = [
      'plan',
      'new',
      allocation.slug,
      '--ordinal',
      String(allocation.ordinal),
      '--dir',
      posixRelative(allocation.root, temp),
    ];
    if (input.title !== undefined) args.push('--title', input.title);
    for (const phase of input.phases ?? ['Implementation']) args.push('--phase', phase);
    const created = await harnessCommand(deps, allocation.root, args);
    if (!created.ok) return created;
    const generated = posixJoin(
      temp,
      `${String(allocation.ordinal).padStart(3, '0')}-${allocation.slug}`,
    );
    const files = deps.fs.listRegularFilesNoFollow(generated);
    if (files === null || !files.includes('plan.dd.json'))
      return builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        'Plan creation returned without a complete scaffold.',
        'Repair the injected harness plan command and retry; a successful exit alone is not a scaffold.',
      );
    for (const file of files) {
      const path = posixJoin(planDir, file);
      if (deps.fs.exists(path)) continue;
      const content = deps.fs.readText(posixJoin(generated, file));
      if (content === null)
        return builderFailure(
          ErrorCodes.BUILDER_INVALID,
          `Unreadable scaffold file: ${file}`,
          'Restore the generated file and retry.',
        );
      deps.fs.mkdirp(posixDirname(path));
      if (!deps.fs.createExclusive(path, content))
        return builderFailure(
          ErrorCodes.BUILDER_CONFLICT,
          `Scaffold target was concurrently created: ${path}`,
          'Inspect the existing file and retry without overwriting it.',
        );
    }
    const local = { ...deps, repoRoot: allocation.root };
    const document = readBuilderDocument(local, plan, 'builder/plan');
    if (!document.ok) return document;
    const meta = document.value.value.sections.find((section) => section.name === 'meta')?.value as
      | { slug?: string; ordinal?: number }
      | undefined;
    if (meta?.slug !== allocation.slug || meta.ordinal !== allocation.ordinal)
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        'Existing plan does not match its allocated identity.',
        'Preserve the existing plan and resolve the conflicting allocation explicitly.',
      );
    return { ok: true, value: true };
  } finally {
    if (deps.fs.exists(temp)) deps.fs.removeDir(temp);
  }
}

export async function provisionBuilderWorkspace(
  deps: BuilderDeps,
  input: WorkspaceInput,
): Promise<BuilderResult<WorkspaceResult>> {
  try {
    const schemas = stageBuilderSchemas(deps, deps.repoRoot);
    if (!schemas.ok) return schemas;
    const reserved = await reserveAllocation(deps, input);
    if (!reserved.ok) return reserved;
    return await withAllocationLock(deps, `${reserved.value.ref.path}.operation.lock`, async () => {
      const verified = await verifyAllocationAuthority(deps, reserved.value);
      if (!verified.ok) return verified;
      let allocation = verified.value;
      const root = allocation.value.root;
      if (allocation.value.journal.includes('initialized')) {
        const observed = await inspectWorkspace(deps, root);
        if (!observed.ok) return observed;
        const plan = resolveInRepo(allocation.value.plan_path as string, root);
        const flow = posixJoin(posixDirname(plan), 'the-flow.json');
        if (
          observed.value.branch !== allocation.value.branch ||
          observed.value.gitDir !== allocation.value.git_dir ||
          !deps.fs.exists(plan) ||
          !deps.fs.exists(flow)
        )
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            'Initialized workspace identity or scaffold changed.',
            'Inspect the existing allocation; retries do not recreate deleted or replaced user files.',
          );
        const bound = bindWorkspaceAllocation(deps, allocation);
        if (!bound.ok) return bound;
        return { ok: true, value: { allocation, plan, flow } };
      }
      if (deps.fs.exists(root) && !allocation.value.journal.includes('workspace-create-started'))
        return builderFailure(
          ErrorCodes.BUILDER_OWNERSHIP,
          'A target appeared after reservation but before creation began.',
          'Adopt it explicitly or choose a new target; a reservation does not own externally created files.',
        );
      const begin = journal(deps, allocation, 'workspace-create-started');
      if (!begin.ok) return begin;
      allocation = begin.value;
      if (!deps.fs.exists(root)) {
        const createArgs =
          input.kind === 'worktree'
            ? [
                'worktree',
                'add',
                '-b',
                allocation.value.branch,
                '--',
                root,
                allocation.value.base_sha,
              ]
            : ['clone', '--no-local', '--no-checkout', '--', deps.repoRoot, root];
        const created = await workspaceGit(deps, deps.repoRoot, createArgs);
        if (!created.ok)
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            'Git workspace creation failed; the reservation is retained.',
            'Repair the reported failure and retry this allocation. Never delete or repurpose a conflicting target.',
            created,
          );
      }
      if (input.kind === 'clone' && !allocation.value.journal.includes('workspace-created')) {
        const origin = await workspaceGit(deps, root, ['remote', 'get-url', 'origin']);
        const common = await workspaceGit(deps, root, [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ]);
        if (
          !origin.ok ||
          deps.fs.realpath(toPosix(origin.stdout.trim())) !== deps.fs.realpath(deps.repoRoot) ||
          deps.fs.realpath(toPosix(common.stdout.trim())) !==
            deps.fs.realpath(posixJoin(root, '.git'))
        )
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'Existing clone does not match its recorded creation source.',
            'Inspect the interrupted clone; do not check out into an unrelated directory.',
          );
        const branch = await workspaceGit(deps, root, [
          'symbolic-ref',
          '--quiet',
          '--short',
          'HEAD',
        ]);
        if (branch.stdout.trim() !== allocation.value.branch) {
          const checkout = await workspaceGit(deps, root, [
            'checkout',
            '-b',
            allocation.value.branch,
            allocation.value.base_sha,
          ]);
          if (!checkout.ok)
            return builderFailure(
              ErrorCodes.BUILDER_CONFLICT,
              'Clone checkout failed; the allocation is resumable.',
              'Inspect the reserved clone and retry without resetting existing work.',
              checkout,
            );
        }
      }
      const observed = await inspectWorkspace(deps, root);
      if (!observed.ok) return observed;
      const sourceGitDir = allocation.value.journal
        .find((event) => event.startsWith('source-git:'))
        ?.slice('source-git:'.length);
      if (
        observed.value.branch !== allocation.value.branch ||
        (input.kind === 'worktree'
          ? observed.value.commonDir !== sourceGitDir
          : observed.value.commonDir !== posixJoin(root, '.git'))
      )
        return builderFailure(
          ErrorCodes.BUILDER_OWNERSHIP,
          'Workspace does not match the reserved Git identity.',
          'Restore the original resource; the reservation never authorizes adopting another checkout.',
        );
      if (
        !allocation.value.journal.includes('workspace-created') &&
        observed.value.head !== allocation.value.base_sha
      )
        return builderFailure(
          ErrorCodes.BUILDER_CONFLICT,
          'Interrupted creation has moved away from its reserved base.',
          'Inspect the unexpected history instead of resetting it.',
        );
      const recorded = journal(deps, allocation, 'workspace-created', {
        git_dir: observed.value.gitDir,
      });
      if (!recorded.ok) return recorded;
      allocation = recorded.value;
      const staged = stageBuilderSchemas(deps, root);
      if (!staged.ok) return staged;
      const plan = resolveInRepo(allocation.value.plan_path as string, root);
      const context = builderContext({ ...deps, repoRoot: root }, plan);
      if (!context.ok) return context;
      if (input.purpose === 'plan') {
        deps.fs.mkdirp(posixDirname(context.value.planDir));
        const started = journal(deps, allocation, 'scaffold-started');
        if (!started.ok) return started;
        allocation = started.value;
        const scaffolded = await scaffoldPlan(deps, allocation.value, input);
        if (!scaffolded.ok) return scaffolded;
        const guide = await harnessCommand(deps, root, [
          'builder',
          'guide',
          allocation.value.plan_path as string,
          '--init',
        ]);
        if (!guide.ok) return guide;
        if (!deps.fs.exists(context.value.guidePath))
          return builderFailure(
            ErrorCodes.BUILDER_NOT_READY,
            'Guide initialization returned without the canonical guide.',
            'Repair the guide command and retry the allocation.',
          );
        const assets = stageBuilderPlanAssets({ ...deps, repoRoot: root }, plan);
        if (!assets.ok) return assets;
        if (!deps.fs.exists(context.value.flowPath)) {
          const flow = await harnessCommand(deps, root, [
            'flow',
            'create',
            'flight-plan',
            '--slug',
            allocation.value.slug,
            '--path',
            posixRelative(root, context.value.flowPath),
            '--plan-dir',
            posixRelative(root, context.value.planDir),
            '--agent',
            'builder',
          ]);
          if (!flow.ok) return flow;
        }
      }
      if (!deps.fs.exists(plan) || !deps.fs.exists(context.value.flowPath))
        return builderFailure(
          ErrorCodes.BUILDER_NOT_READY,
          'The recorded base lacks the canonical plan or flow.',
          'Commit the required parent plan/flow at the source base before provisioning units.',
        );
      const ready = journal(deps, allocation, 'initialized');
      if (!ready.ok) return ready;
      const bound = bindWorkspaceAllocation(deps, ready.value);
      return bound.ok
        ? { ok: true, value: { allocation: ready.value, plan, flow: context.value.flowPath } }
        : bound;
    });
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Workspace initialization interrupted: ${String(error)}`,
      'Inspect the retained allocation journal and repair the filesystem or command before retrying.',
    );
  }
}

export async function adoptBuilderWorkspace(
  deps: BuilderDeps,
  input: AdoptInput,
): Promise<BuilderResult<WorkspaceResult>> {
  try {
    if (!['external', 'pij'].includes(input.owner) || !input.actor.trim())
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'Adoption requires external/pij ownership and an actor.',
        'Never use adoption to confer harness teardown authority.',
      );
    const context = builderContext(deps, input.plan);
    if (!context.ok) return context;
    const plan = readBuilderDocument(deps, context.value.planPath, 'builder/plan');
    if (!plan.ok) return plan;
    const meta = plan.value.value.sections.find((section) => section.name === 'meta')?.value as
      | { slug?: string; ordinal?: number }
      | undefined;
    if (
      typeof meta?.ordinal !== 'number' ||
      !Number.isSafeInteger(meta.ordinal) ||
      meta.ordinal < 0 ||
      typeof meta.slug !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)
    )
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'The existing plan has no valid recorded ordinal and slug.',
        'Record its actual identity through the plan owner before adoption; adoption does not renumber plans.',
      );
    const observed = await inspectWorkspace(deps, deps.repoRoot);
    if (!observed.ok) return observed;
    const authority = await allocationAuthority(deps);
    if (!authority.ok) return authority;
    return await withAllocationLock(
      deps,
      posixJoin(authority.value, 'builder/allocations/reserve.lock'),
      async () => {
        const existing = listAllocations(deps, authority.value);
        if (!existing.ok) return existing;
        const prior = existing.value.find((record) => record.value.root === deps.repoRoot);
        if (prior) {
          if (
            prior.value.owner !== input.owner ||
            prior.value.retired_at ||
            prior.value.plan_path !== posixRelative(deps.repoRoot, context.value.planPath) ||
            prior.value.branch !== observed.value.branch ||
            prior.value.git_dir !== observed.value.gitDir
          )
            return builderFailure(
              ErrorCodes.BUILDER_OWNERSHIP,
              'This checkout already has a different allocation provenance.',
              'Use its original record; adoption never replaces ownership or tombstones.',
            );
          const bound = bindWorkspaceAllocation(deps, prior);
          if (!bound.ok) return bound;
          return {
            ok: true,
            value: {
              allocation: prior,
              plan: context.value.planPath,
              flow: context.value.flowPath,
            },
          };
        }
        const saved = saveAllocation(deps, {
          record_type: 'allocation',
          id: `al-adopt-${deps.nonce()}`,
          owner: input.owner,
          kind: observed.value.gitDir === observed.value.commonDir ? 'clone' : 'worktree',
          purpose: 'plan',
          root: deps.repoRoot,
          authority_root: authority.value,
          git_dir: observed.value.gitDir,
          branch: observed.value.branch,
          base_sha: observed.value.head,
          ordinal: meta.ordinal as number,
          slug: meta.slug as string,
          actor: input.actor,
          recorded_at: deps.clock.nowIso(),
          journal: ['adopted'],
          plan_path: posixRelative(deps.repoRoot, context.value.planPath),
        });
        if (!saved.ok) return saved;
        const bound = bindWorkspaceAllocation(deps, saved.value);
        return bound.ok
          ? {
              ok: true,
              value: {
                allocation: saved.value,
                plan: context.value.planPath,
                flow: context.value.flowPath,
              },
            }
          : bound;
      },
    );
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Adoption could not be recorded: ${String(error)}`,
      'Repair the record target; no existing workspace was reallocated.',
    );
  }
}

function preservationFailure(message: string, details?: unknown) {
  return builderFailure(
    ErrorCodes.BUILDER_PRESERVATION,
    message,
    'Run close again into a surviving, independent destination and pass its complete fresh preservation receipt.',
    details,
  );
}

function diffSource(source: string): { root: string; args: string[] } | null {
  const match = /^git-diff:(.+)#(working-tree|index)$/.exec(source);
  if (!match?.[1]) return null;
  return {
    root: match[1],
    args: match[2] === 'index' ? ['diff', '--cached', '--binary'] : ['diff', '--binary'],
  };
}

function requiredWorkspaceFiles(deps: BuilderDeps, root: string): BuilderResult<string[]> {
  const files: string[] = [];
  const visit = (directory: string): BuilderResult<true> => {
    const entries = deps.fs.readdir(directory);
    if (!entries.length && deps.fs.listRegularFilesNoFollow(directory) === null)
      return preservationFailure(`Unreadable or non-directory workspace material: ${directory}`);
    for (const entry of entries) {
      const path = posixJoin(directory, entry);
      if (isBuilderPreservationExcluded(posixRelative(root, path))) continue;
      if (toPosix(deps.fs.realpath(path) ?? '') !== path)
        return preservationFailure(`Symlinked or unreadable workspace material: ${path}`);
      const file = deps.fs.probeRegularFileNoFollow(root, path, Number.MAX_SAFE_INTEGER);
      if (file.status === 'ok') files.push(path);
      else {
        if (file.reason !== 'non-file')
          return preservationFailure(`Unsafe workspace material: ${path}`);
        const nested = visit(path);
        if (!nested.ok) return nested;
      }
    }
    return { ok: true, value: true };
  };
  const visited = visit(root);
  return visited.ok ? { ok: true, value: files } : visited;
}

function resolvePreservationPaths(
  deps: BuilderDeps,
  receipt: PreservationReceipt,
): PreservationReceipt {
  const absolute = (path: string) => resolveInRepo(path, deps.repoRoot);
  return {
    ...receipt,
    source_root: absolute(receipt.source_root),
    archived_plan: absolute(receipt.archived_plan),
    survivor_root: absolute(receipt.survivor_root),
    retiring_roots: receipt.retiring_roots.map(absolute),
    inventory: receipt.inventory.map((item) => {
      const computed = diffSource(item.source);
      const source = computed
        ? `git-diff:${absolute(computed.root)}#${computed.args.includes('--cached') ? 'index' : 'working-tree'}`
        : item.source.startsWith('git-diff:')
          ? item.source
          : absolute(item.source);
      return { ...item, source, destination: absolute(item.destination) };
    }),
    refs: receipt.refs.map((ref) => ({
      ...ref,
      source_repo: absolute(ref.source_repo),
      destination_repo: absolute(ref.destination_repo),
    })),
  };
}

async function verifyPreservation(
  deps: BuilderDeps,
  allocation: AllocationRecord,
  receipt: PreservationReceipt,
  resume: boolean,
  receiptHash: string,
): Promise<BuilderResult<true>> {
  if (
    receipt.record_type !== 'preservation' ||
    !receipt.allocation_ids.includes(allocation.id) ||
    !receipt.retiring_roots.includes(allocation.root) ||
    !receipt.inventory.length ||
    !receipt.refs.length ||
    !isGitOid(receipt.source_sha) ||
    !isGitOid(receipt.composed_sha)
  )
    return preservationFailure(
      'The receipt does not cover this allocation and its source/composed commits.',
    );
  const survivor = deps.fs.realpath(receipt.survivor_root);
  if (survivor === null) return preservationFailure('The preservation destination is missing.');
  const retiring = receipt.retiring_roots.map((root) =>
    toPosix(deps.fs.normalizeBundleTargetIdentity(root)),
  );
  const survives = (path: string) => !retiring.some((root) => isWithin(root, path));
  if (!survives(toPosix(survivor)) || !survives(allocation.authority_root))
    return preservationFailure(
      'The only archive or allocation authority lies inside a retiring root.',
    );
  const records = listAllocations(deps, allocation.authority_root);
  if (!records.ok) return records;
  const previouslyRemoved = (path: string) =>
    records.value.some(
      ({ value }) =>
        isWithin(value.root, path) &&
        value.journal.includes(`preservation:${receiptHash}`) &&
        (value.retired_at !== undefined ||
          value.journal.includes('workspace-removed') ||
          (resume && value.id === allocation.id)),
    );
  const sources = new Set<string>();
  const destinations = new Set<string>();
  for (const item of receipt.inventory) {
    if (sources.has(item.source) || destinations.has(item.destination))
      return preservationFailure(
        'The preservation inventory contains ambiguous duplicate sources or destinations.',
      );
    sources.add(item.source);
    destinations.add(item.destination);
    const destination = deps.fs.realpath(item.destination);
    if (
      destination === null ||
      !isWithin(toPosix(survivor), toPosix(destination)) ||
      !survives(toPosix(destination))
    )
      return preservationFailure(`Preserved file does not survive: ${item.destination}`);
    const bytes = deps.fs.readBytesNoFollow(item.destination);
    if (bytes === null || bytes.byteLength !== item.bytes || sha256(bytes) !== item.sha256)
      return preservationFailure(`Preserved file bytes changed: ${item.destination}`);
    const computed = diffSource(item.source);
    if (item.source.startsWith('git-diff:') && computed === null)
      return preservationFailure(`Unknown computed inventory source: ${item.source}`);
    let current: Uint8Array | null;
    if (computed) {
      if (!deps.fs.exists(computed.root) && previouslyRemoved(computed.root)) continue;
      const result = await workspaceGit(deps, computed.root, computed.args);
      if (!result.ok) return preservationFailure(`Cannot remeasure ${item.source}`, result);
      current = Buffer.from(result.stdout);
    } else {
      if (!deps.fs.exists(item.source) && previouslyRemoved(item.source)) continue;
      if (toPosix(deps.fs.realpath(item.source) ?? '') !== item.source)
        return preservationFailure(`Required source is missing or symlinked: ${item.source}`);
      current = deps.fs.readBytesNoFollow(item.source);
    }
    if (current === null || current.byteLength !== item.bytes || sha256(current) !== item.sha256)
      return preservationFailure(`Required source changed since preservation: ${item.source}`);
  }
  if (
    !receipt.inventory.some(
      (item) =>
        isWithin(receipt.archived_plan, item.source) && item.source.endsWith('/plan.dd.json'),
    )
  )
    return preservationFailure('The canonical archived plan is missing from the inventory.');
  if (deps.fs.exists(receipt.archived_plan)) {
    const archiveFiles = deps.fs.listRegularFilesNoFollow(receipt.archived_plan);
    if (
      archiveFiles === null ||
      archiveFiles.some((file) => !sources.has(posixJoin(receipt.archived_plan, file)))
    )
      return preservationFailure(
        'The archived plan inventory is incomplete or contains unsafe files.',
      );
  } else if (!previouslyRemoved(receipt.archived_plan))
    return preservationFailure('The canonical archive source cannot be accounted for.');
  const referenceKeys = new Set<string>();
  const verifiedGitStores = new Set<string>();
  for (const ref of receipt.refs) {
    const key = `${ref.source_repo}\0${ref.source_ref}`;
    if (
      referenceKeys.has(key) ||
      !isGitOid(ref.oid) ||
      !ref.destination_ref.startsWith('refs/') ||
      !(ref.source_ref === 'HEAD' || ref.source_ref.startsWith('refs/'))
    )
      return preservationFailure('Invalid or duplicate preservation ref.');
    referenceKeys.add(key);
    const destination = deps.fs.realpath(ref.destination_repo);
    if (
      destination === null ||
      !survives(toPosix(destination)) ||
      !isWithin(toPosix(survivor), toPosix(destination))
    )
      return preservationFailure('The preserved Git repository is not in the surviving archive.');
    if (!verifiedGitStores.has(destination)) {
      const git = await workspaceGit(deps, ref.destination_repo, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]);
      const common =
        git.ok && git.stdout.trim() ? deps.fs.realpath(toPosix(git.stdout.trim())) : null;
      if (
        common === null ||
        !survives(toPosix(common)) ||
        !isWithin(toPosix(survivor), toPosix(common)) ||
        deps.fs.readText(posixJoin(toPosix(common), 'objects/info/alternates'))?.trim()
      )
        return preservationFailure(
          'Preserved refs depend on Git storage outside the surviving archive.',
        );
      const bare = await workspaceGit(deps, ref.destination_repo, [
        'rev-parse',
        '--is-bare-repository',
      ]);
      if (!bare.ok || bare.stdout.trim() !== 'true')
        return preservationFailure('Preserved Git storage is not a bare repository.');
      verifiedGitStores.add(destination);
    }
    const oid = await workspaceGit(deps, ref.destination_repo, [
      'rev-parse',
      '--verify',
      `${ref.destination_ref}^{object}`,
    ]);
    if (!oid.ok || oid.stdout.trim() !== ref.oid)
      return preservationFailure('The preserved bare ref is unavailable or has changed.', {
        ref,
        observed: oid,
      });
    if (!deps.fs.exists(ref.source_repo) && previouslyRemoved(ref.source_repo)) continue;
    const source = await workspaceGit(deps, ref.source_repo, [
      'rev-parse',
      '--verify',
      `${ref.source_ref}^{object}`,
    ]);
    if (!source.ok || source.stdout.trim() !== ref.oid)
      return preservationFailure('The source ref changed after preservation.', {
        ref,
        observed: source,
      });
  }
  if (!referenceKeys.has(`${allocation.root}\0HEAD`))
    return preservationFailure('The removable workspace HEAD is not preserved.');
  if (
    !receipt.refs.some(
      (ref) =>
        ref.source_repo === receipt.source_root &&
        ref.source_ref === 'HEAD' &&
        ref.oid === receipt.source_sha,
    )
  )
    return preservationFailure('The receipt source commit is not its preserved source HEAD.');
  if (!receipt.refs.some((ref) => ref.oid === receipt.composed_sha))
    return preservationFailure('The composed commit has no surviving preserved ref.');
  if (!resume) {
    const refs = await workspaceGit(deps, allocation.root, [
      'for-each-ref',
      '--format=%(refname) %(objectname)',
    ]);
    if (!refs.ok)
      return preservationFailure('Cannot enumerate the removable workspace refs.', refs);
    for (const line of refs.stdout.trim().split('\n').filter(Boolean)) {
      const [name, oid] = line.split(' ');
      if (
        !receipt.refs.some(
          (ref) =>
            ref.source_repo === allocation.root && ref.source_ref === name && ref.oid === oid,
        )
      )
        return preservationFailure(`Required source ref is omitted: ${name}`);
    }
    for (const mode of ['working-tree', 'index'])
      if (!sources.has(`git-diff:${allocation.root}#${mode}`))
        return preservationFailure(`The ${mode} WIP measurement is absent.`);
    const files = requiredWorkspaceFiles(deps, allocation.root);
    if (!files.ok) return files;
    const missing = files.value.filter((file) => !sources.has(file));
    if (missing.length)
      return preservationFailure(
        'Required tracked, untracked or ignored workspace files are not fully preserved.',
        { missing },
      );
  }
  return { ok: true, value: true };
}

export async function tidyBuilderWorkspace(
  deps: TidyDeps,
  input: TidyInput,
): Promise<BuilderResult<TidyResult>> {
  try {
    const verified = await verifyAllocationAuthority(deps, input.allocation);
    if (!verified.ok) return verified;
    return await withAllocationLock<TidyResult>(
      deps,
      `${verified.value.ref.path}.operation.lock`,
      async () => {
        const fresh = await verifyAllocationAuthority(deps, verified.value);
        if (!fresh.ok) return fresh;
        let allocation = fresh.value;
        const value = allocation.value;
        if (
          value.owner !== 'harness' ||
          !value.journal.includes('workspace-created') ||
          !value.journal.includes('reserved')
        )
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'This resource was not created by this harness allocation.',
            'External and adopted resources must be released by their actual owner.',
          );
        if (value.retired_at) return { ok: true, value: { allocation, removed: false } };
        if (
          isWithin(value.root, deps.repoRoot) ||
          isWithin(value.root, value.authority_root) ||
          toPosix(deps.fs.normalizeBundleTargetIdentity(value.root)) !== value.root
        )
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'The removable root contains active authority or aliases another path.',
            'Run tidy from the original surviving authority, with the unchanged resource path.',
          );
        const sourceGitDir = value.journal
          .find((event) => event.startsWith('source-git:'))
          ?.slice('source-git:'.length);
        if (
          !sourceGitDir ||
          toPosix(deps.fs.realpath(sourceGitDir) ?? '') !== sourceGitDir ||
          isWithin(value.root, sourceGitDir)
        )
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'The recorded creation Git storage no longer survives.',
            'Reclaim child workspaces before their parent and preserve the creating Git authority.',
          );
        if (value.peer_id) {
          if (typeof deps.peerReleased !== 'function')
            return builderFailure(
              ErrorCodes.BUILDER_RUNTIME,
              'Peer-release observation is unavailable.',
              'Provide the supported runtime release capability; idle is not released.',
            );
          const released = await deps.peerReleased(value.peer_id);
          if (!released.ok) return released;
          if (released.value !== true)
            return builderFailure(
              ErrorCodes.BUILDER_RUNTIME,
              'The workspace peer has not been verifiably released.',
              'Have the operator stop the original peer process, then retry through the supported release observer.',
            );
        }
        let removalHead: string | undefined;
        for (const event of value.journal)
          if (event.startsWith('remove-started:'))
            removalHead = event.slice('remove-started:'.length);
        const resume = !deps.fs.exists(value.root) && removalHead !== undefined;
        if (!deps.fs.exists(value.root) && !resume)
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'The allocated root disappeared before a verified removal.',
            'Inspect the original resource and preservation; absence alone is not proof of reclamation.',
          );
        const preservationHash = sha256(JSON.stringify(input.preservation));
        if (resume && !value.journal.includes(`preservation:${preservationHash}`))
          return preservationFailure(
            'A resumed removal requires the exact verified preservation generation.',
          );
        const preserved = await verifyPreservation(
          deps,
          value,
          resolvePreservationPaths(deps, input.preservation),
          resume,
          preservationHash,
        );
        if (!preserved.ok) return preserved;
        let head = removalHead;
        if (!resume) {
          const observed = await inspectWorkspace(deps, value.root);
          if (!observed.ok) return observed;
          if (
            observed.value.gitDir !== value.git_dir ||
            observed.value.branch !== value.branch ||
            (value.kind === 'worktree'
              ? observed.value.commonDir !== sourceGitDir
              : observed.value.commonDir !== posixJoin(value.root, '.git'))
          )
            return builderFailure(
              ErrorCodes.BUILDER_OWNERSHIP,
              'Git creation identity no longer matches the allocation.',
              'Do not remove a replaced root or branch.',
            );
          head = observed.value.head;
          const status = await workspaceGit(deps, value.root, [
            'status',
            '--porcelain=v1',
            '-z',
            '--untracked-files=all',
          ]);
          if (!status.ok || status.stdout.length > 0)
            return builderFailure(
              ErrorCodes.BUILDER_CONFLICT,
              'Workspace is dirty; preservation is not permission to discard work.',
              'Commit and integrate the work, refresh preservation, then retry.',
              status,
            );
          const mergeTarget = value.journal
            .find((event) => event.startsWith('merge-target:'))
            ?.slice('merge-target:'.length);
          if (!mergeTarget?.startsWith('refs/heads/'))
            return builderFailure(
              ErrorCodes.BUILDER_OWNERSHIP,
              'The original integration ref was not recorded.',
              'Do not infer a merge target during reclamation.',
            );
          const merged = await workspaceGit(deps, deps.repoRoot, [
            '--git-dir',
            sourceGitDir,
            'merge-base',
            '--is-ancestor',
            head,
            mergeTarget,
          ]);
          if (!merged.ok)
            return builderFailure(
              ErrorCodes.BUILDER_CONFLICT,
              'Workspace HEAD has not been integrated into its original source branch.',
              'Integrate the committed artifact before reclaiming the workspace.',
              merged,
            );
          const pushed = await workspaceGit(deps, deps.repoRoot, [
            '--git-dir',
            sourceGitDir,
            'for-each-ref',
            `--contains=${head}`,
            '--format=%(refname)',
            'refs/remotes',
          ]);
          if (!pushed.ok || !pushed.stdout.trim())
            return builderFailure(
              ErrorCodes.BUILDER_CONFLICT,
              'Workspace HEAD is not known to be pushed.',
              'Push the integrated work and refresh the source remote-tracking refs before reclamation.',
              pushed,
            );
          const proof = journal(deps, allocation, `preservation:${preservationHash}`);
          if (!proof.ok) return proof;
          allocation = proof.value;
          const started = journal(deps, allocation, `remove-started:${head}`);
          if (!started.ok) return started;
          allocation = started.value;
          if (value.kind === 'worktree') {
            // Status is clean and every non-cache file is preserved above. One force
            // permits ignored reports; it still refuses a locked worktree (two required).
            const removed = await workspaceGit(deps, deps.repoRoot, [
              '--git-dir',
              sourceGitDir,
              'worktree',
              'remove',
              '--force',
              '--',
              value.root,
            ]);
            if (!removed.ok)
              return builderFailure(
                ErrorCodes.BUILDER_CONFLICT,
                'Git refused workspace removal; the journal is retained.',
                'Repair the named conflict and resume with the fresh allocation and same preservation receipt.',
                removed,
              );
          } else deps.fs.removeDir(value.root);
        }
        if (deps.fs.exists(value.root))
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            'Workspace removal is incomplete.',
            'Inspect the retained files and resume; the branch and allocation remain intact.',
          );
        const removed = journal(deps, allocation, 'workspace-removed');
        if (!removed.ok) return removed;
        allocation = removed.value;
        if (value.kind === 'worktree') {
          const branch = await workspaceGit(deps, deps.repoRoot, [
            '--git-dir',
            sourceGitDir,
            'rev-parse',
            '--verify',
            `refs/heads/${value.branch}`,
          ]);
          if (branch.ok) {
            if (branch.stdout.trim() !== head)
              return builderFailure(
                ErrorCodes.BUILDER_CONFLICT,
                'The allocated branch changed during removal.',
                "Preserve the changed branch; never delete another writer's history.",
              );
            const deleted = await workspaceGit(deps, deps.repoRoot, [
              '--git-dir',
              sourceGitDir,
              'update-ref',
              '-d',
              `refs/heads/${value.branch}`,
              head as string,
            ]);
            if (!deleted.ok)
              return builderFailure(
                ErrorCodes.BUILDER_CONFLICT,
                'Branch removal failed; workspace removal is recorded.',
                'Retry with the fresh allocation; the expected OID prevents deleting changed history.',
                deleted,
              );
          } else {
            const exists = await workspaceGit(deps, deps.repoRoot, [
              '--git-dir',
              sourceGitDir,
              'show-ref',
              '--verify',
              '--quiet',
              `refs/heads/${value.branch}`,
            ]);
            if (exists.code !== 1)
              return builderFailure(
                ErrorCodes.BUILDER_CONFLICT,
                'Cannot establish whether the allocated branch remains.',
                'Repair Git metadata and retry; no branch is assumed absent.',
                exists,
              );
          }
        }
        const retired = journal(deps, allocation, 'retired', { retired_at: deps.clock.nowIso() });
        return retired.ok
          ? { ok: true, value: { allocation: retired.value, removed: true } }
          : retired;
      },
    );
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Reclamation interrupted: ${String(error)}`,
      'Inspect the retained allocation journal, repair the failing operation and resume without discarding preservation evidence.',
    );
  }
}
