import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { RESERVED_NAMES, type VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const CHAIN = 'test/services/dd/schema/fixtures/chain/repo/docs';
/** The CLI package dir — the cwd `just test` runs from, and the base `CHAIN` is relative to. */
const CLI_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-03T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

/**
 * Drive the REAL act over the REAL fixture files (the house rule permits real fs
 * under `test/**\/fixtures/**`). The act owns its own I/O adapters, exactly like
 * `harness doctor`, so this is the honest end-to-end surface an agent will call.
 */
async function runDd(argv: string[], mode: 'json' | 'human' = 'json') {
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
  const io: CliIo = { mode, writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await buildProgram('0.0.0-test', io, deps(), EMPTY).parseAsync(['node', 'harness', ...argv]);
    // `emitRawAndExit` deliberately returns instead of calling process.exit, so
    // a large piped payload is never truncated — that path lands here.
    code = process.exitCode ?? 0;
  } catch (error) {
    if (!/^exit:\d+$/.test(error instanceof Error ? error.message : '')) throw error;
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
  return {
    out,
    err,
    code,
    envelope: mode === 'json' ? (JSON.parse(out.trim()) as Envelope) : null,
  };
}

describe('harness dd validate — live body (OD-2 handoff)', () => {
  // `dd validate` resolves its document argument against process.cwd() (the house
  // repo-root convention), so CHAIN's relative path only means what it says when
  // cwd is the CLI package. Pin it — the repo also ships a root vitest.config.ts,
  // and vitest's `root` option does NOT set process.cwd().
  let previousCwd = '';

  beforeEach(() => {
    previousCwd = process.cwd();
    process.chdir(CLI_ROOT);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
  });

  it('walks exactly as far as --depth allows: 3 reaches the bad hop, 2 does not', async () => {
    const shallow = await runDd(['dd', 'validate', `${CHAIN}/a.dd.json`, '--depth', '2']);
    expect(shallow.code).toBe(0);
    expect(shallow.envelope?.status).toBe('ok');

    const deep = await runDd(['dd', 'validate', `${CHAIN}/a.dd.json`, '--depth', '3']);
    expect(deep.code).toBe(1);
    expect(deep.envelope?.status).toBe('error');
    expect(deep.envelope?.error?.code).toBe('E408');
    // The finding is OWNED by the document that must change — four hops away.
    const details = deep.envelope?.error?.details as { issues: { owner: string }[] };
    expect(details.issues[0]?.owner).toContain('d.dd.json');
  });

  it('defaults to depth 3 when --depth is not given', async () => {
    const result = await runDd(['dd', 'validate', `${CHAIN}/a.dd.json`]);
    expect((result.envelope?.error?.details as { depth: number }).depth).toBe(3);
  });

  it('maps WARN-only findings to degraded/exit 0, never to a hard failure', async () => {
    const result = await runDd(['dd', 'validate', `${CHAIN}/warn.dd.json`, '--depth', '0']);
    expect(result.code).toBe(0);
    expect(result.envelope?.status).toBe('degraded');
    const data = result.envelope?.data as {
      counts: { error: number; warn: number };
      issues: { class: string; severity: string; code: string }[];
    };
    expect(data.counts.error).toBe(0);
    expect(data.counts.warn).toBeGreaterThan(0);
    for (const issue of data.issues) {
      expect(issue.severity).toBe('WARN');
      expect(issue.code).toMatch(/^E4\d\d$/);
    }
  });

  it('reports an unresolvable schema as a hard E401', async () => {
    const result = await runDd(['dd', 'validate', `${CHAIN}/unknown.dd.json`, '--depth', '0']);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E401');
    expect(result.envelope?.error?.message).toContain('builder/nowhere');
  });

  it('refuses a nonsense --depth instead of guessing one', async () => {
    const result = await runDd(['dd', 'validate', `${CHAIN}/a.dd.json`, '--depth', 'lots']);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E108');
  });

  it('says so plainly when the document is missing', async () => {
    const result = await runDd(['dd', 'validate', `${CHAIN}/nope.dd.json`]);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E400');
    expect(result.envelope?.error?.message).toContain('missing or unreadable');
  });

  it('never skips a document it was pointed at (OD-1)', async () => {
    // The fixture corpus is exactly what the doctor's sweep excludes; a direct
    // invocation must still fail on it, or `dd validate <bad fixture>` is a lie.
    const result = await runDd(['dd', 'validate', `${CHAIN}/d.dd.json`, '--depth', '0']);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E408');
  });
});

describe('harness dd schema / docs — live bodies', () => {
  // `dd schema list`/`show` resolve from the repo root by convention (the house
  // cwd rule), so this group runs there — the suite's own cwd is `harness/cli`.
  const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  let previousCwd = '';

  beforeEach(() => {
    previousCwd = process.cwd();
    process.chdir(REPO_ROOT);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
  });

  it('reserves dd and keeps the family registered while the bodies go live', () => {
    expect(RESERVED_NAMES.has('dd')).toBe(true);
  });

  it('shows a resolved schema with its path, sections, enums and terminal set', async () => {
    const result = await runDd(['dd', 'schema', 'show', 'builder/plan']);
    expect(result.code).toBe(0);
    const data = result.envelope?.data as {
      path: string;
      root: string;
      gate_terminal: string[];
      sections: { name: string }[];
      enums: { name: string }[];
    };
    expect(data.path).toContain('/.dd/schemas/builder/plan/schema.json');
    expect(data.root).toBe('gitroot');
    expect(data.gate_terminal).toEqual(['checked', 'human-skipped', 'na']);
    expect(data.sections.map((section) => section.name)).toEqual(
      expect.arrayContaining(['meta', 'acceptance_criteria', 'phases', 'tasks', 'done_when']),
    );
    expect(data.enums.map((declared) => declared.name)).toEqual(
      expect.arrayContaining(['plan_status', 'complexity']),
    );
  });

  it('renders a human listing rather than a bare status line', async () => {
    const result = await runDd(['dd', 'schema', 'list'], 'human');
    expect(result.code).toBe(0);
    expect(result.out).toContain('harness dd schema — resolved schemas');
    expect(result.out).toContain('Roots searched (precedence order):');
  });

  it('dumps a baked doc verbatim in human mode, envelope-free', async () => {
    const result = await runDd(['dd', 'docs', 'get', 'dd-overview'], 'human');
    expect(result.code).toBe(0);
    expect(result.out.startsWith('# Deterministic documents (dd)')).toBe(true);
    expect(result.out).not.toContain('"status"');
  });
});

/**
 * F002: the acts must be wired to a `SchemaFs` that distinguishes "found
 * nothing" from "could not look". Proving that at the act boundary is the point
 * — a unit test of the adapter passes even if someone re-wires the act back to
 * the shared `NodeFs`, whose `readdir` swallows every error.
 */
describe('harness dd schema — an unscannable root is reported, not silently empty (F002)', () => {
  let tmp = '';
  let previousCwd = '';
  let previousHome: string | undefined;

  // SKIPPED ON WINDOWS, and named in the PR body as not covered (plan 108).
  //
  // The scenario is a directory CYCLE, and the only way to build one is a
  // symlink — `symlinkSync` needs Developer Mode or elevation on Windows and
  // otherwise throws EPERM in `beforeAll`, taking the whole block down before a
  // single assertion runs.
  //
  // Guarded rather than faked: what is being proven is that the REAL scanner
  // reports an unscannable root instead of silently returning empty (F002), and
  // a faked cycle would only prove that a fake throws. The honest trade is to
  // lose the case on Windows and SAY SO, rather than keep a green that tests
  // something else.
  const skipOnWin32 = process.platform === 'win32';

  beforeAll(() => {
    if (skipOnWin32) return;
    tmp = mkdtempSync(join(tmpdir(), 'dd-act-loop-'));
    const root = join(tmp, '.dd');
    const pkg = join(root, 'schemas', 'builder', 'plan');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'schema.json'),
      JSON.stringify({ dd_schema: 1, description: 'probe', sections: {} }),
      'utf8',
    );
    // The root HAS the schema being asked for. Only the loop stops the scan
    // reaching it — so a swallowed error yields the worst possible answer: a
    // confident "no such schema" about a schema that is right there.
    symlinkSync('.', join(root, 'loop'));
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    previousCwd = process.cwd();
    previousHome = process.env.HOME;
    // Keep the scan hermetic: the home root must not wander into the real ~/.dd.
    process.env.HOME = join(tmp, 'home');
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.restoreAllMocks();
  });

  it.skipIf(skipOnWin32)('reports E416 scan-failed, never a confident E410 not-found', async () => {
    const result = await runDd(['dd', 'schema', 'show', 'builder/plan']);

    expect(result.code).toBe(1);
    expect(result.envelope?.status).toBe('error');
    expect(result.envelope?.error?.code).toBe('E416');
  });
});
