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
