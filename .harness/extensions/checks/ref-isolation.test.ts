import { describe, expect, it } from 'vitest';
import checks from './extension.js';

/**
 * `checks --ref` exists to remove a hazard, so these tests are about the hazard,
 * not the happy path (#145).
 *
 * The verb replaces `git stash` as the way to measure against another ref. That
 * only holds if it NEVER runs a gate in the caller's tree — the gates write
 * tracked files, so a `--ref` that changed what was measured while still running
 * here would remove the stash and keep the mutation. The central test therefore
 * asserts a NEGATIVE: no command other than the two read-only git calls is ever
 * executed with the caller's cwd.
 */
const CALLER = '/repo';

interface Call {
  cmd: string;
  args: string[];
  cwd: string;
}

function makeCtx(opts: {
  options?: Record<string, unknown>;
  exec?: (c: Call) => { code: number; stdout: string; stderr: string };
}) {
  const calls: Call[] = [];
  const ctx = {
    cwd: CALLER,
    options: opts.options ?? {},
    fs: { exists: () => true },
    fsWrite: { mkdtemp: () => '/tmp/iso' },
    env: { get: () => undefined },
    exec: async (cmd: string, args: string[], o: { cwd: string }) => {
      const call = { cmd, args, cwd: o.cwd };
      calls.push(call);
      const r = opts.exec?.(call) ?? { code: 0, stdout: '', stderr: '' };
      return { ...r, ok: r.code === 0 };
    },
    ok: (data: unknown, extra: unknown) => ({ status: 'ok', data, extra }),
    degraded: (data: unknown, msg: string) => ({ status: 'degraded', data, msg }),
    error: (code: string, message: string, extra: unknown) => ({ status: 'error', code, message, extra }),
    unconfigured: (msg: string) => ({ status: 'unconfigured', msg }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled test double for the verb context
  return { ctx: ctx as any, calls };
}

/** The gate commands — anything that builds, lints, tests or regenerates. */
const isGateWork = (c: Call) =>
  !(c.cmd === 'git' && (c.args[0] === 'rev-parse' || c.args[0] === 'worktree'));

const okEnvelope = JSON.stringify({ status: 'ok', data: { durationMs: 1, summary: 's', gates: [] } });

describe('checks --ref', () => {
  it('never runs gate work in the caller tree — the whole guarantee', async () => {
    const { ctx, calls } = makeCtx({
      options: { ref: 'abc' },
      exec: (c) => ({ code: 0, stdout: c.args.includes('rev-parse') ? 'deadbeef\n' : okEnvelope, stderr: '' }),
    });
    await checks.run(ctx);

    // Everything that does real work must have run in the isolated tree.
    const inCallerTree = calls.filter((c) => c.cwd === CALLER && isGateWork(c));
    expect(
      inCallerTree,
      `These ran in the caller's tree and must not have: ${JSON.stringify(inCallerTree)}`,
    ).toEqual([]);
    expect(calls.some((c) => c.cwd === '/tmp/iso' && c.args.includes('ci'))).toBe(true);
    expect(calls.some((c) => c.cwd === '/tmp/iso' && c.args.includes('checks'))).toBe(true);
  });

  it('installs its own dependencies rather than sharing them', async () => {
    // Measured: vitest writes node_modules/.vite/vitest/<hash>/results.json, so a
    // shared/symlinked node_modules would leak writes into the caller's checkout.
    const { ctx, calls } = makeCtx({
      options: { ref: 'abc' },
      exec: (c) => ({ code: 0, stdout: c.args.includes('rev-parse') ? 'deadbeef\n' : okEnvelope, stderr: '' }),
    });
    await checks.run(ctx);
    expect(calls.some((c) => c.cmd === 'npm' && c.args[0] === 'ci' && c.cwd === '/tmp/iso')).toBe(true);
    expect(calls.some((c) => c.args.some((a) => /symlink|--prefer-offline-shared/.test(a)))).toBe(false);
  });

  it('removes the worktree even when the isolated gate fails', async () => {
    // A stale worktree is the failure mode this design accepts in exchange for
    // killing the silent one — it only stays benign if cleanup is unconditional.
    const { ctx, calls } = makeCtx({
      options: { ref: 'abc' },
      exec: (c) => {
        if (c.args.includes('rev-parse')) return { code: 0, stdout: 'deadbeef\n', stderr: '' };
        if (c.args.includes('checks')) return { code: 1, stdout: 'not json', stderr: 'boom' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    await checks.run(ctx);
    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true);
  });

  it('--keep leaves the worktree for inspection', async () => {
    const { ctx, calls } = makeCtx({
      options: { ref: 'abc', keep: true },
      exec: (c) => ({ code: 0, stdout: c.args.includes('rev-parse') ? 'deadbeef\n' : okEnvelope, stderr: '' }),
    });
    await checks.run(ctx);
    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(false);
  });

  it('rejects a bad ref before creating anything', async () => {
    const { ctx, calls } = makeCtx({
      options: { ref: 'nope' },
      exec: () => ({ code: 128, stdout: '', stderr: 'fatal: Needed a single revision' }),
    });
    const r = (await checks.run(ctx)) as unknown as { status: string; code: string };
    expect(r.status).toBe('error');
    expect(r.code).toBe('E_CHECKS_BAD_REF');
    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'add')).toBe(false);
  });

  it('pins the verdict to a resolved sha, not the moving name', async () => {
    // A result attributed to `main` is not reproducible once main moves.
    const { ctx } = makeCtx({
      options: { ref: 'main' },
      exec: (c) => ({ code: 0, stdout: c.args.includes('rev-parse') ? 'cafebabe1234\n' : okEnvelope, stderr: '' }),
    });
    const r = (await checks.run(ctx)) as unknown as { data: { ref: string; sha: string; isolated: boolean } };
    expect(r.data.ref).toBe('main');
    expect(r.data.sha).toBe('cafebabe1234');
    expect(r.data.isolated).toBe(true);
  });
});
