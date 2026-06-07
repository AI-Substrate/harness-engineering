import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSlotAct } from '../../src/acts/unconfigured-slot.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { loadSlotRegistry } from '../../src/services/slots/slot-registry.js';

/** Top-level convenience slots = every slot except `run` (which has its own act). */
const TOP_LEVEL_SLOTS = ['validate', 'build', 'lint', 'test', 'smoke', 'health', 'observe'];

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

function programWithTopLevelSlots(io: CliIo): Command {
  const program = new Command().name('harness');
  for (const slot of loadSlotRegistry(new FakeFs()).filter((s) => s.name !== 'run')) {
    registerSlotAct(program, slot, io);
  }
  return program;
}

describe('registerSlotAct — wiring', () => {
  it('registers the seven top-level convenience slots (run is the dispatcher, separate)', () => {
    const { io } = ioFor('json');
    const names = programWithTopLevelSlots(io).commands.map((c) => c.name());
    expect(names).toEqual(TOP_LEVEL_SLOTS);
  });

  it('adds --dry-run only to validate', () => {
    const { io } = ioFor('json');
    const program = programWithTopLevelSlots(io);
    const hasDryRun = (name: string) =>
      program.commands
        .find((c) => c.name() === name)
        ?.options.some((o) => o.long === '--dry-run') ?? false;
    expect(hasDryRun('validate')).toBe(true);
    expect(hasDryRun('build')).toBe(false);
    expect(hasDryRun('observe')).toBe(false);
  });
});

describe('registerSlotAct — execution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(argv: string[], io: CliIo, out: () => string): { env: unknown; code: number } {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    expect(() => programWithTopLevelSlots(io).parse(['node', 'harness', ...argv])).toThrow(
      /^exit:/,
    );
    return { env: JSON.parse(out()), code };
  }

  it('a top-level slot emits its own command name as unconfigured and exits 2', () => {
    const { io, out } = ioFor('json');
    const { env, code } = run(['smoke'], io, out);
    expect((env as { command: string }).command).toBe('smoke');
    expect((env as { status: string }).status).toBe('unconfigured');
    expect(code).toBe(2);
  });

  it('validate --dry-run carries the dry-run payload and exits 2', () => {
    const { io, out } = ioFor('json');
    const { env, code } = run(['validate', '--dry-run'], io, out);
    expect((env as { command: string }).command).toBe('validate');
    expect((env as { data: unknown }).data).toEqual({
      dry_run: true,
      slot: 'validate',
      mapped_command: null,
    });
    expect(code).toBe(2);
  });
});
