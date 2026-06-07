import type { Clock } from '../../adapters/clock/clock-port.js';
import { type Envelope, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
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
