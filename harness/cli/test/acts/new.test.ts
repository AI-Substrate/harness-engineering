import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerNewAct } from '../../src/acts/new.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

function ioFor(mode: OutputMode): { io: CliIo; out: () => string; err: () => string } {
  let stdout = '';
  let stderr = '';
  const writers: Writers = {
    out: (text) => (stdout += text),
    err: (text) => (stderr += text),
  };
  return { io: { mode, writers }, out: () => stdout, err: () => stderr };
}

function depsWith(fs: FakeFs) {
  return { fs, proc: new FakeProcess({}, '/repo'), clock: new FakeClock() };
}

describe('registerNewAct — v2-only minting surface', () => {
  afterEach(() => vi.restoreAllMocks());

  function run(args: string[], io: CliIo, fs: FakeFs): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
      code = value ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerNewAct(program, io, depsWith(fs));
    expect(() => program.parse(['node', 'harness', 'new', ...args])).toThrow(/^exit:/);
    return code;
  }

  it('emits the default v2-ts package and actionable envelope', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    expect(run(['greet'], io, fs)).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      command: 'new',
      status: 'ok',
      data: {
        path: '.harness/extensions/greet/extension.ts',
        instructionsPath: '.harness/extensions/greet/instructions.md',
        verb: 'greet',
        variant: 'v2-ts',
      },
    });
    expect(JSON.parse(out()).next_action).toContain('implement run()');
  });

  it('offers --sub/--wrap/--js/--sensor and no retired v1/flat flags', () => {
    const { io } = ioFor('json');
    const program = new Command().name('harness').exitOverride();
    registerNewAct(program, io, depsWith(new FakeFs()));
    const flags = program.commands
      .find((command) => command.name() === 'new')
      ?.options.map((option) => option.long);
    expect(flags).toEqual(
      expect.arrayContaining(['--sub', '--wrap', '--js', '--sensor', '--force']),
    );
    expect(flags).not.toEqual(expect.arrayContaining(['--record', '--flat', '--legacy']));
  });

  it('--sub parses comma-separated names into v2-sub-ts', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    expect(run(['db', '--sub', 'reset,seed'], io, fs)).toBe(0);
    expect(JSON.parse(out()).data.variant).toBe('v2-sub-ts');
    expect(JSON.parse(out()).next_action).toContain('harness db --help');
    const source = fs.readText('/repo/.harness/extensions/db/extension.ts') ?? '';
    expect(source).toContain("'reset': {");
    expect(source).toContain("'seed': {");
  });

  it('--wrap emits a working bounded v2 wrapper', () => {
    const { io, out } = ioFor('json');
    expect(run(['test', '--wrap', 'npm test'], io, new FakeFs())).toBe(0);
    expect(JSON.parse(out()).data.variant).toBe('v2-wrap-ts');
    expect(JSON.parse(out()).next_action).not.toContain('implement run()');
  });

  it('--sensor emits a runnable typed sensor variant', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    expect(run(['lint-count', '--sensor'], io, fs)).toBe(0);
    expect(JSON.parse(out()).data.variant).toBe('v2-sensor-ts');
    expect(JSON.parse(out()).next_action).toContain('harness sensors run lint-count');
    expect(fs.readText('/repo/.harness/extensions/lint-count/extension.ts')).toContain(
      'sensors: {',
    );
  });

  it('--js emits the v2 bare-literal variant', () => {
    const { io, out } = ioFor('json');
    expect(run(['seed', '--js'], io, new FakeFs())).toBe(0);
    expect(JSON.parse(out()).data).toMatchObject({
      variant: 'v2-js',
      path: '.harness/extensions/seed/extension.js',
    });
  });

  it('maps invalid combinations to E108 without writing', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    expect(run(['db', '--sensor', '--wrap', 'npm test'], io, fs)).toBe(1);
    expect(JSON.parse(out()).error.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(fs.writes).toEqual([]);
  });

  it('maps reserved/existing names to the stable scaffold errors', () => {
    const reservedIo = ioFor('json');
    const reservedFs = new FakeFs();
    expect(run(['help'], reservedIo.io, reservedFs)).toBe(1);
    expect(JSON.parse(reservedIo.out()).error.code).toBe(ErrorCodes.SCAFFOLD_NAME_RESERVED);

    vi.restoreAllMocks();
    const existingIo = ioFor('json');
    const existingFs = new FakeFs({
      '/repo/.harness/extensions/greet/extension.ts': '// existing',
    });
    expect(run(['greet'], existingIo.io, existingFs)).toBe(1);
    expect(JSON.parse(existingIo.out()).error.code).toBe(ErrorCodes.SCAFFOLD_FILE_EXISTS);
  });

  it('human mode prints both created paths', () => {
    const { io, out } = ioFor('human');
    expect(run(['greet'], io, new FakeFs())).toBe(0);
    expect(out()).toContain('Created .harness/extensions/greet/extension.ts');
    expect(out()).toContain('.harness/extensions/greet/instructions.md');
  });
});
