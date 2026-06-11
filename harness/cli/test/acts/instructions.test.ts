import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerInstructionsAct } from '../../src/acts/instructions.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import type { HarnessVerb } from '../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import { CORE_INSTRUCTIONS } from '../../src/services/instructions/core-instructions.js';

/*
Test Doc:
- Why: `harness instructions [verb]` is the agent's self-briefing channel (plan 014 AC-1/2/3):
  a CORE act that surfaces the baked briefing bare, and each extension's runtime-loaded
  instructions.md per verb, mapping outcomes to the canonical Envelope + exit codes
  (ok → 0, unconfigured → 2, error E145 → 1) per D3.
- Contract: bare → ok {instructions, verbs_with_instructions}; <verb> → ok {verb, path,
  instructions} (whole-file, unmodified); unknown verb / missing file → unconfigured + next_action;
  exists-but-unreadable → error E145 + next_action. Never a crash, never a silent empty.
- Quality Contribution: pins the act/envelope/exit wiring with fakes (record.ts pattern).
*/

const FLOW_DIR = '/repo/.harness/extensions/flow';

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

function registry(): VerbRegistry {
  return {
    verbs: [mkVerb('flow')],
    records: [{ entryPath: `${FLOW_DIR}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] }],
  };
}

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

describe('registerInstructionsAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(args: string[], io: CliIo, fs: FakeFs, reg: VerbRegistry = registry()): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerInstructionsAct(
      program,
      io,
      { fs, clock: new FakeClock('2026-06-10T00:00:00.000Z') },
      reg,
    );
    expect(() => program.parse(['node', 'harness', 'instructions', ...args])).toThrow(/^exit:/);
    return code;
  }

  it('bare `instructions` emits the baked core briefing + verbs_with_instructions (AC-1, exit 0)', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs({ [`${FLOW_DIR}/instructions.md`]: '# Flow briefing' });
    const code = run([], io, fs);
    const env = JSON.parse(out());
    expect(env.command).toBe('instructions');
    expect(env.status).toBe('ok');
    expect(env.data.instructions).toBe(CORE_INSTRUCTIONS);
    expect(env.data.verbs_with_instructions).toEqual(['flow']);
    expect(env.next_action).toContain('harness instructions');
    expect(code).toBe(0);
  });

  it('human mode prints the briefing text itself (the agent reads it directly)', () => {
    const { io, out } = ioFor('human');
    const code = run([], io, new FakeFs());
    expect(out()).toContain(CORE_INSTRUCTIONS.slice(0, 40));
    expect(code).toBe(0);
  });

  it('`instructions <verb>` returns the whole unmodified file content (AC-2, exit 0)', () => {
    const { io, out } = ioFor('json');
    const content = '# Flow briefing\n\nReview each worker repo yourself.\n';
    const fs = new FakeFs({ [`${FLOW_DIR}/instructions.md`]: content });
    const code = run(['flow'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      verb: 'flow',
      path: `${FLOW_DIR}/instructions.md`,
      instructions: content,
    });
    expect(code).toBe(0);
  });

  it('serves edited content on the next invocation — runtime-loaded, no rebuild (D4)', () => {
    const fs = new FakeFs({ [`${FLOW_DIR}/instructions.md`]: 'v1' });
    const first = ioFor('json');
    run(['flow'], first.io, fs);
    expect(JSON.parse(first.out()).data.instructions).toBe('v1');

    fs.writeText(`${FLOW_DIR}/instructions.md`, 'v2 — edited between invocations');
    const second = ioFor('json');
    run(['flow'], second.io, fs);
    expect(JSON.parse(second.out()).data.instructions).toBe('v2 — edited between invocations');
  });

  it('unknown verb → unconfigured (exit 2) with a help-pointing next_action, no error code (D3)', () => {
    const { io, out } = ioFor('json');
    const code = run(['nosuchverb'], io, new FakeFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('unconfigured');
    expect(env.error).toBeUndefined();
    expect(env.next_action).toContain('harness help');
    expect(code).toBe(2);
  });

  it('known verb, missing instructions.md → unconfigured (exit 2) prescribing authorship (D3)', () => {
    const { io, out } = ioFor('json');
    const code = run(['flow'], io, new FakeFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('unconfigured');
    expect(env.next_action).toContain(`${FLOW_DIR}/instructions.md`);
    expect(code).toBe(2);
  });

  it('exists-but-unreadable instructions.md → error E145 (exit 1) with next_action (D3)', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    fs.mkdirp(`${FLOW_DIR}/instructions.md`);
    const code = run(['flow'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E145');
    expect(env.next_action).toBeTruthy();
    expect(code).toBe(1);
  });
});
