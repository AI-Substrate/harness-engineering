import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerInitAct } from '../../src/acts/init.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { GOVERNANCE_DOC } from '../../src/services/init/init-service.js';

/*
Test Doc:
- Why: `harness init` is a CORE act (the governance-doc inception writer); it must turn the
  init-service outcome into the canonical Envelope (ok → 0, error → 1), seed maturity_seed:'L0' ONLY
  on a fresh create, attach the doc as evidence, and inject the real ports with no business logic.
- Contract: `init` (created) → ok data {path,created:true,maturity_seed:'L0'} + evidence + adopt
  next_action, exit 0; (existing) → ok data {path,created:false} (no maturity_seed), exit 0; write
  failure → E190 exit 1 with next_action + no stack trace.
- Quality Contribution: pins the act/envelope/exit wiring + the maturity_seed-on-create-only rule.
*/

const DOC_ABS = `/repo/.harness/${GOVERNANCE_DOC}`;
const DOC_REL = `.harness/${GOVERNANCE_DOC}`;

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

function depsWith(fs: FakeFs) {
  return {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
  };
}

describe('registerInitAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(io: CliIo, fs: FakeFs): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerInitAct(program, io, depsWith(fs));
    expect(() => program.parse(['node', 'harness', 'init'])).toThrow(/^exit:/);
    return code;
  }

  it('creates the doc → ok envelope (exit 0) with created:true, maturity_seed:L0, evidence', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    const code = run(io, fs);
    const env = JSON.parse(out());
    expect(env.command).toBe('init');
    expect(env.status).toBe('ok');
    expect(env.data).toEqual({ path: DOC_REL, created: true, maturity_seed: 'L0' });
    expect(env.evidence[0].path).toBe(DOC_REL);
    expect(env.next_action).toMatch(/adopt/i);
    expect(fs.writes).toContain(DOC_ABS);
    expect(code).toBe(0);
  });

  it('an existing doc → ok envelope (exit 0), created:false, NO maturity_seed, nothing written', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs({ [DOC_ABS]: 'existing\n' });
    const code = run(io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data).toEqual({ path: DOC_REL, created: false });
    expect(env.data).not.toHaveProperty('maturity_seed');
    expect(fs.writes).toEqual([]);
    expect(code).toBe(0);
  });

  it('a write failure → error E190 (exit 1) with next_action and no stack trace', () => {
    const { io, out } = ioFor('json');
    class ThrowingFs extends FakeFs {
      override writeText(): void {
        throw new Error('EACCES');
      }
    }
    const code = run(io, new ThrowingFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe(ErrorCodes.INIT_WRITE_FAILED);
    expect(env.next_action.length).toBeGreaterThan(0);
    expect(env.error.message).not.toContain('\n    at '); // no stack frames leaked
    expect(code).toBe(1);
  });

  it('human mode prints a Created line and exits 0', () => {
    const { io, out } = ioFor('human');
    const code = run(io, new FakeFs());
    expect(out()).toContain(`Created ${DOC_REL}`);
    expect(code).toBe(0);
  });

  it('human mode on an existing doc prints "Already present" and exits 0', () => {
    const { io, out } = ioFor('human');
    const fs = new FakeFs({ [DOC_ABS]: 'existing\n' });
    const code = run(io, fs);
    expect(out()).toContain('Already present');
    expect(code).toBe(0);
  });
});
