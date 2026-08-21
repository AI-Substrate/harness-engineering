import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../src/adapters/hash/node-hash.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { GITAI_PIN } from '../../src/services/doctor/collector/pin.js';
import { readCollectorState } from '../../src/services/doctor/collector/state.js';
import type { CollectorDeps } from '../../src/services/doctor/collector/types.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  FakePathKind,
  FakeSequencedExec,
  ok200,
} from '../support/collector-fakes.js';

/*
Test Doc:
- Why: P0 of the phase-1 review. Every collector service function was tested in
  isolation with fakes and every one of them passed — while NO production path
  could reach any of them. `harness doctor` had no collector row, no adapters
  existed, and nothing invoked the lifecycle. This file is the test that would
  have caught that: it drives the REGISTERED command, not the services.
- Contract: (1) a default `harness doctor` includes the `gitai-collector` row
  with no special wiring; (2) `--install-collector`, `--recheck-collector` and
  `--regenerate-collector-pin` are reachable from the CLI and run the lifecycle;
  (3) the lifecycle is driven entirely through injected offline fakes, so it runs
  in CI with no network, no git-ai, no daemon and no agents.
- Quality: the assertions are about REACHABILITY. A feature that cannot be
  invoked has not shipped, and unit tests over its internals cannot tell.
*/

const HOME = '/home/u';
const NOW = '2026-08-06T10:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const TRACE2_GET = 'git config --global --get-regexp ^trace2\\.';
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
const ARTIFACT_URL = `${GITAI_PIN.release_base_url}/${GITAI_PIN.version}/git-ai-macos-arm64`;
const GITAI_TRACE2 = 'trace2.eventtarget af_unix:/home/u/.git-ai/internal/daemon/trace2.sock';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function ioFor(mode: OutputMode): { io: CliIo; out: () => string; err: () => string } {
  let o = '';
  let e = '';
  const writers: Writers = {
    out: (t) => {
      o += t;
    },
    err: (t) => {
      e += t;
    },
  };
  return { io: { mode, writers }, out: () => o, err: () => e };
}

/**
 * EVERY FIXTURE MUST DECLARE THAT THE BINARY RUNS (plan 082 · F007).
 *
 * `installHooks` asks `--version` before it hands over `install-hooks`, and an
 * unconfigured fake answers exit 0 with silence — which is REFUSED. That is
 * deliberate: a fixture that has not said the binary works must break loudly
 * rather than sail through the guard and assert nothing.
 */
const VIABLE = { [`${BINARY} --version`]: { code: 0, stdout: 'git-ai 1.6.22' } };

/** The shipped pin with one digest swapped for the fake payload's real digest. */
function testPin() {
  return {
    ...GITAI_PIN,
    artifacts: {
      ...GITAI_PIN.artifacts,
      'macos-arm64': { file: 'git-ai-macos-arm64', sha256: new NodeHash().sha256Hex(PAYLOAD) },
    },
  } as typeof GITAI_PIN;
}

/**
 * Offline collector dependencies. Everything that would touch the world — the
 * network, the git-ai binary, git itself, the mode bit, the clock — is a fake,
 * which is what lets this run on a CI box with none of them installed.
 */
function offlineDeps(over: Partial<CollectorDeps> = {}): CollectorDeps & {
  fs: FakeCollectorFs;
  exec: FakeSequencedExec;
  http: FakeDownload;
} {
  const fs = new FakeCollectorFs();
  const exec = new FakeSequencedExec({
    ...VIABLE,
    [TRACE2_GET]: [
      { code: 1, stdout: '' },
      { code: 0, stdout: `${GITAI_TRACE2}\n` },
    ],
    [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
    [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
  });
  const http = new FakeDownload({ [ARTIFACT_URL]: ok200(PAYLOAD) });
  return {
    fs,
    exec,
    http,
    paths: new FakePathKind(),
    hash: new NodeHash(),
    exe: new FakeExecutableBit(),
    clock: new FakeClock(NOW),
    host: { platform: 'darwin', arch: 'arm64', home: HOME },
    cwd: '/repo',
    manifest: testPin(),
    ...over,
  } as CollectorDeps & { fs: FakeCollectorFs; exec: FakeSequencedExec; http: FakeDownload };
}

/** Run the REGISTERED command, exactly as the composition root would. */
async function run(
  io: CliIo,
  argv: string[],
  collector?: CollectorDeps,
): Promise<{ code: number }> {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerDoctorAct(program, io, EMPTY, undefined, collector);
  await expect(program.parseAsync(['node', 'harness', 'doctor', ...argv])).rejects.toThrow(
    /^exit:/,
  );
  return { code };
}

describe('the git-ai collector is reachable from the shipped CLI (P0)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a DEFAULT `harness doctor` carries the gitai-collector row, with no wiring by the caller', async () => {
    // This is the whole finding. The row was omitted whenever the composition
    // root failed to supply a host — which it always did — so the shipped doctor
    // was indistinguishable from one with no collector feature at all.
    const { io, out } = ioFor('json');
    await run(io, []);
    const env = JSON.parse(out());
    const layers = env.data.layers as Array<{ name: string; detail: string }>;
    const row = layers.find((layer) => layer.name === 'gitai-collector');

    expect(row).toBeDefined();
    expect(row?.detail.length).toBeGreaterThan(0);
  });

  it('the plain report invokes NOTHING — P7 still holds for a bare doctor run', async () => {
    const deps = offlineDeps();
    const { io } = ioFor('json');
    await run(io, [], deps);

    expect(deps.exec.calls).toEqual([]);
    expect(deps.http.calls).toEqual([]);
  });

  it('`--install-collector` runs the whole lifecycle through the CLI', async () => {
    const deps = offlineDeps();
    const { io, out } = ioFor('json');
    const { code } = await run(io, ['--install-collector'], deps);
    const env = JSON.parse(out());

    expect(env.data.action).toBe('install-collector');
    expect(env.data.cli).toBe('installed');
    expect(env.data.hooks).toBe('installed');
    // It really fetched, verified, placed and hooked — through the ports.
    expect(deps.http.calls.map((call) => call.url)).toEqual([ARTIFACT_URL]);
    expect(deps.fs.exists(BINARY)).toBe(true);
    expect(deps.exec.calls.some((call) => call.args[0] === 'install-hooks')).toBe(true);
    expect(readCollectorState(deps.fs, '/repo')?.hooks.status).toBe('installed');
    expect(code).toBe(0);
  });

  it('discloses what install-hooks changes, in the envelope, before anyone has to ask', async () => {
    const { io, out } = ioFor('json');
    await run(io, ['--install-collector'], offlineDeps());
    const env = JSON.parse(out());

    expect(env.data.disclosures.length).toBeGreaterThan(0);
    expect(env.data.disclosures.join(' ')).toContain('trace2');
  });

  it('a blocked guard degrades the envelope and prints manual steps — it never fails the run', async () => {
    const deps = offlineDeps({
      exec: new FakeSequencedExec({
        ...VIABLE,
        [TRACE2_GET]: { code: 0, stdout: 'trace2.normalTarget /tmp/trace\n' },
        [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
      }),
    });
    const { io, out } = ioFor('json');
    const { code } = await run(io, ['--install-collector'], deps);
    const env = JSON.parse(out());

    expect(env.status).toBe('degraded');
    expect(env.data.hooks).toBe('skipped-trace2');
    expect(env.data.manual.join('\n')).toContain('install-hooks');
    expect(code).toBe(0);
  });

  it('`--recheck-collector` is reachable and reports a harness added after the install', async () => {
    const deps = offlineDeps();
    const { io: installIo } = ioFor('json');
    await run(installIo, ['--install-collector'], deps);

    // A new coding harness appears on the machine afterwards.
    deps.fs.mkdirp(`${HOME}/.gemini`);
    const { io, out } = ioFor('json');
    await run(io, ['--recheck-collector'], deps);
    const env = JSON.parse(out());

    expect(env.data.action).toBe('recheck-collector');
    expect(env.data.newAgents).toContain('gemini');
  });

  it('`--regenerate-collector-pin` hashes every artifact and prints a reviewable pin', async () => {
    const version = 'v9.9.9';
    const scripts: Record<string, ReturnType<typeof ok200>> = {};
    for (const artifact of Object.values(GITAI_PIN.artifacts)) {
      scripts[`${GITAI_PIN.release_base_url}/${version}/${artifact.file}`] = ok200(PAYLOAD);
    }
    const deps = offlineDeps({ http: new FakeDownload(scripts) });
    const { io, out } = ioFor('json');
    const { code } = await run(io, ['--regenerate-collector-pin', version], deps);
    const env = JSON.parse(out());

    expect(env.status).toBe('ok');
    expect(env.data.version).toBe(version);
    expect(Object.keys(env.data.digests)).toHaveLength(6);
    expect(env.data.text).toContain("version: 'v9.9.9'");
    expect(code).toBe(0);
  });

  it('an all-or-nothing pin failure writes nothing and exits non-zero', async () => {
    // Five of six is worse than no bump: the missing platform silently keeps the
    // old digest and no reviewer can see which line is stale.
    const deps = offlineDeps({ http: new FakeDownload({}) });
    const { io, out } = ioFor('json');
    const { code } = await run(io, ['--regenerate-collector-pin', 'v9.9.9'], deps);
    const env = JSON.parse(out());

    expect(env.status).toBe('error');
    expect(env.error.message).toContain('ABORTED');
    expect(code).not.toBe(0);
  });
});
