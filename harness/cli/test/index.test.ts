import { describe, expect, it } from 'vitest';
import type { VerbActDeps } from '../src/acts/verb.js';
import { FakeClock } from '../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../src/adapters/env/fake-env.js';
import { FakeExec } from '../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../src/adapters/git/fake-git.js';
import { FakeProcess } from '../src/adapters/process/fake-process.js';
import { buildProgram, jsonFlag } from '../src/app.js';
import { type CliIo, selectMode } from '../src/output/output-port.js';

const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv(),
    git: new FakeGit(),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

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
  it('registers help, doctor, and one command per registry verb', () => {
    const registry = {
      verbs: [
        { name: 'hello', summary: 's', run: () => ({ status: 'ok' as const }) },
        { name: 'build', summary: 's', run: () => ({ status: 'ok' as const }) },
      ],
      records: [],
    };
    const names = buildProgram('1.2.3', io, deps(), registry).commands.map((c) => c.name());
    expect(names).toEqual([
      'help',
      'doctor',
      'init',
      'new',
      'docs',
      'skills',
      'update',
      'self-install',
      'record',
      'observe',
      'retro',
      'flow',
      'dd',
      'plan',
      'sensors',
      'telemetry',
      'instructions',
      'hello',
      'build',
    ]);
  });

  it('registers the global --json/--no-json/--no-extensions options and --version', () => {
    const program = buildProgram('1.2.3', io, deps(), { verbs: [], records: [] });
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain('--json');
    expect(longs).toContain('--no-json');
    expect(longs).toContain('--no-extensions');
    expect(program.version()).toBe('1.2.3');
  });
});
