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
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * T004 act-level — `harness flow render`: deterministic stdout/file output, the
 * `--check` drift guard (non-zero on drift, NEVER writes), input-flag precedence,
 * and write-containment. Mirrors the flow.test.ts harness.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const FLOW = '/repo/.harness/flows/demo.json';
const SIBLING = '/repo/.harness/flows/demo.md';

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
): Promise<{ env: Envelope; code: number }> {
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
    buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { env: JSON.parse(out.trim()) as Envelope, code };
}

/** Stand up a real flow in the FakeFs (the harness-loop bundled template). */
async function seedFlow(deps: VerbActDeps): Promise<void> {
  (deps.fs as FakeFs).mkdirp('/repo/.harness');
  const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
  expect(created.code).toBe(0);
}

describe('harness flow render', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders to stdout (JSON data.rendered) and exits 0', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    const r = await runFlow(deps, ['flow', 'render', '--slug', 'demo']);
    expect(r.code).toBe(0);
    expect(r.env.status).toBe('ok');
    const rendered = (r.env.data as { rendered: string }).rendered;
    expect(rendered).toContain('flowchart TD');
    expect(rendered).toContain('**Legend**');
  });

  it('--output writes the render in-repo (file matches the stdout render)', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    const stdout = (
      (await runFlow(deps, ['flow', 'render', '--slug', 'demo'])).env.data as { rendered: string }
    ).rendered;
    const w = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--output', '/repo/r.md']);
    expect(w.code).toBe(0);
    expect((w.env.data as { path: string }).path).toBe('/repo/r.md');
    expect(deps.fs.readText('/repo/r.md')).toBe(stdout);
  });

  it('--input is an alias for --path', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    const r = await runFlow(deps, ['flow', 'render', '--input', FLOW]);
    expect(r.code).toBe(0);
    expect((r.env.data as { rendered: string }).rendered).toContain('flowchart TD');
  });

  it('--check passes (exit 0, drift:false) when the committed sibling .md matches', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    // write the golden to the sibling path, then check it
    await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--output', SIBLING]);
    const c = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(c.code).toBe(0);
    expect((c.env.data as { drift: boolean }).drift).toBe(false);
  });

  it('--check fails (E310, exit 1) when no committed render exists, and writes nothing', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    const c = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(c.code).toBe(1);
    expect(c.env.error?.code).toBe(ErrorCodes.FLOW_RENDER_DRIFT);
    expect(deps.fs.exists(SIBLING)).toBe(false); // --check never writes
  });

  it('--check detects drift after a mutation and leaves the committed .md UNCHANGED', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--output', SIBLING]);
    const golden = deps.fs.readText(SIBLING);
    // mutate the flow so the live render diverges from the committed golden
    await runFlow(deps, ['flow', 'status', '--slug', 'demo', '--node', 'boot', '--to', 'done']);
    const c = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(c.code).toBe(1);
    expect(c.env.error?.code).toBe(ErrorCodes.FLOW_RENDER_DRIFT);
    expect(deps.fs.readText(SIBLING)).toBe(golden); // render --check is read-only
  });

  it('--against overrides the .md compared by --check', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--output', '/repo/elsewhere.md']);
    const c = await runFlow(deps, [
      'flow',
      'render',
      '--slug',
      'demo',
      '--check',
      '--against',
      '/repo/elsewhere.md',
    ]);
    expect(c.code).toBe(0);
  });

  it('--output escaping the repo root → E303', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    const r = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--output', '/etc/evil.md']);
    expect(r.code).toBe(1);
    expect(r.env.error?.code).toBe(ErrorCodes.FLOW_PATH_ESCAPE);
  });

  it('no --path/--slug → E301', async () => {
    const deps = fakeDeps(new FakeFs());
    (deps.fs as FakeFs).mkdirp('/repo/.harness');
    const r = await runFlow(deps, ['flow', 'render']);
    expect(r.code).toBe(1);
    expect(r.env.error?.code).toBe(ErrorCodes.FLOW_NOT_FOUND);
  });

  it('human mode prints the raw markdown to stdout (passthrough, no envelope line)', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    let out = '';
    const io: CliIo = { mode: 'human', writers: { out: (t) => (out += t), err: () => {} } };
    await buildProgram('0.4.0', io, deps, EMPTY).parseAsync([
      'node',
      'harness',
      'flow',
      'render',
      '--slug',
      'demo',
    ]);
    expect(out).toContain('flowchart TD');
    expect(out).toContain('**Legend**');
    expect(out).not.toContain('flow: ok'); // raw passthrough, not the envelope summary
  });

  it('flow rail emits the [title] banded one-line rail (JSON data.rail)', async () => {
    const deps = fakeDeps(new FakeFs());
    await seedFlow(deps);
    const r = await runFlow(deps, ['flow', 'rail', '--slug', 'demo']);
    expect(r.code).toBe(0);
    const rail = (r.env.data as { rail: string }).rail;
    expect(rail.startsWith('[demo] ')).toBe(true); // title = slug (no --agent on this create)
    expect(rail).toContain('Boot');
  });
});
