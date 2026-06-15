import { describe, expect, it } from 'vitest';
import { resolveSpawn } from '../../../src/adapters/exec/windows-command.js';

/**
 * Pure resolution tests for the cross-platform exec shim. These run the win32
 * branch explicitly via the `platform`/`env` injection points so the behaviour
 * is provable on any host (including the POSIX CI legs).
 */
describe('resolveSpawn', () => {
  it('is the identity on non-Windows platforms', () => {
    const r = resolveSpawn('minih', ['run', 'x'], '/repo', 'linux', {});
    expect(r).toEqual({ command: 'minih', args: ['run', 'x'] });
  });

  it('leaves an unresolved bare command alone on Windows (natural ENOENT)', () => {
    // No PATH entries => nothing resolves => raw command passes through.
    const r = resolveSpawn('nope', ['--x'], 'C:/repo', 'win32', { PATH: '' });
    expect(r).toEqual({ command: 'nope', args: ['--x'] });
  });

  it('passes an explicit .exe through directly (no cmd wrapper)', () => {
    // An absolute .exe that does not exist still must NOT be cmd-wrapped — the
    // extension is not .cmd/.bat, so it spawns directly.
    const r = resolveSpawn('C:/tools/git.exe', ['status'], 'C:/repo', 'win32', {});
    expect(r.command).toBe('C:/tools/git.exe');
    expect(r.args).toEqual(['status']);
  });

  it('routes an explicit .cmd shim through cmd.exe as one verbatim quoted line', () => {
    const r = resolveSpawn('C:/npm/minih.cmd', ['run', 'a b'], 'C:/repo', 'win32', {});
    expect(r.command).toBe('cmd.exe');
    // Spaced args are inner-quoted; the whole tail gets an OUTER quote pair for /s.
    expect(r.args).toEqual(['/d', '/s', '/c', '"C:/npm/minih.cmd run "a b""']);
    expect(r.windowsVerbatimArguments).toBe(true);
  });

  it('keeps a spaced target path quoted under cmd /s (the C:\\Program Files bug)', () => {
    // The npx shim commonly resolves to C:\Program Files\nodejs\npx.cmd. Without
    // the outer quote pair, cmd /s stripped the path's own quotes and split on
    // the space. The outer pair is what /s strips, so the path stays quoted.
    const r = resolveSpawn(
      'C:\\Program Files\\nodejs\\npx.cmd',
      ['skills@latest', 'add'],
      'C:/repo',
      'win32',
      {},
    );
    expect(r.command).toBe('cmd.exe');
    expect(r.args).toEqual([
      '/d',
      '/s',
      '/c',
      '""C:\\Program Files\\nodejs\\npx.cmd" skills@latest add"',
    ]);
    expect(r.windowsVerbatimArguments).toBe(true);
  });

  it('routes a .bat shim through cmd.exe', () => {
    const r = resolveSpawn('C:/x/tool.bat', ['--v'], 'C:/repo', 'win32', {});
    expect(r.command).toBe('cmd.exe');
    expect(r.args).toEqual(['/d', '/s', '/c', '"C:/x/tool.bat --v"']);
    expect(r.windowsVerbatimArguments).toBe(true);
  });
});
