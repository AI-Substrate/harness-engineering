import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerObserveAct } from '../../src/acts/observe.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

/*
Test Doc:
- Why: `harness observe` is a CORE act (reserved name); it must map the observe-service
  outcomes onto the canonical Envelope + exit codes (ok → 0, unconfigured → 2, error → 1,
  D6) and expose the D-12 flag surface: positional description + --kind/--target/--severity/
  --workaround/--suggested-encoding/--agent for capture, --list/--clear for the drain sweep.
- Contract: capture → ok envelope data.{bucket,id,kind,path}; --list → data per D9
  {observations (bucket-annotated), buckets_scanned, malformed_skipped}; --clear →
  data.{cleared,...}; validation reject / no-.harness → unconfigured exit 2; unreadable
  buffer → E146 exit 1.
- Quality Contribution: pins the act/envelope/exit wiring for every D6 branch with fakes.
*/

const DESC = 'the boot dance had to be re-derived from scratch';

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

function depsWith(fs: FakeFs, env: FakeEnv = new FakeEnv()) {
  return {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    env,
  };
}

function configuredFs(
  seed: Record<string, string> = {},
  dirs: Record<string, string[]> = {},
): FakeFs {
  const fs = new FakeFs(seed, dirs);
  fs.mkdirp('/repo/.harness');
  return fs;
}

function legacyEntry(id: string, kind: string): string {
  return [
    `- id: ${id}`,
    `  kind: ${kind}`,
    '  description: "a legacy hand-written entry from the old skill"',
    '  suggested_encoding: "justfile recipe"',
    '  system:',
    '    compound:',
    '      status: open',
    '      source: agent-self',
    '      first_seen_at: "2026-05-18T10:15:00Z"',
    '',
  ].join('\n');
}

describe('registerObserveAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(args: string[], io: CliIo, fs: FakeFs, env: FakeEnv = new FakeEnv()): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerObserveAct(program, io, depsWith(fs, env));
    expect(() => program.parse(['node', 'harness', 'observe', ...args])).toThrow(/^exit:/);
    return code;
  }

  it('captures an observation: ok envelope (exit 0) with bucket/id/kind/path', () => {
    const { io, out } = ioFor('json');
    const fs = configuredFs();
    const code = run([DESC, '--kind', 'difficulty', '--severity', 'degrading'], io, fs);
    const env = JSON.parse(out());
    expect(env.command).toBe('observe');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      bucket: 'agent',
      id: 'DL-001',
      kind: 'difficulty',
      path: '.harness/temp/agent/session-buffer.md',
    });
    expect(fs.readText('/repo/.harness/temp/agent/session-buffer.md')).toContain(
      'severity: degrading',
    );
    expect(code).toBe(0);
  });

  it('passes --agent and --suggested-encoding through (kebab-sanitized bucket)', () => {
    const { io, out } = ioFor('json');
    const fs = configuredFs();
    const code = run(
      [DESC, '--kind', 'magic-wand', '--agent', 'Claude Code', '--suggested-encoding', 'a recipe'],
      io,
      fs,
    );
    expect(JSON.parse(out()).data).toMatchObject({ bucket: 'claude-code', id: 'MW-001' });
    expect(fs.readText('/repo/.harness/temp/claude-code/session-buffer.md')).toContain(
      'suggested_encoding: "a recipe"',
    );
    expect(code).toBe(0);
  });

  it('an unknown --kind → unconfigured (exit 2) naming the allowed values', () => {
    const { io, out } = ioFor('json');
    const code = run([DESC, '--kind', 'signal-gap'], io, configuredFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('unconfigured');
    expect(env.next_action).toContain('difficulty');
    expect(env.next_action).toContain('confusion');
    expect(code).toBe(2);
  });

  it('a too-short description → unconfigured (exit 2)', () => {
    const { io, out } = ioFor('json');
    const code = run(['too short', '--kind', 'difficulty'], io, configuredFs());
    expect(JSON.parse(out()).status).toBe('unconfigured');
    expect(code).toBe(2);
  });

  it('no .harness/ → unconfigured (exit 2) naming harness setup', () => {
    const { io, out } = ioFor('json');
    const code = run([DESC, '--kind', 'difficulty'], io, new FakeFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('unconfigured');
    expect(env.next_action).toMatch(/\.harness/);
    expect(code).toBe(2);
  });

  it('an unreadable buffer → error E146 (exit 1)', () => {
    class UnreadableFs extends FakeFs {
      override readText(path: string): string | null {
        if (path.endsWith('session-buffer.md')) return null;
        return super.readText(path);
      }
    }
    const fs = new UnreadableFs({
      '/repo/.harness/temp/agent/session-buffer.md': 'present but unreadable',
    });
    fs.mkdirp('/repo/.harness');
    const { io, out } = ioFor('json');
    const code = run([DESC, '--kind', 'difficulty'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E146');
    expect(code).toBe(1);
  });

  describe('--list (the drain sweep, AC-7/D9)', () => {
    const SWEEP_SEED = {
      '/repo/.harness/temp/.gitignore': '*\n',
      '/repo/.harness/temp/agent/session-buffer.md': `${legacyEntry('DL-001', 'difficulty')}- id: DL-XXX\n  garbage: yes\n`,
      '/repo/.harness/temp/claude-code/session-buffer.md': legacyEntry('MW-001', 'magic-wand'),
    };
    const SWEEP_DIRS = { '/repo/.harness/temp': ['claude-code', '.gitignore', 'agent'] };

    it('sweeps all buckets by default with bucket annotation + malformed count', () => {
      const { io, out } = ioFor('json');
      const code = run(['--list'], io, configuredFs(SWEEP_SEED, SWEEP_DIRS));
      const env = JSON.parse(out());
      expect(env.status).toBe('ok');
      expect(env.data.buckets_scanned).toEqual(['agent', 'claude-code']);
      expect(env.data.malformed_skipped).toBe(1);
      expect(env.data.observations).toHaveLength(2);
      expect(env.data.observations[0]).toMatchObject({
        bucket: 'agent',
        id: 'DL-001',
        kind: 'difficulty',
        first_seen_at: '2026-05-18T10:15:00Z',
      });
      expect(env.data.observations[1]).toMatchObject({
        bucket: 'claude-code',
        id: 'MW-001',
        suggested_encoding: 'justfile recipe',
      });
      expect(code).toBe(0);
    });

    it('--agent narrows the sweep; a nonexistent bucket is an honest empty ok (exit 0)', () => {
      const { io, out } = ioFor('json');
      const code = run(
        ['--list', '--agent', 'nobody-here'],
        io,
        configuredFs(SWEEP_SEED, SWEEP_DIRS),
      );
      const env = JSON.parse(out());
      expect(env.status).toBe('ok');
      expect(env.data).toMatchObject({
        observations: [],
        buckets_scanned: [],
        malformed_skipped: 0,
      });
      expect(code).toBe(0);
    });

    it('nothing captured anywhere → ok with an empty array (exit 0)', () => {
      const { io, out } = ioFor('json');
      const code = run(['--list'], io, configuredFs());
      expect(JSON.parse(out()).data.observations).toEqual([]);
      expect(code).toBe(0);
    });
  });

  describe('--clear (truncate, files kept, AC-7/D6)', () => {
    it('clears all buckets by default and reports the cleared count', () => {
      const fs = configuredFs(
        {
          '/repo/.harness/temp/agent/session-buffer.md': legacyEntry('DL-001', 'difficulty'),
          '/repo/.harness/temp/claude-code/session-buffer.md': legacyEntry('MW-001', 'magic-wand'),
        },
        { '/repo/.harness/temp': ['agent', 'claude-code'] },
      );
      const { io, out } = ioFor('json');
      const code = run(['--clear'], io, fs);
      const env = JSON.parse(out());
      expect(env.status).toBe('ok');
      expect(env.data.cleared).toBe(2);
      expect(fs.readText('/repo/.harness/temp/agent/session-buffer.md')).toBe('');
      expect(fs.readText('/repo/.harness/temp/claude-code/session-buffer.md')).toBe('');
      expect(code).toBe(0);
    });

    it('nothing to clear → ok with cleared: 0 (exit 0)', () => {
      const { io, out } = ioFor('json');
      const code = run(['--clear'], io, configuredFs());
      expect(JSON.parse(out()).data.cleared).toBe(0);
      expect(code).toBe(0);
    });
  });
});
