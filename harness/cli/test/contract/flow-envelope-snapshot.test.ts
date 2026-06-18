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
 * T001 checkpoint 2 — the FINAL Phase-1 act (plan 024 AC-08; the sibling of
 * `hooks-snapshot.test.ts` checkpoint 1). Freezes the `harness flow` Envelope
 * `data` shapes for `create` / `show` / `event` — the contract Phase 3 (the-flow
 * migration) consumes. Drift in these shapes silently breaks the migrated host
 * flow, so they are frozen here, BEFORE Phase 2 opens, and re-run in Phase 3.
 *
 * Deterministic by construction: a FakeClock fixes every envelope `timestamp`, so
 * the snapshot is byte-stable with no normalisation.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const CLOCK = '2026-06-18T00:00:00.000Z';

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({
      isRepo: true,
      branch: '024-first-class-flow-system',
      remoteUrl: 'github.com/AI-Substrate/harness-engineering',
    }),
    clock: new FakeClock(CLOCK),
    proc: new FakeProcess({}, '/repo'),
  };
}

/** One simulated CLI process over the (persistent) fake deps; returns the parsed JSON envelope. */
async function runFlow(deps: VerbActDeps, argv: string[]): Promise<Envelope> {
  let out = '';
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    throw new Error(`exit:${c ?? 0}`);
  }) as never);
  await expect(
    buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return JSON.parse(out.trim()) as Envelope;
}

describe('contract: harness flow Envelope data shapes (T001 checkpoint 2 — frozen for Phase 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('freezes create / show / event envelope shapes', async () => {
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness');
    const deps = fakeDeps(fs);

    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const shown = await runFlow(deps, ['flow', 'show', '--slug', 'demo']);
    const evented = await runFlow(deps, [
      'flow',
      'event',
      'coverage',
      '--slug',
      'demo',
      '--value',
      '87.5',
    ]);

    // status + command are part of the contract; data is the frozen shape.
    expect({
      create: { command: created.command, status: created.status, data: created.data },
      show: { command: shown.command, status: shown.status, data: shown.data },
      event: { command: evented.command, status: evented.status, data: evented.data },
    }).toMatchSnapshot();
  });
});
