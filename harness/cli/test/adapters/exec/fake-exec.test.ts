import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeExec } from '../../../src/adapters/exec/fake-exec.js';
import { NodeExec } from '../../../src/adapters/exec/node-exec.js';

describe('FakeExec', () => {
  it('given_scripted_command_when_run_then_returns_result_computes_ok_records_call', async () => {
    /*
    Test Doc:
    - Why: verbs wrap REAL repo commands (P8) via ctx.exec; the loader/verb tests must drive
      that seam with zero real process spawn (WS-A Decision 3, plan AC-4/AC-9).
    - Contract: FakeExec.run returns the scripted {code,stdout,stderr}, sets ok = code===0,
      and records {command,args,cwd} on calls[] (fakes over mocks).
    - Usage Notes: seed `{ 'npm run build': { code, stdout?, stderr? } }` keyed by full command line.
    - Quality Contribution: pins the exec seam every P8-wrapping verb relies on.
    - Worked Example: new FakeExec({'npm run build':{code:0}}).run('npm',['run','build'],{cwd:'/r'}).
    */
    const exec = new FakeExec({
      'npm run build': { code: 0, stdout: 'built\n' },
      'npm run lint': { code: 1, stderr: 'lint failed\n' },
    });

    const okResult = await exec.run('npm', ['run', 'build'], { cwd: '/repo' });
    expect(okResult).toEqual({ code: 0, stdout: 'built\n', stderr: '', ok: true });

    const failResult = await exec.run('npm', ['run', 'lint'], { cwd: '/repo' });
    expect(failResult.code).toBe(1);
    expect(failResult.ok).toBe(false);
    expect(failResult.stderr).toBe('lint failed\n');

    expect(exec.calls).toEqual([
      { command: 'npm', args: ['run', 'build'], cwd: '/repo' },
      { command: 'npm', args: ['run', 'lint'], cwd: '/repo' },
    ]);
  });

  it('preserves scripted raw bytes in base64 and decodes them only for text callers', async () => {
    const exec = new FakeExec({
      binary: {
        code: 2,
        stdout: 'must not replace the bytes',
        stdoutBytes: Uint8Array.from([7, 0xff, 0, 0x61, 7]).subarray(1, 4),
        stderr: 'diagnostic',
      },
    });

    expect(await exec.run('binary', [], { cwd: '/repo', stdoutEncoding: 'base64' })).toEqual({
      code: 2,
      stdout: '/wBh',
      stdoutEncoding: 'base64',
      stderr: 'diagnostic',
      ok: false,
    });
    expect(await exec.run('binary', [], { cwd: '/repo' })).toEqual({
      code: 2,
      stdout: '\ufffd\u0000a',
      stderr: 'diagnostic',
      ok: false,
    });
    expect(exec.calls).toEqual([
      { command: 'binary', args: [], cwd: '/repo', stdoutEncoding: 'base64' },
      { command: 'binary', args: [], cwd: '/repo' },
    ]);
  });

  it('encodes existing text scripts and empty unscripted output only on request', async () => {
    const exec = new FakeExec({ echo: { code: 0, stdout: 'hé\u0000' } });
    expect(await exec.run('echo', [], { cwd: '/repo', stdoutEncoding: 'utf8' })).toEqual({
      code: 0,
      stdout: 'hé\u0000',
      stderr: '',
      ok: true,
    });
    expect(await exec.run('echo', [], { cwd: '/repo', stdoutEncoding: 'base64' })).toEqual({
      code: 0,
      stdout: 'aMOpAA==',
      stdoutEncoding: 'base64',
      stderr: '',
      ok: true,
    });
    expect(await exec.run('absent', [], { cwd: '/repo', stdoutEncoding: 'base64' })).toEqual({
      code: 0,
      stdout: '',
      stdoutEncoding: 'base64',
      stderr: '',
      ok: true,
    });
  });

  it('kills a scripted hung child at the timeout using the fake clock', async () => {
    const clock = new FakeClock('2026-07-14T00:00:00.000Z');
    const exec = new FakeExec({ 'sleep forever': { code: 0, hang: true } }, clock);
    const result = await exec.run('sleep', ['forever'], {
      cwd: '/repo',
      timeoutMs: 250,
      env: { HARNESS_TEST_TOKEN: 'visible' },
    });

    expect(result).toMatchObject({ code: 124, ok: false });
    expect(result.stderr).toContain('SIGKILL');
    expect(clock.sleeps).toEqual([250]);
    expect(exec.kills).toEqual([
      { command: 'sleep', args: ['forever'], signal: 'SIGKILL', timeoutMs: 250 },
    ]);
    expect(exec.calls[0]).toMatchObject({
      timeoutMs: 250,
      env: { HARNESS_TEST_TOKEN: 'visible' },
    });
  });

  it('retains encoded partial stdout and textual diagnostics on a scripted timeout', async () => {
    const clock = new FakeClock('2026-07-14T00:00:00.000Z');
    const exec = new FakeExec(
      { binary: { code: 0, stdoutBytes: Buffer.from([0xff, 0]), stderr: 'waiting', hang: true } },
      clock,
    );
    const result = await exec.run('binary', [], {
      cwd: '/repo',
      timeoutMs: 250,
      stdoutEncoding: 'base64',
    });
    expect(result).toMatchObject({
      code: 124,
      ok: false,
      stdout: '/wA=',
      stdoutEncoding: 'base64',
    });
    expect(result.stderr).toMatch(/^waiting\n.*SIGKILL/);
  });

  it('defaults an unscripted command to a benign success (absent is not an error)', async () => {
    const exec = new FakeExec();
    const result = await exec.run('echo', ['hi'], { cwd: '/repo' });
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
  });
});

describe('NodeExec', () => {
  it.each([
    undefined,
    'utf8',
  ] as const)('keeps the text result shape for encoding %s', async (stdoutEncoding) => {
    const exec = new NodeExec();
    const result = await exec.run(process.execPath, ['-e', 'process.stdout.write("hé\\u0000")'], {
      cwd: process.cwd(),
      ...(stdoutEncoding !== undefined && { stdoutEncoding }),
    });
    expect(result).toEqual({ code: 0, ok: true, stdout: 'hé\u0000', stderr: '' });
  });

  it('captures invalid UTF-8 and NUL across non-three-byte writes without encoding chunks separately', async () => {
    const exec = new NodeExec();
    const result = await exec.run(
      process.execPath,
      [
        '-e',
        `
          const chunks = [[0xff], [0, 0xc3], [0xa9, 0x80, 0, 0x61]];
          let index = 0;
          function next() {
            process.stdout.write(Buffer.from(chunks[index++]), () => {
              if (index < chunks.length) setTimeout(next, 25);
            });
          }
          process.stderr.write('text diagnostic');
          next();
        `,
      ],
      { cwd: process.cwd(), stdoutEncoding: 'base64' },
    );
    expect(result).toEqual({
      code: 0,
      ok: true,
      stdout: '/wDDqYAAYQ==',
      stdoutEncoding: 'base64',
      stderr: 'text diagnostic',
    });
  });

  it('overlays environment values for the child', async () => {
    const exec = new NodeExec();
    const result = await exec.run(
      'node',
      ['-e', 'process.stdout.write(process.env.HARNESS_EXEC_OVERLAY ?? "missing")'],
      { cwd: process.cwd(), env: { HARNESS_EXEC_OVERLAY: 'present' } },
    );
    expect(result).toMatchObject({ code: 0, ok: true, stdout: 'present' });
  });

  it('kills a real hung child at the deadline and returns 124', async () => {
    const exec = new NodeExec();
    const result = await exec.run('node', ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      timeoutMs: 100,
    });
    expect(result).toMatchObject({ code: 124, ok: false });
    expect(result.stderr).toContain('SIGKILL');
  });

  it('marks a real deadline failure as an encoded capture without depending on child startup', async () => {
    const exec = new NodeExec();
    const result = await exec.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      timeoutMs: 100,
      stdoutEncoding: 'base64',
    });
    expect(result).toMatchObject({
      code: 124,
      ok: false,
      stdout: '',
      stdoutEncoding: 'base64',
    });
    expect(result.stderr).toContain('SIGKILL');
  });

  it('retains byte-safe output and diagnostics on a non-zero exit', async () => {
    const exec = new NodeExec();
    const result = await exec.run(
      process.execPath,
      [
        '-e',
        'process.stdout.write(Buffer.from([0xff, 0, 0x61])); process.stderr.write("failed"); process.exitCode = 3',
      ],
      { cwd: process.cwd(), stdoutEncoding: 'base64' },
    );
    expect(result).toEqual({
      code: 3,
      ok: false,
      stdout: '/wBh',
      stdoutEncoding: 'base64',
      stderr: 'failed',
    });
  });

  it('marks empty byte-safe stdout when the executable cannot be spawned', async () => {
    const exec = new NodeExec();
    const result = await exec.run(`${process.execPath}.missing-exec-test`, [], {
      cwd: process.cwd(),
      stdoutEncoding: 'base64',
    });
    expect(result).toMatchObject({
      code: 127,
      ok: false,
      stdout: '',
      stdoutEncoding: 'base64',
    });
    expect(result.stderr).toContain('ENOENT');
  });

  it.each([
    undefined,
    'base64',
  ] as const)('resolves a synchronous spawn error with encoding %s (code 127)', async (stdoutEncoding) => {
    /*
      Test Doc:
      - Why: spawn() can throw SYNCHRONOUSLY (e.g. ERR_INVALID_ARG_VALUE for a null byte in the
        command) inside the Promise executor, which would REJECT despite the never-reject contract
        verb handlers rely on (F001).
      - Contract: a synchronous spawn throw resolves to an ExecResult (code 127, ok=false), never rejects.
      - Quality Contribution: pins the never-reject guarantee against the sync-throw edge.
      - Worked Example: run('node\\u0000bad', []) → resolves { code: 127, ok: false }.
      */
    const exec = new NodeExec();
    const result = await exec.run('node\u0000bad', [], {
      cwd: process.cwd(),
      ...(stdoutEncoding !== undefined && { stdoutEncoding }),
    });
    expect(result).toMatchObject({ code: 127, ok: false, stdout: '' });
    expect(result.stdoutEncoding).toBe(stdoutEncoding);
    expect(result.stderr).not.toBe('');
  });
});
