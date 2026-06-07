import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDoctorAct } from '../../src/acts/doctor.js';
import type { Writers } from '../../src/output/output-port.js';

function capture(): { writers: Writers; out: () => string; err: () => string } {
  let o = '';
  let e = '';
  return {
    writers: {
      out: (t) => {
        o += t;
      },
      err: (t) => {
        e += t;
      },
    },
    out: () => o,
    err: () => e,
  };
}

describe('registerDoctorAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(argv: string[], writers: Writers): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness').option('--json').option('--no-json');
    registerDoctorAct(program, writers, {});
    expect(() => program.parse(['node', 'harness', ...argv])).toThrow(/^exit:/);
    return code;
  }

  it('doctor --json emits a degraded envelope with data.layers and exits 0', () => {
    const cap = capture();
    const code = run(['--json', 'doctor'], cap.writers);
    const env = JSON.parse(cap.out());
    expect(env.command).toBe('doctor');
    // In this repo the slots are all unconfigured, so doctor is degraded (still exit 0).
    expect(env.status).toBe('degraded');
    expect(Array.isArray(env.data.layers)).toBe(true);
    expect(env.data.layers.map((l: { name: string }) => l.name)).toEqual([
      'toolchain',
      'cli-build',
      'command-slots',
    ]);
    expect(env.next_action.length).toBeGreaterThan(0);
    expect(code).toBe(0);
  });

  it('doctor (human) writes the layered report to stderr and a summary to stdout, exits 0', () => {
    const cap = capture();
    const code = run(['--no-json', 'doctor'], cap.writers);
    expect(cap.err()).toContain('toolchain');
    expect(cap.err()).toContain('command-slots');
    expect(cap.out()).toContain('doctor:');
    expect(code).toBe(0);
  });
});
