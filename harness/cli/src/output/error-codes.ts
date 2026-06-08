/**
 * Central error-code table (grep `Exxx` to find call sites). Start minimal;
 * grow as commands are added. Workshop 001 § Error code table.
 */
export const ErrorCodes = {
  /** Unclassified failure (last resort). */
  UNKNOWN: 'E100',
  /** Missing/invalid argument or flag. */
  INVALID_ARGS: 'E108',
  /** `.harness`/command-map config failed validation. */
  CONFIG_INVALID: 'E120',
  /** A doctor check raised an unexpected error (vs. reporting a failing layer). */
  DOCTOR_CHECK_FAILED: 'E130',
  /** An extension file couldn't be imported or failed shape validation (per-extension, non-fatal; surfaced by `doctor`). */
  EXTENSION_LOAD_FAILED: 'E140',
  /** A verb handler threw at invocation time (isolated → error Envelope, never a raw stack). */
  EXTENSION_RUNTIME_ERROR: 'E141',
  /** Two extensions (or an extension + a reserved core name) declared the same verb name. */
  EXTENSION_VERB_CONFLICT: 'E142',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
