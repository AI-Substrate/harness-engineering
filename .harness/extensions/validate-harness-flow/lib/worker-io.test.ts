import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../../harness/cli/src/adapters/fs/fake-fs.js';
import { captureNewRun, copyInto, writeFile } from './worker-io.ts';

/*
Test Doc:
- Why: plan 031 AC-02 — when the post-fire poll can't observe a NEW minih run id,
  the verb must still finish (degraded), not hang. The poll now sleeps via
  ctx.clock.sleep (fakeable) instead of `ctx.exec('sleep')`, so the timeout path
  is deterministic on ubuntu. This pins captureNewRun's two outcomes + writeFile
  going through ctx.fsWrite (no shell).
- Contract: captureNewRun returns null after the full poll cap when no id newer
  than `before` appears (sleeping via ctx.clock each iteration); it returns the
  run as soon as a fresh id shows. writeFile delegates to ctx.fsWrite.writeText.
*/

interface FakeCtx {
  exec: (cmd: string, args: string[]) => Promise<{ code: number; ok: boolean; stdout: string; stderr: string }>;
  clock: { sleep: (ms: number) => Promise<void> };
  fsWrite?: { writeText: (p: string, c: string) => void };
  sleeps: number[];
}

function ctxReturning(stdout: string): FakeCtx {
  const sleeps: number[] = [];
  return {
    exec: () => Promise.resolve({ code: 0, ok: true, stdout, stderr: '' }),
    clock: { sleep: (ms: number) => { sleeps.push(ms); return Promise.resolve(); } },
    sleeps,
  };
}

describe('captureNewRun (plan 031 AC-02 — portable poll wait)', () => {
  it('returns null after the full poll cap when no new run id ever appears, sleeping via ctx.clock', async () => {
    const ctx = ctxReturning('{"data":{"runId":"SAME"}}');
    // `before` === the id minih keeps returning ⇒ never "new" ⇒ times out.
    const result = await captureNewRun(ctx as never, 'slug', 'SAME');
    expect(result).toBeNull();
    expect(ctx.sleeps).toHaveLength(12); // polled the full cap via ctx.clock.sleep (instant in the fake)
    expect(ctx.sleeps.every((ms) => ms === 300)).toBe(true);
  });

  it('returns the new run as soon as a fresh id appears', async () => {
    const ctx = ctxReturning('{"data":{"runId":"NEW","runDir":"/runs/NEW"}}');
    const result = await captureNewRun(ctx as never, 'slug', 'OLD');
    expect(result).toEqual({ runId: 'NEW', runDir: '/runs/NEW' });
    expect(ctx.sleeps).toHaveLength(0); // found on the first poll — no wait
  });
});

describe('writeFile (plan 031 — portable write, no shell)', () => {
  it('writes via ctx.fsWrite.writeText and reports success', async () => {
    const written: Array<{ path: string; contents: string }> = [];
    const ctx = {
      fsWrite: { writeText: (path: string, contents: string) => written.push({ path, contents }) },
    };
    const ok = await writeFile(ctx as never, '/out/manifest.json', '{"x":1}');
    expect(ok).toBe(true);
    expect(written).toEqual([{ path: '/out/manifest.json', contents: '{"x":1}' }]);
  });

  it('reports failure when no write port is present (older core)', async () => {
    const ok = await writeFile({} as never, '/out/x', 'y');
    expect(ok).toBe(false);
  });
});

describe('copyInto (plan 031 — CWE-59 confine forwarding, F002)', () => {
  it('forwards {confineRoot} to ctx.fsWrite.copy on the clone-artifact path', async () => {
    const fs = new FakeFs({ '/clone/.harness/reports/latest.json': 'X' });
    const ok = await copyInto(
      { fsWrite: fs } as never,
      '/clone/.harness/reports/latest.json',
      '/out',
      '/clone',
    );
    expect(ok).toBe(true);
    expect(fs.copies).toEqual([
      { src: '/clone/.harness/reports/latest.json', destDir: '/out', confineRoot: '/clone' },
    ]);
  });

  it('passes NO confineRoot when omitted (the trusted worker-report path)', async () => {
    const fs = new FakeFs({ '/run/report.json': 'X' });
    await copyInto({ fsWrite: fs } as never, '/run/report.json', '/out');
    expect(fs.copies).toEqual([{ src: '/run/report.json', destDir: '/out' }]);
  });

  it('REFUSES an escaping source under a confineRoot (modeled CWE-59 refusal)', async () => {
    const fs = new FakeFs({ '/clone/.harness/reports/latest.json': 'SECRET' });
    fs.confineEscapes.add('/clone/.harness/reports/latest.json'); // model a symlink that escapes
    const ok = await copyInto(
      { fsWrite: fs } as never,
      '/clone/.harness/reports/latest.json',
      '/out',
      '/clone',
    );
    expect(ok).toBe(false);
    expect(fs.exists('/out/latest.json')).toBe(false);
  });
});
