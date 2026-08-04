import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

/** The escape introducer, built rather than written, so no regex holds a control character. */
const ESC = String.fromCharCode(27);

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
 * A temp fixture rather than the tracked exemplar: the sweep skips
 * `test/**\/fixtures/**` by contract (OD-1), so a sweep pointed at a committed
 * fixture tree reports a clean run over nothing at all.
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
  description: 'A plan',
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
            claim: { type: 'text' },
            state: { type: 'state' },
            pressure: { type: 'link' },
          },
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

/** Can this process still read the directory? Root can, and that matters here. */
function accessible(path: string): boolean {
  try {
    accessSync(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

let repo = '';
let previousCwd = '';

function write(relative: string, value: unknown): void {
  const path = join(repo, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * `dd graph` in human mode — FU-9.
 *
 * The command's entire job is to emit a graph, and in human mode it emitted
 * nothing: the mermaid it had already built was reachable only under `--json`.
 * The P4 surface grant justified having no `--emit` option on the stated grounds
 * that "global --json + human mermaid already cover both modes"; these are the
 * tests for the half that was never delivered.
 */
describe('dd graph — human mode emits the mermaid (FU-9)', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'dd-graph-human-'));
    write('.dd/schemas/live/plan/schema.json', PLAN_SCHEMA);
    write('.dd/schemas/live/pressure/schema.json', PRESSURE_SCHEMA);
    write('docs/plan.dd.json', {
      dd: { schema: 'live/plan', spec: 'dd@1' },
      sections: [
        {
          name: 'rows',
          value: [
            {
              id: 'ac-0001',
              claim: 'The first claim',
              state: 'checked',
              pressure: 'pressure.dd.json#rows/bp-0001',
            },
          ],
        },
      ],
      references: [],
    });
    write('docs/pressure.dd.json', {
      dd: { schema: 'live/pressure', spec: 'dd@1' },
      sections: [
        { name: 'rows', value: [{ id: 'bp-0001', criterion: 'A pressure', state: 'checked' }] },
      ],
      references: [],
    });
    // A subtree with no dd documents in it at all, for the empty case.
    mkdirSync(join(repo, 'empty'), { recursive: true });
    writeFileSync(join(repo, 'empty', 'README.md'), '# nothing here\n', 'utf8');
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
  });

  it('puts the mermaid on STDOUT, where it was previously unreachable', async () => {
    const run = await runDd(['dd', 'graph'], { mode: 'human' });
    expect(run.code).toBe(0);
    expect(run.out.startsWith('flowchart LR\n')).toBe(true);
    expect(run.out).toContain('docs/plan.dd.json');
    expect(run.out).toContain('-->');
  });

  it('emits the SAME mermaid a `--json` consumer gets, not a second rendering', async () => {
    // Two renderings that must agree are one rendering: the human path reads
    // `data.mermaid` off the envelope rather than building its own.
    const asJson = await runDd(['dd', 'graph']);
    const asHuman = await runDd(['dd', 'graph'], { mode: 'human' });
    expect(asHuman.out).toBe((asJson.envelope?.data as { mermaid: string }).mermaid);
  });

  it('leaves `--json` byte-identical, since consumers already depend on it', async () => {
    const run = await runDd(['dd', 'graph']);
    expect(run.envelope?.status).toBe('ok');
    expect(run.envelope?.command).toBe('dd graph');
    const data = run.envelope?.data as { mermaid: string; counts: { nodes: number } };
    expect(data.mermaid.startsWith('flowchart LR\n')).toBe(true);
    expect(data.counts.nodes).toBeGreaterThan(0);
    // The whole of stdout is the envelope and nothing else — no mermaid leaked
    // alongside it, which would break every consumer that pipes this to `jq`.
    expect(JSON.parse(run.out)).toEqual(run.envelope);
  });

  it('keeps stdout PURE mermaid, so a redirect produces a valid file', async () => {
    const run = await runDd(['dd', 'graph'], { mode: 'human' });
    // Status and the next action are diagnostics; they go to stderr. Every line
    // of stdout has to be something mermaid can parse.
    expect(run.out).not.toContain('dd graph:');
    expect(run.out).not.toContain('\u2192');
    expect(run.err).toContain('\u2192');
    for (const line of run.out.split('\n').filter((line) => line !== '')) {
      expect(line === 'flowchart LR' || line.startsWith('  ')).toBe(true);
    }
  });

  it('never styles the mermaid, even when colour is resolved ON', async () => {
    // A deliberate exception to the palette `dd graph map` uses. Mermaid is a
    // machine format whose value is that it can be pasted into a viewer, and an
    // SGR byte in a paste corrupts the diagram.
    const coloured = await runDd(['dd', 'graph'], { mode: 'human', useColor: true });
    expect(coloured.out).not.toContain(`${ESC}[`);
    const plain = await runDd(['dd', 'graph'], { mode: 'human' });
    expect(coloured.out).toBe(plain.out);
  });

  it('never wraps a mermaid line, however long the paths get', async () => {
    // The 80-column contract belongs to the map tree. A newline inserted into
    // mermaid syntax produces a file that does not parse, so a long node label
    // stays on its line — and at least one here is longer than that budget.
    const long = 'a-deliberately-long-folder-name-that-pushes-a-node-label-past-eighty';
    write(`${long}/${long}.dd.json`, {
      dd: { schema: 'live/pressure', spec: 'dd@1' },
      sections: [
        { name: 'rows', value: [{ id: 'bp-9001', criterion: 'Far away', state: 'checked' }] },
      ],
      references: [],
    });
    const run = await runDd(['dd', 'graph'], { mode: 'human' });
    const wanted = `${long}/${long}.dd.json`;
    expect(wanted.length).toBeGreaterThan(80);
    expect(run.out.split('\n').some((line) => line.includes(wanted))).toBe(true);
    rmSync(join(repo, long), { recursive: true, force: true });
  });

  it('says plainly that it found nothing, and where it looked', async () => {
    // Silence was wrong twice over: "ok" and no output reads as "here is your
    // graph" when the truth is "there was nothing to graph", and an empty result
    // is almost always a wrong `--path` — so the path is half the answer.
    const run = await runDd(['dd', 'graph', '--path', 'empty'], { mode: 'human' });
    expect(run.code).toBe(0);
    expect(run.err).toContain('no dd documents found under');
    expect(run.err).toContain('empty');
    // Still a valid, empty diagram on stdout: a consumer redirecting stdout
    // should always get something mermaid can parse.
    expect(run.out).toBe('flowchart LR\n');
  });

  it('still reports a non-empty scope as non-empty', async () => {
    // The empty notice has to be a reading of the corpus, not a line that is
    // always or never printed.
    const run = await runDd(['dd', 'graph', '--path', 'docs'], { mode: 'human' });
    expect(run.err).not.toContain('no dd documents found');
    expect(run.out).toContain('docs/plan.dd.json');
  });

  it('reports an unreadable scope on stderr, and writes no mermaid at all', async () => {
    // The error branch, driven by the real failure it exists for. Skipped when
    // the test runs as root, because root reads an unreadable directory anyway
    // and a probe that cannot fail is worse than no probe.
    const locked = join(repo, 'locked');
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, 'a.dd.json'), '{}\n', 'utf8');
    chmodSync(locked, 0o000);
    try {
      if (accessible(locked)) return;
      const run = await runDd(['dd', 'graph', '--path', 'locked'], { mode: 'human' });
      expect(run.code).toBe(1);
      expect(run.err).toContain('dd graph:');
      expect(run.err).toContain('\u2192');
      // Nothing on stdout: a partial diagram of a corpus we could not read would
      // look like a complete one.
      expect(run.out).toBe('');
    } finally {
      chmodSync(locked, 0o755);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it('exits 0 and says nothing was found when the scope does not exist', async () => {
    // A missing `--path` is not an error today, it is an empty corpus — and the
    // empty notice is what makes that readable rather than a silent "ok".
    const run = await runDd(['dd', 'graph', '--path', 'nope'], { mode: 'human' });
    expect(run.code).toBe(0);
    expect(run.err).toContain('no dd documents found under');
    expect(run.out).toBe('flowchart LR\n');
  });
});
