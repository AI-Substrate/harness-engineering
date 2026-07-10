import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram, quietFlag } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * 057 Phase 1 · T004/T005 (AC-02/AC-03) — flow-local `--quiet`.
 *
 * Every flow MUTATION verb echoes the same 7-field `summary()` data block per
 * call (~230B of near-duplicate JSON per call in a create/nav/meta sequence —
 * dossier F-02/F-04). `--quiet` suppresses that echo down to `{path}` on
 * mutation envelopes ONLY: default output stays byte-identical, read verbs
 * (`show`) keep their full summary, and non-flow commands are untouched (D1 —
 * never a CLI-wide renderer change).
 *
 * Named mutations: `quiet-leaks-summary` (full data despite --quiet) ⇒ RED;
 * `quiet-contaminates-default` (data slimmed without the flag) ⇒ RED.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-06-18T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runFlow(
  deps: VerbActDeps,
  argv: string[],
  quiet?: boolean,
): Promise<{ env: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers, ...(quiet !== undefined ? { quiet } : {}) };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { env: JSON.parse(out.trim()) as Envelope, code };
}

/** A minimal valid flow doc on disk via the real create verb (built-in harness-loop type). */
async function createdFlow(deps: VerbActDeps): Promise<void> {
  await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'q']);
}
const MUTATE = ['flow', 'status', '--slug', 'q', '--node', 'boot', '--to', 'in_progress'];

describe('057 T004 — quietFlag tri-state argv read', () => {
  it('reads --quiet as true and absence as undefined (env/TTY may decide later)', () => {
    expect(quietFlag(['node', 'harness', 'flow', 'status', '--quiet'])).toBe(true);
    expect(quietFlag(['node', 'harness', 'flow', 'status'])).toBeUndefined();
  });
});

describe('057 T004 — mutation envelopes under --quiet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppresses the 7-field summary down to {path} on a mutation (quiet io)', async () => {
    const fs = new FakeFs({}, {});
    const deps = fakeDeps(fs);
    await createdFlow(deps);
    const { env, code } = await runFlow(deps, MUTATE, true);
    expect(code).toBe(0);
    expect(env.status).toBe('ok');
    // MUTATION quiet-leaks-summary: slug/now/node_count still present ⇒ RED.
    expect(Object.keys(env.data as object).sort()).toEqual(['path']);
  });

  it('default (no quiet) mutation envelope keeps the full frozen summary shape', async () => {
    const fs = new FakeFs({}, {});
    const deps = fakeDeps(fs);
    await createdFlow(deps);
    const { env } = await runFlow(deps, MUTATE);
    // MUTATION quiet-contaminates-default: any key missing ⇒ RED.
    expect(Object.keys(env.data as object).sort()).toEqual([
      'event_count',
      'kind',
      'next',
      'node_count',
      'now',
      'path',
      'slug',
    ]);
  });

  it('read verbs are untouched: flow show keeps its full summary even under quiet io', async () => {
    const fs = new FakeFs({}, {});
    const deps = fakeDeps(fs);
    await createdFlow(deps);
    const { env } = await runFlow(deps, ['flow', 'show', '--slug', 'q'], true);
    expect(env.status).toBe('ok');
    expect(Object.keys(env.data as object)).toContain('node_count');
    expect(Object.keys(env.data as object)).toContain('slug');
  });

  it('accepts --quiet on the real argv without commander rejection (global option)', async () => {
    const fs = new FakeFs({}, {});
    const deps = fakeDeps(fs);
    await createdFlow(deps);
    const { env, code } = await runFlow(deps, [
      'flow',
      'status',
      '--quiet',
      '--slug',
      'q',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);
    // The entrypoint resolves quiet from argv into io; acts consume io.quiet.
    // Here io.quiet was NOT set (undefined) so the act itself must not re-derive
    // from argv — commander merely tolerates the flag. Full summary expected.
    expect(code).toBe(0);
    expect(Object.keys(env.data as object)).toContain('node_count');
  });
});

describe('057 T004 — non-flow commands are untouched by quiet io (AC-03)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('harness instructions emits its normal data envelope under quiet io', async () => {
    const fs = new FakeFs({}, {});
    const deps = fakeDeps(fs);
    let out = '';
    const writers: Writers = {
      out: (t) => {
        out += t;
      },
      err: () => {},
    };
    const io: CliIo = { mode: 'json', writers, quiet: true };
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      throw new Error(`exit:${c ?? 0}`);
    }) as never);
    await expect(
      buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', 'instructions']),
    ).rejects.toThrow(/^exit:/);
    vi.restoreAllMocks();
    const env = JSON.parse(out.trim()) as Envelope;
    expect(env.status).toBe('ok');
    // The instructions data payload is not slimmed — quiet is flow-mutation-local.
    expect(Object.keys(env.data as object).length).toBeGreaterThan(1);
  });
});
