import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { DdMapResult } from '../../src/services/dd/links/map.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

/** The escape introducer, built rather than written, so no regex holds a control character. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[\\d+m`, 'g');

function sink(): Writers {
  return { out: () => {}, err: () => {} };
}

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-04T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

interface Run {
  envelope: Envelope | null;
  out: string;
  err: string;
  code: number;
}

/**
 * Drive the REAL act over a REAL corpus in a temp directory.
 *
 * A temp directory rather than a tracked fixture: the sweep skips
 * `test/**\/fixtures/**` by contract (OD-1), so a sweep pointed at a committed
 * fixture tree would report a clean run over nothing at all.
 */
async function runDd(argv: string[], io?: Partial<CliIo>): Promise<Run> {
  let out = '';
  let err = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const resolved: CliIo = { mode: 'json', writers, ...io };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await buildProgram('0.0.0-test', resolved, deps(), EMPTY).parseAsync([
      'node',
      'harness',
      ...argv,
    ]);
    code = process.exitCode ?? 0;
  } catch (error) {
    // `--help` leaves through commander's own exit override, not ours.
    const commanderCode = (error as { code?: string }).code ?? '';
    if (
      !/^exit:\d+$/.test(error instanceof Error ? error.message : '') &&
      !commanderCode.startsWith('commander.')
    ) {
      throw error;
    }
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
  const trimmed = out.trim();
  return {
    envelope:
      resolved.mode === 'json' && trimmed.startsWith('{')
        ? (JSON.parse(trimmed) as Envelope)
        : null,
    out,
    err,
    code,
  };
}

const PLAN_SCHEMA = {
  dd_schema: 1,
  description: 'A plan whose rows carry their own links',
  sections: {
    meta: {
      required: true,
      shape: {
        type: 'object',
        required: ['title'],
        fields: { title: { type: 'string' }, log: { type: 'link' } },
      },
    },
    acceptance_criteria: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'claim', 'state'],
          fields: {
            id: { type: 'string' },
            claim: { type: 'text' },
            state: { type: 'state' },
            pressure: { type: 'link' },
            proven_by: { type: 'link' },
          },
        },
      },
    },
  },
};

const LOG_SCHEMA = {
  dd_schema: 1,
  description: 'An execution log',
  sections: {
    entries: {
      required: true,
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id'],
          fields: { id: { type: 'string' }, text: { type: 'string' }, cites: { type: 'link' } },
        },
      },
    },
  },
};

const PRESSURE_SCHEMA = {
  dd_schema: 1,
  description: 'A backpressure survey',
  sections: {
    rows: {
      required: true,
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id'],
          fields: {
            id: { type: 'string' },
            criterion: { type: 'string' },
            state: { type: 'state' },
          },
        },
      },
    },
  },
};

let repo = '';
let previousCwd = '';

function write(relative: string, value: unknown): void {
  const path = join(repo, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function seedCorpus(): void {
  write('.dd/schemas/live/plan/schema.json', PLAN_SCHEMA);
  write('.dd/schemas/live/log/schema.json', LOG_SCHEMA);
  write('.dd/schemas/live/pressure/schema.json', PRESSURE_SCHEMA);
  write('docs/plan.dd.json', {
    dd: { schema: 'live/plan', spec: 'dd@1' },
    sections: [
      { name: 'meta', value: { title: 'A live plan', log: 'log.dd.json#entries' } },
      {
        name: 'acceptance_criteria',
        value: [
          {
            id: 'ac-0201',
            claim: 'The first criterion',
            state: 'checked',
            pressure: 'pressure.dd.json#rows/bp-0201',
            proven_by: 'log.dd.json#entries/lg-0201',
          },
          {
            id: 'ac-0801',
            claim: 'The second criterion',
            state: 'unchecked',
            pressure: 'pressure.dd.json#rows/bp-0801',
          },
        ],
      },
    ],
    references: [],
  });
  write('docs/pressure.dd.json', {
    dd: { schema: 'live/pressure', spec: 'dd@1' },
    sections: [
      {
        name: 'rows',
        value: [
          { id: 'bp-0201', criterion: 'The first pressure', state: 'checked' },
          { id: 'bp-0801', criterion: 'The second pressure', state: 'unchecked' },
        ],
      },
    ],
    references: [],
  });
  write('docs/log.dd.json', {
    dd: { schema: 'live/log', spec: 'dd@1' },
    sections: [
      {
        name: 'entries',
        value: [
          { id: 'lg-0201', text: 'Proved the first', cites: 'pressure.dd.json#rows/bp-0201' },
          {
            id: 'lg-0202',
            text: 'Cites the first row',
            cites: 'plan.dd.json#acceptance_criteria/ac-0201',
          },
        ],
      },
    ],
    references: [],
  });
}

const AC_0201 = 'docs/plan.dd.json#acceptance_criteria/ac-0201';

describe('dd graph map — live over a real corpus', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'dd-graph-map-'));
    seedCorpus();
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  beforeEach(() => {
    previousCwd = process.cwd();
    // Every links verb takes the repo root from process.cwd() (FU-4), so the
    // corpus only means what it says while cwd is pinned to it.
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
  });

  it('T001: registers `map` as a named subcommand of `graph`, with all three options', () => {
    // Asserted on the command TREE rather than on help text: the surface grant
    // is specifically that `map` is a sibling verb under `graph` and that bare
    // `graph` keeps zero positionals, and only the tree can show both.
    const program = buildProgram('0.0.0-test', { mode: 'json', writers: sink() }, deps(), EMPTY);
    const dd = program.commands.find((command) => command.name() === 'dd');
    const graph = dd?.commands.find((command) => command.name() === 'graph');
    const map = graph?.commands.find((command) => command.name() === 'map');
    expect(graph).toBeDefined();
    expect(graph?.registeredArguments).toHaveLength(0);
    expect(map).toBeDefined();
    expect(map?.registeredArguments.map((argument) => argument.name())).toEqual(['address']);

    const help = map?.helpInformation() ?? '';
    expect(help).toContain('--depth <n>');
    expect(help).toContain('--max-nodes <n>');
    expect(help).toContain('--direction <way>');
    // Help wraps, so the defaults are asserted on the parsed options rather than
    // on the rendered column.
    expect(map?.options.map((option) => [option.long, option.defaultValue])).toEqual([
      ['--depth', '3'],
      ['--max-nodes', '20'],
      ['--direction', 'both'],
    ]);
  });

  it('T001: leaves bare `dd graph` byte-identical', async () => {
    // The P4 freeze pins zero positionals and the same bytes. `map` is a sibling
    // verb under the same noun, so adding it must not move this at all.
    const graph = await runDd(['dd', 'graph']);
    expect(graph.code).toBe(0);
    const data = graph.envelope?.data as { mermaid: string; counts: { nodes: number } };
    expect(data.mermaid.startsWith('flowchart LR\n')).toBe(true);
    expect(data.counts.nodes).toBe(3);
    expect(graph.envelope?.command).toBe('dd graph');
    expect(Object.keys(data).sort()).toEqual([
      'counts',
      'edges',
      'issues',
      'mermaid',
      'nodes',
      'root',
    ]);
  });

  it('T002/T003: answers about the row, in both directions, past the first hop', async () => {
    const run = await runDd(['dd', 'graph', 'map', AC_0201]);
    expect(run.code).toBe(0);
    const data = run.envelope?.data as DdMapResult;
    const outbound = data.nodes.filter((node) => node.arm === 'out');
    expect(outbound.map((node) => [node.address, node.distance])).toEqual([
      ['docs/pressure.dd.json#rows/bp-0201', 1],
      ['docs/log.dd.json#entries/lg-0201', 1],
    ]);
    // `meta.log` belongs to the document, not to this row — the exact edge a
    // document-scoped answer wrongly includes.
    expect(data.nodes.map((node) => node.address)).not.toContain('docs/log.dd.json#entries');
    expect(data.nodes.filter((node) => node.arm === 'in').map((node) => node.address)).toEqual([
      'docs/log.dd.json#entries/lg-0202',
    ]);
    expect(data.seed.location).toBe('$.sections[acceptance_criteria].value[0]');
  });

  it('T004: always carries a `truncated` block, cut or not', async () => {
    const complete = await runDd(['dd', 'graph', 'map', AC_0201]);
    const completeData = complete.envelope?.data as DdMapResult;
    expect(completeData.truncated).toEqual({ cut: false, nodes: [] });
    expect(completeData.bounds).toEqual({ depth: 3, max_nodes: 20, direction: 'both' });

    const bounded = await runDd(['dd', 'graph', 'map', AC_0201, '--max-nodes', '2']);
    const boundedData = bounded.envelope?.data as DdMapResult;
    expect(boundedData.truncated.cut).toBe(true);
    expect(boundedData.truncated.nodes.length).toBeGreaterThan(0);
    expect(boundedData.truncated.nodes[0]).toMatchObject({ reason: 'max-nodes' });
    expect(boundedData.nodes).toHaveLength(2);
    expect(bounded.envelope?.next_action).toContain('bound');
  });

  it('T004: node identity is safe to read with jq, and edges reference it', async () => {
    const run = await runDd(['dd', 'graph', 'map', AC_0201]);
    const data = run.envelope?.data as DdMapResult;
    expect(data.nodes.map((node) => node.key)).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(run.out).not.toContain('\\u0000');
    const keys = new Set(data.nodes.map((node) => node.key));
    for (const edge of data.edges) {
      expect(keys.has(edge.from)).toBe(true);
      expect(keys.has(edge.to)).toBe(true);
    }
    for (const node of data.nodes) {
      if (node.parent !== null) expect(keys.has(node.parent)).toBe(true);
    }
    expect(data.nodes[0]?.parent).toBeNull();
  });

  it('T004: the JSON envelope round-trips', async () => {
    const run = await runDd(['dd', 'graph', 'map', AC_0201]);
    const reparsed = JSON.parse(JSON.stringify(run.envelope)) as Envelope;
    expect(reparsed).toEqual(run.envelope);
    expect(run.envelope?.status).toBe('ok');
    expect((run.envelope?.data as { counts: unknown }).counts).toEqual({
      nodes: 4,
      edges: 4,
      inbound: 1,
      outbound: 2,
    });
  });

  it('T004: --json is never styled, not one escape byte', async () => {
    const run = await runDd(['dd', 'graph', 'map', AC_0201], { mode: 'json', useColor: true });
    expect(run.out).not.toContain(`${ESC}[`);
  });

  it('T005: human mode renders the tree, plain when colour is off', async () => {
    const run = await runDd(['dd', 'graph', 'map', AC_0201], { mode: 'human' });
    expect(run.out).toContain('<- inbound');
    expect(run.out).toContain('-> outbound');
    expect(run.out).toContain('#acceptance_criteria/ac-0201');
    expect(run.out).not.toContain(`${ESC}[`);
    for (const line of run.out.split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(80);
    }
  });

  it('T005: colour appears only when the entrypoint resolved it on', async () => {
    const coloured = await runDd(['dd', 'graph', 'map', AC_0201], {
      mode: 'human',
      useColor: true,
    });
    expect(coloured.out).toContain(`${ESC}[`);
    // Same run, same bytes once the escapes are stripped: colour decorates the
    // render, it never changes it.
    const plain = await runDd(['dd', 'graph', 'map', AC_0201], { mode: 'human' });
    expect(coloured.out.replaceAll(ANSI, '')).toBe(plain.out);
  });

  it('rejects a seed that does not resolve with E430, not a new code', async () => {
    const run = await runDd([
      'dd',
      'graph',
      'map',
      'docs/plan.dd.json#acceptance_criteria/ac-9999',
    ]);
    expect(run.code).toBe(1);
    expect(run.envelope?.error?.code).toBe('E430');
    expect(run.envelope?.next_action).toBeTruthy();
  });

  it('rejects a bound that is not a number before it walks anything', async () => {
    const depth = await runDd(['dd', 'graph', 'map', AC_0201, '--depth', 'deep']);
    expect(depth.code).toBe(1);
    expect(depth.envelope?.error?.code).toBe('E108');
    const nodes = await runDd(['dd', 'graph', 'map', AC_0201, '--max-nodes', '0']);
    expect(nodes.envelope?.error?.code).toBe('E108');
    const direction = await runDd(['dd', 'graph', 'map', AC_0201, '--direction', 'sideways']);
    expect(direction.envelope?.error?.code).toBe('E108');
  });

  it('honours --direction end to end', async () => {
    const out = await runDd(['dd', 'graph', 'map', AC_0201, '--direction', 'out']);
    const outData = out.envelope?.data as DdMapResult;
    expect(outData.nodes.some((node) => node.arm === 'in')).toBe(false);

    const inward = await runDd(['dd', 'graph', 'map', AC_0201, '--direction', 'in']);
    const inData = inward.envelope?.data as DdMapResult;
    expect(inData.nodes.some((node) => node.arm === 'out')).toBe(false);
  });

  it('maps a whole document when the address names no interior', async () => {
    const run = await runDd(['dd', 'graph', 'map', 'docs/plan.dd.json', '--direction', 'out']);
    const data = run.envelope?.data as DdMapResult;
    expect(data.seed.location).toBeNull();
    // Every cell in the file at one hop, `meta` included — the question `dd
    // links` answers, and the one a row address must NOT get.
    expect(
      data.nodes
        .filter((node) => node.arm === 'out' && node.distance === 1)
        .map((node) => node.address),
    ).toEqual([
      'docs/log.dd.json#entries',
      'docs/pressure.dd.json#rows/bp-0201',
      'docs/log.dd.json#entries/lg-0201',
      'docs/pressure.dd.json#rows/bp-0801',
    ]);
  });
});
