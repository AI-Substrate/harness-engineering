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
  asciiFlag,
  buildProgram,
  deriveCommand,
  firstPositional,
  isExtensionsDisabled,
  loadRegistry,
  type MainOverrides,
  main,
  noExtensionContextEnvelope,
  shouldCaptureForArgv,
} from '../src/app.js';
import type { CliIo, Writers } from '../src/output/output-port.js';
import type { HarnessVerb } from '../src/services/extensions/contract.js';
import { coreTelemetryAdapters } from '../src/services/telemetry/adapters/index.js';
import { type CaptureDeps, captureTelemetry } from '../src/services/telemetry/capture-service.js';

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

describe('asciiFlag', () => {
  it('resolves --ascii once from raw argv', () => {
    expect(asciiFlag(['node', 'harness', '--ascii', 'sensors'])).toBe(true);
    expect(asciiFlag(['node', 'harness', 'sensors'])).toBeUndefined();
  });
});

describe('isExtensionsDisabled', () => {
  it('is true for --no-extensions or HARNESS_NO_EXTENSIONS=1, else false', () => {
    expect(isExtensionsDisabled(['node', 'h', '--no-extensions', 'help'], {})).toBe(true);
    expect(isExtensionsDisabled(['node', 'h', 'help'], { HARNESS_NO_EXTENSIONS: '1' })).toBe(true);
    expect(isExtensionsDisabled(['node', 'h', 'help'], {})).toBe(false);
  });
});

describe('deriveCommand (telemetry label — plan 034 Phase 3)', () => {
  it('returns the first non-flag token after binary+script, else "harness"', () => {
    expect(deriveCommand(['node', 'harness', 'doctor'])).toBe('doctor');
    expect(deriveCommand(['node', 'harness', 'flow', 'nav'])).toBe('flow'); // top-level only
    expect(deriveCommand(['node', 'harness'])).toBe('harness'); // bare
    expect(deriveCommand(['node', 'harness', '--json', 'record'])).toBe('record'); // skips boolean global
    expect(deriveCommand(['node', 'harness', '--no-extensions', '--json'])).toBe('harness'); // all flags
  });
});

describe('shouldCaptureForArgv (display-only exclusion — plan 034 Phase 3)', () => {
  it('excludes help/version flags and the help subcommand, captures everything else', () => {
    // display-only → excluded
    expect(shouldCaptureForArgv(['node', 'harness', '--help'])).toBe(false);
    expect(shouldCaptureForArgv(['node', 'harness', '-h'])).toBe(false);
    expect(shouldCaptureForArgv(['node', 'harness', '--version'])).toBe(false);
    expect(shouldCaptureForArgv(['node', 'harness', '-v'])).toBe(false);
    expect(shouldCaptureForArgv(['node', 'harness', 'help'])).toBe(false);
    expect(shouldCaptureForArgv(['node', 'harness', 'doctor', '--help'])).toBe(false); // -h anywhere
    // real commands → captured (incl. bare and an unknown verb)
    expect(shouldCaptureForArgv(['node', 'harness', 'doctor'])).toBe(true);
    expect(shouldCaptureForArgv(['node', 'harness'])).toBe(true);
    expect(shouldCaptureForArgv(['node', 'harness', 'bogus'])).toBe(true); // unknown captures by design
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
    - Worked Example: a seeded hello/extension.ts → registry.verbs = [hello].
    */
    const base = '/repo/.harness/extensions';
    const fs = new FakeFs({ [`${base}/hello/extension.ts`]: '// hello' }, { [base]: ['hello'] });
    const loader = new FakeModuleLoader({ [`${base}/hello/extension.ts`]: mkVerb('hello') });
    const reg = await loadRegistry(['node', 'h', 'hello'], {}, deps({ fs }), loader);
    expect(reg.verbs.map((v) => v.name)).toEqual(['hello']);
    expect(loader.loads).toEqual([`${base}/hello/extension.ts`]);
  });

  it('a flat legacy file surfaces as a rejected E143 record, never loaded (plan 014 D1)', async () => {
    const base = '/repo/.harness/extensions';
    const fs = new FakeFs({}, { [base]: ['hello.ts'] });
    const loader = new FakeModuleLoader({});
    const reg = await loadRegistry(['node', 'h', 'help'], {}, deps({ fs }), loader);
    expect(reg.verbs).toEqual([]);
    expect(reg.records[0]?.status).toBe('failed');
    expect(reg.records[0]?.error).toContain('E143');
    expect(loader.loads).toEqual([]);
  });

  it('safe mode returns an empty registry and never touches the loader', async () => {
    const base = '/repo/.harness/extensions';
    const fs = new FakeFs({ [`${base}/hello/extension.ts`]: '// hello' }, { [base]: ['hello'] });
    const loader = new FakeModuleLoader({ [`${base}/hello/extension.ts`]: mkVerb('hello') });
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
  it('registers core commands including sensors, registry verbs, and --no-extensions', () => {
    const registry = { verbs: [mkVerb('hello'), mkVerb('build')], records: [] };
    const program = buildProgram('1.2.3', io, deps(), registry);
    const names = program.commands.map((c) => c.name());
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
    const longs = program.options.map((o) => o.long);
    expect(longs).toContain('--json');
    expect(longs).toContain('--ascii');
    expect(longs).toContain('--no-extensions');
    expect(program.version()).toBe('1.2.3');
  });

  it('registers every core command including sensors even with an empty registry', () => {
    const program = buildProgram('1.2.3', io, deps(), { verbs: [], records: [] });
    expect(program.commands.map((c) => c.name())).toEqual([
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
      nodeVersion: () => '22.0.0',
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

describe('main — telemetry capture preamble (plan 034 Phase 3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Drive main() with a recording/throwing capture seam, capturing stdout/stderr/
   * exit-code. process.exit is spied to throw `exit:N` (the house pattern); the
   * `exit:` throw is swallowed so the test can assert on what was recorded.
   *
   * Captures BOTH the injected `writers` (the envelope path) AND the real
   * `process.stdout/stderr.write` (commander-owned help/error output) — otherwise
   * a zero-drift comparison on `flow`/`record`/unknown commands, which print via
   * commander straight to the process streams, would miss most of the output
   * (companion finding F2).
   */
  async function runMain(
    argv: string[],
    capture: (deps: CaptureDeps) => void,
    extra: Partial<MainOverrides> = {},
  ): Promise<{ out: string; err: string; code: number }> {
    let out = '';
    let err = '';
    let code = -999;
    const writers: Writers = {
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      out += String(chunk);
      return true;
    }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      err += String(chunk);
      return true;
    }) as never);
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const overrides: Partial<MainOverrides> = {
      deps: deps({ env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sess1' }) }),
      loader: new FakeModuleLoader({}),
      env: {}, // local NodeJS.ProcessEnv (mode/safe-mode) — NOT the capture EnvPort
      isTty: false,
      writers,
      version: '9.9.9',
      capture,
      ...extra,
    };
    try {
      await main(argv, overrides);
    } catch (e) {
      if (!String((e as Error)?.message ?? e).startsWith('exit:')) {
        throw e;
      }
    }
    return { out, err, code };
  }

  // ---- T002: composition-root wiring (AC-01) ----

  it('invokes capture exactly once for a real command, with the derived command label', async () => {
    const calls: CaptureDeps[] = [];
    await runMain(['node', 'harness', 'doctor'], (d) => calls.push(d));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('doctor');
  });

  it('passes deps.env (the EnvPort), NOT the local NodeJS.ProcessEnv, and the core adapters (M-K1 env-pin)', async () => {
    const calls: CaptureDeps[] = [];
    const harnessEnv = new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sess1' });
    await runMain(['node', 'harness', 'doctor'], (d) => calls.push(d), {
      deps: deps({ env: harnessEnv }),
      env: {},
    });
    // The EnvPort that carries CLAUDE_CODE_SESSION_ID / HARNESS_PLAN_ID — not `{}`.
    expect(calls[0]?.env).toBe(harnessEnv);
    expect(calls[0]?.adapters).toBe(coreTelemetryAdapters);
  });

  it('captures bare `harness` with the label "harness"', async () => {
    const calls: CaptureDeps[] = [];
    await runMain(['node', 'harness'], (d) => calls.push(d));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('harness');
  });

  it('captures an unknown command by design (label = raw token; trigger is the invocation)', async () => {
    const calls: CaptureDeps[] = [];
    await runMain(['node', 'harness', 'bogus'], (d) => calls.push(d));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('bogus');
  });

  it('skips a boolean global to find the command label (--json doctor → doctor)', async () => {
    const calls: CaptureDeps[] = [];
    await runMain(['node', 'harness', '--json', 'doctor'], (d) => calls.push(d));
    expect(calls[0]?.command).toBe('doctor');
  });

  it.each([
    ['--help'],
    ['-h'],
    ['--version'],
    ['-v'],
    ['help'],
  ])('does NOT capture for display-only argv: harness %s', async (flag) => {
    const calls: CaptureDeps[] = [];
    await runMain(['node', 'harness', flag], (d) => calls.push(d));
    expect(calls).toHaveLength(0);
  });

  it('does NOT capture when a pre-parse boundary exits before the preamble (M-K2 placement)', async () => {
    // A proc whose cwd() throws makes discovery throw → the pre-parse catch fires
    // and exits BEFORE the preamble. Proves capture sits after the error boundaries.
    const calls: CaptureDeps[] = [];
    const throwingProc = {
      which: () => null,
      nodeVersion: () => '22.0.0',
      cwd: () => {
        throw new Error('cwd blew up');
      },
    };
    await runMain(['node', 'harness', 'doctor'], (d) => calls.push(d), {
      deps: deps({ proc: throwingProc }),
    });
    expect(calls).toHaveLength(0);
  });

  // ---- T003: kernel fail-safety (AC-09) ----

  // The envelope timestamp is a live SystemClock value (not deps.clock), so it
  // varies between runs independent of telemetry — mask it so the comparison
  // isolates telemetry's effect (the AC-09 claim) and nothing else.
  const maskTs = (r: { out: string; err: string; code: number }) => ({
    code: r.code,
    out: r.out.replace(/"timestamp":"[^"]*"/g, '"timestamp":"<T>"'),
    err: r.err.replace(/"timestamp":"[^"]*"/g, '"timestamp":"<T>"'),
  });

  it('a THROWING capture leaves stdout+stderr+exit identical to a no-op capture (AC-09)', async () => {
    const baseline = await runMain(['node', 'harness', 'doctor'], () => {});
    const thrown = await runMain(['node', 'harness', 'doctor'], () => {
      throw new Error('boom');
    });
    expect(maskTs(thrown)).toEqual(maskTs(baseline));
  });

  it('swallows a non-Error throw too (catch-all), output unchanged', async () => {
    const baseline = await runMain(['node', 'harness', 'doctor'], () => {});
    const thrown = await runMain(['node', 'harness', 'doctor'], () => {
      throw 'string-boom'; // deliberately a non-Error to prove the catch-all
    });
    expect(maskTs(thrown)).toEqual(maskTs(baseline));
  });

  it('a throw while BUILDING CaptureDeps is also swallowed — the guard covers construction, not just the call (F1)', async () => {
    const baseline = await runMain(['node', 'harness', 'doctor'], () => {});
    // A deps whose `git` getter throws on its FIRST read — that first read is the
    // preamble evaluating the CaptureDeps literal. Subsequent reads (the command)
    // get a real fake. If a future edit moved deps construction OUTSIDE the
    // swallowing try/catch, this first throw would escape and perturb the host.
    const realGit = new FakeGit();
    const throwingDeps = deps({ env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sess1' }) });
    let gitReads = 0;
    Object.defineProperty(throwingDeps, 'git', {
      get() {
        if (gitReads++ === 0) throw new Error('deps-build boom');
        return realGit;
      },
    });
    const thrown = await runMain(['node', 'harness', 'doctor'], () => {}, { deps: throwingDeps });
    expect(gitReads).toBeGreaterThan(1); // preamble threw on read #1, command read again
    expect(maskTs(thrown)).toEqual(maskTs(baseline));
  });

  // ---- T005: zero output/exit drift, REAL capture path on vs off (AC-01) ----

  it.each([
    'doctor',
    'flow',
    'record',
  ])('real telemetry on vs off (kill-switch) leaves %s output+exit identical', async (cmd) => {
    const on = await runMain(['node', 'harness', cmd], captureTelemetry, {
      deps: deps({ env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 's1' }, '/home/u') }),
    });
    const off = await runMain(['node', 'harness', cmd], captureTelemetry, {
      deps: deps({
        env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 's1', HARNESS_NO_TELEMETRY: '1' }, '/home/u'),
      }),
    });
    // Real captureTelemetry runs (and writes a buffer) when on, short-circuits
    // when off — the host command's stdout/stderr/exit must not budge either way.
    expect(maskTs(on)).toEqual(maskTs(off));
  });
});

// ---- FX004: an unregistered verb reports the REASON, not a syntax error ----

describe('noExtensionContextEnvelope (FX004)', () => {
  /*
  Test Doc:
  - Why: pre-fix, `harness checks` from a directory with no loadable extensions
    reported `E108: Expected 0 arguments but got 1: checks` — "you typed it wrong"
    for a state the CLI could diagnose. `harness checks --help` was worse: it printed
    TOP-LEVEL usage and exited 0, a failing case returning a passing-looking result.
  - Contract: the guard runs PRE-PARSE, so it catches both faces; it returns null
    (carry on) whenever it cannot honestly claim an absent extension context.
  - Quality Contribution: this is the control set that breaks the confound which let
    the "not in a harness repo" theory survive three tellings — it tests the
    discriminator in BOTH directions, and nothing here involves git.
  */
  const emptyRegistry = { verbs: [], records: [] };
  const EXT = (root: string) => `${root}/.harness/extensions`;
  const withExtensions = (root: string) =>
    new FakeFs({ [`${EXT(root)}/checks/extension.ts`]: '// checks' }, { [EXT(root)]: ['checks'] });

  const guard = (argv: string[], d: VerbActDeps, registry = emptyRegistry) =>
    noExtensionContextEnvelope(
      argv,
      buildProgram('1.2.3', io, d, registry),
      d,
      new FakeClock('2026-06-08T07:20:00.000Z'),
    );

  it('CONTROL: `checks` with no loadable extensions → E149, not E108', () => {
    const d = deps({ fs: new FakeFs(), proc: new FakeProcess({}, '/tmp/elsewhere') });
    const env = guard(['node', 'harness', 'checks'], d);
    expect(env?.error?.code).toBe('E149');
    expect(env?.error?.message).toContain('/tmp/elsewhere');
  });

  it('CONTROL: the second face — `checks --help` is refused, not silently helped', () => {
    /*
    A near-miss invocation returning a passing-looking result is how the bug read as
    working. The guard is pre-parse precisely so `--help` cannot short-circuit it.
    */
    const d = deps({ fs: new FakeFs(), proc: new FakeProcess({}, '/tmp/elsewhere') });
    expect(guard(['node', 'harness', 'checks', '--help'], d)?.error?.code).toBe('E149');
  });

  it('CONTROL: inside a repo but NOT at its root — still refused, and the remedy is the VERIFIED ancestor', () => {
    /*
    The case a "not in a harness repo" message would lie to. The fake has no git
    concept at all, so "in a repo" is not even representable — that is the point.
    */
    const d = deps({ fs: withExtensions('/work'), proc: new FakeProcess({}, '/work/harness/cli') });
    const env = guard(['node', 'harness', 'checks'], d);
    expect(env?.error?.code).toBe('E149');
    expect(env?.error?.message).not.toMatch(/repo/i);
    expect(env?.next_action).toBe('cd /work && harness checks');
  });

  it('GUARD: extensions ARE loadable here → not our case, E108 still owns the typo', () => {
    /*
    The guard's own guard. It must never claim an absent extension context in a
    directory that has one; an unknown name there really is a typo.
    */
    const d = deps({ fs: withExtensions('/work'), proc: new FakeProcess({}, '/work') });
    expect(guard(['node', 'harness', 'nosuchverb'], d)).toBeNull();
  });

  it('GUARD: a REGISTERED verb is never intercepted, extensions present or not', () => {
    const d = deps({ fs: new FakeFs(), proc: new FakeProcess({}, '/tmp/elsewhere') });
    expect(
      guard(['node', 'harness', 'hello'], d, { verbs: [mkVerb('hello')], records: [] }),
    ).toBeNull();
  });

  it('GUARD: core commands and flag-only invocations are never intercepted', () => {
    const d = deps({ fs: new FakeFs(), proc: new FakeProcess({}, '/tmp/elsewhere') });
    for (const argv of [
      ['node', 'harness'],
      ['node', 'harness', '--version'],
      ['node', 'harness', '--json'],
      ['node', 'harness', 'help'],
      ['node', 'harness', 'doctor'],
    ]) {
      expect(guard(argv, d)).toBeNull();
    }
  });

  it('GUARD: global flags before the verb do not hide it from the guard', () => {
    const d = deps({ fs: new FakeFs(), proc: new FakeProcess({}, '/tmp/elsewhere') });
    expect(guard(['node', 'harness', '--json', '--quiet', 'checks'], d)?.error?.code).toBe('E149');
  });
});

describe('firstPositional (FX004 argv scan)', () => {
  it('skips flags, stops at `--`, and returns null when there is no verb', () => {
    expect(firstPositional(['node', 'h', '--json', 'checks'])).toBe('checks');
    expect(firstPositional(['node', 'h', 'checks', '--help'])).toBe('checks');
    expect(firstPositional(['node', 'h'])).toBeNull();
    expect(firstPositional(['node', 'h', '--version'])).toBeNull();
    expect(firstPositional(['node', 'h', '--', 'checks'])).toBeNull();
  });
});
