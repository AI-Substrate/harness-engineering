import { describe, expect, it } from 'vitest';
import { type ErrorCode, ErrorCodes } from '../../src/output/error-codes.js';

describe('ErrorCodes table', () => {
  it('exposes the starter codes with stable values (workshop 001)', () => {
    /*
    Test Doc:
    - Why: error codes are a public contract — acts and agents grep `Exxx` and switch on them.
    - Contract: the starter table maps names → E100/E108/E110/E120/E130.
    - Usage Notes: reference ErrorCodes.INVALID_ARGS, never the bare 'E108' literal, in acts.
    - Quality Contribution: locks the codes so a rename can't silently drift a documented value.
    - Worked Example: ErrorCodes.INVALID_ARGS === 'E108'.
    */
    expect(ErrorCodes).toEqual({
      UNKNOWN: 'E100',
      INVALID_ARGS: 'E108',
      SLOT_UNKNOWN: 'E110',
      CONFIG_INVALID: 'E120',
      DOCTOR_CHECK_FAILED: 'E130',
      EXTENSION_LOAD_FAILED: 'E140',
      EXTENSION_RUNTIME_ERROR: 'E141',
      EXTENSION_VERB_CONFLICT: 'E142',
    });
  });

  it('every code is a unique E-prefixed string', () => {
    const values: ErrorCode[] = Object.values(ErrorCodes);
    expect(new Set(values).size).toBe(values.length);
    for (const code of values) {
      expect(code).toMatch(/^E\d{3}$/);
    }
  });
});
