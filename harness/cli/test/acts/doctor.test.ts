import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../src/adapters/hash/node-hash.js';
import { FakeSocketProbe } from '../../src/adapters/net/fake-socket-probe.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { GITAI_PIN } from '../../src/services/doctor/collector/pin.js';
import type { CollectorDeps } from '../../src/services/doctor/collector/types.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import { HOOK_MARKER } from '../../src/services/hooks/hook-marker.js';
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
  /**
   * THE SECOND HERMETIC SEAM — the HOME the report reads (plan 083).
   *
   * The `cursor-sandbox` row (#144) is emitted only when a Cursor marker exists in
   * the host's home AND that machine's `permissions.json`/`sandbox.json` do not
   * already permit the sandboxed command. With no fence, this suite read the REAL
   * `$HOME`, so **the layer list depended on the personal Cursor configuration of
   * whoever ran it**.
   *
   * MEASURED ON macOS, not inferred from the platform it was reported on: with
   * `HOME` pointed at a directory containing an empty `.cursor/`, this file fails
   * here with a thirteenth layer; with `HOME` pointed at an empty directory, it
   * passes. It surfaced on a Windows VM only because that box is an ordinary
   * Cursor install and this developer's Mac happens to carry a `permissions.json`
   * that allowlists both commands. **It is not a Windows behaviour and it was never
   * a reason to loosen the expected list** — an assertion relaxed here would have
   * hidden a real host-dependence on every OS.
   *
   * `homedir()` is fenced as well as `$HOME`/`%USERPROFILE%`, because `NodeEnv.home`
   * falls through to it — fencing only the variables would leave the fall-through
   * reading the real machine on any host that unsets them.
   *
   * Same class as the `FakeSocketProbe` above and the auto-install default in
   * `registerDoctorAct`: a unit test that behaves differently depending on the
   * machine is not hermetic. That makes three in this one surface, which is why
   * this is a fence rather than an expectation tweak.
   */
  let fencedHome: string;
  beforeEach(() => {
    fencedHome = mkdtempSync(join(tmpdir(), 'harness-doctor-home-'));
    vi.stubEnv('HOME', fencedHome);
    vi.stubEnv('USERPROFILE', fencedHome);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(fencedHome, { recursive: true, force: true });
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

  /**
   * A backslash is an ESCAPE CHARACTER inside a git config value, so a literal
   * `\\.\pipe\x` must be written doubled or git mangles it. Applied to every
   * target, which is a no-op for the POSIX one.
   */
  const gitEscape = (value: string): string => value.replace(/\\/g, '\\\\');

  /**
   * BOTH LIVE TRANSPORTS, ON EVERY HOST — and neither case is skipped (plan 083).
   *
   * This row used to build its af_unix target from a REAL temp directory, which on
   * Windows is `C:/Users/…`. `resolveTrace2Target` requires a POSIX leading `/` for
   * af_unix — deliberately, because af_unix is a POSIX transport and inventing
   * Windows semantics for it would be a guess — so the fabricated target classified
   * as `unconfigured`, nothing was `connectable`, and **the probe was never
   * consulted at all**. The row then failed accusing `registerDoctorAct` of
   * bypassing its injected seam, when the seam was never reached: an instrument
   * measuring nothing, the same shape as a fault-injection fixture that never
   * matches.
   *
   * The product was right and the FIXTURE was wrong. Windows' live transport is a
   * NAMED PIPE, which `Trace2TargetPolicy` already treats as connectable for the
   * stated reason that `net.createConnection({ path })` is the identical Node call
   * for both.
   *
   * Classification is a pure function of the STRING, so both cases run on every
   * host — no `skipIf`, no platform branch, and the Windows transport is covered by
   * the gate that runs on every push rather than by a VM. The socket/pipe name is
   * SYNTHETIC and absolute rather than a real temp path: it must not exist, so that
   * a real probe would have been a genuine `net.createConnection` and the fake is
   * demonstrably what answered.
   */
  const TRANSPORTS = [
    {
      label: 'af_unix socket (the POSIX transport)',
      // Synthetic and POSIX-absolute, so it classifies identically on every host.
      endpoint: '/harness-p074-doctor/never-listening.sock',
      target: (endpoint: string) => `af_unix:stream:${endpoint}`,
    },
    {
      label: 'Windows named pipe (the only transport git has there)',
      endpoint: '\\\\.\\pipe\\harness-p074-never-listening',
      target: (endpoint: string) => endpoint,
    },
  ] as const;

  it.each(
    TRANSPORTS,
  )('the INJECTED probe answers the ingress over a $label — no real socket is ever reached', async ({
    endpoint,
    target,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'p074-doctor-'));
    const gitconfig = join(dir, 'gitconfig');
    writeFileSync(gitconfig, `[trace2]\n\teventTarget = ${gitEscape(target(endpoint))}\n`);
    const previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = gitconfig;
    const injected = new FakeSocketProbe({ [endpoint]: 'denied' });

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
      expect(injected.calls).toEqual([endpoint]);
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

/**
 * F2 (review round 2) — THE STRING THE OPERATOR ACTUALLY READS.
 *
 * The first round pinned the refusal one layer below this, in the service, and
 * that is exactly how a success-shaped headline reached a bare doctor run
 * unnoticed: every service assertion was true and the sentence printed to stderr
 * said `harness installed … — no flag required` beside a warning that the binary
 * cannot run. This drives the REGISTERED command, so the assertion is on the
 * announcement itself.
 */
describe('plan 082 · F007 — a bare doctor never announces a refusal as an install', () => {
  const HOME_U = '/home/u';
  const GITAI = '/home/u/.git-ai/bin/git-ai';
  const BYTES = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
  /** STATUS_DLL_NOT_FOUND, as the Windows 11 guest reported it on 2026-08-10. */
  const DLL_NOT_FOUND = 3_221_225_781;

  /** The pinned manifest with one digest swapped for the fake payload's real one. */
  function testPin() {
    return {
      ...GITAI_PIN,
      artifacts: {
        ...GITAI_PIN.artifacts,
        'macos-arm64': { file: 'git-ai-macos-arm64', sha256: new NodeHash().sha256Hex(BYTES) },
      },
    } as typeof GITAI_PIN;
  }

  /** A machine where the pinned binary is present and digest-clean, and dead. */
  function brokenBinaryDeps(): CollectorDeps {
    const fs = new FakeCollectorFs();
    fs.seedBytes(GITAI, BYTES);
    fs.mkdirp(`${HOME_U}/.claude`);
    return {
      fs,
      paths: new FakePathKind({}),
      hash: new NodeHash(),
      http: new FakeDownload({}),
      exec: new FakeSequencedExec({
        [`${GITAI} --version`]: { code: DLL_NOT_FOUND, stdout: '', stderr: '' },
        'git config --global --get-regexp ^trace2\\.': { code: 1 },
      }),
      exe: new FakeExecutableBit(),
      clock: new FakeClock('2026-08-10T00:00:00.000Z'),
      host: { platform: 'darwin', arch: 'arm64', home: HOME_U },
      cwd: '/repo',
      manifest: testPin(),
    };
  }

  it('the announced line reports the refusal, not a successful install', async () => {
    const { io, err } = ioFor('text');
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      throw new Error(`exit:${c ?? 0}`);
    }) as never);
    const program = new Command().name('harness');
    registerDoctorAct(program, io, EMPTY, undefined, brokenBinaryDeps(), { probe }, true);
    await expect(program.parseAsync(['node', 'harness', 'doctor'])).rejects.toThrow(/^exit:/);
    const announced = err();

    expect(announced).toContain('git-ai collector:');
    // THE DEFECT, verbatim as it was printed.
    expect(announced).not.toContain('no flag required');
    expect(announced).not.toContain('harness installed the pinned git-ai collector');
    // What the same reader must see instead.
    expect(announced).toContain('could NOT be run');
    expect(announced).toContain('no AI attribution is being collected');
  });
});
