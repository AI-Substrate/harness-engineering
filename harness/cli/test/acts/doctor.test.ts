import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
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

describe('registerDoctorAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(io: CliIo, registry: VerbRegistry = EMPTY): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerDoctorAct(program, io, registry);
    expect(() => program.parse(['node', 'harness', 'doctor'])).toThrow(/^exit:/);
    return code;
  }

  it('json mode emits an envelope with data.layers (incl. extensions) and exits 0', () => {
    const { io, out } = ioFor('json');
    const code = run(io);
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
      'dd-documents',
      'precommit-hook-latency',
      'instructions',
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

  it('human mode writes the layered report to stderr and a summary to stdout, exits 0', () => {
    const { io, out, err } = ioFor('human');
    const code = run(io);
    expect(err()).toContain('toolchain');
    expect(err()).toContain('extensions');
    expect(out()).toContain('doctor:');
    expect(code).toBe(0);
  });

  it('quiet JSON mode emits only extension names, statuses, and verb names', () => {
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

    const code = run({ ...io, quiet: true }, registry);
    const env = JSON.parse(out());
    expect(env.data.extensions).toEqual([{ name: 'demo', status: 'loaded', verbs: ['demo'] }]);
    expect(code).toBe(0);
  });
});
