import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRunAct } from '../../src/acts/run.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';

function jsonIo(): { io: CliIo; out: () => string } {
  let o = '';
  const writers: Writers = {
    out: (t) => {
      o += t;
    },
    err: () => {},
  };
  return { io: { mode: 'json', writers }, out: () => o };
}

describe('registerRunAct — run <slot> dispatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(argv: string[]): { env: Record<string, unknown>; code: number } {
    const { io, out } = jsonIo();
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerRunAct(program, io);
    expect(() => program.parse(['node', 'harness', 'run', ...argv])).toThrow(/^exit:/);
    return { env: JSON.parse(out()), code };
  }

  it('run smoke → unconfigured envelope (command:run) and exit 2 (workshop 001)', () => {
    const { env, code } = run(['smoke']);
    expect(env.command).toBe('run');
    expect(env.status).toBe('unconfigured');
    expect(String(env.next_action)).toContain('smoke');
    expect(code).toBe(2);
  });

  it("run smoke --dry-run → data {dry_run, slot:'smoke', mapped_command:null}, exit 2", () => {
    const { env, code } = run(['smoke', '--dry-run']);
    expect(env.command).toBe('run');
    expect(env.data).toEqual({ dry_run: true, slot: 'smoke', mapped_command: null });
    expect(code).toBe(2);
  });

  it('run (no slot) → E108 error envelope and exit 1', () => {
    const { env, code } = run([]);
    expect(env.status).toBe('error');
    expect((env.error as { code: string }).code).toBe('E108');
    expect(code).toBe(1);
  });

  it('run <unknown> → E110 SLOT_UNKNOWN error and exit 1', () => {
    const { env, code } = run(['not-a-real-slot']);
    expect(env.status).toBe('error');
    expect((env.error as { code: string }).code).toBe('E110');
    expect(code).toBe(1);
  });
});
