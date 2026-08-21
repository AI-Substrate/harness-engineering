import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  gitConfigNullPath,
  safeCredentialConfigEnvironment,
  safeGitEnvironment,
} from '../../../src/adapters/git/exec-remote-telemetry-git.js';

/**
 * The path handed to `GIT_CONFIG_GLOBAL` (plan 083 · defect 1; was plan 077 · #108).
 *
 * ## What this file got wrong, and what it now asserts
 *
 * Its previous case read *"maps win32 to NUL and every other platform to os.devNull"* —
 * **and it passed on every machine that ever ran it**, because on Linux and macOS the
 * win32 branch was never executed. The suite defended the broken constant. Both values
 * this repo has emitted (`'NUL'`, and `os.devNull` = `\\.\nul`) make Git for Windows exit
 * 128 on every verb, so `ExecRemoteTelemetryGit` was inoperative on Windows — roughly two
 * thirds of the Windows suite's failures, from one constant.
 *
 * So every case below asserts a **LITERAL**, and drives the **win32 path on every host**
 * via the injected `platform` argument. Two consequences worth stating:
 *
 * - Nothing here may compare the product against itself. `toBe(gitConfigNullPath())`
 *   cannot fail for any value the function returns; it would have followed `'NUL'`
 *   silently. A derived expectation cannot detect drift in the thing it derives from.
 * - These cases will FAIL, on a Mac, the moment anyone reintroduces platform variance —
 *   which is the property that was unassertable before and is the reason
 *   `gitConfigNullPath` still accepts a `platform` it ignores.
 *
 * ## Why `/dev/null` on Windows is not a POSIX assumption
 *
 * git's `Documentation/git.adoc`, under `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`: *"Can be
 * set to `/dev/null` to skip reading configuration files of the respective level."* It is
 * a documented contract of the variable — git reads the string, it does not open a device
 * — and it is what we measured working (exit 0, isolated, positive control) on Windows 11
 * build 26100 with git 2.55.0.windows.3 on 2026-08-11.
 *
 * ## The ceiling, stated plainly
 *
 * These are still SIMULATED-win32 cases: the platform is injected, never stubbed, nothing
 * here executes on Windows and nothing here runs git. They assert the STRING WE EMIT. The
 * proof that git ACCEPTS it is the Windows VM run, not this file. Honest ceiling: "we emit
 * the documented, Windows-measured value on every platform", not "isolation is proven from
 * here".
 *
 * The filename still says "null-device". Kept deliberately: it is the known address of
 * this defect. The product name was not — `nullDeviceForPlatform` is half the reason
 * someone reached for a Windows null device in the first place, so that one is gone.
 */
describe('GIT_CONFIG_GLOBAL null path (win32 SIMULATED via injected platform)', () => {
  it('is the literal /dev/null on win32 too — no platform variance at all', () => {
    expect(gitConfigNullPath('win32')).toBe('/dev/null');
    expect(gitConfigNullPath('linux')).toBe('/dev/null');
    expect(gitConfigNullPath('darwin')).toBe('/dev/null');
    // The two values that measured exit 128 on Git for Windows, named so a revert is loud.
    expect(gitConfigNullPath('win32')).not.toBe('NUL');
    expect(gitConfigNullPath('win32')).not.toBe('\\\\.\\nul');
    // Every platform node knows about, one value. `devNull` is asserted AGAINST here, not
    // with: on win32 it is `\\.\nul`, and that is precisely what must not come back.
    for (const platform of [
      'aix',
      'android',
      'darwin',
      'freebsd',
      'linux',
      'openbsd',
      'sunos',
      'win32',
    ] as const) {
      expect(gitConfigNullPath(platform)).toBe('/dev/null');
    }
    // A guard on the guard, host-correct on BOTH platforms: `os.devNull` is '/dev/null'
    // here and the DEVICE path '\\.\nul' on Windows. So a case that asserted
    // `toBe(devNull)` would be indistinguishable from a correct one on this machine and
    // silently wrong on the only machine that matters — which is how #108 survived.
    expect(devNull).toBe(process.platform === 'win32' ? '\\\\.\\nul' : '/dev/null');
  });

  /**
   * BOTH product sites, asserted separately and by name. One site fixed with a sibling
   * left behind is the defect shape this plan keeps hitting, so neither site is allowed
   * to be proven only by implication from the other.
   */
  it('site 1 of 2 — safeGitEnvironment falls back to the literal /dev/null on win32', () => {
    expect(safeGitEnvironment(undefined, 'win32').GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(safeGitEnvironment(undefined, 'linux').GIT_CONFIG_GLOBAL).toBe('/dev/null');
  });

  it('site 2 of 2 — safeCredentialConfigEnvironment(materializing) uses the same path', () => {
    expect(safeCredentialConfigEnvironment(true, 'win32').GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(safeCredentialConfigEnvironment(true, 'linux').GIT_CONFIG_GLOBAL).toBe('/dev/null');
  });

  it('leaves the non-null-path behaviour of both sites unchanged', () => {
    // A real credential config path still wins over the null path, on either platform.
    const leased = 'C:/tmp/harness-git-credential-xyz/credentials.gitconfig';
    expect(safeGitEnvironment(leased, 'win32').GIT_CONFIG_GLOBAL).toBe(leased);
    expect(safeGitEnvironment(leased, 'linux').GIT_CONFIG_GLOBAL).toBe(leased);
    // Not materializing → the key is absent entirely, not set to a null path.
    expect(safeCredentialConfigEnvironment(false, 'win32')).not.toHaveProperty('GIT_CONFIG_GLOBAL');
    // The rest of the isolation envelope is untouched by the platform argument.
    for (const platform of ['win32', 'linux'] as const) {
      expect(safeGitEnvironment(undefined, platform).GIT_CONFIG_NOSYSTEM).toBe('1');
      expect(safeCredentialConfigEnvironment(true, platform).GIT_CONFIG_NOSYSTEM).toBe('1');
    }
  });

  /**
   * The anti-sibling guard, and the only case here that would catch a NEW third site.
   *
   * The two cases above name the two sites that exist today; they say nothing about a
   * third one added tomorrow. This reads the adapter source and requires every executable
   * `GIT_CONFIG_GLOBAL` line to route through `gitConfigNullPath`, with neither rejected
   * spelling anywhere in the executable text. Comment lines are excluded, so the prose
   * above `gitConfigNullPath` — which must name `os.devNull` and `'NUL'` to explain why
   * they are wrong — does not trip it.
   *
   * It is a source-text check, so it proves a spelling and not a behaviour. That is the
   * point: the behaviour is unmeasurable from this hardware, and the spelling is not.
   */
  it('no GIT_CONFIG_GLOBAL site in the adapter reaches a Windows null device', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../src/adapters/git/exec-remote-telemetry-git.ts',
      ),
      'utf8',
    );
    const executableLines = source.split('\n').filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line));
    // Neither rejected spelling may appear in executable text ANYWHERE in the adapter —
    // not just on a GIT_CONFIG_GLOBAL line. `os.devNull` is win32's `\\.\nul`, and the
    // import going away is what stops it coming back by autocomplete.
    expect(executableLines.filter((line) => /\bdevNull\b/.test(line))).toEqual([]);
    expect(executableLines.filter((line) => /'NUL'|"NUL"/.test(line))).toEqual([]);
    const configSites = executableLines.filter((line) => line.includes('GIT_CONFIG_GLOBAL'));
    expect(configSites.length).toBeGreaterThanOrEqual(2);
    for (const line of configSites) {
      expect(line).toMatch(/gitConfigNullPath/);
    }
  });

  /**
   * The two test-side siblings. A product-only fix leaves them emitting the value git
   * rejects, and they are the fixture environment for a large part of the suite — on
   * Windows they take real git down with them. Asserted as source text because both are
   * inline object literals inside helpers this file cannot call platform-wise.
   */
  it('the test-side siblings emit the same literal, on every platform', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const relative of [
      '../../support/hermetic-git.ts',
      './exec-remote-telemetry-git.int.test.ts',
    ]) {
      const lines = readFileSync(join(here, relative), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .filter((line) => /GIT_CONFIG_GLOBAL:/.test(line));
      expect(lines.filter((line) => /'NUL'|"NUL"|\bdevNull\b/.test(line))).toEqual([]);
    }
  });
});
