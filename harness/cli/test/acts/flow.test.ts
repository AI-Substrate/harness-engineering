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

  it('add-node --zone persists the rail band (zone round-trips into the flow JSON)', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const r = await runFlow(deps, [
      'flow', 'add-node', '--slug', 'demo', '--id', 'z', '--type', 'improve',
      '--label', 'Z', '--next', '', '--zone', 'postflight',
    ]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(deps.fs.readText('/repo/.harness/flows/demo.json') as string);
    expect(doc.nodes.find((n: { id: string }) => n.id === 'z').zone).toBe('postflight');
  });
});

describe('harness flow nav — show / set / meta act envelopes (T005/T006)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seed(slug = 'demo', bare = false): Promise<VerbActDeps> {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    const argv = ['flow', 'create', 'harness-loop', '--slug', slug];
    if (bare) argv.push('--bare');
    await runFlow(deps, argv);
    return deps;
  }

  it('nav set --now moves position; nav show reflects it + the now-node neighbours', async () => {
    const deps = await seed();
    const set = await runFlow(deps, [
      'flow', 'nav', 'set', '--slug', 'demo', '--now', 'backpressure', '--intent', 'survey',
    ]);
    expect(set.code).toBe(0);
    expect((set.env.data as { now: string }).now).toBe('backpressure');

    const show = await runFlow(deps, ['flow', 'nav', 'show', '--slug', 'demo']);
    expect(show.code).toBe(0);
    const d = show.env.data as {
      nav: { now: string; next: string | null; intent?: string };
      predecessors: { id: string }[];
      successors: { id: string }[];
    };
    expect(d.nav.now).toBe('backpressure');
    expect(d.nav.intent).toBe('survey');
    expect(d.predecessors.map((n) => n.id)).toEqual(['boot']);
    expect(d.successors.map((n) => n.id)).toEqual(['observe']);
  });

  it('nav set --next then --clear-next sets and clears the advisory next', async () => {
    const deps = await seed();
    await runFlow(deps, ['flow', 'nav', 'set', '--slug', 'demo', '--next', 'observe']);
    let show = await runFlow(deps, ['flow', 'nav', 'show', '--slug', 'demo']);
    expect((show.env.data as { nav: { next: string | null } }).nav.next).toBe('observe');
    await runFlow(deps, ['flow', 'nav', 'set', '--slug', 'demo', '--clear-next']);
    show = await runFlow(deps, ['flow', 'nav', 'show', '--slug', 'demo']);
    expect((show.env.data as { nav: { next: string | null } }).nav.next).toBeNull();
  });

  it('nav set --now on a missing node → E305; nav set with no flags → E108', async () => {
    const deps = await seed();
    const e305 = await runFlow(deps, ['flow', 'nav', 'set', '--slug', 'demo', '--now', 'ghost']);
    expect(e305.code).toBe(1);
    expect(e305.env.error?.code).toBe(ErrorCodes.FLOW_NODE_INVALID);
    const e108 = await runFlow(deps, ['flow', 'nav', 'set', '--slug', 'demo']);
    expect(e108.code).toBe(1);
    expect(e108.env.error?.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  it('nav meta set shallow-merges; nav meta get reads one key + the whole bag', async () => {
    const deps = await seed();
    await runFlow(deps, ['flow', 'nav', 'meta', 'set', 'replan_reason', 'draft', '--slug', 'demo']);
    await runFlow(deps, ['flow', 'nav', 'meta', 'set', 'attempts', '2', '--slug', 'demo']);
    const one = await runFlow(deps, ['flow', 'nav', 'meta', 'get', 'replan_reason', '--slug', 'demo']);
    expect((one.env.data as { value: unknown }).value).toBe('draft');
    const all = await runFlow(deps, ['flow', 'nav', 'meta', 'get', '--slug', 'demo']);
    expect((all.env.data as { bag: Record<string, unknown> }).bag).toEqual({
      replan_reason: 'draft',
      attempts: '2',
    });
  });

  it('nav show on a bare (nav-less) flow returns nav:null, not an error (graceful)', async () => {
    const deps = await seed('bare', true);
    const show = await runFlow(deps, ['flow', 'nav', 'show', '--slug', 'bare']);
    expect(show.code).toBe(0);
    expect((show.env.data as { nav: unknown }).nav).toBeNull();
  });
});
