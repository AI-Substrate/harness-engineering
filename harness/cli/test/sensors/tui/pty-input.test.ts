import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SHARED_DIST_ENTRY = join(REPO_ROOT, 'harness/cli/dist/index.js');

function sharedDistFingerprint(): string {
  if (!existsSync(SHARED_DIST_ENTRY)) return 'absent';
  const stats = statSync(SHARED_DIST_ENTRY, { bigint: true });
  return `${stats.size}:${stats.mtimeNs}`;
}

const sharedDistBeforePtySuite = sharedDistFingerprint();
const PYTHON_PTY = String.raw`
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

ROOT = Path(sys.argv[1])
NODE = Path(sys.argv[2])
BUILD = Path(sys.argv[3])
MODE = sys.argv[4]
WRAPPED = sys.argv[5] == 'wrapped'
BOOT = MODE == 'boot'
ENTER = b'\x1b[?1049h'
LEAVE = b'\x1b[?1049l'
FRAME_TOKEN = b'watcher'
WRAPPER_MARKER = b'HARNESS_WRAPPER_EXITED:0'
QUIT_ACK = b'q again to stop sensors'
RUN_ALL_ACK = b'Add a v2'


def drain(master, output, deadline):
    while time.monotonic() < deadline:
        readable, _, _ = select.select([master], [], [], 0.02)
        if not readable:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                return
            raise
        if not chunk:
            return
        output.extend(chunk)


def wait_for(master, output, predicate, deadline):
    while not predicate() and time.monotonic() < deadline:
        drain(master, output, min(deadline, time.monotonic() + 0.05))
    return predicate()


with tempfile.TemporaryDirectory(prefix='harness-pty-input-') as work:
    work_path = Path(work)
    bin_dir = work_path / 'node_modules' / '.bin'
    bin_dir.mkdir(parents=True)
    local_bin = bin_dir / 'harness'
    local_target = work_path / 'harness.mjs'
    local_target.write_text(
        '#!/usr/bin/env node\nimport ' + json.dumps((BUILD / 'index.js').as_uri()) + ';\n',
        encoding='utf-8',
    )
    local_target.chmod(0o755)
    local_bin.symlink_to(local_target)

    master, slave = pty.openpty()
    rows, columns = (40, 140) if BOOT else (30, 120)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
    before = termios.tcgetattr(slave)
    if BOOT:
        direct = [str(NODE), str(BUILD / 'index.js'), 'sensors']
        child_cwd = ROOT
    else:
        direct = [str(local_bin), '--no-extensions', 'sensors']
        child_cwd = work_path
    if WRAPPED:
        command = (
            'node_modules/.bin/harness --no-extensions sensors; '
            'code=$?; echo; echo HARNESS_WRAPPER_EXITED:$code; sleep 300'
        )
        args = ['zsh', '-c', command]
    else:
        args = direct

    child = subprocess.Popen(
        args,
        cwd=child_cwd,
        env={**os.environ, 'TERM': 'xterm-256color', 'HARNESS_NO_TELEMETRY': '1'},
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
        start_new_session=True,
    )
    output = bytearray()
    ready = wait_for(
        master,
        output,
        lambda: ENTER in output and FRAME_TOKEN in output,
        time.monotonic() + 10,
    )

    raw_engaged = False
    raw_deadline = time.monotonic() + 8
    while not raw_engaged and time.monotonic() < raw_deadline:
        current = termios.tcgetattr(slave)
        raw_engaged = not (current[3] & termios.ICANON) and not (current[3] & termios.ECHO)
        if not raw_engaged:
            drain(master, output, min(raw_deadline, time.monotonic() + 0.02))

    boot_output = bytes(output)
    alt_enter_index = boot_output.find(ENTER)
    frame_token_index = boot_output.find(FRAME_TOKEN)

    quit_ack = None
    action_observed = None
    if BOOT:
        os.write(master, b'w')
    elif MODE == 'q':
        os.write(master, b'q')
        quit_ack = wait_for(master, output, lambda: QUIT_ACK in output, time.monotonic() + 2)
        os.write(master, b'q')
    elif MODE == 'run-all':
        os.write(master, b'a')
        action_observed = wait_for(
            master,
            output,
            lambda: RUN_ALL_ACK in output,
            time.monotonic() + 2,
        )
        os.write(master, b'w')
    else:
        os.write(master, b'\x03')

    if WRAPPED:
        exited = wait_for(
            master,
            output,
            lambda: WRAPPER_MARKER in output,
            time.monotonic() + 8,
        )
        exit_code = 0 if exited else None
    else:
        wait_for(master, output, lambda: child.poll() is not None, time.monotonic() + 8)
        exited = child.poll() is not None
        exit_code = child.poll()

    drain(master, output, time.monotonic() + 0.2)
    after = termios.tcgetattr(slave)
    result = {
        'launch': 'wrapped' if WRAPPED else 'direct',
        'input': MODE,
        'ready': ready,
        'rawEngaged': raw_engaged,
        'quitAcknowledged': quit_ack,
        'actionObserved': action_observed,
        'exited': exited,
        'exit': exit_code,
        'altEnter': ENTER in output,
        'altLeave': LEAVE in output,
        'altEnterIndex': alt_enter_index,
        'frameTokenIndex': frame_token_index,
        'termiosRestored': before == after,
    }

    if child.poll() is None:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    child.wait(timeout=5)
    termios.tcsetattr(slave, termios.TCSANOW, before)
    os.close(master)
    os.close(slave)
    print(json.dumps(result, sort_keys=True))
`;

const ptyToolsAvailable =
  process.platform !== 'win32' &&
  spawnSync('python3', ['-c', 'import pty, termios']).status === 0 &&
  spawnSync('zsh', ['--version']).status === 0;
const describePty = ptyToolsAvailable ? describe : describe.skip;
let ptyBuildDir = '';

describePty('real PTY sensor input exits', () => {
  beforeAll(() => {
    const tempRoot = join(REPO_ROOT, '.harness/temp');
    mkdirSync(tempRoot, { recursive: true });
    ptyBuildDir = mkdtempSync(join(tempRoot, 'pty-build-'));
    const tsc = spawnSync(
      process.execPath,
      [
        join(REPO_ROOT, 'node_modules/typescript/bin/tsc'),
        '-p',
        'harness/cli/tsconfig.json',
        '--outDir',
        ptyBuildDir,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(tsc.status, `${tsc.stdout}\n${tsc.stderr}`).toBe(0);
  }, 30_000);

  afterAll(() => {
    if (ptyBuildDir !== '') rmSync(ptyBuildDir, { force: true, recursive: true });
  });

  it('does not rewrite the shared CLI dist used by concurrent flow checks', () => {
    expect(sharedDistFingerprint()).toBe(sharedDistBeforePtySuite);
  });

  it('paints the initial frame after alternate-screen entry without boot input', () => {
    const run = spawnSync(
      'python3',
      ['-c', PYTHON_PTY, REPO_ROOT, process.execPath, ptyBuildDir, 'boot', 'direct'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    expect(result).toMatchObject({
      launch: 'direct',
      input: 'boot',
      ready: true,
      rawEngaged: true,
      exited: true,
      exit: 0,
      altEnter: true,
      altLeave: true,
      termiosRestored: true,
    });
    expect(Number(result.frameTokenIndex)).toBeGreaterThan(Number(result.altEnterIndex));
  }, 25_000);

  it.each([
    { launch: 'direct', input: 'q' },
    { launch: 'direct', input: 'ctrl-c' },
    { launch: 'direct', input: 'run-all' },
    { launch: 'wrapped', input: 'q' },
    { launch: 'wrapped', input: 'ctrl-c' },
  ] as const)('$launch launch exits cleanly from real $input bytes', ({ launch, input }) => {
    const run = spawnSync(
      'python3',
      ['-c', PYTHON_PTY, REPO_ROOT, process.execPath, ptyBuildDir, input, launch],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    expect(result).toMatchObject({
      launch,
      input,
      ready: true,
      rawEngaged: true,
      ...(input === 'q' ? { quitAcknowledged: true } : { quitAcknowledged: null }),
      ...(input === 'run-all' ? { actionObserved: true } : { actionObserved: null }),
      exited: true,
      exit: 0,
      altEnter: true,
      altLeave: true,
      termiosRestored: true,
    });
  }, 25_000);
});
