import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerConvoAct } from '../../src/acts/convo.js';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeBackground } from '../../src/adapters/exec/fake-background.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import { FakeFlowspace } from '../../src/services/convo/fake-flowspace.js';

const ROOT = '/repo';

function ioFor(): { io: CliIo; out: () => string } {
  let output = '';
  const writers: Writers = { out: (text) => (output += text), err: () => {} };
  return { io: { mode: 'json', writers }, out: () => output };
}

function deps(fs: FakeFs, env = new FakeEnv()): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    fsWrite: fs,
    background: new FakeBackground(),
    env,
    git: new FakeGit(),
    clock: new FakeClock('2026-08-30T01:02:03.000Z'),
    proc: new FakeProcess({ flowspace3: '/bin/flowspace3' }, ROOT),
  };
}

function enabledFs(): FakeFs {
  return new FakeFs({
    [`${ROOT}/.harness/settings.json`]: JSON.stringify({
      schema_version: 1,
      flowspace: { ingest: { enabled: true } },
    }),
  });
}

describe('registerConvoAct', () => {
  afterEach(() => vi.restoreAllMocks());

  async function run(argv: string[], fs: FakeFs, flowspace: FakeFlowspace, env = new FakeEnv()) {
    const { io, out } = ioFor();
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
      code = value ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness').exitOverride();
    registerConvoAct(program, io, deps(fs, env), () => flowspace);
    await expect(program.parseAsync(['node', 'harness', 'convo', 'sync', ...argv])).rejects.toThrow(
      /^exit:/,
    );
    return { envelope: JSON.parse(out()), code };
  }

  it('runs explicit identity through U2 and renders dispatch, not delivery', async () => {
    const flowspace = new FakeFlowspace();
    const result = await run(
      ['--harness', 'omp', '--session', 'native-session', '--folder', ROOT],
      enabledFs(),
      flowspace,
    );
    expect(flowspace.calls).toEqual(['detect', 'ping', 'ingest']);
    expect(flowspace.ingests).toEqual([
      { harness: 'omp', session: 'native-session', folder: ROOT },
    ]);
    expect(result.envelope.data).toMatchObject({ status: 'fired', origin: 'repo' });
    expect(JSON.stringify(result.envelope)).toMatch(/dispatched/i);
    expect(result.code).toBe(0);
  });

  it('reports enabled identity failure and names explicit repair flags before probing', async () => {
    const flowspace = new FakeFlowspace();
    const result = await run([], enabledFs(), flowspace);
    expect(result.envelope).toMatchObject({ status: 'degraded' });
    expect(result.envelope.next_action).toMatch(/--harness/);
    expect(result.envelope.next_action).toMatch(/--session/);
    expect(flowspace.calls).toEqual([]);
  });

  it('reports default-disabled before identity resolution and performs no Flowspace work', async () => {
    const flowspace = new FakeFlowspace();
    const result = await run([], new FakeFs(), flowspace);
    expect(result.envelope.data).toMatchObject({ status: 'disabled', origin: 'default' });
    expect(JSON.stringify(result.envelope)).toMatch(/not configured/i);
    expect(flowspace.calls).toEqual([]);
    expect(result.code).toBe(0);
  });
});
