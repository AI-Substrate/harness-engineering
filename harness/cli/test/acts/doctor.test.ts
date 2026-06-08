import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
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
      'cli-build',
      'extensions',
    ]);
    expect(env.next_action.length).toBeGreaterThan(0);
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
});
