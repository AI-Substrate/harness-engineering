/**
 * Central error-code table (grep `Exxx` to find call sites). Start minimal;
 * grow as commands are added. Workshop 001 § Error code table.
 */
export const ErrorCodes = {
  /** Unclassified failure (last resort). */
  UNKNOWN: 'E100',
  /** Missing/invalid argument or flag. */
  INVALID_ARGS: 'E108',
  /** Named slot is not a known command slot. */
  SLOT_UNKNOWN: 'E110',
  /** `.harness`/command-map config failed validation. */
  CONFIG_INVALID: 'E120',
  /** A doctor check raised an unexpected error (vs. reporting a failing layer). */
  DOCTOR_CHECK_FAILED: 'E130',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
