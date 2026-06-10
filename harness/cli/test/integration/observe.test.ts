import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeModuleLoader } from '../../src/adapters/loader/fake-loader.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import { buildVerbRegistry, type VerbRegistry } from '../../src/services/extensions/registry.js';

/*
Test Doc:
- Why: AC-8 — observations must survive context compaction. The buffer lives on disk, so a
  SECOND CLI process (a fresh buildProgram over the same filesystem) must return what the
  first one captured. Also proves `observe` is reserved: an extension claiming the name is
  a conflict (E142), never a shadow (AC-1/finding 03).
- Contract: capture (run 1) → --list (run 2, fresh program) returns the entry → --clear
  (run 3) → --list (run 4) is empty. buildVerbRegistry rejects an extension verb named
  `observe` as a conflict.
- Quality Contribution: end-to-end proof of the compaction-resilience thesis with fakes as
  the persistent "disk".
*/

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv(),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

/** One simulated CLI process: a FRESH buildProgram over the (persistent) deps. */
async function runIn(
  deps: VerbActDeps,
  argv: string[],
): Promise<{ out: string; code: number }> {
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
    buildProgram('9.9.9', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { out, code };
}

describe('harness observe — compaction resilience end-to-end (AC-8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an entry captured by one CLI run is returned by --list in a fresh run, then cleared', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);

    // Run 1: capture (the "before the context wipe" process).
    const captured = await runIn(deps, [
      'observe',
      'had to infer the endpoint behavior — no smoke path existed',
      '--kind',
      'difficulty',
      '--target',
      'project-sensor',
    ]);
    expect(captured.code).toBe(0);
    expect(JSON.parse(captured.out).data).toMatchObject({ bucket: 'agent', id: 'DL-001' });

    // Run 2: a FRESH program over the same fs (the "after the wipe" process).
    const listed = await runIn(deps, ['observe', '--list']);
    expect(listed.code).toBe(0);
    const data = JSON.parse(listed.out).data;
    expect(data.observations).toHaveLength(1);
    expect(data.observations[0]).toMatchObject({
      bucket: 'agent',
      id: 'DL-001',
      kind: 'difficulty',
      target: 'project-sensor',
      description: 'had to infer the endpoint behavior — no smoke path existed',
      first_seen_at: '2026-06-08T07:20:00.000Z',
    });

    // Run 3 + 4: clear, then the next sweep is an honest empty.
    const cleared = await runIn(deps, ['observe', '--clear']);
    expect(JSON.parse(cleared.out).data.cleared).toBe(1);
    const after = await runIn(deps, ['observe', '--list']);
    expect(JSON.parse(after.out).data.observations).toEqual([]);
  });
});

describe('`observe` is a reserved core name (AC-1, finding 03)', () => {
  it('an extension verb named `observe` is a conflict (E142), never registered', async () => {
    const entryPath = '/repo/.harness/extensions/observe/extension.ts';
    const loader = new FakeModuleLoader({
      [entryPath]: {
        name: 'observe',
        summary: 'an extension trying to shadow the core capture verb',
        run: () => ({ status: 'ok' as const }),
      },
    });
    const registry = await buildVerbRegistry([entryPath], loader);
    expect(registry.verbs).toEqual([]);
    expect(registry.records[0]?.status).toBe('conflict');
    expect(registry.records[0]?.error).toContain('E142');
    expect(registry.records[0]?.shadows).toEqual(['observe']);
  });
});
