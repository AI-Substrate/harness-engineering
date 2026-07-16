import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { registerV2VerbAct } from '../../src/acts/verb-v2.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo } from '../../src/output/output-port.js';
import type { NormalizedVerb } from '../../src/services/extensions/v2/types.js';

function deps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv(),
    git: new FakeGit(),
    clock: new FakeClock('2026-07-14T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

const neverBare = (): never => {
  throw new Error('kernel should not call an absent bare handler');
};

function dbVerb(
  runReset: NormalizedVerb['run'] = (ctx) => ctx.ok({ reset: true }),
): NormalizedVerb {
  return {
    name: 'db',
    summary: 'Database commands',
    description: 'Manage the local database.',
    options: [{ flags: '--profile <name>', description: 'Shared profile' }],
    run: neverBare,
    hasOwnRun: false,
    subverbs: [
      {
        name: 'reset',
        summary: 'Reset database',
        args: [{ name: '<files...>', description: 'Seed files' }],
        options: [{ flags: '--force', description: 'Bypass safety check' }],
        run: runReset,
      },
      {
        name: 'seed',
        summary: 'Seed database',
        run: (ctx) => ctx.ok({ seeded: true }),
      },
    ],
  };
}

async function invoke(
  verb: NormalizedVerb,
  argv: string[],
): Promise<{ envelope: Record<string, unknown>; code: number }> {
  let out = '';
  let code = -1;
  const io: CliIo = {
    mode: 'json',
    writers: { out: (text) => (out += text), err: () => {} },
  };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness').exitOverride();
  registerV2VerbAct(program, verb, deps(), io);
  await expect(program.parseAsync(['node', 'harness', ...argv])).rejects.toThrow(/^exit:/);
  return { envelope: JSON.parse(out), code };
}

describe('registerV2VerbAct', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mounts real nested commands with scoped help', () => {
    const program = new Command().name('harness').exitOverride();
    const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };
    const parent = registerV2VerbAct(program, dbVerb(), deps(), io);
    const reset = parent.commands.find((command) => command.name() === 'reset');
    const seed = parent.commands.find((command) => command.name() === 'seed');

    expect(parent.helpInformation()).toContain('reset');
    expect(parent.helpInformation()).toContain('--profile');
    expect(reset?.helpInformation()).toContain('--force');
    expect(reset?.helpInformation()).toContain('files');
    expect(seed?.helpInformation()).not.toContain('--force');
  });

  it('passes variadic args as string[] and merges parent + scoped options', async () => {
    const seen: { args?: unknown; options?: unknown } = {};
    const verb = dbVerb((ctx) => {
      seen.args = ctx.args;
      seen.options = ctx.options;
      return ctx.ok({ reset: true });
    });

    const { envelope, code } = await invoke(verb, [
      'db',
      '--profile',
      'dev',
      'reset',
      'seed-a.sql',
      'seed-b.sql',
      '--force',
    ]);
    expect(seen.args).toEqual({ files: ['seed-a.sql', 'seed-b.sql'] });
    expect(seen.options).toEqual({ profile: 'dev', force: true });
    expect(envelope).toMatchObject({ command: 'db', status: 'ok' });
    expect(code).toBe(0);
  });

  it('keeps variadics on the v2 context path for a leaf verb too', async () => {
    let seen: unknown;
    const verb: NormalizedVerb = {
      name: 'files',
      summary: 'Files',
      args: [{ name: '<paths...>', description: 'Paths' }],
      run: (ctx) => {
        seen = ctx.args.paths;
        return ctx.ok({ paths: ctx.args.paths });
      },
      hasOwnRun: true,
      subverbs: [],
    };
    const { envelope } = await invoke(verb, ['files', 'a.txt', 'b.txt']);
    expect(seen).toEqual(['a.txt', 'b.txt']);
    expect(envelope).toMatchObject({ status: 'ok', data: { paths: ['a.txt', 'b.txt'] } });
  });

  it('emits a kernel-owned pick-a-subverb unconfigured envelope for bare parent', async () => {
    const { envelope, code } = await invoke(dbVerb(), ['db']);
    expect(envelope).toMatchObject({ command: 'db', status: 'unconfigured' });
    expect(String(envelope.next_action)).toContain('Pick a subverb');
    expect(code).toBe(2);
  });

  it('emits an actionable kernel error envelope for an unknown subverb', async () => {
    const { envelope, code } = await invoke(dbVerb(), ['db', 'destroy']);
    expect(envelope).toMatchObject({
      command: 'db',
      status: 'error',
      error: { code: 'E108' },
    });
    expect(String(envelope.next_action)).toContain('harness db --help');
    expect(code).toBe(1);
  });

  it.each([
    '<value>',
    '<values...>',
  ])('treats an unmatched token as an unknown subverb when a subverb-only parent declares %s', async (argName) => {
    const verb = dbVerb();
    verb.args = [{ name: argName, description: 'Parent value with no bare consumer' }];

    const { envelope, code } = await invoke(verb, ['db', 'destroy']);
    expect(envelope).toMatchObject({
      command: 'db',
      status: 'error',
      error: { code: 'E108', message: "Unknown subverb 'destroy' for 'db'." },
    });
    expect(code).toBe(1);
  });

  it('runs an explicitly declared bare parent handler when run and sub coexist', async () => {
    const verb = dbVerb();
    verb.hasOwnRun = true;
    verb.run = (ctx) => ctx.ok({ profile: ctx.options.profile });
    const { envelope } = await invoke(verb, ['db', '--profile', 'dev']);
    expect(envelope).toMatchObject({ status: 'ok', data: { profile: 'dev' } });
  });
});
