import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import { RESERVED_NAMES, type VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-03T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runDd(argv: string[]): Promise<{ envelope: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('0.0.0-test', io, deps(), EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { envelope: JSON.parse(out.trim()) as Envelope, code };
}

describe('harness dd act surface', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the full frozen family and reserves dd from extensions', () => {
    const program = buildProgram(
      '0.0.0-test',
      { mode: 'json', writers: { out: () => {}, err: () => {} } },
      deps(),
      EMPTY,
    );
    const dd = program.commands.find((command) => command.name() === 'dd');
    expect(dd?.commands.map((command) => command.name())).toEqual([
      'validate',
      'schema',
      'docs',
      'build',
      'address',
      'link',
      'links',
      'graph',
      'doctor',
    ]);
    expect(
      dd?.commands.find((command) => command.name() === 'schema')?.commands.map((c) => c.name()),
    ).toEqual(['list', 'show']);
    expect(
      dd?.commands.find((command) => command.name() === 'docs')?.commands.map((c) => c.name()),
    ).toEqual(['list', 'get']);
    expect(
      dd?.commands.find((command) => command.name() === 'address')?.commands.map((c) => c.name()),
    ).toEqual(['generate', 'validate']);
    expect(
      dd?.commands.find((command) => command.name() === 'link')?.commands.map((c) => c.name()),
    ).toEqual(['resolve', 'verify-basis']);
    expect(RESERVED_NAMES.has('dd')).toBe(true);
  });

  it.each([
    [['dd', 'validate', 'doc.dd.json'], 'Phase 2: Schema layer & baked docs'],
    [['dd', 'schema', 'list'], 'Phase 2: Schema layer & baked docs'],
    [['dd', 'schema', 'show', 'builder/plan'], 'Phase 2: Schema layer & baked docs'],
    [['dd', 'docs', 'list'], 'Phase 2: Schema layer & baked docs'],
    [['dd', 'docs', 'get', 'how-to'], 'Phase 2: Schema layer & baked docs'],
    [['dd', 'build', 'doc.dd.json'], 'Phase 3: Render, adapters & freshness'],
    [['dd', 'address', 'generate', 'phases/ph-a1b2'], 'Phase 4: Links, ledger & doctor'],
    [['dd', 'address', 'validate', '#phases/ph-a1b2'], 'Phase 4: Links, ledger & doctor'],
    [['dd', 'link', 'resolve', '#phases/ph-a1b2'], 'Phase 4: Links, ledger & doctor'],
    [
      ['dd', 'link', 'verify-basis', '#phases/ph-a1b2', '--sha', 'abc123'],
      'Phase 4: Links, ledger & doctor',
    ],
    [['dd', 'links', '#phases/ph-a1b2'], 'Phase 4: Links, ledger & doctor'],
    [['dd', 'graph'], 'Phase 4: Links, ledger & doctor'],
    [['dd', 'doctor'], 'Phase 4: Links, ledger & doctor'],
  ] as const)('%j exits 2 unconfigured naming %s', async (argv, owner) => {
    const result = await runDd([...argv]);
    expect(result.code).toBe(2);
    expect(result.envelope.status).toBe('unconfigured');
    expect(result.envelope.next_action).toContain(owner);
    expect(result.envelope.data).toEqual({ owner_phase: owner });
  });
});
