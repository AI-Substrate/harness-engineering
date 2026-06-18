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
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * T015 act-level — the `harness flow` Envelope + the post-mutation validation
 * gate (companion HIGH): a mutation that would violate the resolved overlay must
 * exit error (E300) and leave the persisted flow UNCHANGED.
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

describe('harness flow act — create + mutate + the post-mutation validation gate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create → status (valid) round-trips and exits 0', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    expect((await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo'])).code).toBe(
      0,
    );
    const status = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'done',
    ]);
    expect(status.code).toBe(0);
    expect(status.env.status).toBe('ok');
  });

  it('a status OUTSIDE the overlay vocabulary → E300 and the file is UNCHANGED', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const before = fs.readText('/repo/.harness/flows/demo.json');

    const bad = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'not-a-real-status',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.FLOW_SCHEMA_INVALID);

    // nothing written: the persisted flow is byte-identical to before the bad mutation
    expect(fs.readText('/repo/.harness/flows/demo.json')).toBe(before);
  });

  it('an add-node with a type NOT in the overlay → E300, file unchanged', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const before = fs.readText('/repo/.harness/flows/demo.json');
    const bad = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'demo',
      '--id',
      'x',
      '--type',
      'not-a-harness-loop-type',
      '--label',
      'X',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.FLOW_SCHEMA_INVALID);
    expect(fs.readText('/repo/.harness/flows/demo.json')).toBe(before);
  });

  it('a mutation on a missing node → E305', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const bad = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'ghost',
      '--to',
      'done',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.FLOW_NODE_INVALID);
  });
});
