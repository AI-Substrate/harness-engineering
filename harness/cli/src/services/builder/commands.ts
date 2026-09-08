import { type Command, InvalidArgumentError, Option } from 'commander';
import { ErrorCodes } from '../../output/error-codes.js';
import { builderFailure } from './records.js';
import type { BuilderResult, Guide, WorkspaceKind, WorkspaceKindSelector } from './types.js';

export type BuilderVerb =
  | 'new'
  | 'adopt'
  | 'guide'
  | 'ready'
  | 'contracts'
  | 'settings'
  | 'dispatch'
  | 'self-check'
  | 'on-track'
  | 'advance'
  | 'compose'
  | 'review'
  | 'close'
  | 'tidy';

export interface BuilderOption {
  flags: string;
  description: string;
  required?: boolean;
  choices?: string[];
  default?: string | string[];
  conflicts?: string[];
}
export interface BuilderCommand {
  name: BuilderVerb;
  argument: string;
  description: string;
  options: BuilderOption[];
  results: string[];
  exactlyOne?: string[];
  requires?: Record<string, string[]>;
}

const roleOptions: BuilderOption[] = [
  { flags: '--harness <name>', description: 'Explicit role harness override; no fallback' },
  { flags: '--model <selector>', description: 'Explicit provider/model selector override' },
  {
    flags: '--effort <level>',
    description: 'Explicit effort override; omission inherits without inventing a value',
  },
];

/** The CLI and shipped instructions share this grammar, not two spelling registries. */
export const BUILDER_COMMANDS: BuilderCommand[] = [
  {
    name: 'new',
    argument: '<slug>',
    description:
      'Reserve the next plan ordinal and create an isolated workspace, plan and canonical flow',
    options: [
      {
        flags: '--workspace <path>',
        description: 'New, explicitly selected workspace directory',
        required: true,
      },
      { flags: '--actor <id>', description: 'Allocation creator identity', required: true },
      {
        flags: '--kind <kind>',
        description: 'Git workspace kind (separate from allocation owner)',
        choices: ['worktree', 'clone'],
        default: 'worktree',
      },
      { flags: '--base <ref>', description: 'Local source ref', default: 'HEAD' },
      { flags: '--title <text>', description: 'Plan title' },
      {
        flags: '--phase <titles...>',
        description: 'Plan phase titles',
        default: ['Implementation'],
      },
    ],
    results: ['allocation', 'plan', 'flow'],
  },
  {
    name: 'adopt',
    argument: '<plan>',
    description: 'Record an existing workspace without claiming ownership or reallocating it',
    options: [
      { flags: '--actor <id>', description: 'Recording actor identity', required: true },
      {
        flags: '--owner <owner>',
        description: 'Existing allocation owner; never harness',
        choices: ['external', 'pij'],
        default: 'external',
      },
    ],
    results: ['allocation', 'plan', 'flow'],
  },
  {
    name: 'guide',
    argument: '<plan>',
    description: 'Read, initialize or structurally check the separate implementation guide',
    options: [
      {
        flags: '--init',
        description: 'Create a missing guide without overwriting an existing one',
        conflicts: ['check'],
      },
      {
        flags: '--check',
        description:
          'Check structure, ownership, dependencies and AC/proof links; not architectural judgement',
        conflicts: ['init'],
      },
    ],
    results: ['guide', 'checks'],
  },
  {
    name: 'ready',
    argument: '<plan>',
    description: 'Re-observe guide, contract baseline and dependency readiness',
    options: [{ flags: '--unit <id>', description: 'Assess a specific implementation unit' }],
    results: ['status', 'issues', 'context', 'guide', 'baseline'],
  },
  {
    name: 'contracts',
    argument: '<plan>',
    description: 'Inspect the contract baseline, or run its checks and seal the committed inputs',
    options: [
      {
        flags: '--seal',
        description: 'Run the declared checks and record a digest-bound baseline',
      },
      { flags: '--review <path>', description: 'Approved decomposition ReviewReceipt DD document' },
    ],
    requires: { seal: ['review'], review: ['seal'] },
    results: ['baseline'],
  },
  {
    name: 'settings',
    argument: '<plan>',
    description: 'Resolve repo < guide < explicit role settings, including field provenance',
    options: [
      {
        flags: '--role <role>',
        description: 'Role to inspect or override',
        choices: ['coder', 'reviewer'],
      },
      ...roleOptions,
    ],
    requires: { harness: ['role'], model: ['role'], effort: ['role'] },
    results: ['roles'],
  },
  {
    name: 'dispatch',
    argument: '<plan>',
    description:
      'Prepare or bind an isolated coder and send a map-first packet; no acknowledgement gate',
    options: [
      {
        flags: '--unit <id>',
        description: 'Coder unit from the implementation guide',
        required: true,
      },
      {
        flags: '--workspace <path>',
        description: 'Isolated coder directory; existing when --adopt-peer is supplied',
        required: true,
      },
      { flags: '--parent <id>', description: 'Governing peer identity', required: true },
      {
        flags: '--adopt-peer <id>',
        description:
          'Bind an already-running peer without spawning, replaying or granting new work',
      },
      {
        flags: '--kind <kind>',
        description: 'Guide isolation mode by default; an explicit checkout kind overrides it',
        choices: ['guide', 'worktree', 'clone'],
        default: 'guide',
      },
      ...roleOptions,
    ],
    results: ['dispatch', 'packet'],
  },
  {
    name: 'self-check',
    argument: '<packet>',
    description: 'Inspect clone, source commit and packet digest; report advisory warnings, exit 0',
    options: [
      {
        flags: '--sha256 <digest>',
        description: 'Expected packet digest from the dispatch message',
        required: true,
      },
    ],
    results: ['self_check'],
  },
  {
    name: 'on-track',
    argument: '<plan>',
    description:
      'Inspect the guide map against unit or PM changes; warnings only, no writes, exit 0',
    options: [
      {
        flags: '--unit <id>',
        description: 'Inspect one named unit; otherwise compare all PM maps',
      },
      {
        flags: '--from <ref>',
        description: 'Comparison base; defaults to import, baseline, then HEAD',
      },
      {
        flags: '--to <ref>',
        description: 'Committed endpoint; omission includes tracked working changes',
      },
      {
        flags: '--untracked',
        description: 'Also inspect untracked files when no --to is supplied',
      },
    ],
    results: ['on_track'],
  },
  {
    name: 'advance',
    argument: '<plan>',
    description: 'Advance only through the canonical flow departure gates',
    options: [{ flags: '--now <node>', description: 'Canonical destination node', required: true }],
    results: ['flow', 'now', 'warnings'],
  },
  {
    name: 'compose',
    argument: '<plan>',
    description:
      'Import unit commits with map warnings, or prove committed PM composition; importing is not proof',
    options: [
      {
        flags: '--import <path>',
        description: 'JSON array of UnitDelivery records to import in guide dependency order',
        conflicts: ['verify'],
      },
      {
        flags: '--already-integrated',
        description:
          'Prove supplied unit projections match the selected integration commit (HEAD by default); do not replay',
        conflicts: ['verify'],
      },
      {
        flags: '--integration-sha <ref>',
        description:
          'Historical matching commit between sealed source and HEAD; leave the checkout unchanged',
        conflicts: ['verify'],
      },
      {
        flags: '--verify <sha>',
        description: 'Exact composed commit to exercise through the guide checks',
        conflicts: ['import', 'alreadyIntegrated', 'integrationSha'],
      },
    ],
    exactlyOne: ['import', 'verify'],
    requires: {
      alreadyIntegrated: ['import'],
      integrationSha: ['import', 'alreadyIntegrated'],
    },
    results: ['composition'],
  },
  {
    name: 'review',
    argument: '<plan>',
    description:
      'Validate and record independent decomposition/composition review against the exact subject and document basis',
    options: [
      {
        flags: '--receipt <path>',
        description: 'ReviewReceipt DD document from the independent reviewer',
        required: true,
      },
    ],
    results: ['review'],
  },
  {
    name: 'close',
    argument: '<plan>',
    description:
      'Verify closeout, archive the canonical plan and preserve evidence outside every retiring root',
    options: [
      {
        flags: '--survivor <path>',
        description: 'Explicit surviving evidence directory',
        required: true,
      },
      {
        flags: '--allocations <path>',
        description: 'JSON array of Stored<AllocationRecord> resources under this closeout',
        required: true,
      },
      {
        flags: '--evidence <path>',
        description:
          'JSON array of additional required evidence paths and categories, including telemetry',
        required: true,
      },
    ],
    results: ['archive', 'preservation'],
  },
  {
    name: 'tidy',
    argument: '<allocation>',
    description:
      'Re-verify ownership, runtime release and surviving evidence before retiring a workspace',
    options: [
      {
        flags: '--preservation <path>',
        description: 'PreservationReceipt DD document outside the retiring workspace',
        required: true,
      },
    ],
    results: ['allocation', 'removed'],
  },
];

export const BUILDER_OUTCOMES = {
  ok: { exit: 0, next_action: 'optional' },
  degraded: { exit: 0, next_action: 'required' },
  unconfigured: { exit: 2, next_action: 'required' },
  error: { exit: 1, next_action: 'required' },
  readiness: 'not-ready and cant-tell are non-success; neither authorizes dispatch',
  unsupported: 'error E473 with a named prerequisite; no model/root fallback',
} as const;

/** Resolve policy to a factual checkout kind; never dispatch a solo or unknown guide. */
export function resolveBuilderDispatchKind(
  mode: Guide['isolation']['mode'],
  selection: WorkspaceKindSelector = 'guide',
): BuilderResult<WorkspaceKind> {
  if (mode === 'solo')
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'The implementation guide declares solo execution, not coder dispatch.',
      'Keep the work with the PM, or review a guide with independent coder units.',
    );
  if (mode !== 'clone-per-coder' && mode !== 'worktree-per-coder')
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'The guide has no recognized isolation mode.',
      'Correct the guide using the packaged implementation-guide schema.',
    );
  if (selection === 'guide')
    return { ok: true, value: mode === 'clone-per-coder' ? 'clone' : 'worktree' };
  if (selection === 'clone' || selection === 'worktree') return { ok: true, value: selection };
  return builderFailure(
    ErrorCodes.BUILDER_INVALID,
    'The dispatch workspace selector is not recognized.',
    'Choose guide, clone or worktree; no fallback kind will be selected.',
  );
}

/** Uses Commander itself, including its required, choice and conflict checks. */
export function registerBuilderCommandContract(
  program: Command,
  handle: (
    verb: BuilderVerb,
    argument: string,
    options: Record<string, unknown>,
  ) => void | Promise<void>,
): Command {
  const family = program
    .command('builder')
    .description('Architecture-enabled Builder team lifecycle');
  for (const spec of BUILDER_COMMANDS) {
    const command = family.command(spec.name).argument(spec.argument).description(spec.description);
    for (const flag of spec.options) {
      const option = new Option(flag.flags, flag.description);
      if (flag.required) option.makeOptionMandatory();
      if (flag.choices) option.choices(flag.choices);
      if (flag.default !== undefined) option.default(flag.default);
      if (flag.conflicts) option.conflicts(flag.conflicts);
      command.addOption(option);
    }
    command.action((argument: string, options: Record<string, unknown>) => {
      const supplied = (key: string): boolean =>
        options[key] !== undefined && options[key] !== false;
      if (spec.exactlyOne && spec.exactlyOne.filter(supplied).length !== 1) {
        throw new InvalidArgumentError(
          `Choose exactly one of ${spec.exactlyOne.map((key) => `--${key}`).join(', ')}.`,
        );
      }
      for (const [key, requirements] of Object.entries(spec.requires ?? {})) {
        if (supplied(key) && requirements.some((required) => !supplied(required))) {
          throw new InvalidArgumentError(
            `--${key} requires ${requirements.map((required) => `--${required}`).join(', ')}.`,
          );
        }
      }
      return handle(spec.name, argument, options);
    });
  }
  return family;
}
