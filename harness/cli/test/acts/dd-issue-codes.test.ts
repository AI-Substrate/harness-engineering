import { describe, expect, it } from 'vitest';
import { DD_ISSUE_CODES } from '../../src/acts/dd/shared.js';

/**
 * The class → E-code table, pinned by value.
 *
 * P5 collapsed three drifted copies of this map into one, which forced a winner
 * for every class that disagreed. The compiler proves the map is EXHAUSTIVE (an
 * unmapped class will not build); nothing proved which code each class ends up
 * with, so the arbitration lived only in a prose record — and the record and the
 * artifact promptly disagreed (P5 review F005). This file is the assertion that
 * keeps the choice re-derivable: change a code and this test names it.
 */
const EXPECTED: Record<string, string> = {
  'address-malformed': 'E405',
  'address-path-absolute': 'E405',
  // THE ruled change (PM-confirmed, P5 T004): `dd validate` used to report a path
  // that leaves the repository with the generic address code (E405) while
  // `dd doctor` reported the specific link-escape code. The specific code wins,
  // and it is now the answer wherever the finding is reported.
  'address-path-escape': 'E433',
  'address-path-non-posix': 'E405',
  'address-target-missing': 'E431',
  'address-target-untracked': 'E432',
  'adapter-gap': 'E423',
  'basis-stale': 'E434',
  'duplicate-id': 'E404',
  'enum-invalid': 'E407',
  'human-skipped-receipt-required': 'E409',
  'id-invalid': 'E403',
  // NOT the doctor's E439: a class code says what went wrong and must not change
  // with the verb reporting it. `dd doctor` keeps E439 as its ENVELOPE code, set
  // at its own exit site (P5 review F002).
  'link-scan-failed': 'E436',
  'link-scan-incomplete': 'E436',
  'link-type-mismatch': 'E406',
  'link-unresolved': 'E430',
  'schema-shape': 'E402',
  'schema-unresolvable': 'E401',
  'state-note-required': 'E408',
};

describe('DD_ISSUE_CODES — one class, one code', () => {
  it('maps every dd finding class to its frozen E-code', () => {
    expect(DD_ISSUE_CODES).toEqual(EXPECTED);
  });

  it('covers every class exactly once, with no class left unmapped', () => {
    // The compiler already refuses an unmapped class; this pins the other half —
    // a class quietly REMOVED from the union would drop its code with it, and the
    // frozen surface would shrink without anyone deciding to shrink it.
    expect(Object.keys(DD_ISSUE_CODES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('answers every class with a dd-range code', () => {
    for (const [issueClass, code] of Object.entries(DD_ISSUE_CODES)) {
      expect(code, `${issueClass} must answer with a dd-range E-code`).toMatch(/^E4\d\d$/);
    }
  });
});
