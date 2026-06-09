import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRecordAct } from '../../src/acts/record.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import {
  buildRecordRegistry,
  coreRecordTypes,
  type RecordRegistry,
} from '../../src/services/record/registry.js';

/*
Test Doc:
- Why: `harness record` is a CORE act; it must turn the record-service outcome into the canonical
  Envelope (ok → 0, error → 1, unconfigured → 2), expose --list discovery + a bare orientation, and
  inject the real ports, with no business logic.
- Contract: `record <type> [--slug s]` → ok envelope with data.{type,path,source} + evidence + a
  fill next_action; `record --list` / bare `record` → ok envelope enumerating data.types; unknown
  type → E180 exit 1; no .harness/ → unconfigured exit 2; bad slug → E108 exit 1.
- Quality Contribution: pins the act/envelope/exit wiring + the --list payload shape with fakes.
*/

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

/** A registry with the core retro type plus one extension type (for --list provenance). */
const REGISTRY: RecordRegistry = buildRecordRegistry(coreRecordTypes, [
  {
    recordType: {
      kind: 'record',
      type: 'dev-survey',
      description: 'Developer-experience survey.',
      template: '---\nrecord_type: dev-survey\n---\n',
    },
    entryPath: '.harness/extensions/dev-survey.record.ts',
  },
]);

function depsWith(fs: FakeFs) {
  return {
    fs,
    proc: new FakeProcess({}, '/repo'),
    clock: new FakeClock('2026-06-08T07:20:00.000Z'),
  };
}

/** A FakeFs whose `.harness/` directory exists. */
function configuredFs(seed: Record<string, string> = {}): FakeFs {
  const fs = new FakeFs(seed);
  fs.mkdirp('/repo/.harness');
  return fs;
}

describe('registerRecordAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(args: string[], io: CliIo, fs: FakeFs, registry: RecordRegistry = REGISTRY): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerRecordAct(program, io, depsWith(fs), registry);
    expect(() => program.parse(['node', 'harness', 'record', ...args])).toThrow(/^exit:/);
    return code;
  }

  it('creates a retro record and emits an ok envelope (exit 0) with the path + evidence', () => {
    const { io, out } = ioFor('json');
    const fs = configuredFs();
    const code = run(['retro', '--slug', 'my-note'], io, fs);
    const env = JSON.parse(out());
    expect(env.command).toBe('record');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      type: 'retro',
      path: '.harness/records/retro/2026-06-08-my-note.md',
      source: 'core',
    });
    expect(env.evidence[0].path).toBe('.harness/records/retro/2026-06-08-my-note.md');
    expect(env.next_action).toMatch(/fill/i);
    expect(fs.writes).toContain('/repo/.harness/records/retro/2026-06-08-my-note.md');
    expect(code).toBe(0);
  });

  it('a second same-day create gets the -001 collision suffix', () => {
    const { io, out } = ioFor('json');
    const fs = configuredFs({ '/repo/.harness/records/retro/2026-06-08-x.md': 'existing' });
    const code = run(['retro', '--slug', 'x'], io, fs);
    expect(JSON.parse(out()).data.path).toBe('.harness/records/retro/2026-06-08-x-001.md');
    expect(code).toBe(0);
  });

  it('an unknown type → error E180 (exit 1) listing known types', () => {
    const { io, out } = ioFor('json');
    const fs = configuredFs();
    const code = run(['nope'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.code).toBe(ErrorCodes.RECORD_TYPE_UNKNOWN);
    expect(env.next_action).toContain('retro');
    expect(code).toBe(1);
  });

  it('no .harness/ → unconfigured (exit 2), nothing written', () => {
    const { io, out } = ioFor('json');
    const fs = new FakeFs();
    const code = run(['retro'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('unconfigured');
    expect(env.next_action.length).toBeGreaterThan(0);
    expect(fs.writes).toEqual([]);
    expect(code).toBe(2);
  });

  it('an invalid slug → error E108 (exit 1)', () => {
    const { io, out } = ioFor('json');
    const code = run(['retro', '--slug', '!!!'], io, configuredFs());
    expect(JSON.parse(out()).error.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(code).toBe(1);
  });

  it('--list enumerates core ∪ extension with provenance (exit 0)', () => {
    const { io, out } = ioFor('json');
    const code = run(['--list'], io, configuredFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    const types = env.data.types as Array<{ type: string; source: string; entryPath?: string }>;
    const retro = types.find((t) => t.type === 'retro');
    const ds = types.find((t) => t.type === 'dev-survey');
    expect(retro).toMatchObject({ source: 'core' });
    expect(retro?.entryPath).toBeUndefined();
    expect(ds).toMatchObject({
      source: 'extension',
      entryPath: '.harness/extensions/dev-survey.record.ts',
    });
    expect(env.data.types[0]).toHaveProperty('description');
    expect(code).toBe(0);
  });

  it('bare `record` (no type, no --list) prints the same orientation listing (exit 0)', () => {
    const { io, out } = ioFor('json');
    const code = run([], io, configuredFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data.types.map((t: { type: string }) => t.type)).toContain('retro');
    expect(code).toBe(0);
  });

  it('human mode prints a Created line and exits 0', () => {
    const { io, out } = ioFor('human');
    const code = run(['retro', '--slug', 'x'], io, configuredFs());
    expect(out()).toContain('Created .harness/records/retro/2026-06-08-x.md');
    expect(code).toBe(0);
  });
});
