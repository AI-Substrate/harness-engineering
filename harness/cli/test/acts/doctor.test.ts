import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../src/adapters/hash/node-hash.js';
import { FakeSocketProbe } from '../../src/adapters/net/fake-socket-probe.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import type { CollectorDeps } from '../../src/services/doctor/collector/types.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import { HOOK_MARKER } from '../../src/services/hooks/hook-marker.js';
import { toPosix } from '../../src/services/shared/posix-path.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  FakePathKind,
  FakeSequencedExec,
} from '../support/collector-fakes.js';

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

const EMPTY: VerbRegistry = { verbs: [], records: [] };

/**
 * Offline collector deps whose EXEC calls are recorded into `calls`.
 *
 * Nothing here can reach the network or the real filesystem: the download port
 * has no script for any url and so always reports a network failure, which is
 * also a free exercise of the warn-only failure path.
 *
 * BOTH ports record, and that matters: on a clean fake fs the install fails at
 * the DOWNLOAD and returns before `install-hooks` is ever exec'd, so an
 * exec-only observable reads empty on a run that very much happened. The first
 * version of this helper watched exec alone and would have reported the
 * opted-in run as inert — proving the guard by measuring the wrong port.
 */
function collectorDepsRecording(calls: string[]): CollectorDeps {
  const exec = new FakeSequencedExec({});
  const recording: typeof exec = new Proxy(exec, {
    get(target, prop, receiver) {
      if (prop === 'run') {
        return async (command: string, args: string[], opts: { cwd: string }) => {
          calls.push([command, ...args].join(' '));
          return target.run(command, args, opts);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const http = new FakeDownload({});
  const recordingHttp: typeof http = new Proxy(http, {
    get(target, prop, receiver) {
      if (prop === 'get') {
        return async (url: string, opts: { timeoutMs: number }) => {
          calls.push(`GET ${url}`);
          return target.get(url, opts);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return {
    fs: new FakeCollectorFs(),
    paths: new FakePathKind({}),
    hash: new NodeHash(),
    http: recordingHttp,
    exec: recording,
    exe: new FakeExecutableBit(),
    clock: new FakeClock('2026-08-09T00:00:00.000Z'),
    host: { platform: 'darwin', arch: 'arm64', home: '/home/u' },
    cwd: '/repo',
  };
}

/**
 * The HERMETIC seam (review F006). `absent` is the honest default for a machine
 * with no daemon, and — crucially — it is the SAME answer on every host, so this
 * suite no longer depends on whether the developer running it has git-ai
 * installed. It also records its calls, which is how the last assertion proves
 * the act never reached `net.createConnection`.
 */
const probe = new FakeSocketProbe({}, 'absent');

describe('registerDoctorAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `parseAsync` since plan 074: doctor's report path awaits ONE ingress probe
  // (a socket connect cannot be synchronous), so the act returns a promise on
  // both branches. The composition root already parses with `parseAsync`.
  //
  // The probe is a FAKE (review F006). Without the injection this act built the
  // real `NodeSocketProbe`, so on any machine whose global `trace2.eventTarget`
  // is an `af_unix` path — every developer box with git-ai installed — this test
  // performed a genuine `net.createConnection`. A unit test that behaves
  // differently depending on the host's git config is not hermetic, and ac-000a
  // says the CI path never touches a real socket.
  async function run(io: CliIo, registry: VerbRegistry = EMPTY): Promise<number> {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerDoctorAct(program, io, registry, undefined, undefined, { probe });
    await expect(program.parseAsync(['node', 'harness', 'doctor'])).rejects.toThrow(/^exit:/);
    return code;
  }

  it('json mode emits an envelope with data.layers (incl. extensions) and exits 0', async () => {
    const { io, out } = ioFor('json');
    const code = await run(io);
    const env = JSON.parse(out());
    expect(env.command).toBe('doctor');
    expect(['ok', 'degraded']).toContain(env.status);
    expect(env.data.layers.map((l: { name: string }) => l.name)).toEqual([
      'toolchain',
      'node-runtime',
      'cli-build',
      'version-skew',
      'extensions',
      'quality-gate',
      'sensor-watcher',
      'capture-liveness',
      // plan 073 — wired by DEFAULT. The row was previously omitted whenever the
      // composition root supplied no host, which it always did; a doctor without
      // this row cannot say "nothing is collecting your AI attribution", which is
      // the only thing it exists to say.
      'gitai-collector',
      // plan 074 · ac-0003 — the at-risk row, present because this act wires a
      // real repo's attribution reads. READ-ONLY: it names the nudge, never runs it.
      'attribution-at-risk',
      'dd-documents',
      'instructions',
      // plan 074 · ac-0008 — warns when AGENTS.md carries no managed block.
      'commit-guidance',
      'record-types',
    ]);
    // Envelope contract: degraded always carries a next_action; ok need not (FX001 —
    // pre-fix this cwd was perpetually degraded via the false consumer cli-build check,
    // which made next_action look unconditional).
    if (env.status === 'degraded') {
      expect(env.next_action.length).toBeGreaterThan(0);
    }
    expect(code).toBe(0);
  });

  it('human mode writes the layered report to stderr and a summary to stdout, exits 0', async () => {
    const { io, out, err } = ioFor('human');
    const code = await run(io);
    expect(err()).toContain('toolchain');
    expect(err()).toContain('extensions');
    expect(out()).toContain('doctor:');
    expect(code).toBe(0);
  });

  it('quiet JSON mode emits only extension names, statuses, and verb names', async () => {
    const { io, out } = ioFor('json');
    const verb: HarnessVerb = {
      name: 'demo',
      summary: 'Verbose summary.',
      description: 'Verbose description.',
      options: [{ flags: '--value <value>', description: 'Verbose option.' }],
      run: () => ({ status: 'ok' }),
    };
    const registry: VerbRegistry = {
      verbs: [verb],
      records: [
        {
          entryPath: '/repo/.harness/extensions/demo/extension.ts',
          status: 'loaded',
          verbs: [verb],
        },
      ],
    };

    const code = await run({ ...io, quiet: true }, registry);
    const env = JSON.parse(out());
    expect(env.data.extensions).toEqual([{ name: 'demo', status: 'loaded', verbs: ['demo'] }]);
    expect(code).toBe(0);
  });
});

describe('registerDoctorAct — CI hermeticity (plan 074 · ac-000a, review F006)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the INJECTED probe answers the ingress — no real socket is ever reached', async () => {
    // The guard that would have caught F006. `GIT_CONFIG_GLOBAL` forces an
    // af_unix target so the probe is definitely consulted, which makes the
    // assertion independent of whatever this machine's git config says — and
    // the socket path is one that does not exist, so a REAL probe would have
    // been an actual `net.createConnection` against the filesystem.
    const dir = mkdtempSync(join(tmpdir(), 'p074-doctor-'));
    const gitconfig = join(dir, 'gitconfig');
    // toPosix, not join()'s raw output: a backslash is an ESCAPE CHARACTER inside a
    // git config value, so a native Windows path here turns `\n` into a literal
    // newline and git rejects the entire file (`fatal: bad config line 2`) — the
    // probe is then never consulted, and the test fails accusing `registerDoctorAct`
    // of bypassing its injected seam, which is the wrong component entirely (plan
    // 108 B1). Git accepts forward slashes on Windows, so this is a no-op on POSIX.
    const socket = toPosix(join(dir, 'never-listening.sock'));
    writeFileSync(gitconfig, `[trace2]\n\teventTarget = af_unix:stream:${socket}\n`);
    const previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = gitconfig;
    const injected = new FakeSocketProbe({ [socket]: 'denied' });

    try {
      let code = -1;
      vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
        code = c ?? 0;
        throw new Error(`exit:${code}`);
      }) as never);
      const { io } = ioFor('json');
      const program = new Command().name('harness');
      registerDoctorAct(program, io, EMPTY, undefined, undefined, { probe: injected });
      await expect(program.parseAsync(['node', 'harness', 'doctor'])).rejects.toThrow(/^exit:/);

      // The act used the injected seam, not `net.createConnection`.
      expect(injected.calls).toEqual([socket]);
      expect(code).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Plan 077 — the auto-install is OPT-IN, and the opt-in is the only lever.
 *
 * Production and this suite both call `registerDoctorAct` with no
 * `collectorOverride`, so nothing inside the act can tell them apart. Had the
 * auto-install defaulted ON, `vitest` would have fetched a git-ai release and
 * run `install-hooks` machine-wide on whatever box ran it — the ac-000a
 * hermeticity failure review F006 found for the socket probe, with an
 * install-sized blast radius instead of a connect-sized one.
 *
 * It survived development unnoticed for an instructive reason: the dev machine
 * already had a healthy collector, so the install path short-circuited and the
 * suite was green for a cause unrelated to the guard. So these two assert the
 * PORTS, not the outcome — the same fake deps, driven both ways, and the only
 * difference is the flag.
 */
describe('plan 077 — a bare doctor auto-installs ONLY when production opts in', () => {
  async function runWith(autoInstall: boolean): Promise<{ exec: string[]; announced: string }> {
    const calls: string[] = [];
    const deps = collectorDepsRecording(calls);
    const { io, err } = ioFor('text');
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      throw new Error(`exit:${c ?? 0}`);
    }) as never);
    const program = new Command().name('harness');
    registerDoctorAct(program, io, EMPTY, undefined, deps, { probe }, autoInstall);
    await expect(program.parseAsync(['node', 'harness', 'doctor'])).rejects.toThrow(/^exit:/);
    return { exec: calls, announced: err() };
  }

  it('DEFAULT (no opt-in): the collector ports are never touched', async () => {
    const { exec, announced } = await runWith(false);

    expect(exec).toEqual([]);
    expect(announced).not.toContain('git-ai collector:');
  });

  it('OPT-IN: the same deps ARE driven, and the run says what it did', async () => {
    const { exec, announced } = await runWith(true);

    // The guard is what makes the first assertion meaningful: if this one also
    // came back empty, the test above would be proving nothing.
    expect(exec.length).toBeGreaterThan(0);
    expect(announced).toContain('git-ai collector:');
  });
});

/**
 * THE GUARD THAT DID NOT EXIST, and its absence cost a real developer's editor
 * configs (2026-08-10, plan 082 tk-0002).
 *
 * WHAT HAPPENED. `harness doctor` gained a second installer — our agent hooks —
 * and its call site read the COMPOSITION ROOT's own adapters rather than the
 * injected `collectorOverride`:
 *
 *   autoInstallHooks(hooksDeps({ fs, clock, env }))
 *
 * `hooksDeps` resolves `env.home()`, so the injected fence moved the collector's
 * installer and not ours. The row directly above — `runWith(true)`, written for
 * plan 077 AFTER THE IDENTICAL BUG, whose own doc comment names "an install-sized
 * blast radius" — then ran the real installer against the real machine. It is in
 * the FAST test scope, so EVERY `just checks` reinfected the box, not just one run.
 *
 * WHY NOTHING CAUGHT IT. Plan 077's protection has two halves — an opt-in FLAG and
 * an injection SEAM — and only the flag is visible in the function signature. A
 * competent reader satisfies the visible half and walks past the other. That is a
 * property of the guard, not of the reader, which is why this file now asserts the
 * seam MECHANICALLY instead of trusting the next person to notice it.
 *
 * The assertion is deliberately POSITIVE as well as negative: proving "nothing was
 * written outside the fence" is satisfied by an install that never ran at all, and
 * a vacuous guard is how this class survives. So it also proves the install DID
 * happen, inside the injected filesystem.
 */
describe('plan 082 — doctor installs hooks ONLY into the INJECTED deps', () => {
  it('writes our hook into the injected fs at the injected home, and nowhere else', async () => {
    const calls: string[] = [];
    const deps = collectorDepsRecording(calls);
    const fs = deps.fs as FakeCollectorFs;
    // A DETECTED agent inside the fence. Without this nothing is installed and
    // every assertion below passes for the wrong reason.
    fs.mkdirp(`${deps.host.home}/.cursor`);

    const { io } = ioFor('text');
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      throw new Error(`exit:${c ?? 0}`);
    }) as never);
    const program = new Command().name('harness');
    registerDoctorAct(program, io, EMPTY, undefined, deps, { probe }, true);
    await expect(program.parseAsync(['node', 'harness', 'doctor'])).rejects.toThrow(/^exit:/);

    // POSITIVE: the install ran, through the INJECTED filesystem.
    const written = [...fs.files.keys()];
    const config = written.find((p) => p.endsWith('/.cursor/hooks.json'));
    expect(config).toBe(`${deps.host.home}/.cursor/hooks.json`);
    expect(new TextDecoder().decode(fs.files.get(config as string))).toContain(HOOK_MARKER);

    // NEGATIVE: nothing landed outside the injected home, and in particular
    // nothing landed under the REAL one. The real home is named explicitly because
    // that is the failure that actually happened — a generic prefix check would
    // pass on a machine whose home happens to sit under the fake path.
    const realHome = homedir().replace(/\\/g, '/');
    for (const path of written) {
      expect(path.startsWith(realHome)).toBe(false);
    }
  });
});
