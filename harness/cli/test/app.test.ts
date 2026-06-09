import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../src/acts/verb.js';
import { FakeClock } from '../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../src/adapters/env/fake-env.js';
import { FakeExec } from '../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../src/adapters/git/fake-git.js';
import { FakeModuleLoader } from '../src/adapters/loader/fake-loader.js';
import { FakeProcess } from '../src/adapters/process/fake-process.js';
import {
  buildProgram,
  isExtensionsDisabled,
  loadRegistry,
  type MainOverrides,
  main,
} from '../src/app.js';
import type { CliIo, Writers } from '../src/output/output-port.js';
import type { HarnessVerb } from '../src/services/extensions/contract.js';

const io: CliIo = { mode: 'json', writers: { out: () => {}, err: () => {} } };

function deps(overrides: Partial<VerbActDeps> = {}): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs(),
    env: new FakeEnv(),
    git: new FakeGit(),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
    ...overrides,
  };
}

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

describe('isExtensionsDisabled', () => {
  it('is true for --no-extensions or HARNESS_NO_EXTENSIONS=1, else false', () => {
    expect(isExtensionsDisabled(['node', 'h', '--no-extensions', 'help'], {})).toBe(true);
    expect(isExtensionsDisabled(['node', 'h', 'help'], { HARNESS_NO_EXTENSIONS: '1' })).toBe(true);
    expect(isExtensionsDisabled(['node', 'h', 'help'], {})).toBe(false);
  });
});

describe('loadRegistry', () => {
  it('given_extensions_present_when_loaded_then_builds_the_verb_registry', async () => {
    /*
    Test Doc:
    - Why: the composition root must discover + load extensions BEFORE parse so the verbs exist
      as commands (WS-A Decision 6, KF-04).
    - Contract: loadRegistry runs discovery (FsPort.readdir + ProcessPort.cwd) then buildVerbRegistry
      via the injected loader; returns {verbs, records}.
    - Usage Notes: tested with seeded fakes — no real jiti / fs.
    - Quality Contribution: pins discovery+load wiring without invoking commander/exit.
    - Worked Example: a seeded hello.ts → registry.verbs = [hello].
    */
    const base = '/repo/.harness/extensions';
    const fs = new FakeFs({}, { [base]: ['hello.ts'] });
    const loader = new FakeModuleLoader({ [`${base}/hello.ts`]: mkVerb('hello') });
    const reg = await loadRegistry(['node', 'h', 'hello'], {}, deps({ fs }), loader);
    expect(reg.verbs.map((v) => v.name)).toEqual(['hello']);
    expect(loader.loads).toEqual([`${base}/hello.ts`]);
  });

  it('safe mode returns an empty registry and never touches the loader', async () => {
    const base = '/repo/.harness/extensions';
    const fs = new FakeFs({}, { [base]: ['hello.ts'] });
    const loader = new FakeModuleLoader({ [`${base}/hello.ts`]: mkVerb('hello') });
    const reg = await loadRegistry(
      ['node', 'h', '--no-extensions', 'help'],
      {},
      deps({ fs }),
      loader,
    );
    expect(reg.verbs).toEqual([]);
    expect(loader.loads).toEqual([]);
  });
});

describe('buildProgram — composition root wiring', () => {
  it('registers help, doctor, new, docs, skills, one command per registry verb, and the --no-extensions option', () => {
    const registry = { verbs: [mkVerb('hello'), mkVerb('build')], records: [] };
    const program = buildProgram('1.2.3', io, deps(), registry);
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(['help', 'doctor', 'new', 'docs', 'skills', 'hello', 'build']);
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain('--json');
    expect(longs).toContain('--no-extensions');
    expect(program.version()).toBe('1.2.3');
  });

  it('registers core help/doctor/new/docs/skills even with an empty registry', () => {
    const program = buildProgram('1.2.3', io, deps(), { verbs: [], records: [] });
    expect(program.commands.map((c) => c.name())).toEqual([
      'help',
      'doctor',
      'new',
      'docs',
      'skills',
    ]);
  });
});

describe('main — unexpected pre-parse error routes through the kernel (bin rejection safety)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an exception during discovery becomes an E100 envelope via the exit kernel, not a floated rejection', async () => {
    let out = '';
    let code = -1;
    const writers: Writers = {
      out: (t) => {
        out += t;
      },
      err: () => {},
    };
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);

    // A process port whose cwd() throws makes discovery throw → the pre-parse catch fires.
    const throwingProc = {
      which: () => null,
      cwd: () => {
        throw new Error('cwd blew up');
      },
    };
    const overrides: Partial<MainOverrides> = {
      deps: deps({ proc: throwingProc }),
      loader: new FakeModuleLoader(),
      env: {},
      isTty: false,
      writers,
      version: '9.9.9',
    };

    await expect(main(['node', 'harness', 'whatever'], overrides)).rejects.toThrow(/^exit:1/);
    const env = JSON.parse(out);
    expect(env.command).toBe('harness');
    expect(env.error.code).toBe('E100');
    expect(code).toBe(1);
  });
});
