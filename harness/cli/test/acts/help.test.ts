import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerHelpAct } from '../../src/acts/help.js';
import type { Writers } from '../../src/output/output-port.js';

function capture(): { writers: Writers; out: () => string } {
  let o = '';
  return {
    writers: {
      out: (t) => {
        o += t;
      },
      err: () => {},
    },
    out: () => o,
  };
}

describe('registerHelpAct', () => {
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
    registerHelpAct(program, writers);
    expect(() => program.parse(['node', 'harness', ...argv])).toThrow(/^exit:/);
    return code;
  }

  it('help --json emits a stable envelope with machine-readable data.slots[] and exits 0', () => {
    const cap = capture();
    const code = run(['--json', 'help'], cap.writers);
    const env = JSON.parse(cap.out());
    expect(env.command).toBe('help');
    expect(env.status).toBe('ok');
    expect(Array.isArray(env.data.slots)).toBe(true);
    expect(env.data.slots).toHaveLength(8);
    expect(env.data.slots[0]).toHaveProperty('name');
    expect(env.data.slots[0]).toHaveProperty('status');
    expect(env.data.slots[0]).toHaveProperty('next_action');
    expect(code).toBe(0);
  });

  it('help (human) prints rich text and exits 0', () => {
    const cap = capture();
    const code = run(['--no-json', 'help'], cap.writers);
    expect(cap.out()).toContain('Commands:');
    expect(cap.out()).toContain('doctor');
    expect(cap.out()).toContain('Safe first actions:');
    expect(code).toBe(0);
  });
});
