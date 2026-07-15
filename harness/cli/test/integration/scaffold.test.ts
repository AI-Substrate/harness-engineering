import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { SystemClock } from '../../src/adapters/clock/system-clock.js';
import { NodeEnv } from '../../src/adapters/env/node-env.js';
import { NodeExec } from '../../src/adapters/exec/node-exec.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { ExecGit } from '../../src/adapters/git/exec-git.js';
import { JitiLoader } from '../../src/adapters/loader/jiti-loader.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { discoverExtensions } from '../../src/services/extensions/discovery.js';
import { buildVerbRegistry, type VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * End-to-end for `harness new`: scaffold a real extension into a throwaway temp
 * repo with the real NodeFs writer, then DISCOVER + LOAD it through real jiti and
 * run it. Proves the scaffolded stub is genuinely loadable and honestly reports
 * `unconfigured` until implemented (AC1-AC3) — the loop the whole feature exists
 * to close. We drive `buildProgram(...).parseAsync(...)` directly so the mocked
 * `process.exit` throw propagates to the test.
 */

function realDeps(cwd: string): VerbActDeps {
  return {
    exec: new NodeExec(),
    fs: new NodeFs(),
    env: new NodeEnv(),
    git: new ExecGit(),
    clock: new SystemClock(),
    proc: new FakeProcess({}, cwd),
  };
}

const EMPTY: VerbRegistry = { verbs: [], records: [] };

async function runIn(
  deps: VerbActDeps,
  registry: VerbRegistry,
  argv: string[],
  mode: OutputMode = 'json',
): Promise<{ out: string; err: string; code: number }> {
  let out = '';
  let err = '';
  let code = -1;
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
  };
  const io: CliIo = { mode, writers };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('9.9.9', io, deps, registry).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { out, err, code };
}

describe('`harness new` — scaffold then load end-to-end via real jiti', () => {
  let workdir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir) rmSync(workdir, { recursive: true, force: true });
  });

  it('scaffolds the greet package into an empty repo, then doctor/help see it loaded and `greet` runs unconfigured (exit 2)', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'harness-new-'));
    const deps = realDeps(workdir);

    // 1. Scaffold (the `new` core command needs no registry).
    const scaffold = await runIn(deps, EMPTY, ['new', 'greet']);
    expect(scaffold.code).toBe(0);
    expect(JSON.parse(scaffold.out).data.path).toBe('.harness/extensions/greet/extension.ts');
    expect(JSON.parse(scaffold.out).data.instructionsPath).toBe(
      '.harness/extensions/greet/instructions.md',
    );

    // 2. Discover + load the freshly written package through real jiti (folder form, AC-8).
    const discovery = discoverExtensions(deps.fs, deps.proc);
    expect(discovery.rejected).toEqual([]);
    const registry = await buildVerbRegistry(discovery.candidates, new JitiLoader());
    const greetRecord = registry.records.find((r) => r.entryPath.endsWith('greet/extension.ts'));
    expect(greetRecord?.status).toBe('loaded');
    expect(registry.verbs.map((v) => v.name)).toContain('greet');

    // 3. `help` lists it.
    const help = await runIn(deps, registry, ['help']);
    expect(JSON.parse(help.out).data.verbs.map((v: { name: string }) => v.name)).toContain('greet');

    // 4. Invoking the stub is honest: unconfigured, exit 2, with a next_action.
    const invoked = await runIn(deps, registry, ['greet']);
    const env = JSON.parse(invoked.out);
    expect(env.command).toBe('greet');
    expect(env.status).toBe('unconfigured');
    expect(env.next_action).toContain('.harness/extensions/greet/extension.ts');
    expect(invoked.code).toBe(2);
  });

  it('scaffolds a --wrap verb that runs the wrapped command to an ok envelope (exit 0)', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'harness-new-wrap-'));
    const deps = realDeps(workdir);

    // Wrap a command guaranteed to exist + succeed (`node --version`).
    const scaffold = await runIn(deps, EMPTY, ['new', 'ver', '--wrap', 'node --version']);
    expect(scaffold.code).toBe(0);
    expect(JSON.parse(scaffold.out).data.variant).toBe('v2-wrap-ts');

    const registry = await buildVerbRegistry(
      discoverExtensions(deps.fs, deps.proc).candidates,
      new JitiLoader(),
    );
    expect(registry.verbs.map((v) => v.name)).toContain('ver');

    const invoked = await runIn(deps, registry, ['ver']);
    const env = JSON.parse(invoked.out);
    expect(env.status).toBe('ok');
    expect(env.data.command).toBe('node --version');
    expect(invoked.code).toBe(0);
  });

  it('scaffolds structural subverbs that load and mount immediately', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'harness-new-sub-'));
    const deps = realDeps(workdir);
    const scaffold = await runIn(deps, EMPTY, ['new', 'db', '--sub', 'reset,seed']);
    expect(scaffold.code).toBe(0);
    expect(JSON.parse(scaffold.out).data.variant).toBe('v2-sub-ts');

    const registry = await buildVerbRegistry(
      discoverExtensions(deps.fs, deps.proc).candidates,
      new JitiLoader(),
    );
    expect(registry.records[0]).toMatchObject({ status: 'loaded', format: 'v2 (api 2)' });
    expect(registry.verbs[0]?.subverbs?.map((subverb) => subverb.name)).toEqual(['reset', 'seed']);

    const invoked = await runIn(deps, registry, ['db', 'reset']);
    expect(JSON.parse(invoked.out)).toMatchObject({ command: 'db', status: 'unconfigured' });
    expect(invoked.code).toBe(2);
  });

  it('scaffolds a sensor that registers and runs through the real sensor act', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'harness-new-sensor-'));
    const deps = realDeps(workdir);
    const scaffold = await runIn(deps, EMPTY, ['new', 'lint-count', '--sensor']);
    expect(scaffold.code).toBe(0);
    expect(JSON.parse(scaffold.out).data.variant).toBe('v2-sensor-ts');

    const registry = await buildVerbRegistry(
      discoverExtensions(deps.fs, deps.proc).candidates,
      new JitiLoader(),
    );
    expect(registry.records[0]).toMatchObject({ status: 'loaded', format: 'v2 (api 2)' });
    expect(registry.sensors?.map((sensor) => sensor.name)).toEqual(['lint-count']);
    expect(registry.verbs).toEqual([]);

    const invoked = await runIn(deps, registry, ['sensors', 'run', 'lint-count']);
    expect(JSON.parse(invoked.out)).toMatchObject({
      command: 'sensors',
      status: 'ok',
      data: { record: { runStatus: 'ok', reading: { state: 'fail' } } },
    });
    expect(invoked.code).toBe(0);
    expect(deps.fs.exists(join(workdir, '.harness/temp/sensors/state/lint-count.json'))).toBe(true);
  });

  it('scaffolds a plain-JS bare literal that loads without a factory import', async () => {
    workdir = mkdtempSync(join(tmpdir(), 'harness-new-js-'));
    const deps = realDeps(workdir);
    deps.fs.writeText(join(workdir, 'package.json'), '{"type":"module"}\n');
    const scaffold = await runIn(deps, EMPTY, ['new', 'seed', '--js']);
    expect(scaffold.code).toBe(0);
    expect(JSON.parse(scaffold.out).data.variant).toBe('v2-js');

    const registry = await buildVerbRegistry(
      discoverExtensions(deps.fs, deps.proc).candidates,
      new JitiLoader(),
    );
    expect(registry.records[0]).toMatchObject({ status: 'loaded', format: 'v2 (api 2)' });
    expect(registry.verbs.map((verb) => verb.name)).toContain('seed');
  });
});
