import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoRegenerateSibling, siblingPath } from '../../src/acts/dd/build.js';
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
/** The CLI package dir — the cwd `just test` runs from, and the base fixture paths assume. */
const CLI_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'test/services/dd/render/fixtures';

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
 * Drive the REAL act over REAL files. `dd build` owns its own I/O adapters (the
 * `harness doctor` precedent, followed by every dd act), so this is the honest
 * end-to-end surface an agent calls — and it means the act resolves paths against
 * the PROCESS cwd, which every test here pins explicitly.
 */
async function runDd(argv: string[]): Promise<{ envelope: Envelope; code: number; err: string }> {
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
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('0.0.0-test', io, deps(), EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { envelope: JSON.parse(out.trim()) as Envelope, code, err };
}

describe('harness dd build — read-only checking', () => {
  let previousCwd = '';

  /**
   * Check mode never writes, so these run directly against the COMMITTED corpus —
   * a much stronger proof than a temp copy: it pins the goldens themselves. The
   * cwd is the fixture's own `repo/` because that is where its `.dd/schemas` live,
   * exactly as a real consumer repo's schemas sit at its git root.
   */
  function enter(fixtureCase: string): void {
    process.chdir(join(CLI_ROOT, FIXTURES, fixtureCase, 'repo'));
  }

  beforeEach(() => {
    previousCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
  });

  it('reports no drift when the committed sibling is the render', async () => {
    enter('showcase');
    const result = await runDd(['dd', 'build', 'docs/showcase.dd.json', '--check']);
    expect(result.code).toBe(0);
    expect(result.envelope.status).toBe('ok');
    expect(result.envelope.data).toMatchObject({ schema: 'render/showcase', drift: false });
    // The showcase's live basis is deliberately out of date: a moved basis is
    // REPORTED, never a degradation — the view is still correct.
    const data = result.envelope.data as { refreshed_bases: { recorded: string }[] };
    expect(data.refreshed_bases.map((basis) => basis.recorded)).toEqual(['sha-other']);
  });

  it('renders every committed golden in the corpus without drift', async () => {
    for (const [fixtureCase, document] of [
      ['showcase', 'docs/other.dd.json'],
      ['chain', 'docs/source.dd.json'],
      ['chain', 'docs/consumer.dd.json'],
      ['limits', 'docs/limits.dd.json'],
    ] as const) {
      enter(fixtureCase);
      const result = await runDd(['dd', 'build', document, '--check']);
      expect({ document, status: result.envelope.status, code: result.code }).toEqual({
        document,
        status: 'ok',
        code: 0,
      });
    }
  });

  it('fails with the frozen drift code when a human edited the generated sibling', async () => {
    enter('drift');
    const result = await runDd(['dd', 'build', 'docs/drift.dd.json', '--check']);
    expect(result.code).toBe(1);
    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error?.code).toBe('E422');
    expect(result.envelope.next_action).toContain('harness dd build');
  });

  it('is degraded — never failed — by adapter issues, and names every one', async () => {
    enter('adapters');
    const result = await runDd(['dd', 'build', 'docs/adapters.dd.json', '--check']);
    expect(result.code).toBe(0);
    expect(result.envelope.status).toBe('degraded');
    const data = result.envelope.data as {
      drift: boolean;
      adapter_warnings: { type: string; code: string }[];
    };
    expect(data.drift).toBe(false);
    expect(data.adapter_warnings.map((warning) => warning.code).sort()).toEqual([
      'E423',
      'E424',
      'E424',
      'E425',
      'E426',
    ]);
  });

  it('never writes in check mode', async () => {
    const sibling = join(CLI_ROOT, FIXTURES, 'drift/repo/docs/drift.dd.md');
    const before = readFileSync(sibling, 'utf8');
    enter('drift');
    await runDd(['dd', 'build', 'docs/drift.dd.json', '--check']);
    expect(readFileSync(sibling, 'utf8')).toEqual(before);
  });

  it('maps every input failure to its frozen code', async () => {
    enter('drift');
    const missing = await runDd(['dd', 'build', 'docs/absent.dd.json', '--check']);
    expect(missing.code).toBe(1);
    expect(missing.envelope.error?.code).toBe('E429');

    const notADocument = await runDd([
      'dd',
      'build',
      '.dd/schemas/render/simple/schema.json',
      '--check',
    ]);
    expect(notADocument.code).toBe(1);
    expect(notADocument.envelope.error?.code).toBe('E429');
  });
});

describe('harness dd build — writing the sibling', () => {
  let previousCwd = '';
  let repo = '';

  beforeEach(() => {
    previousCwd = process.cwd();
    // A self-contained repo shape in a temp dir: the act anchors on the process
    // cwd, so this makes the temp dir the repo root and keeps every write off the
    // committed corpus — the fixtures stay the spec, never a scratch pad.
    repo = mkdtempSync(join(tmpdir(), 'dd-build-'));
    cpSync(join(CLI_ROOT, FIXTURES, 'drift/repo'), repo, { recursive: true });
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(repo, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('regenerates a hand-edited sibling, and the regenerated file then checks clean', async () => {
    const written = await runDd(['dd', 'build', 'docs/drift.dd.json']);
    expect(written.code).toBe(0);
    expect(written.envelope.status).toBe('ok');
    expect(written.envelope.evidence?.[0]?.label).toBe('rendered markdown');

    const expected = readFileSync(
      join(CLI_ROOT, FIXTURES, 'drift/repo/docs/drift.expected.md'),
      'utf8',
    );
    expect(readFileSync(join(repo, 'docs/drift.dd.md'), 'utf8')).toEqual(expected);

    const rechecked = await runDd(['dd', 'build', 'docs/drift.dd.json', '--check']);
    expect(rechecked.code).toBe(0);
    expect(rechecked.envelope.status).toBe('ok');
  });

  it('renders byte-identically on a second run', async () => {
    await runDd(['dd', 'build', 'docs/drift.dd.json']);
    const first = readFileSync(join(repo, 'docs/drift.dd.md'), 'utf8');
    await runDd(['dd', 'build', 'docs/drift.dd.json']);
    expect(readFileSync(join(repo, 'docs/drift.dd.md'), 'utf8')).toEqual(first);
  });

  it('reports an unresolvable schema rather than writing a half-rendered file', async () => {
    writeFileSync(
      join(repo, 'docs/orphan.dd.json'),
      JSON.stringify({ dd: { schema: 'render/no-such' }, sections: [], references: [] }),
    );
    const result = await runDd(['dd', 'build', 'docs/orphan.dd.json']);
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe('E401');
    expect(result.envelope.next_action).toContain('harness dd schema list');
  });

  it('refuses a document outside the repository root', async () => {
    const outside = join(previousCwd, 'package.json');
    const result = await runDd(['dd', 'build', outside, '--check']);
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe('E429');
    expect(result.envelope.error?.message).toContain('outside the repository root');
  });
});

describe('autoRegenerateSibling — the mutating-verb seam', () => {
  let previousCwd = '';
  let repo = '';
  const warnings: string[] = [];
  const io: CliIo = {
    mode: 'json',
    writers: {
      out: () => {},
      err: (text) => {
        warnings.push(text);
      },
    },
  };

  beforeEach(() => {
    previousCwd = process.cwd();
    repo = mkdtempSync(join(tmpdir(), 'dd-regen-'));
    cpSync(join(CLI_ROOT, FIXTURES, 'drift/repo'), repo, { recursive: true });
    warnings.length = 0;
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(repo, { recursive: true, force: true });
  });

  it('regenerates the sibling after a mutation', async () => {
    const result = await autoRegenerateSibling(`${repo}/docs/drift.dd.json`, repo, io);
    expect(result.regenerated).toBe(true);
    expect(warnings).toEqual([]);
    expect(readFileSync(join(repo, 'docs/drift.dd.md'), 'utf8')).toEqual(
      readFileSync(join(CLI_ROOT, FIXTURES, 'drift/repo/docs/drift.expected.md'), 'utf8'),
    );
  });

  it('warns and keeps going when the render cannot happen — a mutation is never rolled back', async () => {
    const result = await autoRegenerateSibling(`${repo}/docs/gone.dd.json`, repo, io);
    expect(result.regenerated).toBe(false);
    expect(result.reason).toContain('missing or unreadable');
    expect(warnings.join('')).toContain('warning: dd sibling not regenerated');
  });

  it('puts the sibling beside the document, whatever the document is called', () => {
    expect(siblingPath('/a/b/plan.dd.json')).toBe('/a/b/plan.dd.md');
    expect(siblingPath('/a/b/plain.json')).toBe('/a/b/plain.md');
  });
});
