import type { Clock } from '../../adapters/clock/clock-port.js';
import { type Envelope, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { HarnessVerb } from '../extensions/contract.js';
import type { CommandSlot } from '../slots/slot-registry.js';

/** One thing wrong with a slot in the command-map. */
export interface CommandMapIssue {
  slot: string;
  problem: string;
}

const VALID_STATUSES = new Set(['configured', 'unconfigured']);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate the in-code command-map (the slot registry) shape **before use**.
 * Returns an actionable `error` envelope (`E120 CONFIG_INVALID`) on a malformed
 * map rather than throwing — every slot needs a non-empty name, a known status,
 * and a next_action; names must be unique. *No external config file is read
 * this slice; the FsPort-fed loader is deferred to the extension system.*
 */
export function validateCommandMap(slots: readonly CommandSlot[], clock: Clock): Envelope {
  const issues: CommandMapIssue[] = [];
  const seen = new Set<string>();

  slots.forEach((slot, index) => {
    const label = nonEmptyString(slot?.name) ? slot.name : `#${index}`;
    if (!nonEmptyString(slot?.name)) {
      issues.push({ slot: label, problem: 'missing or empty name' });
    } else {
      if (seen.has(slot.name)) {
        issues.push({ slot: slot.name, problem: 'duplicate name' });
      }
      seen.add(slot.name);
    }
    if (!slot || !VALID_STATUSES.has(slot.status)) {
      issues.push({ slot: label, problem: `invalid status '${slot?.status}'` });
    }
    if (!nonEmptyString(slot?.next_action)) {
      issues.push({ slot: label, problem: 'missing next_action' });
    }
    if (!nonEmptyString(slot?.description)) {
      issues.push({ slot: label, problem: 'missing description' });
    }
  });

  if (issues.length > 0) {
    return formatError(
      'config',
      ErrorCodes.CONFIG_INVALID,
      `Command-map is invalid: ${issues.length} issue(s).`,
      clock,
      { details: issues, next_action: 'Fix the slot registry entries listed in error.details.' },
    );
  }
  return formatOk('config', { valid: true, slots: slots.length }, clock);
}

/** One thing wrong with a verb in the assembled registry. */
export interface VerbRegistryIssue {
  verb: string;
  problem: string;
}

/**
 * Field-level issues for a single verb (empty array = well-formed). The single
 * source of truth for "what a valid verb looks like" — shared by the per-extension
 * load check in the registry and the whole-registry pre-flight below.
 */
export function verbShapeIssues(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return ['not an object'];
  }
  const verb = value as Partial<HarnessVerb>;
  const issues: string[] = [];
  if (!nonEmptyString(verb.name)) {
    issues.push('missing or empty name');
  }
  if (!nonEmptyString(verb.summary)) {
    issues.push('missing or empty summary');
  }
  if (typeof verb.run !== 'function') {
    issues.push('missing run() handler');
  }
  return issues;
}

/** Type guard — a value conforms to the minimum `HarnessVerb` shape. */
export function isVerbShaped(value: unknown): value is HarnessVerb {
  return verbShapeIssues(value).length === 0;
}

/**
 * Validate the assembled verb registry shape **before use** — the open-keyed
 * successor to {@link validateCommandMap} (plan D3). Every verb needs a non-empty
 * `name` (an open `string` key — no closed union), a non-empty `summary`, and a
 * `run()` handler; names must be unique. Returns an actionable `E120` envelope on
 * any issue rather than throwing (AC-7).
 */
export function validateVerbRegistry(verbs: readonly HarnessVerb[], clock: Clock): Envelope {
  const issues: VerbRegistryIssue[] = [];
  const seen = new Set<string>();

  verbs.forEach((verb, index) => {
    const label = nonEmptyString(verb?.name) ? verb.name : `#${index}`;
    for (const problem of verbShapeIssues(verb)) {
      issues.push({ verb: label, problem });
    }
    if (nonEmptyString(verb?.name)) {
      if (seen.has(verb.name)) {
        issues.push({ verb: verb.name, problem: 'duplicate name' });
      }
      seen.add(verb.name);
    }
  });

  if (issues.length > 0) {
    return formatError(
      'config',
      ErrorCodes.CONFIG_INVALID,
      `Verb registry is invalid: ${issues.length} issue(s).`,
      clock,
      {
        details: issues,
        next_action: 'Fix or remove the extension verbs listed in error.details.',
      },
    );
  }
  return formatOk('config', { valid: true, verbs: verbs.length }, clock);
}
