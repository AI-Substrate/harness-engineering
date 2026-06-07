import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

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

describe('registerDoctorAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(io: CliIo): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerDoctorAct(program, io);
    expect(() => program.parse(['node', 'harness', 'doctor'])).toThrow(/^exit:/);
    return code;
  }

  it('json mode emits a degraded envelope with data.layers and exits 0', () => {
    const { io, out } = ioFor('json');
    const code = run(io);
    const env = JSON.parse(out());
    expect(env.command).toBe('doctor');
    // In this repo every slot is unconfigured, so doctor is degraded (still exit 0).
    expect(env.status).toBe('degraded');
    expect(env.data.layers.map((l: { name: string }) => l.name)).toEqual([
      'toolchain',
      'cli-build',
      'command-slots',
    ]);
    expect(env.next_action.length).toBeGreaterThan(0);
    expect(code).toBe(0);
  });

  it('human mode writes the layered report to stderr and a summary to stdout, exits 0', () => {
    const { io, out, err } = ioFor('human');
    const code = run(io);
    expect(err()).toContain('toolchain');
    expect(err()).toContain('command-slots');
    expect(out()).toContain('doctor:');
    expect(code).toBe(0);
  });
});
