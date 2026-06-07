import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerHelpAct } from '../../src/acts/help.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

function ioFor(mode: OutputMode): { io: CliIo; out: () => string } {
  let o = '';
  const writers: Writers = {
    out: (t) => {
      o += t;
    },
    err: () => {},
  };
  return { io: { mode, writers }, out: () => o };
}

describe('registerHelpAct', () => {
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
    registerHelpAct(program, io);
    expect(() => program.parse(['node', 'harness', 'help'])).toThrow(/^exit:/);
    return code;
  }

  it('json mode emits a stable envelope with machine-readable data.slots[] and exits 0', () => {
    const { io, out } = ioFor('json');
    const code = run(io);
    const env = JSON.parse(out());
    expect(env.command).toBe('help');
    expect(env.status).toBe('ok');
    expect(Array.isArray(env.data.slots)).toBe(true);
    expect(env.data.slots).toHaveLength(8);
    expect(env.data.slots[0]).toHaveProperty('name');
    expect(env.data.slots[0]).toHaveProperty('status');
    expect(env.data.slots[0]).toHaveProperty('next_action');
    expect(code).toBe(0);
  });

  it('human mode prints rich text and exits 0', () => {
    const { io, out } = ioFor('human');
    const code = run(io);
    expect(out()).toContain('Commands:');
    expect(out()).toContain('doctor');
    expect(out()).toContain('Safe first actions:');
    expect(code).toBe(0);
  });
});
