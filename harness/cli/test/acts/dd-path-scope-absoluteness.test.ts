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

const EMPTY: VerbRegistry = { verbs: [], records: [] };

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

/** Drive the REAL program, exactly as `dd-links-live.test.ts` does. */
async function runDd(argv: string[]): Promise<{ envelope: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await buildProgram('0.0.0-test', io, deps(), EMPTY).parseAsync(['node', 'harness', ...argv]);
    code = process.exitCode ?? 0;
  } catch (error) {
    if (!/^exit:\d+$/.test(error instanceof Error ? error.message : '')) throw error;
  } finally {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  }
  return { envelope: JSON.parse(out.trim()) as Envelope, code };
}

/**
 * D1/D2, plan 108 — `dd doctor --path` and `dd graph --path` shared an
 * IDENTICAL hand-rolled `resolveScope` (the #106 shape recurring): `path
 * .startsWith('/') ? path : \`${repoRoot}/${path}\``. A Windows drive-letter
 * path never starts with `/`, so it was misread as RELATIVE and glued onto
 * `repoRoot` (measured: `resolveScope('C:\repo\docs', 'C:/repo')` ->
 * `'C:/repo/C:\repo\docs'`) — a directory that does not exist, silently
 * scoping the sweep/graph to nothing. Fixed by deleting both copies and
 * calling the shared `resolveInRepo` directly.
 *
 * NOT a separator bug: the forward-slash case below proves it, because the
 * old check already accepted forward slashes just as badly as backslashes —
 * what it was missing was drive-letter ABSOLUTENESS, not slash direction.
 */
describe('dd doctor / dd graph --path — D1/D2 absoluteness (plan 108)', () => {
  it.each([
    ['dd doctor', 'doctor', 'C:\\repo\\docs'],
    ['dd graph', 'graph', 'C:\\repo\\docs'],
    ['dd doctor', 'doctor', 'C:/repo/docs'],
    ['dd graph', 'graph', 'C:/repo/docs'],
  ])('%s --path %s is passed through, not re-anchored under the (unrelated) repoRoot', async (_label, verb, path) => {
    const run = await runDd(['dd', verb, '--path', path]);
    expect(run.code).toBe(0);
    const root = (run.envelope.data as { root: string }).root;
    // Both spellings resolve to the SAME logical scope: proof this is about
    // recognising a drive-letter root as absolute, not about which slash it uses.
    expect(root).toBe('C:/repo/docs');
  });
});
