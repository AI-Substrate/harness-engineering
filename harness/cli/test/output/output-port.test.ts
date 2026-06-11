import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { formatOk, formatUnconfigured } from '../../src/output/envelope.js';
import { exitWithEnvelope } from '../../src/output/exit.js';
import {
  createOutputPort,
  type OutputPort,
  renderHuman,
  renderJson,
  selectMode,
  type Writers,
} from '../../src/output/output-port.js';

function fakeWriters() {
  const out: string[] = [];
  const err: string[] = [];
  const writers: Writers = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { writers, out, err };
}

describe('selectMode (precedence: flag > env > TTY)', () => {
  it('--json flag wins over everything', () => {
    /*
    Test Doc:
    - Why: agents need a deterministic way to force JSON; the flag must beat env + TTY.
    - Contract: flags.json===true => 'json' regardless of env/TTY.
    - Usage Notes: --no-json (flags.json===false) forces human even when piped.
    - Quality Contribution: locks the precedence agents/CI depend on.
    - Worked Example: selectMode({json:true}, {HARNESS_JSON:'0'}, true) === 'json'.
    */
    expect(selectMode({ json: true }, { HARNESS_JSON: '0' }, true)).toBe('json');
  });

  it('--no-json flag forces human even when piped + env set', () => {
    expect(selectMode({ json: false }, { HARNESS_JSON: '1' }, false)).toBe('human');
  });

  it('HARNESS_JSON=1 wins when no flag', () => {
    expect(selectMode({}, { HARNESS_JSON: '1' }, true)).toBe('json');
  });

  it('falls back to TTY: interactive => human', () => {
    expect(selectMode({}, {}, true)).toBe('human');
  });

  it('falls back to TTY: piped => json', () => {
    expect(selectMode({}, {}, false)).toBe('json');
  });
});

describe('renderJson', () => {
  it('writes exactly one parseable JSON line to stdout, nothing to stderr', () => {
    const { writers, out, err } = fakeWriters();
    const env = formatOk('help', { ok: true }, new FakeClock());
    renderJson(env, writers);
    expect(out).toHaveLength(1);
    expect(out[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(out[0])).toEqual(env);
    expect(err).toHaveLength(0);
  });
});

describe('renderHuman', () => {
  it('summary to stdout, next_action diagnostic to stderr', () => {
    /*
    Test Doc:
    - Why: humans read diagnostics on stderr; the pipeable summary must stay on stdout (workshop 001).
    - Contract: renderHuman writes "<command>: <status>" to stdout; non-ok next_action to stderr.
    - Usage Notes: ok envelopes (no next_action) write nothing to stderr.
    - Quality Contribution: guards the stdout/stderr split the contract promises.
    - Worked Example: unconfigured 'run' => stdout "run: unconfigured", stderr "→ <next_action>".
    */
    const { writers, out, err } = fakeWriters();
    const env = formatUnconfigured('run', 'Configure the slot.', new FakeClock());
    renderHuman(env, writers);
    expect(out).toEqual(['run: unconfigured\n']);
    expect(err).toEqual(['→ Configure the slot.\n']);
  });

  it('ok envelope writes only the summary to stdout', () => {
    const { writers, out, err } = fakeWriters();
    renderHuman(formatOk('help', {}, new FakeClock()), writers);
    expect(out).toEqual(['help: ok\n']);
    expect(err).toHaveLength(0);
  });
});

describe('createOutputPort', () => {
  it('json mode emits a JSON line', () => {
    const { writers, out } = fakeWriters();
    createOutputPort('json', writers).emit(formatOk('help', {}, new FakeClock()));
    expect(JSON.parse(out[0]).command).toBe('help');
  });

  it('human mode emits the summary', () => {
    const { writers, out } = fakeWriters();
    createOutputPort('human', writers).emit(formatOk('help', {}, new FakeClock()));
    expect(out).toEqual(['help: ok\n']);
  });
});

describe('exitWithEnvelope', () => {
  it('emits via the OutputPort then exits with the mapped code', () => {
    /*
    Test Doc:
    - Why: the single exit point must both render and exit with the right code (workshop 001).
    - Contract: exitWithEnvelope(env, io) calls io.emit(env) then process.exit(exitCodeFor(env)).
    - Usage Notes: process.exit is spied/throwing so the test runner survives.
    - Quality Contribution: covers the one place process.exit is allowed; proves unconfigured => 2.
    - Worked Example: exitWithEnvelope(unconfigured, io) => emits + exit 2.
    */
    const emitted: unknown[] = [];
    const io: OutputPort = { emit: (e) => emitted.push(e) };
    const env = formatUnconfigured('run', 'x', new FakeClock());
    const spy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    expect(() => exitWithEnvelope(env, io)).toThrow('exit:2');
    expect(emitted).toEqual([env]);
    spy.mockRestore();
  });
});
