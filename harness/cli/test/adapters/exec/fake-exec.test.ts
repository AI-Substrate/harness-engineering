import { describe, expect, it } from 'vitest';
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

  it('defaults an unscripted command to a benign success (absent is not an error)', async () => {
    const exec = new FakeExec();
    const result = await exec.run('echo', ['hi'], { cwd: '/repo' });
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
  });
});

describe('NodeExec', () => {
  it('runs a real command and reflects success (code 0 → ok)', async () => {
    const exec = new NodeExec();
    const result = await exec.run('node', ['-e', 'process.stdout.write("hi")'], {
      cwd: process.cwd(),
    });
    expect(result.code).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('hi');
  });

  it('reflects a non-zero exit as a failure (ok=false)', async () => {
    const exec = new NodeExec();
    const result = await exec.run('node', ['-e', 'process.exit(3)'], { cwd: process.cwd() });
    expect(result.code).toBe(3);
    expect(result.ok).toBe(false);
  });

  it('resolves (never rejects) when spawn throws synchronously, e.g. a null byte (code 127)', async () => {
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
    const result = await exec.run('node\u0000bad', [], { cwd: process.cwd() });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(127);
  });
});
