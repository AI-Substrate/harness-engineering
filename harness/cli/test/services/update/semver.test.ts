import { describe, expect, it } from 'vitest';
import { isNewer } from '../../../src/services/update/semver.js';

describe('isNewer', () => {
  it('given_higher_core_version_when_compared_then_true', () => {
    /*
    Test Doc:
    - Why: the update banner fires only when latest is strictly newer than installed.
    - Contract: isNewer(latest, installed) compares major.minor.patch numerically.
    - Usage Notes: pure function; no I/O.
    - Quality Contribution: pins the precedence the throttle/banner logic depends on.
    - Worked Example: isNewer('0.3.0','0.2.0') === true.
    */
    expect(isNewer('0.3.0', '0.2.0')).toBe(true); // minor
    expect(isNewer('1.0.0', '0.9.9')).toBe(true); // major
    expect(isNewer('0.2.1', '0.2.0')).toBe(true); // patch
    expect(isNewer('0.2.10', '0.2.9')).toBe(true); // numeric, not lexical
  });

  it('given_equal_or_older_when_compared_then_false', () => {
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0', '0.3.0')).toBe(false);
    expect(isNewer('0.9.9', '1.0.0')).toBe(false);
  });

  it('tolerates a leading v and ignores build metadata', () => {
    expect(isNewer('v0.3.0', '0.2.0')).toBe(true);
    expect(isNewer('0.3.0', 'v0.3.0')).toBe(false);
    expect(isNewer('0.3.0+build.7', '0.3.0')).toBe(false); // build ignored ⇒ equal
  });

  it('treats a release as newer than its pre-release, and vice-versa', () => {
    expect(isNewer('0.3.0', '0.3.0-canary.1')).toBe(true); // release > prerelease
    expect(isNewer('0.3.0-canary.1', '0.3.0')).toBe(false);
    // a newer core that is still a prerelease beats an older release
    expect(isNewer('0.3.0-canary.1', '0.2.0')).toBe(true);
  });

  it('orders pre-release identifiers per the SemVer spec', () => {
    expect(isNewer('0.3.0-canary.2', '0.3.0-canary.1')).toBe(true); // numeric
    expect(isNewer('0.3.0-canary.1', '0.3.0-canary.2')).toBe(false);
    expect(isNewer('0.3.0-alpha.1', '0.3.0-alpha')).toBe(true); // more fields win
    expect(isNewer('0.3.0-beta', '0.3.0-alpha')).toBe(true); // lexical
    expect(isNewer('0.3.0-rc.1', '0.3.0-rc.1')).toBe(false); // identical
  });

  it('is safe on malformed input — never a phantom update', () => {
    expect(isNewer('garbage', '0.2.0')).toBe(false);
    expect(isNewer('0.3.0', 'not-a-version')).toBe(false);
    expect(isNewer('0.3', '0.2.0')).toBe(false); // not a clean triple
    expect(isNewer('', '0.2.0')).toBe(false);
    expect(isNewer('1.2.x', '1.2.0')).toBe(false);
  });
});
