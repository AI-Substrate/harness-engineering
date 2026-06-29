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
 * Plan 040 Phase 2 (Tasks 2.1–2.2 + P2-fix) — the read-only `harness flow orient`
 * verb: in ONE command an agent at `nav.now` sees the rail, the current node's
 * label/command/full `instructions[]` text (the one place instruction text IS
 * shown), and the chores anchored here each with a status pip (`■`/`▨`/`□`/`▣`).
 * D6: orient uses `listChores` (ALL statuses) NOT `dueChores`, so the COMPLETED
 * chore shows ticked. Real flow JSON, no mocks (repo convention).
 *
 * P2-fix: the DEFAULT (no flag) is the HUMAN text (D2 is for a weak model);
 * `--json` opts into the structured envelope. A SET-but-dangling `nav.now` (points
 * at a node not in `nodes[]`) is a corrupt flow → an error envelope (E305).
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

const FLOW_PATH = '/repo/.harness/flows/demo.json';

/**
 * A real flow doc with `nav.now` on a node that carries `instructions[]` + a
 * `command`, and four chores anchored here (via `branch_of`) in mixed statuses so
 * every pip is exercised: done (`■`), strongly-recommended-todo (`▣`),
 * recommended-todo (`□`), skipped (`▨`). Written verbatim — `readFlowDoc` does not
 * schema-validate, so the orient READ exercises the real read path.
 */
function seedDoc(navNow = 'plan'): unknown {
  return {
    schema_version: 1,
    kind: 'flight-plan',
    slug: 'demo',
    nav: { now: navNow, next: 'ship', intent: 'author the plan' },
    created_at: '2026-06-29T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.6.0',
      branch: 'main',
      repo: null,
      created_at: '2026-06-29T00:00:00.000Z',
      agent: 'demo-agent',
      plan_id: null,
    },
    events: [],
    nodes: [
      { id: 'research', type: 'research', label: 'Research', status: 'done', next: ['plan'] },
      {
        id: 'plan',
        type: 'plan',
        label: 'Author the plan',
        status: 'in_progress',
        next: ['ship'],
        command: '/plan',
        instructions: ['Read the brief end to end', 'Draft the section headers first'],
      },
      { id: 'ship', type: 'merge', label: 'Ship', status: 'known', next: [] },
      // chores anchored at `plan` (branch_of), mixed statuses → one of each pip:
      {
        id: 'lint',
        type: 'chore',
        label: 'Run the linter',
        status: 'done',
        next: [],
        branch_of: 'plan',
        command: '/lint',
        chore: { kind: 'command', importance: 'recommended' },
      },
      {
        id: 'review',
        type: 'chore',
        label: 'Peer review',
        status: 'known',
        next: [],
        branch_of: 'plan',
        command: '/review',
        chore: { kind: 'skill', importance: 'strongly-recommended' },
      },
      {
        id: 'docs',
        type: 'chore',
        label: 'Update docs',
        status: 'known',
        next: [],
        branch_of: 'plan',
        command: '/docs',
        chore: { kind: 'command', importance: 'recommended' },
      },
      {
        id: 'bench',
        type: 'chore',
        label: 'Benchmark',
        status: 'skipped',
        next: [],
        branch_of: 'plan',
        command: '/bench',
        chore: { kind: 'command', importance: 'optional' },
      },
    ],
  };
}

function seed(navNow = 'plan'): VerbActDeps {
  const fs = new FakeFs();
  fs.mkdirp('/repo/.harness/flows');
  fs.writeText(FLOW_PATH, JSON.stringify(seedDoc(navNow), null, 2));
  return fakeDeps(fs);
}

/** Run `harness flow …` in JSON mode; returns the parsed envelope + exit code. */
async function runJson(
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

/**
 * Run `harness flow …` in HUMAN mode; returns the raw stdout + exit code. The
 * orient success path is a verbatim passthrough (`emitRawAndExit`) — it sets
 * `process.exitCode` and returns NATURALLY (never `process.exit`), so `parseAsync`
 * resolves rather than throwing. Only ever drive the SUCCESS path through here (an
 * error path would call the real `process.exit` in human mode).
 */
async function runText(deps: VerbActDeps, argv: string[]): Promise<{ out: string; code: number }> {
  let out = '';
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'human', writers };
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  await buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]);
  const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
  process.exitCode = prevExitCode;
  return { out, code };
}

/**
 * Run `harness flow orient` with NO `--json` flag under an AMBIENT json-mode
 * `CliIo` — i.e. the piped / non-TTY invocation that is the EXACT context of the
 * original bug, where orient's default fell back to ambient `io.mode` and emitted
 * the envelope. Unlike `runText` (which pins `io.mode: 'human'` and so cannot see
 * that regression at all), this drives `io.mode: 'json'`. The CORRECT human path
 * returns naturally (`emitRawAndExit` sets `process.exitCode`, never calls
 * `process.exit`); a REGRESSED build would route through `emit` →
 * `exitWithEnvelope` → `process.exit`, so we stub `process.exit` to a no-op — that
 * keeps a regression from killing the runner while still letting its JSON write
 * land in `out`, so the not-`{` assertion bites red.
 */
async function runRawUnderJsonIo(deps: VerbActDeps, argv: string[]): Promise<{ out: string }> {
  let out = '';
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers }; // AMBIENT json — simulates piped / non-TTY
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  await buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]);
  vi.restoreAllMocks();
  process.exitCode = prevExitCode;
  return { out };
}

type OrientChore = {
  id: string;
  label: string;
  status: string;
  importance: string;
  pip: string;
};
type OrientData = {
  now: string | null;
  rail: string;
  node: { id: string; label: string; command: string | null; instructions: string[] } | null;
  chores: OrientChore[];
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('harness flow orient — the where-am-I / what-next read (plan 040 P2 / AC-03)', () => {
  it('--json emits rail + the nav.now node (label/command/instructions) + chores-with-pips', async () => {
    const r = await runJson(seed(), ['flow', 'orient', '--slug', 'demo', '--json']);
    expect(r.code).toBe(0);
    expect(r.env.status).toBe('ok');
    const data = r.env.data as unknown as OrientData;

    expect(data.now).toBe('plan');
    // the rail is REUSED (renderRailLine): titled by provenance.agent, names the spine.
    expect(data.rail).toContain('[demo-agent]');
    expect(data.rail).toContain('Author the plan');

    // the current node, with its full instructions[] text verbatim.
    expect(data.node).not.toBeNull();
    expect(data.node?.id).toBe('plan');
    expect(data.node?.label).toBe('Author the plan');
    expect(data.node?.command).toBe('/plan');
    expect(data.node?.instructions).toEqual([
      'Read the brief end to end',
      'Draft the section headers first',
    ]);
  });

  it('maps each anchored chore to its status pip (■ done · ▣ strong-todo · □ todo · ▨ skipped)', async () => {
    const r = await runJson(seed(), ['flow', 'orient', '--slug', 'demo', '--json']);
    const chores = (r.env.data as unknown as OrientData).chores;
    const pip = (id: string) => chores.find((c) => c.id === id)?.pip;
    expect(pip('lint')).toBe('■'); // done
    expect(pip('review')).toBe('▣'); // strongly-recommended + outstanding
    expect(pip('docs')).toBe('□'); // recommended + outstanding
    expect(pip('bench')).toBe('▨'); // skipped
  });

  it('AC-03/D6 — uses listChores (ALL statuses), so the DONE and SKIPPED chores still show', async () => {
    const r = await runJson(seed(), ['flow', 'orient', '--slug', 'demo', '--json']);
    const chores = (r.env.data as unknown as OrientData).chores;
    // dueChores would have dropped lint(done) + bench(skipped); orient keeps all four.
    expect(chores.map((c) => c.id).sort()).toEqual(['bench', 'docs', 'lint', 'review']);
  });

  it('P2-fix FIX 1 — DEFAULT (no flag) is the human text: rail, command, instruction TEXT verbatim', async () => {
    const r = await runText(seed(), ['flow', 'orient', '--slug', 'demo']);
    expect(r.code).toBe(0);
    // the default is the human block, NOT the JSON envelope (the whole point of D2).
    expect(r.out.trimStart().startsWith('{')).toBe(false);
    expect(r.out).toContain('[demo-agent]'); // the rail line
    expect(r.out).toContain('/plan'); // the node command
    // instruction text IS shown here (verbatim) — orient is the surface that prints it.
    expect(r.out).toContain('Read the brief end to end');
    expect(r.out).toContain('Draft the section headers first');
    // chores rendered with their pips + labels.
    expect(r.out).toContain('■ Run the linter');
    expect(r.out).toContain('▣ Peer review');
    expect(r.out).toContain('▨ Benchmark');
  });

  it('P2-fix2 FIX A — DEFAULT (no flag) stays human EVEN under ambient io.mode=json (piped/non-TTY)', async () => {
    // The ORIGINAL bug: with no flag, orient fell back to the ambient io.mode, so a
    // piped / non-TTY caller (io.mode=json) got the JSON envelope — defeating D2. The
    // prior default-human test uses `runText`, which pins io.mode=human and so cannot
    // see that regression. Here io.mode is json and there is STILL no --json flag, so
    // the output must remain the raw human block — never the envelope.
    const r = await runRawUnderJsonIo(seed(), ['flow', 'orient', '--slug', 'demo']);
    // not the JSON envelope (a regression to ambient io.mode would print one here).
    expect(r.out.trimStart().startsWith('{')).toBe(false);
    expect(r.out).not.toContain('"status"'); // belt-and-braces: no envelope key leaked
    // it is the human block — rail, command, instruction TEXT verbatim, a chore pip.
    expect(r.out).toContain('[demo-agent]');
    expect(r.out).toContain('/plan');
    expect(r.out).toContain('Read the brief end to end');
    expect(r.out).toContain('■ Run the linter');
  });

  it('degrades gracefully — a node with no instructions/chores still prints rail + node', async () => {
    const r = await runJson(seed('ship'), ['flow', 'orient', '--slug', 'demo', '--json']);
    expect(r.code).toBe(0);
    const data = r.env.data as unknown as OrientData;
    expect(data.now).toBe('ship');
    expect(data.node?.id).toBe('ship');
    expect(data.node?.instructions).toEqual([]);
    expect(data.chores).toEqual([]);
    expect(data.rail).toContain('[demo-agent]');
  });

  it('a missing flow path → E301 FLOW_NOT_FOUND (read-only; nothing is written)', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const r = await runJson(fakeDeps(fs), ['flow', 'orient', '--slug', 'ghost', '--json']);
    expect(r.code).toBe(1);
    expect(r.env.status).toBe('error');
    expect(r.env.error?.code).toBe('E301');
  });

  it('P2-fix FIX 2 — a SET-but-dangling nav.now (no matching node) → E305 error, not ok+node:null', async () => {
    // nav.now = "ghost" but nodes[] has no such node: a corrupt/inconsistent flow.
    const r = await runJson(seed('ghost'), ['flow', 'orient', '--slug', 'demo', '--json']);
    expect(r.code).toBe(1);
    expect(r.env.status).toBe('error');
    expect(r.env.error?.code).toBe('E305'); // FLOW_NODE_INVALID — the missing-NODE case
    expect(r.env.error?.message).toContain('ghost');
  });
});
