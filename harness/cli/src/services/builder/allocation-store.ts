import type { ExecResult } from '../../adapters/exec/exec-port.js';
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
  builderFailure,
  builderRecordPath,
  readBuilderRecord,
  writeBuilderRecord,
} from './records.js';
import type {
  AllocationRecord,
  BuilderContext,
  BuilderDeps,
  BuilderResult,
  Stored,
  WorkspaceInput,
} from './types.js';

export const isGitOid = (value: string): boolean => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

export function workspaceGit(deps: BuilderDeps, root: string, args: string[]): Promise<ExecResult> {
  return deps.exec.run('git', args, { cwd: root, timeoutMs: 120_000 });
}

interface WorkspaceAllocationLocator {
  path: string;
  id: string;
}

/** A locator only: ownership and mutable facts remain exclusively in the original DD record. */
function readWorkspaceAllocationLocator(
  deps: BuilderDeps,
  root: string,
  gitDir: string,
): BuilderResult<AllocationRecord | null> {
  const path = posixJoin(gitDir, 'builder/allocation-ref');
  if (toPosix(deps.fs.normalizeBundleTargetIdentity(path)) !== path)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace allocation locator is aliased.',
      'Restore the original no-follow allocation reference before adoption.',
    );
  const locator = deps.fs.readTextFileNoFollow(gitDir, path, 16 * 1024);
  if (locator.status !== 'ok')
    return locator.reason === 'missing'
      ? { ok: true, value: null }
      : builderFailure(
          ErrorCodes.BUILDER_OWNERSHIP,
          'Workspace allocation locator is unreadable or unsafe.',
          'Restore its original regular-file locator; do not adopt over ambiguous ownership.',
        );
  let parsed: unknown;
  try {
    parsed = JSON.parse(locator.text);
  } catch {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace allocation locator is malformed.',
      'Restore its original authority path and allocation id; do not adopt over it.',
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 2 ||
    !('path' in parsed) ||
    typeof parsed.path !== 'string' ||
    !('id' in parsed) ||
    typeof parsed.id !== 'string' ||
    !parsed.id
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace allocation locator is not a stable path/id reference.',
      'Use the original authority path and allocation id; hash-locator drafts and copied ownership fields are not accepted.',
    );
  const ref: WorkspaceAllocationLocator = { path: parsed.path, id: parsed.id };
  if (
    !ref.path ||
    resolveInRepo(ref.path, root) !== ref.path ||
    toPosix(deps.fs.normalizeBundleTargetIdentity(ref.path)) !== ref.path
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace allocation locator is not an absolute, unaliased reference.',
      'Restore the original allocation reference without inventing new ownership.',
    );
  const record = readBuilderRecord<AllocationRecord>(deps, ref.path, 'allocation');
  if (
    !record.ok ||
    record.value.value.id !== ref.id ||
    record.value.value.owner !== 'harness' ||
    allocationPath(record.value.value.authority_root, record.value.value.id) !== ref.path ||
    record.value.value.root !== root ||
    record.value.value.git_dir !== gitDir ||
    record.value.value.retired_at !== undefined ||
    !record.value.value.journal.includes('initialized')
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'The workspace locator does not resolve its live initialized harness-owned allocation identity.',
      'Recover the original creator authority; never replace it with a clone-local allocation.',
    );
  return { ok: true, value: record.value.value };
}

export function bindWorkspaceAllocation(
  deps: BuilderDeps,
  allocation: Stored<AllocationRecord>,
): BuilderResult<true> {
  const value = allocation.value;
  const path = posixJoin(value.git_dir, 'builder/allocation-ref');
  if (
    value.owner !== 'harness' ||
    value.retired_at !== undefined ||
    !value.journal.includes('initialized') ||
    allocation.ref.path !== allocationPath(value.authority_root, value.id) ||
    toPosix(deps.fs.normalizeBundleTargetIdentity(path)) !== path
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Cannot bind an unfinalized or unverified workspace allocation locator.',
      'Use the live initialized harness-created allocation and unchanged Git directory.',
    );
  // The authority is mutable (for example peer_id binding); only its identity is stable.
  const locator: WorkspaceAllocationLocator = { path: allocation.ref.path, id: value.id };
  const text = `${JSON.stringify(locator, null, 2)}\n`;
  deps.fs.mkdirp(posixDirname(path));
  if (deps.fs.createExclusive(path, text)) return { ok: true, value: true };
  const existing = deps.fs.readTextFileNoFollow(value.git_dir, path, 16 * 1024);
  return existing.status === 'ok' && existing.text === text
    ? { ok: true, value: true }
    : builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        'The workspace already has a different allocation locator.',
        'Preserve the existing reference and resolve the identity conflict explicitly.',
      );
}

/**
 * The allocation record of the checkout `deps.repoRoot` IS, read through its
 * own locator (`<git-dir>/builder/allocation-ref`): null when the checkout was
 * never builder-allocated or adopted. Ownership facts stay in the DD record;
 * this only finds it.
 */
export async function locateWorkspaceAllocation(
  deps: BuilderDeps,
): Promise<BuilderResult<AllocationRecord | null>> {
  const actualGit = await workspaceGit(deps, deps.repoRoot, ['rev-parse', '--absolute-git-dir']);
  const gitDir = actualGit.ok ? deps.fs.realpath(toPosix(actualGit.stdout.trim())) : null;
  if (gitDir === null)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Cannot inspect the workspace allocation locator.',
      'Restore readable workspace Git metadata before dispatching from this checkout.',
    );
  return readWorkspaceAllocationLocator(deps, deps.repoRoot, toPosix(gitDir));
}

export async function allocationAuthority(
  deps: BuilderDeps,
  parent?: AllocationRecord,
): Promise<BuilderResult<string>> {
  const result = await workspaceGit(deps, deps.repoRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const root =
    result.ok && result.stdout.trim() ? deps.fs.realpath(toPosix(result.stdout.trim())) : null;
  if (root === null)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Cannot resolve the repository allocation authority.',
      'Run from a real Git checkout with a readable common directory.',
      result,
    );
  if (!parent) {
    const actualGit = await workspaceGit(deps, deps.repoRoot, ['rev-parse', '--absolute-git-dir']);
    const gitDir = actualGit.ok ? deps.fs.realpath(toPosix(actualGit.stdout.trim())) : null;
    if (gitDir === null)
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        'Cannot inspect the workspace allocation locator.',
        'Restore readable workspace Git metadata before adoption.',
      );
    const located = readWorkspaceAllocationLocator(deps, deps.repoRoot, toPosix(gitDir));
    if (!located.ok) return located;
    parent = located.value ?? undefined;
    if (!parent && toPosix(gitDir) === toPosix(root)) {
      // Older managed clones already have an original authority at their local
      // clone source. Consult that same DD truth; never synthesize ownership.
      const origin = await workspaceGit(deps, deps.repoRoot, [
        'config',
        '--local',
        '--get',
        'remote.origin.url',
      ]);
      if (!origin.ok && origin.code !== 1)
        return builderFailure(
          ErrorCodes.BUILDER_OWNERSHIP,
          'Cannot inspect local clone provenance.',
          'Repair the origin configuration before adopting an ambiguous checkout.',
        );
      const source = toPosix(origin.stdout.trim());
      if (source && resolveInRepo(source, deps.repoRoot) === source) {
        const sourceRoot = deps.fs.realpath(source);
        if (sourceRoot === null)
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'The local clone source is unavailable; existing ownership cannot be excluded.',
            'Restore the original creator repository or its allocation locator before adoption.',
          );
        const sourceGit = await workspaceGit(deps, toPosix(sourceRoot), [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ]);
        const sourceCommon = sourceGit.ok
          ? deps.fs.realpath(toPosix(sourceGit.stdout.trim()))
          : null;
        if (sourceCommon === null)
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'The local clone source has no readable Git authority.',
            'Restore the creator authority rather than recording replacement ownership.',
          );
        const sourceLocator = readWorkspaceAllocationLocator(
          deps,
          toPosix(sourceRoot),
          toPosix(sourceCommon),
        );
        if (!sourceLocator.ok) return sourceLocator;
        const allocations = listAllocations(
          deps,
          sourceLocator.value?.authority_root ?? toPosix(sourceCommon),
        );
        if (!allocations.ok) return allocations;
        const matches = allocations.value.filter((entry) => entry.value.root === deps.repoRoot);
        if (matches.length > 1)
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'Multiple creator allocations claim this checkout.',
            'Resolve the original identity conflict; adoption cannot select a replacement.',
          );
        parent = matches[0]?.value;
      }
    }
    if (!parent) return { ok: true, value: toPosix(root) };
  }
  if (parent.authority_root !== toPosix(root)) {
    const local = listAllocations(deps, toPosix(root));
    if (!local.ok) return local;
    if (local.value.some((record) => record.value.root === deps.repoRoot))
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        'Clone-local allocation conflicts with the original creator authority.',
        'Preserve both records for explicit repair; never silently select new ownership.',
      );
  }
  const stored = readBuilderRecord<AllocationRecord>(
    deps,
    allocationPath(parent.authority_root, parent.id),
    'allocation',
  );
  const git = await workspaceGit(deps, deps.repoRoot, ['rev-parse', '--absolute-git-dir']);
  const branch = await workspaceGit(deps, deps.repoRoot, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'HEAD',
  ]);
  const authority = await workspaceGit(deps, deps.repoRoot, [
    '--git-dir',
    parent.authority_root,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  if (
    !stored.ok ||
    JSON.stringify(stored.value.value) !== JSON.stringify(parent) ||
    parent.retired_at ||
    parent.root !== deps.repoRoot ||
    !branch.ok ||
    branch.stdout.trim() !== parent.branch ||
    !git.ok ||
    toPosix(deps.fs.realpath(toPosix(git.stdout.trim())) ?? '') !== parent.git_dir ||
    parent.kind !== (parent.git_dir === toPosix(root) ? 'clone' : 'worktree') ||
    !authority.ok ||
    toPosix(deps.fs.realpath(toPosix(authority.stdout.trim())) ?? '') !== parent.authority_root
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'The parent does not bind to its original allocation authority.',
      'Use its original allocation record and exact live parent checkout; never start another ordinal domain inside a clone.',
    );
  return { ok: true, value: parent.authority_root };
}

export function allocationPath(authority: string, id: string): string {
  // Allocation authority is deliberately outside the disposable plan/worker tree.
  const context: BuilderContext = {
    repoRoot: authority,
    planDir: authority,
    planPath: '',
    guidePath: '',
    flowPath: '',
    teamDir: posixJoin(authority, 'builder/allocations'),
  };
  return builderRecordPath(context, 'allocation', id);
}

export function listAllocations(
  deps: BuilderDeps,
  authority: string,
): BuilderResult<Stored<AllocationRecord>[]> {
  const directory = posixJoin(authority, 'builder/allocations');
  const records: Stored<AllocationRecord>[] = [];
  for (const name of deps.fs.readdir(directory).sort()) {
    if (!/^allocation-.*\.dd\.json$/.test(name)) continue;
    const loaded = readBuilderRecord<AllocationRecord>(
      deps,
      posixJoin(directory, name),
      'allocation',
    );
    if (!loaded.ok) return loaded;
    if (
      loaded.value.value.authority_root !== authority ||
      allocationPath(authority, loaded.value.value.id) !== posixJoin(directory, name)
    ) {
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        `Allocation authority mismatch: ${name}`,
        'Repair the authoritative record; do not infer ownership from a copied record.',
      );
    }
    records.push({
      ...loaded.value,
      ref: { ...loaded.value.ref, path: posixJoin(directory, name) },
    });
  }
  return { ok: true, value: records };
}

export function saveAllocation(
  deps: BuilderDeps,
  value: AllocationRecord,
  previous?: Stored<AllocationRecord>,
): BuilderResult<Stored<AllocationRecord>> {
  const path = allocationPath(value.authority_root, value.id);
  const result = writeBuilderRecord(deps, path, value, {
    root: value.authority_root,
    ...(previous && { expectedSha256: previous.ref.sha256 }),
  });
  return result.ok
    ? { ok: true, value: { ...result.value, ref: { ...result.value.ref, path } } }
    : result;
}

export async function withAllocationLock<T>(
  deps: BuilderDeps,
  path: string,
  action: () => Promise<BuilderResult<T>>,
): Promise<BuilderResult<T>> {
  if (toPosix(deps.fs.normalizeBundleTargetIdentity(path)) !== path)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'The allocation lock path aliases another filesystem location.',
      'Restore the original non-symlinked allocation directory before retrying.',
    );
  const token = deps.nonce();
  deps.fs.mkdirp(posixDirname(path));
  // A short critical section, not a lease: interrupted locks are never stolen.
  let claimed = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (deps.fs.createExclusive(path, token)) {
      claimed = true;
      break;
    }
    await deps.clock.sleep(10);
  }
  if (!claimed)
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Allocation is busy: ${path}`,
      'Retry after the active writer; inspect an interrupted lock before explicitly recovering it.',
    );
  try {
    return await action();
  } finally {
    if (deps.fs.readText(path) === token) deps.fs.deleteFile(path);
  }
}

export async function verifyAllocationAuthority(
  deps: BuilderDeps,
  supplied: Stored<AllocationRecord>,
): Promise<BuilderResult<Stored<AllocationRecord>>> {
  let parent: AllocationRecord | undefined;
  if (supplied.value.parent_id) {
    const record = readBuilderRecord<AllocationRecord>(
      deps,
      allocationPath(supplied.value.authority_root, supplied.value.parent_id),
      'allocation',
    );
    if (record.ok && record.value.value.root === deps.repoRoot) parent = record.value.value;
  }
  const authority = await allocationAuthority(deps, parent);
  if (!authority.ok) return authority;
  const path = allocationPath(authority.value, supplied.value.id);
  if (supplied.value.authority_root !== authority.value || supplied.ref.path !== path) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'The allocation is not held by this Git authority.',
      'Use the original absolute allocation reference from its creating repository.',
    );
  }
  const stored = readBuilderRecord<AllocationRecord>(deps, path, 'allocation');
  if (!stored.ok) return stored;
  if (
    stored.value.ref.sha256 !== supplied.ref.sha256 ||
    JSON.stringify(stored.value.value) !== JSON.stringify(supplied.value)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      'The allocation changed or was copied/forged.',
      'Re-read the original allocation before retrying.',
    );
  }
  return { ok: true, value: { ...stored.value, ref: { ...stored.value.ref, path } } };
}

export async function reserveAllocation(
  deps: BuilderDeps,
  input: WorkspaceInput,
): Promise<BuilderResult<Stored<AllocationRecord>>> {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
    !input.actor.trim() ||
    !input.target ||
    !['worktree', 'clone'].includes(input.kind) ||
    !['plan', 'unit'].includes(input.purpose)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Invalid workspace slug, actor, target, purpose or kind.',
      'Use a lowercase hyphenated slug, explicit actor, target and workspace kind.',
    );
  }
  const targetText = toPosix(input.target);
  if (targetText.split('/').includes('..') || targetText.includes('\0')) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace target contains an escaping path.',
      'Pass an explicit absolute sibling target or an in-repository relative target without parent traversal.',
    );
  }
  const target = resolveInRepo(targetText, deps.repoRoot);
  const identity = toPosix(deps.fs.normalizeBundleTargetIdentity(target));
  if (
    identity !== target ||
    isWithin(target, deps.repoRoot) ||
    isWithin(posixJoin(deps.repoRoot, '.git'), target)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace target aliases or contains protected repository state.',
      'Choose a new, non-symlinked workspace outside Git metadata.',
    );
  }
  if (input.purpose === 'unit' && !input.parent) {
    // A unit hangs off the plan workspace it is dispatched FROM. Callers
    // (dispatch) name the governing peer, not the allocation record, so the
    // store resolves the parent itself through the workspace's own locator —
    // the same DD truth `allocationAuthority` consults. Without this, every
    // unit dispatch from a builder-allocated plan workspace refused E470
    // (backlog row 46, Unisphere Plan001).
    const located = await locateWorkspaceAllocation(deps);
    if (!located.ok) return located;
    if (located.value === null)
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'This checkout carries no builder allocation locator, so a unit has no parent allocation.',
        'Dispatch units from the plan workspace `harness builder new` created (or `harness builder adopt` bound); the locator lives at <git-dir>/builder/allocation-ref.',
      );
    input = { ...input, parent: located.value };
  }
  const authority = await allocationAuthority(deps, input.parent);
  if (!authority.ok) return authority;
  if (isWithin(target, authority.value) || isWithin(authority.value, target)) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Workspace overlaps its allocation authority.',
      'Keep disposable resources separate from shared Git authority.',
    );
  }
  const ref = input.base ?? (input.purpose === 'unit' ? input.parent?.base_sha : 'HEAD');
  if (!ref || ref.startsWith('-'))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Missing or invalid base revision.',
      'Pass the recorded parent allocation for a unit, or a Git base revision for a plan.',
    );
  const resolved = await workspaceGit(deps, deps.repoRoot, [
    'rev-parse',
    '--verify',
    `${ref}^{commit}`,
  ]);
  const base = resolved.stdout.trim();
  if (!resolved.ok || !isGitOid(base))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Cannot resolve the workspace base commit.',
      'Supply a locally available full commit or revision.',
      resolved,
    );
  if (input.purpose === 'unit') {
    if (
      !input.parent ||
      !input.plan ||
      !input.unit ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.unit) ||
      input.parent.retired_at ||
      (input.base !== undefined && !isGitOid(input.base))
    ) {
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'Unit allocation requires its live parent, canonical plan, unit and recorded base.',
        'Pass the explicit parent allocation, plan and unit; do not allocate a second product plan.',
      );
    }
    const plan = resolveInRepo(input.plan, deps.repoRoot);
    if (
      !isWithin(deps.repoRoot, plan) ||
      !plan.endsWith('/plan.dd.json') ||
      !deps.fs.exists(plan)
    ) {
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'The unit plan is unavailable in the parent checkout.',
        'Pass its canonical in-repository plan source.',
      );
    }
  }
  const worktrees = await workspaceGit(deps, deps.repoRoot, [
    'worktree',
    'list',
    '--porcelain',
    '-z',
  ]);
  if (!worktrees.ok)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Cannot enumerate sibling workspaces.',
      'Repair Git worktree metadata before allocating.',
      worktrees,
    );
  const mergeTarget = await workspaceGit(deps, deps.repoRoot, ['symbolic-ref', '--quiet', 'HEAD']);
  if (!mergeTarget.ok || !mergeTarget.stdout.trim().startsWith('refs/heads/'))
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'The creating checkout has no attached integration branch.',
      'Create from an attached source branch so reclamation can prove integration.',
    );
  const sourceGit = await workspaceGit(deps, deps.repoRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const sourceGitDir = sourceGit.ok ? deps.fs.realpath(toPosix(sourceGit.stdout.trim())) : null;
  if (sourceGitDir === null)
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Cannot bind the creating checkout Git storage.',
      'Restore the actual parent Git directory before allocation.',
    );
  return withAllocationLock(
    deps,
    posixJoin(authority.value, 'builder/allocations/reserve.lock'),
    async () => {
      const existing = listAllocations(deps, authority.value);
      if (!existing.ok) return existing;
      const prior = existing.value.find((record) => record.value.root === target);
      if (prior) {
        const value = prior.value;
        if (
          value.owner !== 'harness' ||
          value.retired_at ||
          value.kind !== input.kind ||
          value.slug !== input.slug ||
          value.actor !== input.actor ||
          value.base_sha !== base ||
          value.purpose !== input.purpose ||
          value.parent_id !== input.parent?.id ||
          value.unit_id !== input.unit
        ) {
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            'Target already has a different or retired allocation.',
            'Choose a new target; reservations and tombstones are never reused.',
          );
        }
        return { ok: true, value: prior };
      }
      if (deps.fs.exists(target))
        return builderFailure(
          ErrorCodes.BUILDER_CONFLICT,
          `Workspace target already exists: ${target}`,
          'Adopt the existing resource explicitly or choose a new target.',
        );
      if (input.parent) {
        const parent = existing.value.find((record) => record.value.id === input.parent?.id)?.value;
        if (
          !parent ||
          JSON.stringify(parent) !== JSON.stringify(input.parent) ||
          parent.root !== deps.repoRoot
        ) {
          return builderFailure(
            ErrorCodes.BUILDER_OWNERSHIP,
            'The parent is not the authoritative allocation of this checkout.',
            'Use the recorded allocation of the actual parent workspace.',
          );
        }
      }
      let ordinal = Math.max(0, ...existing.value.map((record) => record.value.ordinal));
      const roots = new Set([
        deps.repoRoot,
        ...existing.value
          .filter((record) => !record.value.retired_at)
          .map((record) => record.value.root),
        ...worktrees.stdout
          .split('\0')
          .filter((line) => line.startsWith('worktree '))
          .map((line) => toPosix(line.slice(9))),
      ]);
      for (const root of roots) {
        for (const directory of ['docs/plans', 'docs/plans/archive']) {
          for (const name of deps.fs.readdir(posixJoin(root, directory))) {
            const number = /^(\d+)-/.exec(name)?.[1];
            if (number !== undefined) ordinal = Math.max(ordinal, Number(number));
          }
        }
      }
      ordinal += 1;
      if (!Number.isSafeInteger(ordinal))
        return builderFailure(
          ErrorCodes.BUILDER_CONFLICT,
          'Allocation ordinal range is exhausted.',
          'Inspect malformed reservations or plan folder ordinals.',
        );
      const prefix = String(ordinal).padStart(3, '0');
      const id = `al-${prefix}-${deps.nonce()}`;
      const branch = `builder/${prefix}-${input.slug}${input.unit ? `/${input.unit}` : ''}`;
      const branchCheck = await workspaceGit(deps, deps.repoRoot, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${branch}`,
      ]);
      if (branchCheck.code !== 1)
        return builderFailure(
          ErrorCodes.BUILDER_CONFLICT,
          `Branch exists or cannot be inspected: ${branch}`,
          'Choose a different allocation; existing branches are never repurposed.',
          branchCheck,
        );
      return saveAllocation(deps, {
        record_type: 'allocation',
        id,
        owner: 'harness',
        kind: input.kind,
        purpose: input.purpose,
        root: target,
        authority_root: authority.value,
        git_dir: input.kind === 'clone' ? posixJoin(target, '.git') : toPosix(sourceGitDir),
        branch,
        base_sha: base,
        ordinal,
        slug: input.slug,
        actor: input.actor,
        recorded_at: deps.clock.nowIso(),
        journal: [
          'reserved',
          `source-git:${toPosix(sourceGitDir)}`,
          `merge-target:${mergeTarget.stdout.trim()}`,
        ],
        plan_path:
          input.purpose === 'unit'
            ? posixRelative(deps.repoRoot, resolveInRepo(input.plan as string, deps.repoRoot))
            : `docs/plans/${prefix}-${input.slug}/plan.dd.json`,
        ...(input.parent && { parent_id: input.parent.id }),
        ...(input.unit && { unit_id: input.unit }),
      });
    },
  );
}
