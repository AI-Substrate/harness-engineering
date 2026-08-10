import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  nullDeviceForPlatform,
  safeCredentialConfigEnvironment,
  safeGitEnvironment,
} from '../../../src/adapters/git/exec-remote-telemetry-git.js';

/**
 * The null-device spelling handed to `GIT_CONFIG_GLOBAL` (plan 077 · #108).
 *
 * ## Why this file exists, and what it can and cannot prove
 *
 * `GIT_CONFIG_GLOBAL` is the isolation boundary for the remote-telemetry adapter: it is
 * what stops a fixture git run from reading the operator's real global config. The value
 * used to be `os.devNull`, which is `/dev/null` on POSIX but the DEVICE path `\\.\nul` on
 * win32.
 *
 * ## SIMULATED win32 — every case below runs on the host's real platform
 *
 * The platform is INJECTED, never stubbed (the shape used by `NodeBackground` and
 * `resolveSpawn`). Nothing here executes on Windows and nothing here runs git. Every
 * win32 expectation is EXPECTED, UNVERIFIED — nobody on this side has a Windows host.
 *
 * ## The claim split, stated plainly
 *
 * (i) `os.devNull` is `\\.\nul` on win32 and `/dev/null` elsewhere — documented Node
 *     behaviour, and the negative controls below assert the POSIX half directly.
 * (ii) git REJECTS `\\.\nul` as a config path and ACCEPTS `NUL` — NOT ours. It is the
 *     downstream consumer's, taken from a comment in their fork, which they said they
 *     could not date or trace to a changelog. It is not restated here as measurement.
 *
 * These tests assert (i) and the wiring. They CANNOT assert (ii): a simulated-win32 test
 * asserts the STRING WE EMIT, not git's reaction to it. So if (ii) is wrong, we have
 * swapped a device path git rejects for a device path git rejects differently, and every
 * one of these cases still passes. The consumer's next Windows run is the only instrument
 * that closes that gap. The honest ceiling is "we now emit the spelling git is reported to
 * accept", NOT "isolation is restored on Windows".
 *
 * Do not read `test/support/hermetic-git.ts` (which has spelled it `'NUL'` since #73) as
 * corroboration of (ii). As far as we can tell it has never been exercised on a Windows
 * runner, so it has survived rather than succeeded. It shows someone here believed it.
 */
describe('null device for GIT_CONFIG_GLOBAL (win32 SIMULATED via injected platform)', () => {
  it('maps win32 to NUL and every other platform to os.devNull', () => {
    expect(nullDeviceForPlatform('win32')).toBe('NUL');
    // Negative controls — these are what let this file return the contrary answer on a
    // POSIX host, so the mapping is a real branch rather than a constant.
    expect(nullDeviceForPlatform('linux')).toBe(devNull);
    expect(nullDeviceForPlatform('darwin')).toBe(devNull);
    expect(nullDeviceForPlatform('linux')).not.toBe('NUL');
  });

  /**
   * BOTH product sites, asserted separately and by name. One site fixed with a sibling
   * left behind is the defect shape this thread keeps hitting, so neither site is allowed
   * to be proven only by implication from the other.
   */
  it('site 1 of 2 — safeGitEnvironment falls back to the platform null device', () => {
    expect(safeGitEnvironment(undefined, 'win32').GIT_CONFIG_GLOBAL).toBe('NUL');
    expect(safeGitEnvironment(undefined, 'linux').GIT_CONFIG_GLOBAL).toBe(devNull);
  });

  it('site 2 of 2 — safeCredentialConfigEnvironment(materializing) uses the same device', () => {
    expect(safeCredentialConfigEnvironment(true, 'win32').GIT_CONFIG_GLOBAL).toBe('NUL');
    expect(safeCredentialConfigEnvironment(true, 'linux').GIT_CONFIG_GLOBAL).toBe(devNull);
  });

  it('leaves the non-null-device behaviour of both sites unchanged', () => {
    // A real credential config path still wins over the null device, on either platform.
    const leased = 'C:/tmp/harness-git-credential-xyz/credentials.gitconfig';
    expect(safeGitEnvironment(leased, 'win32').GIT_CONFIG_GLOBAL).toBe(leased);
    expect(safeGitEnvironment(leased, 'linux').GIT_CONFIG_GLOBAL).toBe(leased);
    // Not materializing → the key is absent entirely, not set to a null device.
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
   * `GIT_CONFIG_GLOBAL` line to route through `nullDeviceForPlatform` rather than touch
   * `devNull` directly. Comment lines are excluded, so prose about `os.devNull` — such as
   * the note above `nullDeviceForPlatform` itself — does not trip it.
   *
   * It is a source-text check, so it proves a spelling and not a behaviour. That is the
   * point: the behaviour is unmeasurable from this hardware, and the spelling is not.
   */
  it('no other GIT_CONFIG_GLOBAL site in the adapter reaches os.devNull directly', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../src/adapters/git/exec-remote-telemetry-git.ts',
      ),
      'utf8',
    );
    const executable = source
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .filter((line) => line.includes('GIT_CONFIG_GLOBAL'));
    expect(executable.length).toBeGreaterThanOrEqual(2);
    expect(executable.filter((line) => /\bdevNull\b/.test(line))).toEqual([]);
    for (const line of executable) {
      expect(line).toMatch(/nullDeviceForPlatform/);
    }
  });
});
