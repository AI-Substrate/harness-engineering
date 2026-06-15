import { describe, expect, it } from 'vitest';
import type { ExecResult } from '../../../src/adapters/exec/exec-port.js';
import {
  classifyInstallFailure,
  formatNpmCommand,
  normalizePin,
  npmInstallArgv,
} from '../../../src/services/update/install.js';

const PKG = '@ai-substrate/engineering-harness';
const COMMAND = `npm i -g ${PKG}@latest`;

function result(over: Partial<ExecResult>): ExecResult {
  return { code: 1, stdout: '', stderr: '', ok: false, ...over };
}

describe('npm argv helpers', () => {
  it('builds the global install argv and command string', () => {
    expect(npmInstallArgv('latest')).toEqual(['i', '-g', `${PKG}@latest`]);
    expect(npmInstallArgv('0.3.0')).toEqual(['i', '-g', `${PKG}@0.3.0`]);
    expect(formatNpmCommand(npmInstallArgv('latest'))).toBe(COMMAND);
  });

  it('normalises a pin, stripping a leading v/V', () => {
    expect(normalizePin('v0.3.0')).toBe('0.3.0');
    expect(normalizePin('V1.2.3')).toBe('1.2.3');
    expect(normalizePin('0.3.0')).toBe('0.3.0');
    expect(normalizePin('  v0.3.0  ')).toBe('0.3.0');
  });
});

describe('classifyInstallFailure (AC10)', () => {
  it('npm absent (exit 127 or command-not-found) → E203', () => {
    expect(classifyInstallFailure(result({ code: 127 }), COMMAND).code).toBe('E203');
    expect(
      classifyInstallFailure(result({ code: 1, stderr: 'npm: command not found' }), COMMAND).code,
    ).toBe('E203');
  });

  it('401/403 → E201 auth with a .npmrc + read:packages next_action', () => {
    const f = classifyInstallFailure(result({ stderr: 'npm ERR! 401 Unauthorized' }), COMMAND);
    expect(f.code).toBe('E201');
    expect(f.next_action).toMatch(/\.npmrc/);
    expect(f.next_action).toMatch(/read:packages/);
    expect(classifyInstallFailure(result({ stderr: 'E403 Forbidden' }), COMMAND).code).toBe('E201');
  });

  it('PINNED + 404 → E204 version-not-found (checked before auth)', () => {
    const f = classifyInstallFailure(
      result({ stderr: 'npm ERR! 404 No matching version found for ...' }),
      `npm i -g ${PKG}@9.9.9`,
      { pinned: '9.9.9' },
    );
    expect(f.code).toBe('E204');
    expect(f.message).toContain('9.9.9');
    expect(f.next_action).toContain('--pin');
  });

  it('PINNED + GENERIC 404 (no version text) → E201 setup, not E204 (companion F006)', () => {
    // first-time user with an unconfigured @ai-substrate scope hits a generic 404
    const f = classifyInstallFailure(
      result({
        stderr: 'npm ERR! 404 Not Found - GET https://npm.pkg.github.com/@ai-substrate%2f...',
      }),
      `npm i -g ${PKG}@9.9.9`,
      { pinned: '9.9.9' },
    );
    expect(f.code).toBe('E201'); // a generic 404 on a pin is a config/auth issue, not "version absent"
    expect(f.next_action).toMatch(/\.npmrc/);
  });

  it('NON-pinned 404 → E201 (scope/registry unconfigured) with the setup next_action', () => {
    const f = classifyInstallFailure(
      result({ stderr: 'npm ERR! 404 Not Found - GET ...' }),
      COMMAND,
    );
    expect(f.code).toBe('E201'); // not version-not-found: no pin ⇒ it's a config/auth issue
    expect(f.next_action).toMatch(/\.npmrc/);
  });

  it('EACCES/EPERM → E202 permission denied', () => {
    expect(
      classifyInstallFailure(
        result({ stderr: 'npm ERR! Error: EACCES: permission denied' }),
        COMMAND,
      ).code,
    ).toBe('E202');
    expect(
      classifyInstallFailure(result({ stderr: 'EPERM: operation not permitted' }), COMMAND).code,
    ).toBe('E202');
  });

  it('anything else → E200 generic, echoing the command to re-run', () => {
    const f = classifyInstallFailure(result({ code: 1, stderr: 'something weird' }), COMMAND);
    expect(f.code).toBe('E200');
    expect(f.next_action).toContain(COMMAND);
  });
});
