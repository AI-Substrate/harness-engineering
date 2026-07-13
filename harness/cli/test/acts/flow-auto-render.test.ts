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

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const FLOW = '/repo/.harness/flows/demo.json';
const RENDER = '/repo/.harness/flows/demo.md';

class MdFailFs extends FakeFs {
  override writeText(path: string, contents: string): void {
    if (path.endsWith('.md')) throw new Error('read-only render');
    super.writeText(path, contents);
  }
}

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-06-18T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runFlow(
  deps: VerbActDeps,
  argv: string[],
): Promise<{ env: Envelope; code: number; out: string; err: string }> {
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
    buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { env: JSON.parse(out.trim()) as Envelope, code, out, err };
}

describe('FX001-5 flow mutation auto-render', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create writes the sibling markdown byte-identical to manual render output', async () => {
    const fs = new FakeFs();
    const deps = fakeDeps(fs);
    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    expect(created.code).toBe(0);
    expect(fs.readText(RENDER)).not.toBeNull();

    const manual = await runFlow(deps, ['flow', 'render', '--path', FLOW]);
    expect(fs.readText(RENDER)).toBe((manual.env.data as { rendered: string }).rendered);
  });

  it('a successful mutation refreshes the sibling render and preserves default stdout bytes', async () => {
    const fs = new FakeFs();
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const before = fs.readText(RENDER);

    const mutated = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);

    expect(mutated.out).toBe(
      '{"command":"flow","status":"ok","timestamp":"2026-06-18T00:00:00.000Z","data":{"path":"/repo/.harness/flows/demo.json","slug":"demo","kind":"harness-loop","now":"boot","next":null,"node_count":7,"event_count":2}}\n',
    );
    expect(fs.readText(RENDER)).not.toBe(before);
    const checked = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(checked.code).toBe(0);
    expect((checked.env.data as { drift: boolean }).drift).toBe(false);
  });

  it('the append-only event mutation also refreshes the sibling render', async () => {
    const fs = new FakeFs();
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const before = fs.readText(RENDER);

    const event = await runFlow(deps, ['flow', 'event', 'test-run', '--slug', 'demo']);

    expect(event.code).toBe(0);
    expect(fs.readText(RENDER)).not.toBe(before);
    const checked = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(checked.code).toBe(0);
  });

  it('warns on a sibling markdown write failure without changing mutation success or stdout', async () => {
    const fs = new MdFailFs();
    const deps = fakeDeps(fs);
    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);

    expect(created.code).toBe(0);
    expect(created.env.status).toBe('ok');
    expect(created.err).toContain('warning: flow state saved but auto-render failed');
    expect(fs.readText(FLOW)).not.toBeNull();
  });
});
