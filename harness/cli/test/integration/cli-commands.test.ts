import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/app.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

/**
 * Integration: drive the fully-wired composition root (every act registered
 * together) and assert the envelope + exit code for each command against the
 * workshop 001 worked examples. Output is captured via injected writers; the
 * single exit point (exit.ts) is spied.
 */
function harness(argv: string[], mode: OutputMode): { out: string; err: string; code: number } {
  let out = '';
  let err = '';
  let code = -1;
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
  };
  const io: CliIo = { mode, writers };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  expect(() => buildProgram('9.9.9', io).parse(['node', 'harness', ...argv])).toThrow(/^exit:/);
  return { out, err, code };
}

describe('CLI integration (workshop 001 worked examples)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('help --json → ok envelope with 8 machine-readable slots, exit 0', () => {
    const { out, code } = harness(['help'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('help');
    expect(env.status).toBe('ok');
    expect(env.data.slots).toHaveLength(8);
    expect(code).toBe(0);
  });

  it('doctor → degraded (slots unconfigured), layered report, exit 0', () => {
    const { out, code } = harness(['doctor'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('doctor');
    expect(env.status).toBe('degraded');
    expect(env.data.layers.map((l: { name: string }) => l.name)).toEqual([
      'toolchain',
      'cli-build',
      'command-slots',
    ]);
    expect(code).toBe(0);
  });

  it('run smoke → command:run unconfigured, exit 2', () => {
    const { out, code } = harness(['run', 'smoke'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('run');
    expect(env.status).toBe('unconfigured');
    expect(code).toBe(2);
  });

  it('run validate --dry-run → data {dry_run, slot:validate}, exit 2', () => {
    const { out, code } = harness(['run', 'validate', '--dry-run'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('run');
    expect(env.data).toEqual({ dry_run: true, slot: 'validate', mapped_command: null });
    expect(code).toBe(2);
  });

  it('smoke (top-level convenience slot) → command:smoke unconfigured, exit 2', () => {
    const { out, code } = harness(['smoke'], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('smoke');
    expect(env.status).toBe('unconfigured');
    expect(code).toBe(2);
  });

  it('run (no slot) → E108 error, exit 1', () => {
    const { out, code } = harness(['run'], 'json');
    const env = JSON.parse(out);
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E108');
    expect(code).toBe(1);
  });

  it('bare harness → orientation ok envelope, exit 0', () => {
    const { out, code } = harness([], 'json');
    const env = JSON.parse(out);
    expect(env.command).toBe('harness');
    expect(env.status).toBe('ok');
    expect(env.data.version).toBe('9.9.9');
    expect(code).toBe(0);
  });

  it('doctor (human) → layered report on stderr, summary on stdout, exit 0', () => {
    const { out, err, code } = harness(['doctor'], 'human');
    expect(err).toContain('toolchain');
    expect(out).toContain('doctor:');
    expect(code).toBe(0);
  });
});
