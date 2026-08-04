import { describe, expect, it } from 'vitest';
import {
  COMPLETION_STATES,
  DEFAULT_GATE_TERMINAL_STATES,
  ID_PREFIXES,
  MINTED_ID_PATTERN,
  REFERENCES_LEDGER_FIELD,
} from '../../../../src/services/dd/core/constants.js';

describe('dd-core constants', () => {
  it('freezes the id registry and four-hex minting rule', () => {
    // Adjusted DELIBERATELY, never loosened: `fn-` joined for fence rows
    // (tk-7171). A prefix is part of every address that will ever name one of
    // these rows, so adding one is closer to a surface change than a constant
    // edit — and this pin is what makes it a decision rather than an import.
    expect(ID_PREFIXES).toEqual(['ph-', 'tk-', 'ac-', 'bp-', 'lg-', 'dw-', 'fn-']);
    expect(MINTED_ID_PATTERN.test('fn-0a1b')).toBe(true);
    expect(MINTED_ID_PATTERN.test('tk-9f2a')).toBe(true);
    expect(MINTED_ID_PATTERN.test('tk-9f2a1')).toBe(false);
    expect(MINTED_ID_PATTERN.test('xx-9f2a')).toBe(false);
  });

  it('freezes completion and references-ledger vocabulary', () => {
    expect(COMPLETION_STATES).toEqual(['unchecked', 'checked', 'blocked', 'human-skipped', 'na']);
    expect(DEFAULT_GATE_TERMINAL_STATES).toEqual(['checked', 'human-skipped', 'na']);
    expect(REFERENCES_LEDGER_FIELD).toBe('references');
  });
});
