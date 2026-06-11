import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerNewAct } from '../../src/acts/new.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

/*
Test Doc:
- Why: `harness new` is a CORE act; it must turn the scaffold-service outcome into the canonical
  Envelope (ok → exit 0; error → exit 1) and inject the real ports, with no business logic.
- Contract: `new <name> [--wrap <cmd>] [--js] [--force]` → ok envelope with
  data.{path,verb,variant,instructionsPath} on success (folder form since plan 014 AC-8: entry +
  starter instructions.md; there is NO --flat flag); error envelope (E15x/E108) with next_action
  on failure; never throws to the user.
- Quality Contribution: pins the act/envelope/exit wiring with fakes (P3).
*/

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

function depsWith(fs: FakeFs) {
  return { fs, proc: new FakeProcess({}, '/repo'), clock: new FakeClock() };
}

describe('registerNewAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(args: string[], io: CliIo, fs: FakeFs): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerNewAct(program, io, depsWith(fs));
    expect(() => program.parse(['node', 'harness', 'new', ...args])).toThrow(/^exit:/);
    return code;
  }

  it('scaffolds <name>/extension.ts + instructions.md and emits an ok envelope (exit 0) with both paths', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    const code = run(['greet'], io, fs);
    const env = JSON.parse(out());
    expect(env.command).toBe('new');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      path: '.harness/extensions/greet/extension.ts',
      instructionsPath: '.harness/extensions/greet/instructions.md',
      verb: 'greet',
      variant: 'minimal-ts',
    });
    expect(fs.writes).toContain('/repo/.harness/extensions/greet/extension.ts');
    expect(fs.writes).toContain('/repo/.harness/extensions/greet/instructions.md');
    expect(code).toBe(0);
  });

  it('exposes no --flat flag (the flat layout is retired, plan 014 AC-8)', () => {
    const { io } = ioFor('json');
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const program = new Command().name('harness').exitOverride();
    registerNewAct(program, io, depsWith(new FakeFs()));
    const newCmd = program.commands.find((c) => c.name() === 'new');
    expect(newCmd?.options.map((o) => o.long)).not.toContain('--flat');
  });

  it('--js scaffolds a .js file', () => {
    const { io, out } = ioFor('json');
    const code = run(['greet', '--js'], io, new FakeFs());
    expect(JSON.parse(out()).data.path).toBe('.harness/extensions/greet/extension.js');
    expect(code).toBe(0);
  });

  it('--wrap emits the wrap variant', () => {
    const { io, out } = ioFor('json');
    const code = run(['test', '--wrap', 'npm test'], io, new FakeFs());
    const env = JSON.parse(out());
    expect(env.data.variant).toBe('wrap-ts');
    // wrap scaffolds already have a working run() — next_action must NOT say "implement run()" (MH-003)
    expect(env.next_action).not.toContain('implement run()');
    expect(env.next_action).toContain('harness test');
    expect(code).toBe(0);
  });

  it('a minimal stub tells the author to implement run()', () => {
    const { io, out } = ioFor('json');
    const code = run(['greet'], io, new FakeFs());
    expect(JSON.parse(out()).next_action).toContain('implement run()');
    expect(code).toBe(0);
  });

  it('a reserved name is rejected (E151, exit 1) and writes nothing', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    const code = run(['help'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe(ErrorCodes.SCAFFOLD_NAME_RESERVED);
    expect(env.next_action.length).toBeGreaterThan(0);
    expect(fs.writes).toEqual([]);
    expect(code).toBe(1);
  });

  it('--record scaffolds a record-type stub and points at `harness record <name>`', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    const code = run(['dev-survey', '--record'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      path: '.harness/extensions/dev-survey/extension.ts',
      verb: 'dev-survey',
      variant: 'record-ts',
    });
    expect(env.next_action).toContain('harness record dev-survey');
    expect(fs.writes).toContain('/repo/.harness/extensions/dev-survey/extension.ts');
    expect(code).toBe(0);
  });

  it('`new record` is rejected as a reserved name (E151)', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    const code = run(['record'], io, fs);
    expect(JSON.parse(out()).error.code).toBe(ErrorCodes.SCAFFOLD_NAME_RESERVED);
    expect(fs.writes).toEqual([]);
    expect(code).toBe(1);
  });

  it('an existing file without --force is rejected (E152, exit 1)', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs({ '/repo/.harness/extensions/greet/extension.ts': '// existing' });
    const code = run(['greet'], io, fs);
    expect(JSON.parse(out()).error.code).toBe(ErrorCodes.SCAFFOLD_FILE_EXISTS);
    expect(code).toBe(1);
  });

  it('human mode prints a friendly Created line and exits 0', () => {
    const { io, out } = ioFor('human');
    const code = run(['greet'], io, new FakeFs());
    expect(out()).toContain('Created .harness/extensions/greet/extension.ts');
    expect(out()).toContain('.harness/extensions/greet/instructions.md');
    expect(code).toBe(0);
  });
});
