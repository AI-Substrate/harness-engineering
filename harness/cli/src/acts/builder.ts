import { isDeepStrictEqual } from 'node:util';
import type { Command } from 'commander';
import { type Envelope, formatError, formatOk, formatUnconfigured } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort } from '../output/output-port.js';
import { closeBuilderPlan } from '../services/builder/close-service.js';
import { type BuilderVerb, registerBuilderCommandContract } from '../services/builder/commands.js';
import { composeBuilderUnits } from '../services/builder/composition-service.js';
import {
  checkBuilderReadiness,
  sealBuilderContracts,
} from '../services/builder/contracts-service.js';
import {
  checkBuilderPeerReleased,
  dispatchBuilderUnit,
} from '../services/builder/dispatch-service.js';
import { checkBuilderGuide, readBuilderGuide } from '../services/builder/guide-service.js';
import { advanceBuilderStage } from '../services/builder/lifecycle-service.js';
import { inspectBuilderOnTrack } from '../services/builder/on-track-service.js';
import {
  builderContext,
  builderFailure,
  readBuilderDocument,
  readBuilderRecord,
} from '../services/builder/records.js';
import { recordBuilderReview } from '../services/builder/review-service.js';
import { resolveBuilderRoles } from '../services/builder/role-settings.js';
import { selfCheckBuilderPacket } from '../services/builder/self-check-service.js';
import type {
  AllocationRecord,
  BaselineReceipt,
  BuilderDeps,
  BuilderFailure,
  BuilderResult,
  Guide,
  PreservationReceipt,
  PreservedItem,
  ReviewReceipt,
  Role,
  RoleBinding,
  RoleOverrides,
  Stored,
  UnitDelivery,
  WorkspaceKind,
  WorkspaceKindSelector,
} from '../services/builder/types.js';
import {
  adoptBuilderUnitWorkspace,
  adoptBuilderWorkspace,
  provisionBuilderWorkspace,
  tidyBuilderWorkspace,
} from '../services/builder/workspace-service.js';
import { loadSettings } from '../services/settings/load-settings.js';
import { posixDirname, resolveInRepo } from '../services/shared/posix-path.js';

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const DELIVERY_FIELDS = [
  'unit_id',
  'peer_id',
  'workspace',
  'commit_sha',
  'packet_sha256',
  'baseline_sha',
] as const;
const EVIDENCE_CATEGORIES = new Set<PreservedItem['category']>([
  'artifact',
  'wip',
  'report',
  'observation',
  'telemetry',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inputFailure(message: string): BuilderFailure {
  return builderFailure(
    ErrorCodes.BUILDER_INVALID,
    message,
    'Supply the documented Builder input; use harness builder <command> --help for its contract.',
  );
}

function readJsonInput(deps: BuilderDeps, input: string): BuilderResult<unknown> {
  const path = resolveInRepo(input, deps.repoRoot);
  const loaded = deps.fs.readTextFileNoFollow(posixDirname(path), path, MAX_INPUT_BYTES);
  if (loaded.status !== 'ok')
    return inputFailure(`Cannot read a bounded regular JSON input: ${path} (${loaded.reason}).`);
  try {
    return { ok: true, value: JSON.parse(loaded.text) as unknown };
  } catch {
    return inputFailure(`The input is not valid JSON: ${path}.`);
  }
}

function named<T>(key: string, result: BuilderResult<T>): BuilderResult<Record<string, T>> {
  return result.ok ? { ok: true, value: { [key]: result.value } } : result;
}

function roleOverrides(role: Role | undefined, options: Record<string, unknown>): RoleOverrides {
  if (role === undefined) return {};
  return {
    [role]: {
      ...(typeof options.harness === 'string' && { harness: options.harness }),
      ...(typeof options.model === 'string' && { model: options.model }),
      ...(typeof options.effort === 'string' && { effort: options.effort }),
    },
  };
}

function effectiveRoles(
  deps: BuilderDeps,
  guide: Guide,
  overrides: RoleOverrides,
): BuilderResult<RoleBinding[]> {
  const loaded = loadSettings(deps.repoRoot, deps);
  if (!loaded.ok) return loaded;
  return resolveBuilderRoles(loaded.settings, guide, overrides);
}

function readAllocations(
  deps: BuilderDeps,
  input: string,
): BuilderResult<Stored<AllocationRecord>[]> {
  const loaded = readJsonInput(deps, input);
  if (!loaded.ok) return loaded;
  if (!Array.isArray(loaded.value)) return inputFailure('Allocations must be a JSON array.');
  const allocations: Stored<AllocationRecord>[] = [];
  for (const entry of loaded.value) {
    if (
      !isObject(entry) ||
      !isObject(entry.ref) ||
      typeof entry.ref.path !== 'string' ||
      typeof entry.ref.sha256 !== 'string' ||
      !isObject(entry.value)
    )
      return inputFailure('Each allocation must contain its FileDigest ref and recorded value.');
    const current = readBuilderRecord<AllocationRecord>(deps, entry.ref.path, 'allocation');
    if (!current.ok) return current;
    if (
      current.value.ref.sha256 !== entry.ref.sha256 ||
      !isDeepStrictEqual(current.value.value, entry.value)
    )
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        `The allocation manifest is stale or disagrees with ${entry.ref.path}.`,
        'Re-read the authoritative allocation records and rebuild the explicit closeout manifest.',
      );
    allocations.push(current.value);
  }
  return { ok: true, value: allocations };
}

async function executeBuilder(
  verb: BuilderVerb,
  argument: string,
  options: Record<string, unknown>,
  deps: BuilderDeps,
): Promise<BuilderResult<unknown>> {
  switch (verb) {
    case 'new':
      return provisionBuilderWorkspace(deps, {
        purpose: 'plan',
        slug: argument,
        target: options.workspace as string,
        kind: options.kind as WorkspaceKind,
        actor: options.actor as string,
        base: options.base as string,
        ...(typeof options.title === 'string' && { title: options.title }),
        phases: options.phase as string[],
      });
    case 'adopt':
      return adoptBuilderWorkspace(deps, {
        plan: argument,
        actor: options.actor as string,
        owner: options.owner as 'external' | 'pij',
      });
    case 'guide': {
      const guide = readBuilderGuide(deps, { plan: argument, init: options.init === true });
      if (!guide.ok) return guide;
      if (!options.check) return { ok: true, value: { guide: guide.value } };
      const context = builderContext(deps, argument);
      if (!context.ok) return context;
      const plan = readBuilderDocument(deps, context.value.planPath, 'builder/plan');
      if (!plan.ok) return plan;
      const criteria = plan.value.value.sections.find(
        (section) => section.name === 'acceptance_criteria',
      )?.value;
      if (
        !Array.isArray(criteria) ||
        !criteria.every((row) => isObject(row) && typeof row.id === 'string')
      )
        return inputFailure('The product plan has no valid acceptance-criteria collection.');
      const checks = checkBuilderGuide(guide.value, criteria as Array<{ id: string }>);
      return checks.valid
        ? { ok: true, value: { guide: guide.value, checks } }
        : builderFailure(
            ErrorCodes.BUILDER_INVALID,
            'The implementation guide does not satisfy its structural contract.',
            checks.issues[0]?.next_action ?? 'Correct the guide before readiness or dispatch.',
            checks,
          );
    }
    case 'ready':
      return checkBuilderReadiness(deps, {
        plan: argument,
        ...(typeof options.unit === 'string' && { unit: options.unit }),
      });
    case 'contracts': {
      if (options.seal)
        return named(
          'baseline',
          await sealBuilderContracts(deps, { plan: argument, review: options.review as string }),
        );
      const guide = readBuilderGuide(deps, { plan: argument });
      if (!guide.ok) return guide;
      const context = builderContext(deps, argument);
      if (!context.ok) return context;
      return named(
        'baseline',
        readBuilderRecord<BaselineReceipt>(
          deps,
          resolveInRepo(guide.value.baseline.receipt, posixDirname(context.value.guidePath)),
          'baseline',
        ),
      );
    }
    case 'settings': {
      const guide = readBuilderGuide(deps, { plan: argument });
      if (!guide.ok) return guide;
      const role = options.role as Role | undefined;
      const roles = effectiveRoles(deps, guide.value, roleOverrides(role, options));
      if (!roles.ok) return roles;
      return {
        ok: true,
        value: {
          roles: role === undefined ? roles.value : roles.value.filter((row) => row.role === role),
        },
      };
    }
    case 'dispatch': {
      const guide = readBuilderGuide(deps, { plan: argument });
      if (!guide.ok) return guide;
      const roles = effectiveRoles(deps, guide.value, roleOverrides('coder', options));
      if (!roles.ok) return roles;
      const role = roles.value.find((row) => row.role === 'coder');
      if (role === undefined)
        return builderFailure(
          ErrorCodes.BUILDER_NOT_READY,
          'No effective coder harness/model is configured.',
          'Declare the coder role in repository settings or the guide, or pass explicit overrides.',
        );
      return dispatchBuilderUnit(
        {
          ...deps,
          readiness: (input) => checkBuilderReadiness(deps, input),
          provision: (input) => provisionBuilderWorkspace(deps, input),
          adoptUnit: (input) => adoptBuilderUnitWorkspace(deps, input),
        },
        {
          plan: argument,
          unit: options.unit as string,
          workspace: options.workspace as string,
          parent: options.parent as string,
          ...(typeof options.adoptPeer === 'string' && { adoptPeer: options.adoptPeer }),
          role,
          kind: options.kind as WorkspaceKindSelector,
        },
      );
    }
    case 'self-check':
      return named(
        'self_check',
        await selfCheckBuilderPacket(deps, {
          packet: argument,
          sha256: options.sha256 as string,
        }),
      );
    case 'on-track':
      return named(
        'on_track',
        await inspectBuilderOnTrack(deps, {
          plan: argument,
          ...(typeof options.unit === 'string' && { unit: options.unit }),
          ...(typeof options.from === 'string' && { from: options.from }),
          ...(typeof options.to === 'string' && { to: options.to }),
          ...(options.untracked === true && { untracked: true }),
        }),
      );
    case 'advance':
      return advanceBuilderStage(deps, { plan: argument, now: options.now as string });
    case 'compose': {
      const compositionDeps = {
        ...deps,
        readiness: (input: { plan: string; unit?: string }) => checkBuilderReadiness(deps, input),
      };
      if (typeof options.verify === 'string')
        return named(
          'composition',
          await composeBuilderUnits(compositionDeps, {
            plan: argument,
            mode: 'verify',
            sha: options.verify,
          }),
        );
      const deliveries = readJsonInput(deps, options.import as string);
      if (!deliveries.ok) return deliveries;
      if (
        !Array.isArray(deliveries.value) ||
        !deliveries.value.every(
          (row) =>
            isObject(row) &&
            DELIVERY_FIELDS.every(
              (field) => typeof row[field] === 'string' && row[field].length > 0,
            ),
        )
      )
        return inputFailure('Import requires a JSON array of complete UnitDelivery records.');
      return named(
        'composition',
        await composeBuilderUnits(compositionDeps, {
          plan: argument,
          mode: 'import',
          deliveries: deliveries.value as UnitDelivery[],
          ...(options.alreadyIntegrated === true && { alreadyIntegrated: true }),
          ...(typeof options.integrationSha === 'string' && {
            integrationSha: options.integrationSha,
          }),
        }),
      );
    }
    case 'review': {
      const review = readBuilderRecord<ReviewReceipt>(deps, options.receipt as string, 'review');
      if (!review.ok) return review;
      return named(
        'review',
        await recordBuilderReview(deps, { plan: argument, receipt: review.value.value }),
      );
    }
    case 'close': {
      const allocations = readAllocations(deps, options.allocations as string);
      if (!allocations.ok) return allocations;
      const evidence = readJsonInput(deps, options.evidence as string);
      if (!evidence.ok) return evidence;
      if (
        !Array.isArray(evidence.value) ||
        !evidence.value.every(
          (row) =>
            isObject(row) &&
            typeof row.path === 'string' &&
            row.path.length > 0 &&
            EVIDENCE_CATEGORIES.has(row.category as PreservedItem['category']),
        )
      )
        return inputFailure(
          'Evidence must be a JSON array of nonempty paths and documented categories.',
        );
      return closeBuilderPlan(deps, {
        plan: argument,
        survivor: options.survivor as string,
        allocations: allocations.value,
        evidence: evidence.value as Array<{ path: string; category: PreservedItem['category'] }>,
      });
    }
    case 'tidy': {
      const allocation = readBuilderRecord<AllocationRecord>(deps, argument, 'allocation');
      if (!allocation.ok) return allocation;
      const preservation = readBuilderRecord<PreservationReceipt>(
        deps,
        options.preservation as string,
        'preservation',
      );
      if (!preservation.ok) return preservation;
      return tidyBuilderWorkspace(
        { ...deps, peerReleased: (peerId) => checkBuilderPeerReleased(deps, peerId) },
        { allocation: allocation.value, preservation: preservation.value.value },
      );
    }
  }
}

export function registerBuilderAct(program: Command, io: CliIo, deps: BuilderDeps): void {
  registerBuilderCommandContract(program, async (verb, argument, options) => {
    const command = `builder ${verb}`;
    const result = await executeBuilder(verb, argument, options, deps);
    let envelope: Envelope;
    if (!result.ok) {
      envelope = formatError(command, result.code, result.message, deps.clock, {
        next_action: result.next_action,
        details: result.warnings?.length
          ? { cause: result.details, warnings: result.warnings }
          : result.details,
      });
    } else if (verb === 'ready' && isObject(result.value) && result.value.status !== 'ready') {
      const reading = result.value;
      const issues = Array.isArray(reading.issues) ? reading.issues : [];
      const next = issues.find((issue) => isObject(issue) && typeof issue.next_action === 'string');
      const nextAction = isObject(next)
        ? String(next.next_action)
        : 'Restore the named readiness prerequisites, then retry.';
      envelope =
        reading.status === 'cant-tell'
          ? formatUnconfigured(command, nextAction, deps.clock, { data: reading })
          : formatError(
              command,
              ErrorCodes.BUILDER_NOT_READY,
              'Builder is not ready to dispatch.',
              deps.clock,
              {
                next_action: nextAction,
                details: reading,
              },
            );
    } else {
      envelope = formatOk(command, result.value, deps.clock);
    }
    exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
  });
}
