import { describe, expect, it } from 'vitest';
import { buildProgram, jsonFlag } from '../src/index.js';
import { type CliIo, selectMode } from '../src/output/output-port.js';

const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };

describe('jsonFlag — tri-state', () => {
  it('returns undefined when neither flag is present (let env/TTY decide)', () => {
    expect(jsonFlag(['node', 'harness', 'doctor'])).toBeUndefined();
  });

  it('returns true for --json and false for --no-json', () => {
    expect(jsonFlag(['node', 'harness', '--json'])).toBe(true);
    expect(jsonFlag(['node', 'harness', '--no-json'])).toBe(false);
  });
});

describe('output-mode resolution (F002 regression — flags registered, none passed)', () => {
  it('falls back to env/TTY when no flag is present, even though both flags exist', () => {
    // No flag → jsonFlag undefined → selectMode uses HARNESS_JSON, then TTY.
    const absent = jsonFlag(['node', 'harness', 'doctor']);
    expect(selectMode({ json: absent }, {}, false)).toBe('json'); // piped → json
    expect(selectMode({ json: absent }, {}, true)).toBe('human'); // interactive → human
    expect(selectMode({ json: absent }, { HARNESS_JSON: '1' }, true)).toBe('json'); // env override
  });

  it('an explicit flag still wins over env/TTY', () => {
    expect(
      selectMode({ json: jsonFlag(['node', 'h', '--no-json']) }, { HARNESS_JSON: '1' }, false),
    ).toBe('human');
  });
});

describe('buildProgram — composition root wiring', () => {
  it('registers help, doctor, the run dispatcher, and the 7 top-level slots', () => {
    const names = buildProgram('1.2.3', io).commands.map((c) => c.name());
    expect(names).toEqual([
      'help',
      'doctor',
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

  it('registers the global --json/--no-json options and --version', () => {
    const program = buildProgram('1.2.3', io);
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain('--json');
    expect(longs).toContain('--no-json');
    expect(program.version()).toBe('1.2.3');
  });
});
