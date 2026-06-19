import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeBackground } from '../../../src/adapters/exec/node-background.js';

// Mock the real side effects so the adapter is fully unit-testable on ubuntu:
// node:child_process.spawn (assert the spawn spec/options) and node:fs
// openSync/closeSync (the log fd lifecycle — write/close nothing real).
// windows-command.ts's own existsSync stays real (importOriginal) — the
// explicit-`.cmd` case never probes the fs.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  openSync: vi.fn(),
  closeSync: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);
const openSyncMock = vi.mocked(openSync);
const closeSyncMock = vi.mocked(closeSync);

function fakeChild(pid: number | undefined) {
  return { pid, unref: vi.fn() } as unknown as ReturnType<typeof spawn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  openSyncMock.mockReturnValue(7 as never);
  spawnMock.mockReturnValue(fakeChild(4242));
});

describe('NodeBackground.spawnDetached (plan 031 T002 — workshop 001 §C2)', () => {
  it('win32: a .cmd target is launched via cmd.exe with windowsVerbatimArguments — never a bare .cmd (I1/I2)', () => {
    /*
    Test Doc:
    - Why: a bare `.cmd` spawn with shell:false EINVALs on patched Node (≥20.12.2);
      the only injection-safe route is cmd.exe /d /s /c + verbatim. This proves the
      adapter reuses the REAL resolveSpawn (platform-injected) and passes the spec +
      verbatim flag straight through to spawn — the load-bearing F19 correction.
    - Contract: spawn('cmd.exe', ['/d','/s','/c', <line>], {detached, stdio:[ignore,fd,fd],
      windowsHide, windowsVerbatimArguments:true}); the log fd is openSync(logPath,'a');
      child.unref() is called; the returned pid is the child's.
    - Runs on ubuntu: resolveSpawn's win32 branch is driven by the injected platform,
      not the host (P3 — pass the parameter, never patch process.platform).
    */
    const child = fakeChild(4242);
    spawnMock.mockReturnValue(child);
    const bg = new NodeBackground('win32');

    const { pid } = bg.spawnDetached({
      command: 'C:/npm/minih.cmd',
      args: ['run', 'a b'],
      cwd: 'C:/repo',
      logPath: 'C:/repo/run.log',
    });

    expect(openSyncMock).toHaveBeenCalledWith('C:/repo/run.log', 'a');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('cmd.exe'); // NEVER the bare .cmd (would EINVAL)
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(options).toMatchObject({
      cwd: 'C:/repo',
      detached: true,
      stdio: ['ignore', 7, 7], // the same openSync fd for stdout + stderr (I3)
      windowsHide: true,
      windowsVerbatimArguments: true, // I2 — passed THROUGH from the resolver
    });
    expect(child.unref).toHaveBeenCalledTimes(1); // I4
    expect(pid).toBe(4242); // I5
    expect(closeSyncMock).toHaveBeenCalledWith(7); // F004 — parent closes its fd copy
  });

  it('non-windows: the command is spawned as-is with windowsVerbatimArguments false', () => {
    const bg = new NodeBackground('linux');
    bg.spawnDetached({
      command: 'minih',
      args: ['run', 'slug'],
      cwd: '/repo',
      logPath: '/repo/run.log',
    });
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('minih');
    expect(args).toEqual(['run', 'slug']);
    expect(options).toMatchObject({
      cwd: '/repo',
      detached: true,
      stdio: ['ignore', 7, 7],
      windowsVerbatimArguments: false, // the `?? false` default — no verbatim off-Windows
    });
  });

  it('inherits the parent env when env is omitted, and overrides it when provided', () => {
    const bg = new NodeBackground('linux');

    bg.spawnDetached({ command: 'minih', args: [], cwd: '/repo', logPath: '/repo/a.log' });
    // No `env` key ⇒ spawn inherits process.env (the worker needs the operator's PATH/tokens).
    expect(spawnMock.mock.calls[0][2]).not.toHaveProperty('env');

    const env = { GH_TOKEN: 'x', PATH: '/usr/bin' };
    bg.spawnDetached({ command: 'minih', args: [], cwd: '/repo', logPath: '/repo/b.log', env });
    expect(spawnMock.mock.calls[1][2]).toMatchObject({ env });
  });

  it('throws when the spawn yields no pid (I5 — caller maps it to an honest envelope)', () => {
    spawnMock.mockReturnValue(fakeChild(undefined));
    const bg = new NodeBackground('linux');
    expect(() =>
      bg.spawnDetached({ command: 'minih', args: [], cwd: '/repo', logPath: '/repo/run.log' }),
    ).toThrow(/no pid/);
    // F004: the log fd is still closed on the throw path (finally).
    expect(closeSyncMock).toHaveBeenCalledWith(7);
  });

  it('forwards env to the resolver too, so a win32 PATH lookup uses the child env (F005)', () => {
    // A bare command on win32 makes resolveSpawn consult env.PATH/PATHEXT. With an
    // empty PATH the name resolves to nothing and passes through unchanged — which
    // proves the adapter handed OUR env (not process.env) to the resolver: a real
    // PATH entry on the host must NOT leak in.
    const bg = new NodeBackground('win32');
    bg.spawnDetached({
      command: 'definitely-not-on-path',
      args: ['x'],
      cwd: 'C:/repo',
      logPath: 'C:/repo/run.log',
      env: { PATH: '', PATHEXT: '.EXE' },
    });
    expect(spawnMock.mock.calls[0][0]).toBe('definitely-not-on-path'); // unresolved → raw passthrough
  });
});
