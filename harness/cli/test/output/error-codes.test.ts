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
      CONFIG_INVALID: 'E120',
      DOCTOR_CHECK_FAILED: 'E130',
      EXTENSION_LOAD_FAILED: 'E140',
      EXTENSION_RUNTIME_ERROR: 'E141',
      EXTENSION_VERB_CONFLICT: 'E142',
      EXTENSION_FLAT_LAYOUT: 'E143',
      EXTENSION_INSTRUCTIONS_MISSING: 'E144',
      INSTRUCTIONS_UNREADABLE: 'E145',
      OBSERVE_BUFFER_UNREADABLE: 'E146',
      SCAFFOLD_INVALID_NAME: 'E150',
      SCAFFOLD_NAME_RESERVED: 'E151',
      SCAFFOLD_FILE_EXISTS: 'E152',
      SCAFFOLD_WRITE_FAILED: 'E153',
      DOC_NOT_FOUND: 'E160',
      SKILLS_INSTALL_FAILED: 'E170',
      RECORD_TYPE_UNKNOWN: 'E180',
      RECORD_WRITE_FAILED: 'E181',
      INIT_WRITE_FAILED: 'E190',
      UPDATE_FAILED: 'E200',
      UPDATE_AUTH_FAILED: 'E201',
      UPDATE_PERMISSION_DENIED: 'E202',
      UPDATE_NPM_MISSING: 'E203',
      UPDATE_VERSION_NOT_FOUND: 'E204',
      FLOW_SCHEMA_INVALID: 'E300',
      FLOW_NOT_FOUND: 'E301',
      FLOW_WRITE_FAILED: 'E302',
      FLOW_PATH_ESCAPE: 'E303',
      FLOW_TYPE_UNKNOWN: 'E304',
      FLOW_NODE_INVALID: 'E305',
      FLOW_SCHEMA_VERSION: 'E306',
      FLOW_AMBIGUOUS_TARGET: 'E307',
      FLOW_LEGACY_FORMAT: 'E308',
      FLOW_EDGE_INVALID: 'E309',
      FLOW_RENDER_DRIFT: 'E310',
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
