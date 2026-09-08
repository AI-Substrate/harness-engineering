import { ErrorCodes } from '../../output/error-codes.js';
import { builderFailure } from './records.js';
import type { BuilderResult, OwnershipWarning, Unit } from './types.js';

export function builderOwnsPath(unit: Unit, path: string): boolean {
  return unit.paths.some(
    (fence) =>
      fence === path ||
      (fence.endsWith('/**') && path.startsWith(fence.slice(0, -2))) ||
      (fence.endsWith('/') && path.startsWith(fence)),
  );
}

/** One file/owner comparison for automatic receipts and self-serve inspection. */
export function ownershipWarnings(
  units: readonly Unit[],
  paths: readonly string[],
  allowedUnits: readonly Unit[],
  stage: OwnershipWarning['stage'],
  unitId?: string,
): OwnershipWarning[] {
  const warnings: OwnershipWarning[] = [];
  for (const file of [...new Set(paths)].sort()) {
    if (allowedUnits.some((unit) => builderOwnsPath(unit, file))) continue;
    const owners = units.filter((unit) => builderOwnsPath(unit, file));
    for (const owning_unit of owners.length ? owners.map((unit) => unit.id) : ['unmapped']) {
      warnings.push({ file, owning_unit, stage, ...(unitId !== undefined && { unit_id: unitId }) });
    }
  }
  return warnings;
}

/** Read every touched path, including reverted writes, without changing Git state. */
export async function committedDeliveryPaths(
  readGit: (args: string[]) => Promise<BuilderResult<string>>,
  from: string,
  to: string,
): Promise<BuilderResult<{ commits: string[]; paths: string[] }>> {
  const listed = await readGit(['rev-list', '--reverse', `${from}..${to}`]);
  if (!listed.ok) return listed;
  const commits = listed.value.trim().split(/\s+/).filter(Boolean);
  if (commits.some((commit) => !/^[a-f0-9]{40}$/.test(commit))) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Git returned an invalid commit identifier during delivery comparison.',
      'Inspect the selected from/to commits and git rev-list output in the intended checkout.',
    );
  }
  const paths = new Set<string>();
  for (const commit of commits) {
    const changed = await readGit([
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '--no-renames',
      '-m',
      '-r',
      '-z',
      commit,
    ]);
    if (!changed.ok) return changed;
    for (const path of changed.value.split('\0')) if (path) paths.add(path);
  }
  return { ok: true, value: { commits, paths: [...paths].sort() } };
}
