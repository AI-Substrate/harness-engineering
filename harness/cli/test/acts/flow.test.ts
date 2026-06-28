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

  it('a RELATIVE --path is accepted on create AND on the read path (rail) — no spurious E303', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);

    // create with an explicit relative in-repo --path (the exact default location)
    const created = await runFlow(deps, [
      'flow',
      'create',
      'harness-loop',
      '--slug',
      'demo',
      '--path',
      '.harness/flows/demo.json',
    ]);
    expect(created.code).toBe(0);
    expect((created.env.data as { path: string }).path).toBe('/repo/.harness/flows/demo.json');

    // read it back via a relative --path on the rail verb (previously → E303)
    const rail = await runFlow(deps, [
      'flow',
      'rail',
      '--path',
      '.harness/flows/demo.json',
      '--chores',
      'show',
    ]);
    expect(rail.code).toBe(0);
    expect(rail.env.status).toBe('ok');
  });

  it('a relative ../ escape on --path is still refused → E303', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    const res = await runFlow(deps, [
      'flow',
      'create',
      'harness-loop',
      '--slug',
      'demo',
      '--path',
      '../escape.json',
    ]);
    expect(res.code).toBe(1);
    expect(res.env.error?.code).toBe(ErrorCodes.FLOW_PATH_ESCAPE);
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
      'flow',
      'add-node',
      '--slug',
      'demo',
      '--id',
      'z',
      '--type',
      'improve',
      '--label',
      'Z',
      '--next',
      '',
      '--zone',
      'postflight',
    ]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(deps.fs.readText('/repo/.harness/flows/demo.json') as string);
    expect(doc.nodes.find((n: { id: string }) => n.id === 'z').zone).toBe('postflight');
  });

  it('add-node --zone with an invalid band → E108 and the file is UNCHANGED (companion MED)', async () => {
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
      'z',
      '--type',
      'improve',
      '--label',
      'Z',
      '--zone',
      'bogus',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(fs.readText('/repo/.harness/flows/demo.json')).toBe(before);
  });

  it('comment accepts --message as an alias for --text (the text actually lands)', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);

    const viaAlias = await runFlow(deps, [
      'flow',
      'comment',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--message',
      'landed-via-alias',
    ]);
    expect(viaAlias.code).toBe(0);
    expect(viaAlias.env.status).toBe('ok');

    // non-vacuous: the aliased value must reach the persisted comment, not just parse
    const doc = JSON.parse(fs.readText('/repo/.harness/flows/demo.json')) as {
      nodes: { id: string; comments?: { text: string }[] }[];
    };
    const boot = doc.nodes.find((n) => n.id === 'boot');
    expect(boot?.comments?.some((c) => c.text === 'landed-via-alias')).toBe(true);
  });

  it('comment with neither --text nor --message → E108 naming the alias (not the bare commander error)', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);

    const missing = await runFlow(deps, ['flow', 'comment', '--slug', 'demo', '--node', 'boot']);
    expect(missing.code).toBe(1);
    expect(missing.env.error?.code).toBe(ErrorCodes.INVALID_ARGS);
    // the contextual message must connect the user to the alias
    expect(missing.env.error?.message).toContain('--message');
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
      'flow',
      'nav',
      'set',
      '--slug',
      'demo',
      '--now',
      'backpressure',
      '--intent',
      'survey',
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
    const one = await runFlow(deps, [
      'flow',
      'nav',
      'meta',
      'get',
      'replan_reason',
      '--slug',
      'demo',
    ]);
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

describe('harness flow act — chore + command surface (Phase 4 T005/T006)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedDemo(): Promise<VerbActDeps> {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    return deps;
  }

  function nodeById(deps: VerbActDeps, id: string): Record<string, unknown> | undefined {
    const doc = JSON.parse(deps.fs.readText('/repo/.harness/flows/demo.json') as string) as {
      nodes: Record<string, unknown>[];
    };
    return doc.nodes.find((n) => n.id === id);
  }

  it('insert-node --command persists node.command (closes the ws-003 §I2 gap)', async () => {
    const deps = await seedDemo();
    const r = await runFlow(deps, [
      'flow',
      'insert-node',
      '--slug',
      'demo',
      '--id',
      'val',
      '--type',
      'backpressure',
      '--label',
      'Validate',
      '--after',
      'boot',
      '--command',
      '/validate-v2',
    ]);
    expect(r.code).toBe(0);
    expect(nodeById(deps, 'val')?.command).toBe('/validate-v2');
  });

  it('add-node --command persists node.command', async () => {
    const deps = await seedDemo();
    const r = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'demo',
      '--id',
      'c',
      '--type',
      'improve',
      '--label',
      'C',
      '--next',
      '',
      '--command',
      '/compact',
    ]);
    expect(r.code).toBe(0);
    expect(nodeById(deps, 'c')?.command).toBe('/compact');
  });

  it('insert-node --chore-kind/--importance assembles the nested chore object', async () => {
    const deps = await seedDemo();
    const r = await runFlow(deps, [
      'flow',
      'insert-node',
      '--slug',
      'demo',
      '--id',
      'val',
      '--type',
      'backpressure',
      '--label',
      'Validate',
      '--after',
      'boot',
      '--command',
      '/validate-v2',
      '--chore-kind',
      'command',
      '--importance',
      'strongly-recommended',
    ]);
    expect(r.code).toBe(0);
    expect(nodeById(deps, 'val')?.chore).toEqual({
      kind: 'command',
      importance: 'strongly-recommended',
    });
  });

  it('a bad --chore-kind → E108 pre-write and the file is UNCHANGED', async () => {
    const deps = await seedDemo();
    const before = deps.fs.readText('/repo/.harness/flows/demo.json');
    const bad = await runFlow(deps, [
      'flow',
      'insert-node',
      '--slug',
      'demo',
      '--id',
      'val',
      '--type',
      'backpressure',
      '--label',
      'Validate',
      '--after',
      'boot',
      '--chore-kind',
      'bogus',
      '--importance',
      'recommended',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(deps.fs.readText('/repo/.harness/flows/demo.json')).toBe(before);
  });

  it('"required" is rejected as an importance (advisory invariant)', async () => {
    const deps = await seedDemo();
    const bad = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'demo',
      '--id',
      'c',
      '--type',
      'improve',
      '--label',
      'C',
      '--next',
      '',
      '--chore-kind',
      'skill',
      '--importance',
      'required',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  async function seedWithChore(): Promise<VerbActDeps> {
    const deps = await seedDemo();
    await runFlow(deps, [
      'flow',
      'insert-node',
      '--slug',
      'demo',
      '--id',
      'val',
      '--type',
      'backpressure',
      '--label',
      'Validate',
      '--after',
      'boot',
      '--command',
      '/validate-v2',
      '--chore-kind',
      'command',
      '--importance',
      'recommended',
    ]);
    return deps;
  }
  const railOf = (env: Envelope) => (env.data as { rail: string }).rail;
  /** The rail's name-lane body, with the 039 AC-11 `⚑ due:` cursor callout stripped — the
   *  `--chores` mode governs the NAME LANE; the due callout is an unconditional separate surface. */
  const bodyOf = (rail: string) => rail.split('  ⚑ due:')[0];

  it('rail --chores show renders the chore name; default collapse hides it behind [*]', async () => {
    const deps = await seedWithChore();
    const shown = await runFlow(deps, ['flow', 'rail', '--slug', 'demo', '--chores', 'show']);
    expect(shown.code).toBe(0);
    expect(railOf(shown.env)).toContain('Validate');

    const collapsed = await runFlow(deps, ['flow', 'rail', '--slug', 'demo']); // default
    expect(bodyOf(railOf(collapsed.env))).toContain('[*]');
    expect(bodyOf(railOf(collapsed.env))).not.toContain('Validate'); // name lane collapses it
    // 039 AC-11: a chore due at the cursor is still surfaced in the ⚑ due: callout.
    expect(railOf(collapsed.env)).toContain('⚑ due: Validate');
  });

  it('rail --chores hide drops the name AND the [*] marker but keeps the square pip', async () => {
    const deps = await seedWithChore();
    const hidden = await runFlow(deps, ['flow', 'rail', '--slug', 'demo', '--chores', 'hide']);
    expect(hidden.code).toBe(0);
    expect(bodyOf(railOf(hidden.env))).not.toContain('Validate'); // name lane drops it
    expect(bodyOf(railOf(hidden.env))).not.toContain('[*]');
    expect(railOf(hidden.env)).toContain('□');
    // 039 AC-11: the cursor's due chore still surfaces in the ⚑ due: callout.
    expect(railOf(hidden.env)).toContain('⚑ due: Validate');
  });

  it('rail --chores with an invalid mode → E108', async () => {
    const deps = await seedWithChore();
    const bad = await runFlow(deps, ['flow', 'rail', '--slug', 'demo', '--chores', 'bogus']);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.INVALID_ARGS);
  });

  type ChoreRow = {
    id: string;
    kind: string;
    importance: string;
    status: string;
    anchor: string | null;
    command: string | null;
    runnable: boolean;
  };

  it('chores lists chore nodes (kind/importance/status/anchor/ref); builtin is not runnable', async () => {
    const deps = await seedWithChore(); // inserts 'val' (command/recommended) after boot
    await runFlow(deps, [
      'flow',
      'insert-node',
      '--slug',
      'demo',
      '--id',
      'cmp',
      '--type',
      'improve',
      '--label',
      'Compact',
      '--after',
      'val',
      '--command',
      '/compact',
      '--chore-kind',
      'builtin',
      '--importance',
      'optional',
    ]);
    const r = await runFlow(deps, ['flow', 'chores', '--slug', 'demo']);
    expect(r.code).toBe(0);
    const chores = (r.env.data as { chores: ChoreRow[] }).chores;
    expect(chores.map((c) => c.id).sort()).toEqual(['cmp', 'val']);

    const val = chores.find((c) => c.id === 'val') as ChoreRow;
    expect(val.kind).toBe('command');
    expect(val.importance).toBe('recommended');
    expect(val.command).toBe('/validate-v2');
    expect(val.anchor).toBe('boot');
    expect(val.runnable).toBe(true);

    const cmp = chores.find((c) => c.id === 'cmp') as ChoreRow;
    expect(cmp.kind).toBe('builtin');
    expect(cmp.anchor).toBe('val');
    expect(cmp.runnable).toBe(false); // builtin — the agent can't run it
  });

  it('chores on a flow with no chores → empty list, exit 0', async () => {
    const deps = await seedDemo();
    const r = await runFlow(deps, ['flow', 'chores', '--slug', 'demo']);
    expect(r.code).toBe(0);
    expect((r.env.data as { chores: ChoreRow[] }).chores).toEqual([]);
  });

  it('set-node --command sets the command ref on an EXISTING node (companion MED fix)', async () => {
    const deps = await seedDemo();
    const r = await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--command',
      '/eng-harness-flow --hook session-start',
    ]);
    expect(r.code).toBe(0);
    expect(nodeById(deps, 'boot')?.command).toBe('/eng-harness-flow --hook session-start');
  });
});

describe('harness flow act — dangling-edge guard runs regardless of schema resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Bundled (in-repo-resolvable) flow: the mechanical E305 guard now fires BEFORE
  // the post-mutation schema check (which would also catch the dangling ref as E300).
  it('add-node --next <ghost> on a bundled flow → E305, file UNCHANGED', async () => {
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
      'improve',
      '--label',
      'X',
      '--next',
      'ghost',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.FLOW_NODE_INVALID);
    expect(fs.readText('/repo/.harness/flows/demo.json')).toBe(before);
  });

  // The the-flow case: a flow created from an OUT-OF-REPO --schema. Mutations
  // can't re-resolve the overlay, so the act's post-mutation validateFlowDoc is
  // tolerantly SKIPPED — before the fix a dangling --next was written silently.
  // The mechanical guard now rejects it even on this skip path.
  async function seedOutOfRepoSchemaFlow(): Promise<VerbActDeps> {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    fs.mkdirp('/external');
    fs.writeText(
      '/external/flight-plan.schema.json',
      JSON.stringify({
        kind: 'flight-plan',
        extends: 'flow-core',
        schema_version: 1,
        statuses: ['known', 'in_progress', 'done', 'blocked'],
        nodeTypes: ['research', 'plan', 'phase', 'review', 'merge'],
      }),
    );
    const deps = fakeDeps(fs);
    // create resolves the overlay via --schema (flag source); later mutations cannot.
    const created = await runFlow(deps, [
      'flow',
      'create',
      'flight-plan',
      '--slug',
      'fp',
      '--schema',
      '/external/flight-plan.schema.json',
      '--bare',
    ]);
    expect(created.code).toBe(0);
    // one real node to point at (and to prove the skip path writes normally)
    const seed = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'fp',
      '--id',
      'p1',
      '--type',
      'phase',
      '--label',
      'P1',
    ]);
    expect(seed.code).toBe(0);
    return deps;
  }

  it('add-node --next <ghost> on an out-of-repo-schema flow → E305 (gap closed), file UNCHANGED', async () => {
    const deps = await seedOutOfRepoSchemaFlow();
    const before = deps.fs.readText('/repo/.harness/flows/fp.json');
    const bad = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'fp',
      '--id',
      'p2',
      '--type',
      'phase',
      '--label',
      'P2',
      '--next',
      'ghost',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.env.error?.code).toBe(ErrorCodes.FLOW_NODE_INVALID);
    expect(deps.fs.readText('/repo/.harness/flows/fp.json')).toBe(before);
  });

  it('add-node --next <existing> on an out-of-repo-schema flow still succeeds (skip path writes normally)', async () => {
    const deps = await seedOutOfRepoSchemaFlow();
    const ok = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'fp',
      '--id',
      'p2',
      '--type',
      'phase',
      '--label',
      'P2',
      '--next',
      'p1',
    ]);
    expect(ok.code).toBe(0);
    const doc = JSON.parse(deps.fs.readText('/repo/.harness/flows/fp.json') as string);
    expect(doc.nodes.find((n: { id: string }) => n.id === 'p2').next).toEqual(['p1']);
  });
});

describe('harness flow set-node — instructions[] flags + full round-trip (plan 040 P1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const FLOW = '/repo/.harness/flows/demo.json';

  async function seed(): Promise<VerbActDeps> {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    return deps;
  }

  function instructionsOf(deps: VerbActDeps, id: string): unknown {
    const doc = JSON.parse(deps.fs.readText(FLOW) as string) as {
      nodes: { id: string; instructions?: string[] }[];
    };
    return doc.nodes.find((n) => n.id === id)?.instructions;
  }

  it('--instructions "a||b" REPLACES the node list (split on ||)', async () => {
    const deps = await seed();
    const r = await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--instructions',
      'read nav||run orient',
    ]);
    expect(r.code).toBe(0);
    expect(instructionsOf(deps, 'boot')).toEqual(['read nav', 'run orient']);
  });

  it('--add-instruction APPENDS to the existing list', async () => {
    const deps = await seed();
    await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--instructions',
      'first',
    ]);
    const r = await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--add-instruction',
      'second',
    ]);
    expect(r.code).toBe(0);
    expect(instructionsOf(deps, 'boot')).toEqual(['first', 'second']);
  });

  it('--add-instruction on a node with no instructions seeds a one-item list', async () => {
    const deps = await seed();
    const r = await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--add-instruction',
      'only',
    ]);
    expect(r.code).toBe(0);
    expect(instructionsOf(deps, 'boot')).toEqual(['only']);
  });

  it('--clear-instructions EMPTIES the list', async () => {
    const deps = await seed();
    await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--instructions',
      'a||b',
    ]);
    const r = await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--clear-instructions',
    ]);
    expect(r.code).toBe(0);
    expect(instructionsOf(deps, 'boot')).toEqual([]);
  });

  it('AC-01 — instructions survive a create → apply → set-node → render round-trip', async () => {
    const deps = await seed();
    // apply: upsert instructions onto an existing node via the transactional batch
    deps.fs.writeText(
      '/repo/ops.json',
      JSON.stringify([{ op: 'upsert', id: 'boot', instructions: ['boot the harness'] }]),
    );
    const applied = await runFlow(deps, [
      'flow',
      'apply',
      '--slug',
      'demo',
      '--ops',
      '/repo/ops.json',
    ]);
    expect(applied.code).toBe(0);
    expect(instructionsOf(deps, 'boot')).toEqual(['boot the harness']);
    // set-node: append a runtime-authored instruction
    const set = await runFlow(deps, [
      'flow',
      'set-node',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--add-instruction',
      'then observe',
    ]);
    expect(set.code).toBe(0);
    expect(instructionsOf(deps, 'boot')).toEqual(['boot the harness', 'then observe']);
    // render: the field persists in the JSON; its TEXT never appears in the diagram
    // (AC-02 — the `📝N` badge lands in P3; here we only prove the text never leaks).
    const rendered = await runFlow(deps, ['flow', 'render', '--slug', 'demo']);
    expect(rendered.code).toBe(0);
    const md = (rendered.env.data as { rendered: string }).rendered;
    expect(md).not.toContain('boot the harness');
    expect(md).not.toContain('then observe');
    // render is read-only → the JSON still carries instructions afterwards
    expect(instructionsOf(deps, 'boot')).toEqual(['boot the harness', 'then observe']);
  });
});
