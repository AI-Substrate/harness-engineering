import { describe, expect, it, vi } from 'vitest';
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
 * The dd gate at the ACT boundary (plan 065 P6 T003/T005) — `nav set --now`'s
 * refusal + `--force` envelope, and the `orient` gate block.
 *
 * Everything here runs on fakes, all the way down to the dd document loader and
 * schema resolver: the gate takes its filesystem from the injected `FsPort`, so a
 * whole `.dd` schema package and a target document can live in a `FakeFs`. The
 * matching real-CLI, real-disk proof is `test/integration/dd-flow-gate.int.test.ts` —
 * this file is the fast layer, that one is the honest one.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const FLOW_PATH = '/repo/.harness/flows/gate.json';
const DOC = 'docs/tasks.dd.json';

const SCHEMA = {
  dd_schema: 1,
  description: 'act-level gate fixture',
  sections: {
    tasks: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'state'],
          fields: { id: { type: 'string' }, state: { type: 'state' } },
        },
      },
    },
  },
};

function ddDoc(items: Array<{ id: string; state: string }>): string {
  return `${JSON.stringify(
    { dd: { schema: 'fixture/plan' }, sections: [{ name: 'tasks', value: items }], references: [] },
    null,
    2,
  )}\n`;
}

function flowDoc(link: Record<string, unknown> | undefined): unknown {
  return {
    schema_version: 1,
    kind: 'harness-loop',
    slug: 'gate',
    nav: { now: 'a', next: null },
    created_at: '2026-08-04T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.4.0',
      branch: 'main',
      repo: null,
      created_at: '2026-08-04T00:00:00.000Z',
      agent: 'gate-demo',
      plan_id: null,
    },
    events: [],
    nodes: [
      {
        id: 'a',
        type: 'boot',
        label: 'Phase A',
        status: 'in_progress',
        next: ['b'],
        ...(link !== undefined && { dd_link: link }),
      },
      { id: 'b', type: 'observe', label: 'Review', status: 'known', next: [] },
    ],
  };
}

function seed(
  items: Array<{ id: string; state: string }>,
  link: Record<string, unknown> | null = { address: `${DOC}#tasks` },
): VerbActDeps {
  const fs = new FakeFs();
  fs.mkdirp('/repo/.harness/flows');
  fs.mkdirp('/repo/.dd/schemas/fixture/plan');
  fs.mkdirp('/repo/docs');
  fs.writeText('/repo/.dd/schemas/fixture/plan/schema.json', JSON.stringify(SCHEMA, null, 2));
  fs.writeText(`/repo/${DOC}`, ddDoc(items));
  fs.writeText(FLOW_PATH, JSON.stringify(flowDoc(link ?? undefined), null, 2));
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-04T09:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

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

const NAV_SET = ['flow', 'nav', 'set', '--path', FLOW_PATH, '--now', 'b'];

describe('nav set --now — the gate refuses at the act boundary', () => {
  it('answers E440 with a non-zero exit and leaves the flow file untouched', async () => {
    const deps = seed([
      { id: 'dw-0001', state: 'checked' },
      { id: 'dw-0002', state: 'unchecked' },
    ]);
    const before = deps.fs.readText(FLOW_PATH);
    const { env, code } = await runJson(deps, NAV_SET);
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E440');
    expect(code).not.toBe(0);
    expect(deps.fs.readText(FLOW_PATH)).toBe(before);
  });

  it('lets a satisfied gate through as a clean ok, recording the reading', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'checked' }]);
    const { env, code } = await runJson(deps, NAV_SET);
    expect(env.status).toBe('ok');
    expect(code).toBe(0);
    const written = JSON.parse(deps.fs.readText(FLOW_PATH) ?? '{}');
    expect(written.nav.now).toBe('b');
    expect(written.nodes[0].dd_link.reading).toEqual({
      status: 'complete',
      terminal: 1,
      total: 1,
      incomplete: [],
      at: '2026-08-04T09:00:00.000Z',
    });
    expect(written.nodes[0].dd_link.basis_sha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('nav set --now --force — a defended override is never a clean ok', () => {
  it('succeeds as DEGRADED, carrying the etiquette line as next_action', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'unchecked' }]);
    const { env, code } = await runJson(deps, [...NAV_SET, '--force']);
    expect(env.status).toBe('degraded');
    expect(code).toBe(0);
    expect(env.next_action).toBe(
      "Record why departing was the human's decision — an agent may not force a dd gate on its own judgment (workshop-002). `human-skipped` or `na` on the individual items is the legitimate way a gate passes without the work.",
    );
  });

  it('puts the override on the event log where it can be answered for', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'unchecked' }]);
    await runJson(deps, [...NAV_SET, '--force']);
    const written = JSON.parse(deps.fs.readText(FLOW_PATH) ?? '{}');
    const override = written.events.find((e: { kind: string }) => e.kind === 'dd-gate-override');
    expect(override).toMatchObject({
      id: 'DDG-001',
      origin: 'manual',
      details: { node: 'a', to: 'b', incomplete: ['dw-0001'], terminal: 0, total: 1 },
    });
    expect(written.nav.now).toBe('b');
  });

  it('the override survives being combined with --intent in one command', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'unchecked' }]);
    const { env } = await runJson(deps, [...NAV_SET, '--force', '--intent', 'ship it']);
    expect(env.status).toBe('degraded');
    const written = JSON.parse(deps.fs.readText(FLOW_PATH) ?? '{}');
    expect(written.nav.intent).toBe('ship it');
    expect(written.events.some((e: { kind: string }) => e.kind === 'dd-gate-override')).toBe(true);
  });

  it('a flow with NO dd_link is unaffected by --force — the opt-in contract', async () => {
    const plain = seed([{ id: 'dw-0001', state: 'unchecked' }], null);
    const forced = seed([{ id: 'dw-0001', state: 'unchecked' }], null);
    const { env: a } = await runJson(plain, NAV_SET);
    const { env: b } = await runJson(forced, [...NAV_SET, '--force']);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(plain.fs.readText(FLOW_PATH)).toBe(forced.fs.readText(FLOW_PATH));
  });
});

describe('flow orient — the dd gate block (AC-11)', () => {
  const ORIENT = ['flow', 'orient', '--path', FLOW_PATH, '--json'];

  it('shows every item with its own state and pip, complete ones included', async () => {
    const deps = seed([
      { id: 'dw-0001', state: 'checked' },
      { id: 'dw-0002', state: 'blocked' },
      { id: 'dw-0003', state: 'na' },
    ]);
    const { env } = await runJson(deps, ORIENT);
    const gate = (env.data as { dd_gate: Record<string, unknown> }).dd_gate;
    expect(gate).toMatchObject({
      address: `${DOC}#tasks`,
      gates: true,
      status: 'incomplete',
      terminal: 2,
      total: 3,
    });
    expect(gate.items).toEqual([
      { id: 'dw-0001', state: 'checked', pip: '■' },
      { id: 'dw-0002', state: 'blocked', pip: '□' },
      { id: 'dw-0003', state: 'na', pip: '■' },
    ]);
  });

  it('evaluates LIVE — a document edited since the recorded reading reads current', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'unchecked' }], {
      address: `${DOC}#tasks`,
      reading: { status: 'complete', terminal: 9, total: 9, incomplete: [], at: 'old' },
    });
    const { env } = await runJson(deps, ORIENT);
    const gate = (env.data as { dd_gate: { status: string; total: number } }).dd_gate;
    expect(gate.status).toBe('incomplete');
    expect(gate.total).toBe(1);
  });

  it('reports basis drift as information alongside the live verdict', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: `${DOC}#tasks`,
      basis_sha: 'a-sha-from-before-the-edit',
    });
    const { env, code } = await runJson(deps, ORIENT);
    const gate = (env.data as { dd_gate: Record<string, unknown> }).dd_gate;
    expect(gate.status).toBe('complete');
    expect(gate.drift).toMatchObject({
      address: `${DOC}#tasks`,
      recorded: 'a-sha-from-before-the-edit',
    });
    // Drift never turns a read into a failure.
    expect(env.status).toBe('ok');
    expect(code).toBe(0);
  });

  it('marks a non-gating link as such instead of hiding it', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'unchecked' }], {
      address: `${DOC}#tasks`,
      gate: false,
    });
    const { env } = await runJson(deps, ORIENT);
    expect((env.data as { dd_gate: { gates: boolean } }).dd_gate.gates).toBe(false);
  });

  it('says why an unevaluable gate could not be read', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: 'docs/gone.dd.json#tasks',
    });
    const { env } = await runJson(deps, ORIENT);
    const gate = (env.data as { dd_gate: Record<string, unknown> }).dd_gate;
    expect(gate.status).toBe('unevaluable');
    expect(gate.problem).toContain('docs/gone.dd.json');
  });

  it('omits the block entirely for a node with no dd_link', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], null);
    const { env } = await runJson(deps, ORIENT);
    expect((env.data as Record<string, unknown>).dd_gate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HUMAN-mode orient — the surface a person actually reads (F002, F003).
//
// Every assertion above rides `--json`, which is a different code path: it never
// calls `railDoc` or `renderOrientGate`. So the JSON suite stayed green while the
// human rail printed an OPEN gate directly above `! could not evaluate`, and while
// drift printed two 64-character digests on one row. Both were found by operating
// the feature, and neither was pinned. They are pinned here.
// ---------------------------------------------------------------------------

/**
 * Run in HUMAN mode and capture stdout.
 *
 * `orient`'s human path writes its block RAW (`emitRawAndExit`) and sets
 * `process.exitCode` rather than calling `process.exit`, so unlike `runJson` this
 * resolves normally — hence the separate runner rather than a mode flag on the
 * other one.
 */
async function runHuman(deps: VerbActDeps, argv: string[]): Promise<{ out: string; code: number }> {
  let out = '';
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      out += t;
    },
  };
  const io: CliIo = { mode: 'human', writers };
  const previous = process.exitCode;
  process.exitCode = undefined;
  let code = -1;
  try {
    await buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]);
    code = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } finally {
    process.exitCode = previous;
  }
  return { out, code };
}

const ORIENT_HUMAN = ['flow', 'orient', '--path', FLOW_PATH];

describe('flow orient (human) — the rail and the block never contradict each other', () => {
  it('an UNEVALUABLE gate never renders an open rail above it (F002)', async () => {
    // The worst shape: a stored reading that says COMPLETE, on a link whose target
    // no longer exists. Before the fix the rail read `⚑ gate: Phase A ⛨ 2/2 ✓` —
    // "you may depart" — immediately above `! could not evaluate`.
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: 'docs/gone.dd.json#tasks',
      reading: { status: 'complete', terminal: 2, total: 2, incomplete: [], at: 'old' },
    });
    const { out } = await runHuman(deps, ORIENT_HUMAN);
    expect(out).toContain('! could not evaluate');
    expect(out).toContain('⚑ gate: Phase A ⛨ not yet evaluated');
    // The stale claim is gone from BOTH halves — no count, and no open tick.
    expect(out).not.toContain('2/2');
    expect(out).not.toContain('⛨ 2/2 ✓');
  });

  it('the rail agrees with the block on a LIVE incomplete reading (F003)', async () => {
    // The stored reading lies in the other direction: it claims 9/9 complete while
    // the document has one unchecked item. The block computes live; the rail must
    // report the SAME live numbers, not the recorded ones.
    const deps = seed(
      [
        { id: 'dw-0001', state: 'checked' },
        { id: 'dw-0002', state: 'unchecked' },
      ],
      {
        address: `${DOC}#tasks`,
        reading: { status: 'complete', terminal: 9, total: 9, incomplete: [], at: 'old' },
      },
    );
    const { out } = await runHuman(deps, ORIENT_HUMAN);
    expect(out).toContain('⚑ gate: Phase A ⛨ 1/2');
    expect(out).toContain(`dd gate: ${DOC}#tasks  1/2 ✕ holds`);
    expect(out).not.toContain('9/9'); // the recorded reading is never the answer
  });

  it('the rail agrees with the block on a LIVE complete reading, tick included (F003)', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: `${DOC}#tasks`,
      reading: { status: 'incomplete', terminal: 0, total: 4, incomplete: ['x'], at: 'old' },
    });
    const { out } = await runHuman(deps, ORIENT_HUMAN);
    expect(out).toContain('⚑ gate: Phase A ⛨ 1/1 ✓');
    expect(out).toContain(`dd gate: ${DOC}#tasks  1/1 ✓ open`);
    expect(out).not.toContain('0/4');
  });

  it('drift prints TWELVE-character shas, not two 64-character walls (F003)', async () => {
    const recorded = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: `${DOC}#tasks`,
      basis_sha: recorded,
    });
    const { out } = await runHuman(deps, ORIENT_HUMAN);
    const line = out.split('\n').find((l) => l.includes('recorded '));
    expect(line).toBeDefined();
    expect(line).toContain('recorded abcdef012345… → actual ');
    expect(line).not.toContain(recorded); // the full digest never reaches the row
    // Exactly two truncated digests and nothing longer on the line.
    expect(line?.match(/[0-9a-f]{13,}/)).toBeNull();
    expect(out).toContain('⚠ basis drift:');
  });

  it('the full shas stay available in --json — truncation is a HUMAN affordance', async () => {
    const recorded = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: `${DOC}#tasks`,
      basis_sha: recorded,
    });
    const { env } = await runJson(deps, ['flow', 'orient', '--path', FLOW_PATH, '--json']);
    const gate = (env.data as { dd_gate: { drift: { recorded: string; actual: string } } }).dd_gate;
    expect(gate.drift.recorded).toBe(recorded);
    expect(gate.drift.actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a node with no dd_link prints no rail callout and no block at all', async () => {
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], null);
    const { out } = await runHuman(deps, ORIENT_HUMAN);
    expect(out).not.toContain('⚑ gate:');
    expect(out).not.toContain('dd gate:');
    expect(out).not.toContain('⛨');
  });
});

describe('--force through an UNEVALUABLE gate clears the stale reading (F002)', () => {
  it('does not persist an open badge for a gate the CLI just said it could not read', async () => {
    // This is the same contradiction as the rail one, written to disk: without the
    // clear, the committed diagram keeps badging `⛨2/2 ✓` on a node whose gate is
    // unreadable — and the next reader meets that claim with no error beside it.
    const deps = seed([{ id: 'dw-0001', state: 'checked' }], {
      address: 'docs/gone.dd.json#tasks',
      basis_sha: 'b'.repeat(64),
      reading: { status: 'complete', terminal: 2, total: 2, incomplete: [], at: 'old' },
    });
    const { env, code } = await runJson(deps, [...NAV_SET, '--force']);
    expect(env.status).toBe('degraded');
    expect(code).toBe(0);
    const written = JSON.parse(deps.fs.readText(FLOW_PATH) ?? '{}');
    expect(written.nodes[0].dd_link.reading).toBeUndefined();
    // The drift anchor survives — it is not a completion claim.
    expect(written.nodes[0].dd_link.basis_sha).toBe('b'.repeat(64));
  });

  it('a REFUSAL still writes nothing — clearing only happens on a writing path', async () => {
    const deps = seed(
      [
        { id: 'dw-0001', state: 'checked' },
        { id: 'dw-0002', state: 'unchecked' },
      ],
      {
        address: `${DOC}#tasks`,
        reading: { status: 'complete', terminal: 2, total: 2, incomplete: [], at: 'old' },
      },
    );
    const before = deps.fs.readText(FLOW_PATH);
    const { env } = await runJson(deps, NAV_SET);
    expect(env.error?.code).toBe('E440');
    expect(deps.fs.readText(FLOW_PATH)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// F005 — the address anchors at the DOCUMENT's repo root, not the process cwd.
// ---------------------------------------------------------------------------

/** `seed`, plus a `.git` marker so the flow file sits in a discoverable repository. */
function seedInRepo(items: Array<{ id: string; state: string }>, cwd: string): VerbActDeps {
  const deps = seed(items);
  deps.fs.writeText('/repo/.git', 'gitdir: /elsewhere/.git/worktrees/repo\n');
  return { ...deps, proc: new FakeProcess({}, cwd) };
}

describe('gate resolution anchors at the flow document, not the cwd (F005)', () => {
  it('resolves the same absolute flow path identically from any working directory', async () => {
    const ORIENT = ['flow', 'orient', '--path', FLOW_PATH, '--json'];
    const fromRoot = await runJson(
      seedInRepo([{ id: 'dw-0001', state: 'checked' }], '/repo'),
      ORIENT,
    );
    const fromElsewhere = await runJson(
      seedInRepo([{ id: 'dw-0001', state: 'checked' }], '/somewhere/else'),
      ORIENT,
    );
    const gateOf = (r: { env: Envelope }) =>
      (r.env.data as { dd_gate: Record<string, unknown> }).dd_gate;

    // The pre-fix behaviour: from `/somewhere/else` the repo-relative address
    // resolved against the wrong root, the target "vanished", and the reader was
    // told a complete gate could not be evaluated — an invitation to --force.
    expect(gateOf(fromElsewhere).status).toBe('complete');
    expect(gateOf(fromElsewhere)).toEqual(gateOf(fromRoot));
    expect(fromElsewhere.env.status).toBe('ok');
  });

  it('a deeper cwd INSIDE the same repo resolves identically too', async () => {
    const ORIENT = ['flow', 'orient', '--path', FLOW_PATH, '--json'];
    const deep = await runJson(
      seedInRepo([{ id: 'dw-0001', state: 'unchecked' }], '/repo/harness/cli'),
      ORIENT,
    );
    const gate = (deep.env.data as { dd_gate: { status: string; total: number } }).dd_gate;
    expect(gate.status).toBe('incomplete'); // evaluated, not "unevaluable"
    expect(gate.total).toBe(1);
  });

  it('nav set gates on the same anchor — no false E441 from another directory', async () => {
    const deps = seedInRepo([{ id: 'dw-0001', state: 'unchecked' }], '/somewhere/else');
    const { env } = await runJson(deps, NAV_SET);
    // E440 (a real refusal, item outstanding) — NOT E441 (target invalid), which is
    // what a cwd-anchored address produced from here.
    expect(env.error?.code).toBe('E440');
  });

  it('falls back to the cwd when the flow file is in no repository at all', async () => {
    // No `.git` anywhere above the flow — the old behaviour is the right one, and
    // must keep working: the un-versioned temp-dir case is how every fixture runs.
    const deps = seed([{ id: 'dw-0001', state: 'checked' }]);
    const { env } = await runJson(deps, ['flow', 'orient', '--path', FLOW_PATH, '--json']);
    expect((env.data as { dd_gate: { status: string } }).dd_gate.status).toBe('complete');
  });
});
