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
import { cellWidth } from '../../src/services/dd/links/report.js';
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
      // `--rel` collects; its empty default means "every relation", never a subset.
      ['--rel', []],
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
      expect(cellWidth(line)).toBeLessThanOrEqual(80);
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

/**
 * The 80-column contract, proved on the whole terminal surface.
 *
 * The suite above measures today's short exemplar addresses, which pass whether
 * or not the render can survive a long one. This corpus is built so that the
 * header, the node rows, the back-reference, the truncation block AND the
 * next-action line all exceed the budget before wrapping — and it measures
 * stderr as well as stdout, because the contract is about what lands on a
 * terminal, not about one writer.
 */
describe('dd graph map — 80 columns over the whole terminal surface (T005)', () => {
  /** Deep enough that the header's folder line alone cannot fit. */
  const DEEP = 'docs/plans/archive/065-deterministic-documents/tasks/phase-7-graph-map/evidence';
  /** Long enough that no single address fits a line. */
  const LONG = 'unreasonably-but-entirely-legitimate-document-name-nobody-plans-for';
  const SEED = `${DEEP}/plan-${LONG}.dd.json#acceptance_criteria/ac-0201`;

  let wide = '';
  let previous = '';

  beforeAll(() => {
    wide = mkdtempSync(join(tmpdir(), 'dd-graph-map-wide-'));
    repo = wide;
    write('.dd/schemas/live/plan/schema.json', PLAN_SCHEMA);
    write('.dd/schemas/live/log/schema.json', LOG_SCHEMA);
    write('.dd/schemas/live/pressure/schema.json', PRESSURE_SCHEMA);
    write(`${DEEP}/plan-${LONG}.dd.json`, {
      dd: { schema: 'live/plan', spec: 'dd@1' },
      sections: [
        { name: 'meta', value: { title: 'A plan filed a long way down' } },
        {
          name: 'acceptance_criteria',
          value: [
            {
              id: 'ac-0201',
              claim: 'The claim under test',
              state: 'checked',
              pressure: `pressure-${LONG}.dd.json#rows/bp-0201`,
              proven_by: `log-${LONG}.dd.json#entries/lg-0201`,
            },
          ],
        },
      ],
      references: [],
    });
    write(`${DEEP}/pressure-${LONG}.dd.json`, {
      dd: { schema: 'live/pressure', spec: 'dd@1' },
      sections: [
        { name: 'rows', value: [{ id: 'bp-0201', criterion: 'The pressure', state: 'checked' }] },
      ],
      references: [],
    });
    write(`${DEEP}/log-${LONG}.dd.json`, {
      dd: { schema: 'live/log', spec: 'dd@1' },
      sections: [
        {
          name: 'entries',
          value: [
            {
              id: 'lg-0201',
              text: 'Proved it',
              cites: `pressure-${LONG}.dd.json#rows/bp-0201`,
            },
            {
              id: 'lg-0202',
              text: 'Mentions it',
              cites: `plan-${LONG}.dd.json#acceptance_criteria/ac-0201`,
            },
          ],
        },
      ],
      references: [],
    });
  });

  afterAll(() => {
    rmSync(wide, { recursive: true, force: true });
  });

  beforeEach(() => {
    previous = process.cwd();
    process.chdir(wide);
  });

  afterEach(() => {
    process.chdir(previous);
  });

  // Measured with the RENDERER's own width function. Characters are not columns,
  // and an oracle that counts code points clears a line a terminal draws at
  // twice the width — the defect this suite exists to catch.
  const widths = (text: string): number[] =>
    text
      .replaceAll(ANSI, '')
      .split('\n')
      .map((line) => cellWidth(line));

  it('proves the fixture really does exceed the budget first', () => {
    expect(SEED.length).toBeGreaterThan(80);
  });

  it('keeps stdout AND stderr inside 80 columns, plain and coloured', async () => {
    for (const useColor of [false, true]) {
      const run = await runDd(['dd', 'graph', 'map', SEED], { mode: 'human', useColor });
      expect(run.out).toContain('-> outbound');
      for (const width of widths(run.out)) expect(width).toBeLessThanOrEqual(80);
      for (const width of widths(run.err)) expect(width).toBeLessThanOrEqual(80);
    }
  });

  it('keeps the next-action line inside 80 columns when a bound fires', async () => {
    const run = await runDd(['dd', 'graph', 'map', SEED, '--max-nodes', '2'], { mode: 'human' });
    // The line this exists for: the truncation next-action is the longest string
    // the command can write, and it goes to stderr, which no width check saw.
    expect(run.err).toContain('bound');
    expect(run.err.split('\n').length).toBeGreaterThan(2);
    for (const width of widths(run.out)) expect(width).toBeLessThanOrEqual(80);
    for (const width of widths(run.err)) expect(width).toBeLessThanOrEqual(80);
  });

  it('keeps the ERROR path inside 80 columns too, and wraps the address there', async () => {
    // The branch that only runs once something has already gone wrong, which is
    // the branch least often exercised and most often reasoned about instead of
    // tested. It matters here because `nextActionFor` INTERPOLATES the address
    // into its message, so on a long address the error's next-action line grows
    // with it — the same defect, on the one path the success tests cannot reach.
    const missing = `${DEEP}/plan-${LONG}.dd.json#acceptance_criteria/ac-9999`;
    const run = await runDd(['dd', 'graph', 'map', missing], { mode: 'human' });
    expect(run.code).toBe(1);
    expect(run.err).toContain('dd graph map:');
    expect(run.err).toContain('\u2192');
    // Same seed under `--json` names the code, so this really is the E430 path
    // and not some other failure that happens to write to stderr.
    const asJson = await runDd(['dd', 'graph', 'map', missing]);
    expect(asJson.envelope?.error?.code).toBe('E430');
    // It genuinely had to wrap, rather than passing because it happened to fit.
    expect(run.err.split('\n').length).toBeGreaterThan(3);
    for (const width of widths(run.err)) expect(width).toBeLessThanOrEqual(80);

    // Wrapped, not clipped — the same standard the tree is held to. A next
    // action naming half an address sends the reader somewhere that does not
    // exist, which is worse than saying nothing.
    expect(run.err).not.toContain('\u2026');
    const joined = run.err
      .split('\n')
      .map((line) => line.replace(/^ +/, ''))
      .join('');
    expect(joined).toContain(missing);
  });

  it('wraps the error MESSAGE too, not only the next action', async () => {
    // A sibling of the line above, and it survived the first sweep of this fix:
    // an id that is missing from a document that exists gives a short message,
    // so the message line passed on the fixture rather than on its merits. A
    // missing FILE interpolates the resolved absolute path, which is longer than
    // the address the reader typed.
    const missing = `${DEEP}/nope-${LONG}.dd.json#rows/bp-9999`;
    const run = await runDd(['dd', 'graph', 'map', missing], { mode: 'human' });
    expect(run.code).toBe(1);
    expect(run.err).toContain('is missing');
    expect(run.err.split('\n').length).toBeGreaterThan(4);
    for (const width of widths(run.err)) expect(width).toBeLessThanOrEqual(80);
    expect(run.err).not.toContain('\u2026');
    const joined = run.err
      .split('\n')
      .map((line) => line.replace(/^ +/, ''))
      .join('');
    expect(joined).toContain(`nope-${LONG}.dd.json`);
  });

  /** A legal file part that a terminal draws two cells per character. */
  const WIDE = '\u754c'.repeat(70);
  /** A legal file part with none of the characters the wrapper breaks at. */
  const NO_JOINTS = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('budgets in terminal CELLS, so a CJK file part cannot overflow', async () => {
    // `core/address.ts` constrains only the INTERIOR segments to ASCII, so the
    // file part may legitimately be CJK. Counted as characters this address
    // "fits"; drawn by a terminal it is 146 cells wide.
    write(`${DEEP}/${WIDE}.dd.json`, {
      dd: { schema: 'live/pressure', spec: 'dd@1' },
      sections: [{ name: 'rows', value: [{ id: 'bp-0301', criterion: 'Wide', state: 'checked' }] }],
      references: [],
    });
    const run = await runDd(['dd', 'graph', 'map', `${DEEP}/${WIDE}.dd.json#rows/bp-0301`], {
      mode: 'human',
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain('\u754c');
    for (const width of widths(run.out)) expect(width).toBeLessThanOrEqual(80);
    for (const width of widths(run.err)) expect(width).toBeLessThanOrEqual(80);

    // Measured a SECOND way, without the renderer's helper. The check above
    // shares its width function with the code under test, so it proves the two
    // agree, not that either is right — break the helper and both move together.
    // This one knows one fact by hand: U+754C is two cells.
    const byHand = (line: string): number =>
      [...line].reduce((cells, char) => cells + (char === '\u754c' ? 2 : 1), 0);
    for (const line of run.out.replaceAll(ANSI, '').split('\n')) {
      expect(byHand(line)).toBeLessThanOrEqual(80);
    }
  });

  it('wraps an address that offers no break joint at all', async () => {
    // The degenerate input for a joint-seeking wrapper: nothing to break at, and
    // longer than the budget. It has to fall back to a hard cut rather than
    // giving up and emitting one long line.
    write(`${DEEP}/${NO_JOINTS}.dd.json`, {
      dd: { schema: 'live/pressure', spec: 'dd@1' },
      sections: [
        { name: 'rows', value: [{ id: 'bp-0401', criterion: 'Jointless', state: 'checked' }] },
      ],
      references: [],
    });
    const run = await runDd(['dd', 'graph', 'map', `${DEEP}/${NO_JOINTS}.dd.json#rows/bp-0401`], {
      mode: 'human',
    });
    expect(run.code).toBe(0);
    for (const width of widths(run.out)) expect(width).toBeLessThanOrEqual(80);
    // Still whole: a hard cut is a wrap, not a truncation.
    const joined = run.out
      .split('\n')
      .map((line) => line.replace(/^[ \u2502]+/, ''))
      .join('');
    expect(joined).toContain(NO_JOINTS);
  });

  it('never shortens an address to make it fit', async () => {
    const run = await runDd(['dd', 'graph', 'map', SEED], { mode: 'human' });
    const address = `pressure-${LONG}.dd.json#rows/bp-0201`;
    for (const line of run.out.split('\n')) expect(line).not.toContain(address);
    const joined = run.out
      .split('\n')
      .map((line) => line.replace(/^[ \u2502]+/, ''))
      .join('');
    expect(joined).toContain(address);
  });
});
