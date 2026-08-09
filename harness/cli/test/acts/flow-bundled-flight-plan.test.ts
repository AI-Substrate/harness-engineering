import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * Plan 081 (flow reachability), phase 1 — `flight-plan` is a BUNDLED flow type.
 *
 * Ruling (2026-08-09, supersedes plan 024 grill 6/7 "skill-owned, --schema only"):
 * pij workteam verbs mint the flow at dispatch and cannot depend on the builder
 * skill's install layout, so the bare invocation — no --schema, no --template,
 * no skill on disk — must work: "pij can rely on harness". The builder skill
 * stays the single SOURCE (gen-flows bundles from skills/builder/references);
 * check:flows guards the copy against drift.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-09T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runFlow(
  deps: VerbActDeps,
  argv: string[],
): Promise<{ env: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
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

describe('bundled flight-plan flow type (plan 081 phase 1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bare create — no --schema, no --template, no builder skill on disk — succeeds', async () => {
    const fs = new FakeFs({ '/repo/.git/HEAD': 'ref' });
    const deps = fakeDeps(fs);
    const { env, code } = await runFlow(deps, [
      'flow',
      'create',
      'flight-plan',
      '--slug',
      'reach-check',
      '--path',
      '/repo/docs/plans/900-reach-check/the-flow.json',
      '--plan-dir',
      'docs/plans/900-reach-check',
    ]);
    expect(env.status).toBe('ok');
    expect(code).toBe(0);
    const data = env.data as { node_count: number; kind: string };
    expect(data.kind).toBe('flight-plan');
    // The full 11-node seed travels with the bundle, not just the overlay.
    expect(data.node_count).toBe(11);
  });

  it('the created flow reads back through a flow read verb (rail)', async () => {
    const fs = new FakeFs({ '/repo/.git/HEAD': 'ref' });
    const deps = fakeDeps(fs);
    await runFlow(deps, [
      'flow',
      'create',
      'flight-plan',
      '--slug',
      'reach-check',
      '--path',
      '/repo/docs/plans/900-reach-check/the-flow.json',
      '--plan-dir',
      'docs/plans/900-reach-check',
    ]);
    const { env, code } = await runFlow(deps, [
      'flow',
      'rail',
      '--path',
      '/repo/docs/plans/900-reach-check/the-flow.json',
    ]);
    expect(env.status).toBe('ok');
    expect(code).toBe(0);
    expect((env.data as { rail: string }).rail).toContain('Research');
  });

  it('E304 for a genuinely unknown type now names flight-plan among the bundled types', async () => {
    const fs = new FakeFs({ '/repo/.git/HEAD': 'ref' });
    const deps = fakeDeps(fs);
    const { env, code } = await runFlow(deps, [
      'flow',
      'create',
      'no-such-type',
      '--slug',
      'x',
      '--path',
      '/repo/f.json',
    ]);
    expect(env.status).toBe('error');
    expect(code).toBe(1);
    expect(env.next_action).toContain('flight-plan');
  });
});
