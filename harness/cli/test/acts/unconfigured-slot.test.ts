import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSlotAct } from '../../src/acts/unconfigured-slot.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { loadSlotRegistry } from '../../src/services/slots/slot-registry.js';

function programWithSlots(): Command {
  const program = new Command().name('harness');
  for (const slot of loadSlotRegistry(new FakeFs())) {
    registerSlotAct(program, slot);
  }
  return program;
}

describe('registerSlotAct — wiring', () => {
  it('registers all eight slot commands', () => {
    const names = programWithSlots().commands.map((c) => c.name());
    expect(names).toEqual([
      'run',
      'validate',
      'build',
      'lint',
      'test',
      'smoke',
      'health',
      'observe',
    ]);
  });

  it('adds --dry-run only to run and validate', () => {
    const program = programWithSlots();
    const hasDryRun = (name: string) =>
      program.commands
        .find((c) => c.name() === name)
        ?.options.some((o) => o.long === '--dry-run') ?? false;
    expect(hasDryRun('run')).toBe(true);
    expect(hasDryRun('validate')).toBe(true);
    expect(hasDryRun('build')).toBe(false);
    expect(hasDryRun('observe')).toBe(false);
  });
});

describe('registerSlotAct — execution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runCommand(argv: string[]): { out: string; exitCode: number } {
    let out = '';
    let exitCode = -1;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`exit:${exitCode}`);
    }) as never);
    expect(() => programWithSlots().parse(['node', 'harness', ...argv])).toThrow(/^exit:/);
    return { out, exitCode };
  }

  it('an unconfigured slot emits a JSON envelope and exits 2', () => {
    const { out, exitCode } = runCommand(['smoke']);
    const env = JSON.parse(out);
    expect(env.command).toBe('smoke');
    expect(env.status).toBe('unconfigured');
    expect(env.next_action.length).toBeGreaterThan(0);
    expect(exitCode).toBe(2);
  });

  it('run --dry-run carries the dry-run payload and still exits 2', () => {
    const { out, exitCode } = runCommand(['run', '--dry-run']);
    const env = JSON.parse(out);
    expect(env.command).toBe('run');
    expect(env.data).toEqual({ dry_run: true, slot: 'run', mapped_command: null });
    expect(exitCode).toBe(2);
  });
});
