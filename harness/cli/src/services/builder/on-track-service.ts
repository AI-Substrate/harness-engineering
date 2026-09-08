import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, resolveInRepo } from '../shared/posix-path.js';
import { builderGit, loadBuilderGuide } from './composition-service.js';
import { committedDeliveryPaths, ownershipWarnings } from './ownership-service.js';
import { builderRecordPath, readBuilderRecord } from './records.js';
import type {
  BaselineReceipt,
  BuilderDeps,
  BuilderIssue,
  BuilderResult,
  CompositionReceipt,
  OnTrackInput,
  OnTrackReport,
} from './types.js';

const SHA = /^[a-f0-9]{40}$/;

/** Inspection only: maps guide work without authorizing it or requiring sealed proof. */
export async function inspectBuilderOnTrack(
  deps: BuilderDeps,
  input: OnTrackInput,
): Promise<BuilderResult<OnTrackReport>> {
  const report: OnTrackReport = {
    compared: false,
    mode: input.unit !== undefined ? 'unit' : 'pm',
    ...(input.unit !== undefined && { unit_id: input.unit }),
    includes_worktree: input.to === undefined,
    includes_untracked: input.to === undefined && input.untracked === true,
    warnings: [],
    issues: [],
  };
  const unavailable = (issue: BuilderIssue): BuilderResult<OnTrackReport> => {
    report.issues.push({
      code: issue.code,
      message: issue.message,
      next_action: issue.next_action,
    });
    return { ok: true, value: report };
  };
  try {
    const loaded = loadBuilderGuide(deps, input.plan);
    if (!loaded.ok) return unavailable(loaded);
    const { context, guide: storedGuide } = loaded.value;
    const guide = storedGuide.value;
    const allowed =
      report.mode === 'unit'
        ? guide.units.filter((unit) => unit.id === input.unit)
        : guide.units.filter((unit) => unit.role === 'pm');
    if (report.mode === 'unit' && allowed.length !== 1)
      return unavailable({
        code: ErrorCodes.BUILDER_INVALID,
        message: `The guide does not identify exactly one unit named ${input.unit}.`,
        next_action:
          'Select an existing, unambiguous guide unit with --unit, or omit --unit for the PM maps.',
      });

    let from = input.from;
    if (from !== undefined) {
      report.basis = 'explicit';
    } else {
      // Only a genuinely missing receipt permits fallback; unreadable/symlink bases do not.
      const hasBasis = (path: string) => {
        const probe = deps.fs.probeRegularFileNoFollow(
          context.planDir,
          path,
          Number.MAX_SAFE_INTEGER,
        );
        return probe.status === 'ok' || probe.reason !== 'missing';
      };
      const compositionPath = builderRecordPath(context, 'composition');
      if (report.mode === 'pm' && hasBasis(compositionPath)) {
        report.basis = 'import';
        const composition = readBuilderRecord<CompositionReceipt>(
          deps,
          compositionPath,
          'composition',
        );
        if (!composition.ok) return unavailable(composition);
        from = composition.value.value.integration_sha;
      } else {
        const baselinePath = resolveInRepo(guide.baseline.receipt, posixDirname(context.guidePath));
        if (!isWithin(context.planDir, baselinePath))
          return unavailable({
            code: ErrorCodes.BUILDER_INVALID,
            message: 'The guide baseline receipt path escapes this plan.',
            next_action:
              'Keep the baseline receipt within the plan assets, or select an explicit --from commit for inspection.',
          });
        if (hasBasis(baselinePath)) {
          report.basis = 'baseline';
          const baseline = readBuilderRecord<BaselineReceipt>(deps, baselinePath, 'baseline');
          if (!baseline.ok) return unavailable(baseline);
          from = baseline.value.value.source_sha;
        } else {
          report.basis = 'head';
          from = 'HEAD';
        }
      }
      if (report.basis !== 'head' && (typeof from !== 'string' || !SHA.test(from)))
        return unavailable({
          code: ErrorCodes.BUILDER_PROOF,
          message: `The existing ${report.basis} basis does not name a full committed SHA.`,
          next_action:
            'Recover the original valid receipt or select an explicit --from commit; inspection will not silently substitute HEAD.',
        });
    }
    const refs = [from, input.to ?? 'HEAD'] as const;
    for (const [index, ref] of refs.entries()) {
      const resolved = await builderGit(deps, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${ref}^{commit}`,
      ]);
      if (!resolved.ok)
        return unavailable({
          code: resolved.code,
          message: `Cannot resolve the ${index === 0 ? 'from' : 'to'} commit ${ref}: ${resolved.message}`,
          next_action:
            'Use an existing commit reference in this checkout; fetch missing history or correct --from/--to, then inspect again.',
        });
      const sha = resolved.value.trim();
      if (!SHA.test(sha))
        return unavailable({
          code: ErrorCodes.BUILDER_PROOF,
          message: `Git did not return a full commit SHA for ${ref}.`,
          next_action:
            'Restore the repository and resolve the selected reference to a full commit before inspecting again.',
        });
      if (index === 0) report.from = sha;
      else report.to = sha;
    }
    // Both identifiers were measured above; never pass user-supplied refs to range operations.
    const source = report.from as string;
    const target = report.to as string;
    const ancestor = await builderGit(deps, ['merge-base', '--is-ancestor', source, target]);
    if (!ancestor.ok)
      return unavailable({
        code: ancestor.code,
        message: `Cannot establish that the from commit ${source} is an ancestor of ${target}: ${ancestor.message}`,
        next_action:
          'Choose an ancestor with --from, or recover missing Git history, then inspect the intended range again.',
      });
    const paths = new Set<string>();
    if (report.mode === 'unit') {
      const history = await committedDeliveryPaths(
        (args) => builderGit(deps, args),
        source,
        target,
      );
      if (!history.ok) return unavailable(history);
      for (const path of history.value.paths) paths.add(path);
    } else {
      const delta = await builderGit(deps, [
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        source,
        target,
      ]);
      if (!delta.ok) return unavailable(delta);
      for (const path of delta.value.split('\0')) if (path) paths.add(path);
    }
    if (report.includes_worktree) {
      for (const args of [
        ['diff', '--name-only', '--no-renames', '-z'],
        ['diff', '--cached', '--name-only', '--no-renames', '-z'],
        ...(report.includes_untracked
          ? [['ls-files', '--others', '--exclude-standard', '-z']]
          : []),
      ]) {
        const changed = await builderGit(deps, args);
        if (!changed.ok) return unavailable(changed);
        for (const path of changed.value.split('\0')) if (path) paths.add(path);
      }
    }
    report.warnings = ownershipWarnings(
      guide.units,
      [...paths].filter(
        (path) =>
          report.mode === 'unit' || !isWithin(context.planDir, resolveInRepo(path, deps.repoRoot)),
      ),
      allowed,
      report.mode === 'unit' ? 'delivery' : 'verify',
      input.unit,
    );
    report.compared = true;
    return { ok: true, value: report };
  } catch (error) {
    return unavailable({
      code: ErrorCodes.BUILDER_INVALID,
      message: `Ownership inspection is unavailable: ${String(error)}`,
      next_action:
        'Restore readable canonical guide/receipt data and a usable Git checkout, then inspect again; no files were changed.',
    });
  }
}
