import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRetroAct } from '../../src/acts/retro.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { dirs, files } from '../services/retro/fixtures.js';

function ioFor(mode: OutputMode): { io: CliIo; out: () => string; err: () => string } {
  let stdout = '';
  let stderr = '';
  const writers: Writers = {
    out: (text) => {
      stdout += text;
    },
    err: (text) => {
      stderr += text;
    },
  };
  return { io: { mode, writers }, out: () => stdout, err: () => stderr };
}

function fixtureFs(pending = true): FakeFs {
  const seed = {
    ...files,
    ...(pending && {
      '/repo/.harness/temp/agent/session-buffer.md': [
        '- id: DL-999',
        '  kind: difficulty',
        '  description: "Pending buffer evidence remains advisory only."',
        '  system:',
        '    compound:',
        '      status: open',
        '      first_seen_at: "2026-07-12T00:00:00.000Z"',
        '',
      ].join('\n'),
    }),
  };
  const seededDirs = {
    ...dirs,
    ...(pending && { '/repo/.harness/temp': ['agent'] }),
  };
  const fs = new FakeFs(seed, seededDirs);
  fs.mkdirp('/repo/.harness');
  return fs;
}

function run(args: string[], io: CliIo, fs: FakeFs): number {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((exitCode?: number) => {
    code = exitCode ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerRetroAct(program, io, {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-07-12T00:00:00.000Z'),
    env: new FakeEnv(),
  });
  expect(() => program.parse(['node', 'harness', 'retro', 'insights', ...args])).toThrow(/^exit:/);
  return code;
}

describe('registerRetroAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits one honest JSON envelope with source counts and no durable evidence', () => {
    const { io, out } = ioFor('json');
    const code = run([], io, fixtureFs());
    const envelope = JSON.parse(out());
    expect(envelope.command).toBe('retro');
    expect(envelope.status).toBe('ok');
    expect(envelope.data).toMatchObject({
      schema_version: 'harness.retro-insights/v1',
      headline: { records: 7, entries: 8 },
      sources: {
        canonical: { scanned: 6, parsed: 4, included: 4, deduped: 0 },
        agents: { scanned: 2, parsed: 2, included: 1, deduped: 1 },
        retros: { scanned: 2, parsed: 2, included: 2, deduped: 0 },
      },
      malformed_skipped: 1,
      buffer_pending: 1,
    });
    expect(envelope.evidence).toEqual([{ label: 'retro insights report', none: true }]);
    expect(code).toBe(0);
  });

  it('composes --plan, --since, --kind, and --agent filters', () => {
    const { io, out } = ioFor('json');
    const code = run(
      [
        '--plan',
        'plan-one',
        '--since',
        '2026-05-20T00:00:00Z',
        '--kind',
        'difficulty',
        '--agent',
        'delta',
      ],
      io,
      fixtureFs(false),
    );
    const data = JSON.parse(out()).data;
    expect(data.headline).toMatchObject({
      records: 1,
      entries: 1,
      plans_touched: ['plan-one'],
      agents: ['delta'],
    });
    expect(data.scope).toEqual({
      plans: ['plan-one'],
      since: '2026-05-20T00:00:00Z',
      kinds: ['difficulty'],
      agents: ['delta'],
    });
    expect(code).toBe(0);
  });

  it('accepts repeatable --plan flags', () => {
    const { io, out } = ioFor('json');
    run(['--plan', 'plan-one', '--plan', 'plan-two'], io, fixtureFs(false));
    expect(JSON.parse(out()).data.headline.plans_touched).toEqual(['plan-one', 'plan-two']);
  });

  it('reports buffer_pending without merging transient observations into totals', () => {
    const withBuffer = ioFor('json');
    run([], withBuffer.io, fixtureFs(true));
    const withoutBuffer = ioFor('json');
    run([], withoutBuffer.io, fixtureFs(false));
    expect(JSON.parse(withBuffer.out()).data.buffer_pending).toBe(1);
    expect(JSON.parse(withBuffer.out()).data.headline.entries).toBe(
      JSON.parse(withoutBuffer.out()).data.headline.entries,
    );
  });

  it('is read-only and leaves source lifecycle status untouched', () => {
    const fs = fixtureFs();
    const path = '/repo/.harness/records/retro/2026-05-15/001-duplicate-canonical.md';
    const before = fs.readText(path);
    const { io } = ioFor('json');
    run([], io, fs);
    expect(fs.writes).toEqual([]);
    expect(fs.deletes).toEqual([]);
    expect(fs.removedDirs).toEqual([]);
    expect(fs.readText(path)).toBe(before);
  });

  it('renders a concise human headline and top-cluster view', () => {
    const { io, out } = ioFor('human');
    const code = run([], io, fixtureFs(false));
    expect(out()).toContain('Harness retro insights');
    expect(out()).toContain('Scanned 7 retros');
    expect(out()).toContain('Open clusters');
    expect(code).toBe(0);
  });

  it('declares the complete flag surface on the insights subcommand', () => {
    const program = new Command().name('harness');
    const { io } = ioFor('json');
    registerRetroAct(program, io, {
      fs: fixtureFs(false),
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-07-12T00:00:00.000Z'),
      env: new FakeEnv(),
    });
    const retro = program.commands.find((command) => command.name() === 'retro');
    const insights = retro?.commands.find((command) => command.name() === 'insights');
    expect(insights?.options.map((option) => option.flags)).toEqual([
      '--plan <slug>',
      '--since <iso>',
      '--kind <kind>',
      '--agent <slug>',
    ]);
  });
});
