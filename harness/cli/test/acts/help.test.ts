import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerHelpAct } from '../../src/acts/help.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

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

  function run(io: CliIo, registry: VerbRegistry): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerHelpAct(program, io, registry, new FakeFs());
    expect(() => program.parse(['node', 'harness', 'help'])).toThrow(/^exit:/);
    return code;
  }

  it('json mode emits a stable envelope with machine-readable data.verbs[] and exits 0', () => {
    const { io, out } = ioFor('json');
    const registry: VerbRegistry = {
      verbs: [mkVerb('hello')],
      records: [{ entryPath: '/x/hello.ts', status: 'loaded', verbs: [mkVerb('hello')] }],
    };
    const code = run(io, registry);
    const env = JSON.parse(out());
    expect(env.command).toBe('help');
    expect(env.status).toBe('ok');
    expect(Array.isArray(env.data.verbs)).toBe(true);
    expect(env.data.verbs[0]).toEqual({
      name: 'hello',
      summary: 'hello verb',
      status: 'loaded',
      has_instructions: false,
    });
    expect(env.data.agents_start_here).toContain('harness instructions');
    expect(out()).not.toContain('BUILTIN_SLOTS');
    expect(code).toBe(0);
  });

  it('empty registry → ok envelope with an honest no-extensions next_action', () => {
    const { io, out } = ioFor('json');
    const code = run(io, { verbs: [], records: [] });
    const env = JSON.parse(out());
    expect(env.data.verbs).toEqual([]);
    expect(env.next_action).toMatch(/\.harness\/extensions/);
    expect(code).toBe(0);
  });

  it('human mode prints rich text and exits 0', () => {
    const { io, out } = ioFor('human');
    const code = run(io, {
      verbs: [mkVerb('hello')],
      records: [{ entryPath: '/x/hello.ts', status: 'loaded', verbs: [mkVerb('hello')] }],
    });
    expect(out()).toContain('Commands:');
    expect(out()).toContain('doctor');
    expect(out()).toContain('Safe first actions:');
    expect(code).toBe(0);
  });
});
