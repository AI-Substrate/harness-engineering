import { describe, expect, it } from 'vitest';
import type {
  ExtensionExport,
  ExtensionRecord,
  HarnessVerb,
  VerbContext,
  VerbResult,
} from '../../../src/services/extensions/contract.js';

/**
 * Type-level conformance for the public verb contract. The real assurance is
 * `tsc --noEmit` (run in CI / `just fft`): if the example objects below stop
 * conforming, the build fails. The runtime assertions just keep the example
 * exercised so it can't silently rot.
 */
describe('verb contract', () => {
  it('an example HarnessVerb conforms and runs against a ctx', async () => {
    /*
    Test Doc:
    - Why: authors import these types directly; a copyable, conforming example is the contract's
      proof it is usable as published (plan AC-11, KF-02).
    - Contract: a HarnessVerb declares name/summary/options and a run(ctx) returning a VerbResult
      built via the ctx envelope helpers; the core owns command/timestamp/exit.
    - Usage Notes: this mirrors the shipped examples/extensions/hello.ts (T027).
    - Quality Contribution: the example is type-checked + executed, so contract drift breaks the build.
    - Worked Example: hello.run(ctx) → { status:'ok', data:{greeting:'hello, world'} }.
    */
    const hello: HarnessVerb = {
      name: 'hello',
      summary: 'Say hello (example extension).',
      options: [{ flags: '--name <name>', description: 'who to greet', defaultValue: 'world' }],
      run(ctx) {
        return ctx.ok(
          { greeting: `hello, ${ctx.options.name ?? 'world'}` },
          { next_action: 'Edit .harness/extensions/hello.ts to customise.' },
        );
      },
    };

    const result = await hello.run(makeStubContext({ name: 'world' }));
    expect(result.status).toBe('ok');
    expect((result.data as { greeting: string }).greeting).toBe('hello, world');
  });

  it('a default export may be a single verb or an array', () => {
    const single: ExtensionExport = { name: 'a', summary: 's', run: () => ({ status: 'ok' }) };
    const many: ExtensionExport = [
      { name: 'a', summary: 's', run: () => ({ status: 'ok' }) },
      { name: 'b', summary: 's', run: () => ({ status: 'ok' }) },
    ];
    expect(Array.isArray(many)).toBe(true);
    expect(Array.isArray(single)).toBe(false);
  });

  it('an ExtensionRecord captures load status + verbs for doctor', () => {
    const record: ExtensionRecord = {
      entryPath: '/repo/.harness/extensions/hello.ts',
      status: 'loaded',
      verbs: [{ name: 'hello', summary: 's', run: () => ({ status: 'ok' }) }],
    };
    expect(record.status).toBe('loaded');
    expect(record.verbs).toHaveLength(1);
  });
});

/** Minimal stub ctx so the conformance example can execute. */
function makeStubContext(options: Record<string, unknown>): VerbContext {
  return {
    cwd: '/repo',
    args: {},
    options,
    exec: () => Promise.resolve({ code: 0, stdout: '', stderr: '', ok: true }),
    fs: { exists: () => false, readText: () => null, readdir: () => [] },
    env: { get: () => undefined },
    git: { isRepo: () => false, currentBranch: () => null },
    clock: { nowIso: () => '2026-06-08T00:00:00.000Z' },
    ok: (data, opts): VerbResult => ({ status: 'ok', data, ...(opts ?? {}) }),
    degraded: (data, next_action, opts): VerbResult => ({
      status: 'degraded',
      data,
      next_action,
      ...(opts ?? {}),
    }),
    unconfigured: (next_action, opts): VerbResult => ({
      status: 'unconfigured',
      next_action,
      ...(opts ?? {}),
    }),
    error: (code, message, opts): VerbResult => ({
      status: 'error',
      error: { code, message, ...(opts?.details !== undefined && { details: opts.details }) },
      next_action: opts?.next_action ?? message,
    }),
  };
}
