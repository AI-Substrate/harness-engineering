import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import { FakeSocketProbe } from '../../src/adapters/net/fake-socket-probe.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

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
      'telemetry-flush-hook',
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
      'dd-cli',
      'precommit-hook-latency',
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
    const socket = join(dir, 'never-listening.sock');
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
