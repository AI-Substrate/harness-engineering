import type { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram, commanderErrorEnvelope } from '../../src/app.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';

const clock = () => new FakeClock('2026-06-08T07:20:00.000Z');

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

  it('a verb returning an error → actionable envelope, never a raw stack trace', async () => {
    const errorVerb: HarnessVerb = {
      name: 'boom',
      summary: 's',
      run: (ctx) => ctx.error('E1', 'kaboom', { next_action: 'fix it' }),
    };
    const { io, out } = captureIo();
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      throw new Error(`exit:${c ?? 0}`);
    }) as never);
    const program: Command = buildProgram('1.0.0', io, deps(), {
      verbs: [errorVerb],
      records: [],
    });
    await expect(program.parseAsync(['node', 'harness', 'boom'])).rejects.toThrow('exit:1');
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E1');
    expect(env.next_action).toBeDefined();
    expect(out()).not.toMatch(/\n\s+at\s/); // no Node stack frames
  });
});
