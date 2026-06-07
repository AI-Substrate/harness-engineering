import type { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { buildProgram, commanderErrorEnvelope } from '../../src/app.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';

const clock = () => new FakeClock('2026-06-08T07:20:00.000Z');

describe('commanderErrorEnvelope', () => {
  it('returns null for help/version display (already printed → exit 0)', () => {
    expect(commanderErrorEnvelope({ code: 'commander.helpDisplayed' }, clock())).toBeNull();
    expect(commanderErrorEnvelope({ code: 'commander.version' }, clock())).toBeNull();
  });

  it('maps an unknown command/option to an actionable E108 envelope', () => {
    const env = commanderErrorEnvelope(
      { code: 'commander.unknownCommand', message: "error: unknown command 'frobnicate'" },
      clock(),
    );
    expect(env?.status).toBe('error');
    expect(env?.error?.code).toBe('E108');
    expect(env?.next_action).toBeDefined();
  });

  it('maps an unexpected throw (no commander code) to E100 — no stack trace leaks', () => {
    const env = commanderErrorEnvelope({ message: 'boom' }, clock());
    expect(env?.error?.code).toBe('E100');
  });
});

describe('actionable error paths through the program', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureIo(): { io: CliIo; out: () => string } {
    let o = '';
    const writers: Writers = {
      out: (t) => {
        o += t;
      },
      err: () => {},
    };
    return { io: { mode: 'json', writers }, out: () => o };
  }

  function run(argv: string[]): { env: Record<string, unknown>; out: string } {
    const { io, out } = captureIo();
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      throw new Error(`exit:${c ?? 0}`);
    }) as never);
    const program: Command = buildProgram('1.0.0', io);
    expect(() => program.parse(['node', 'harness', ...argv])).toThrow(/^exit:/);
    return { env: JSON.parse(out()), out: out() };
  }

  it('run with no slot → actionable E108, never a raw stack trace', () => {
    const { env, out } = run(['run']);
    expect(env.status).toBe('error');
    expect((env.error as { code: string }).code).toBe('E108');
    expect(env.next_action).toBeDefined();
    expect(out).not.toMatch(/\n\s+at\s/); // no Node stack frames
  });

  it('run with an unknown slot → actionable E110, never a raw stack trace', () => {
    const { env, out } = run(['run', 'not-a-slot']);
    expect(env.status).toBe('error');
    expect((env.error as { code: string }).code).toBe('E110');
    expect(out).not.toMatch(/\n\s+at\s/);
  });
});
