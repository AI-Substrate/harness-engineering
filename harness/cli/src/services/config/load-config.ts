import type { Clock } from '../../adapters/clock/clock-port.js';
import { type Envelope, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { HarnessVerb, VerbArg, VerbOption } from '../extensions/contract.js';

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Field-level issues for a verb's declared positional args (empty = well-formed). */
function argShapeIssues(args: unknown, allowVariadic = false): string[] {
  if (args === undefined) {
    return [];
  }
  if (!Array.isArray(args)) {
    return ['args must be an array'];
  }
  const issues: string[] = [];
  args.forEach((arg, index) => {
    if (arg === null || typeof arg !== 'object') {
      issues.push(`arg #${index} is not an object`);
      return;
    }
    const name = (arg as Partial<VerbArg>).name;
    if (!nonEmptyString(name)) {
      issues.push(`arg #${index} has a missing or empty name`);
      return;
    }
    // Variadic positionals (`<files...>`) would hand commander an array, breaking
    // the `ctx.args: Record<string, string | undefined>` contract — reject in v1.
    if (!allowVariadic && name.includes('...')) {
      issues.push(`arg '${name}' is variadic; variadic args are not supported (v1)`);
    }
  });
  return issues;
}

/** Field-level issues for a verb's declared options (empty = well-formed). */
function optionShapeIssues(options: unknown): string[] {
  if (options === undefined) {
    return [];
  }
  if (!Array.isArray(options)) {
    return ['options must be an array'];
  }
  const issues: string[] = [];
  options.forEach((option, index) => {
    if (option === null || typeof option !== 'object') {
      issues.push(`option #${index} is not an object`);
      return;
    }
    if (!nonEmptyString((option as Partial<VerbOption>).flags)) {
      issues.push(`option #${index} has missing or empty flags`);
    }
  });
  return issues;
}

/** One thing wrong with a verb in the assembled registry. */
export interface VerbRegistryIssue {
  verb: string;
  problem: string;
}

/**
 * Field-level issues for a single verb (empty array = well-formed). The single
 * source of truth for "what a valid verb looks like" — shared by the per-extension
 * load check in the registry and the whole-registry pre-flight below. Validates
 * the verb's name/summary/run plus the SHAPE of its declared args + options
 * (rejecting variadic positionals and malformed options) so a bad extension
 * becomes a clean E140/E120 instead of crashing commander at registration time.
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
  issues.push(...argShapeIssues(verb.args));
  issues.push(...optionShapeIssues(verb.options));
  return issues;
}

/** Type guard — a value conforms to the minimum `HarnessVerb` shape. */
export function isVerbShaped(value: unknown): value is HarnessVerb {
  return verbShapeIssues(value).length === 0;
}

function v2NormalizedVerbShapeIssues(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return ['not an object'];
  const verb = value as Partial<HarnessVerb> & { subverbs?: unknown };
  const issues: string[] = [];
  if (!nonEmptyString(verb.name)) issues.push('missing or empty name');
  if (!nonEmptyString(verb.summary)) issues.push('missing or empty summary');
  if (typeof verb.run !== 'function') issues.push('missing run() handler');
  issues.push(...argShapeIssues(verb.args, true));
  issues.push(...optionShapeIssues(verb.options));
  if (verb.subverbs !== undefined) {
    if (!Array.isArray(verb.subverbs)) {
      issues.push('subverbs must be an array');
    } else {
      verb.subverbs.forEach((subverb, index) => {
        for (const problem of v2NormalizedVerbShapeIssues(subverb)) {
          issues.push(`subverb #${index}: ${problem}`);
        }
      });
    }
  }
  return issues;
}

function isV2NormalizedVerb(value: unknown): boolean {
  return (
    value !== null && typeof value === 'object' && ('hasOwnRun' in value || 'subverbs' in value)
  );
}

/**
 * Validate the assembled verb registry shape **before use** — the open-keyed
 * registry pre-flight (plan D3). Every verb needs a non-empty
 * `name` (an open `string` key — no closed union), a non-empty `summary`, and a
 * `run()` handler; names must be unique. Returns an actionable `E120` envelope on
 * any issue rather than throwing (AC-7).
 */
export function validateVerbRegistry(verbs: readonly HarnessVerb[], clock: Clock): Envelope {
  const issues: VerbRegistryIssue[] = [];
  const seen = new Set<string>();

  verbs.forEach((verb, index) => {
    const label = nonEmptyString(verb?.name) ? verb.name : `#${index}`;
    const shapeIssues = isV2NormalizedVerb(verb)
      ? v2NormalizedVerbShapeIssues(verb)
      : verbShapeIssues(verb);
    for (const problem of shapeIssues) {
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
