import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../src/acts/telemetry.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGitWrite } from '../../src/adapters/git/fake-git-write.js';
import { telemetryRefFor } from '../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';

/** The single shard the buffered fixture flushes to (one session, one capture date). */
const TELEMETRY_REF = telemetryRefFor('2026/06/23', 'sessA');

/*
Test Doc:
- Why: `harness telemetry sync` is a CORE act (reserved family, mirrors `flow`). It must map
  the sync-service outcome onto the Envelope + exit code (ok → 0, push/ref failure → 1) and
  flush via the injected GitWritePort — never touching the host on a failed push beyond exit 1.
- Contract: sync with buffer → ok envelope data.{synced,sessions,pushed,plans}; failed push →
  error envelope exit 1, buffer intact; empty buffer → ok exit 0 synced:0.
- Quality: pins the act/envelope/exit + port-injection wiring with fakes (AC-07/14 surface).
*/

const TEL = '/repo/.harness/temp/telemetry';

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

function seg(plans: string[]): string {
  return `${JSON.stringify(
    { command: 'flow', timecode: '2026-06-23T11:00:00.000Z', plans_touched: plans },
    null,
    2,
  )}\n`;
}

describe('registerTelemetryAct — telemetry sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(
    args: string[],
    io: CliIo,
    fs: FakeFs,
    git: FakeGitWrite,
    env: FakeEnv = new FakeEnv(),
  ): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs,
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-06-23T11:00:00.000Z'),
      env,
      gitWrite: git,
    });
    expect(() => program.parse(['node', 'harness', 'telemetry', ...args])).toThrow(/^exit:/);
    return code;
  }

  function bufferedFs(): FakeFs {
    return new FakeFs(
      { [`${TEL}/sessA/1.json`]: seg(['034-x']), [`${TEL}/sessA/2.json`]: seg(['055-y']) },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json'] },
    );
  }

  it('flushes the buffer and reports an ok envelope (exit 0) with synced/pushed/plans', () => {
    const { io, out } = ioFor('json');
    const git = new FakeGitWrite();
    const code = run(['sync'], io, bufferedFs(), git);
    const env = JSON.parse(out());
    expect(env.command).toBe('telemetry');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      synced: 2,
      sessions: 1,
      pushed: true,
      plans: ['034-x', '055-y'],
    });
    expect(git.pushed).toEqual([`${TELEMETRY_REF}:${TELEMETRY_REF}`]);
    expect(code).toBe(0);
  });

  it('reports an error envelope (exit 1) when the push fails, leaving the buffer intact', () => {
    const { io, out } = ioFor('json');
    const fs = bufferedFs();
    const git = new FakeGitWrite();
    git.failPush = true;
    const code = run(['sync'], io, fs, git);
    const env = JSON.parse(out());
    expect(env.command).toBe('telemetry');
    expect(env.status).toBe('error');
    expect(code).toBe(1);
    // buffer intact: no watermark written
    expect(fs.exists(`${TEL}/sessA.flushed`)).toBe(false);
  });

  it('is a clean ok no-op (exit 0, synced 0) when nothing is buffered', () => {
    const { io, out } = ioFor('json');
    const git = new FakeGitWrite();
    const code = run(['sync'], io, new FakeFs(), git);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({ synced: 0, pushed: false });
    expect(git.calls).toEqual([]);
    expect(code).toBe(0);
  });

  it('human mode prints a one-line summary', () => {
    const { io, out } = ioFor('text');
    const code = run(['sync'], io, bufferedFs(), new FakeGitWrite());
    expect(out()).toContain('telemetry sync: flushed 2 segment(s)');
    expect(code).toBe(0);
  });
});

/*
Test Doc:
- Why: `telemetry get <id>` is the CORE act wrapping `getSessionEvidence` (Finding 2 — the 10
  service tests call the service directly; option parsing, deps construction, the JSON envelope
  shape, the text summary, and the unknown-id exit code are unpinned at the act layer).
- Contract: known id → ok envelope data = the SessionEvidence; unknown id → error envelope (E100)
  exit 1; `--worktree <path>` resolves a non-cwd buffer; text mode → a one-line human summary.
- Quality: the `get` action is ASYNC, so it is driven via `parseAsync` (the live app uses it too)
  and the mocked `process.exit` throw surfaces as the awaited rejection.
*/
describe('registerTelemetryAct — telemetry get', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A buffered segment fold() can read: pij join key + an event stream + a files field. */
  function evidenceSeg(pijId: string): string {
    return JSON.stringify({
      command: 'doctor',
      harness: 'claude-code',
      harness_session_id: 'h1',
      timecode: '2026-06-23T11:00:00.000Z',
      captured_env: { PIJ_SESSION_ID: pijId },
      files: { written: ['a.ts'], edited: [] },
      tokens: {
        input: 1,
        output: 1,
        cache_create: 0,
        cache_read: 0,
        total: 2,
        subagent_tokens: 0,
        grand_total: 2,
      },
      plans_touched: [],
      event_stream: [
        { t: '2026-06-23T11:00:01.000Z', kind: 'tools', name: 'Bash', count: 3, span_s: 1 },
        { t: '2026-06-23T11:00:02.000Z', kind: 'harness', verb: 'doctor' },
      ],
    });
  }

  /** Drive the ASYNC `get` action through `parseAsync`; the mocked exit throw becomes the rejection. */
  async function runGet(
    args: string[],
    io: CliIo,
    fs: FakeFs,
    env: FakeEnv = new FakeEnv(),
  ): Promise<number> {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs,
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-06-23T11:00:00.000Z'),
      env,
      gitWrite: new FakeGitWrite(),
    });
    await expect(program.parseAsync(['node', 'harness', 'telemetry', ...args])).rejects.toThrow(
      /^exit:/,
    );
    return code;
  }

  /** Buffer under the cwd ('/repo' → TEL), one session subdir holding one tagged segment. */
  function getBufferFs(pijId: string): FakeFs {
    return new FakeFs(
      { [`${TEL}/sessA/0.json`]: evidenceSeg(pijId) },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['0.json'] },
    );
  }

  it('known id → ok envelope (exit 0) carrying the SessionEvidence object', async () => {
    const { io, out } = ioFor('json');
    const code = await runGet(['get', 'pij-get'], io, getBufferFs('pij-get'));
    const env = JSON.parse(out());
    expect(env.command).toBe('telemetry');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({
      pij_session_id: 'pij-get',
      harness: 'claude-code',
      segments: 1,
      tools: { Bash: 3 },
      harness_verbs: { doctor: 1 },
      files: { written: ['a.ts'], edited: [] },
      gaps: ['plans_touched'],
    });
    expect(code).toBe(0);
  });

  it('unknown id → error envelope (E100, exit 1)', async () => {
    const { io, out } = ioFor('json');
    const code = await runGet(['get', 'pij-absent'], io, getBufferFs('pij-get'));
    const env = JSON.parse(out());
    expect(env.command).toBe('telemetry');
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E100');
    expect(code).toBe(1);
  });

  it('--worktree <path> resolves a buffer outside the cwd', async () => {
    const WT = '/wt/.harness/temp/telemetry';
    const fs = new FakeFs(
      { [`${WT}/s/0.json`]: evidenceSeg('pij-wt') },
      { [WT]: ['s'], [`${WT}/s`]: ['0.json'] },
    );
    const { io, out } = ioFor('json');
    // cwd '/repo' has NO buffer here → resolution must come from --worktree
    const code = await runGet(['get', 'pij-wt', '--worktree', '/wt'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data.pij_session_id).toBe('pij-wt');
    expect(code).toBe(0);
  });

  it('text mode prints a one-line human summary', async () => {
    const { io, out } = ioFor('text');
    const code = await runGet(['get', 'pij-get'], io, getBufferFs('pij-get'));
    expect(out()).toContain('telemetry get: 1 segment(s)');
    expect(out()).toContain('1 tool(s)');
    expect(code).toBe(0);
  });
});

/*
Test Doc (review note N1 — plan 047 Phase 1):
- Why: `telemetry session save <id>` is the CORE act wrapping `combineSession` (the service is
  unit-tested; the act's option parsing, file WRITE, Envelope + evidence[] wiring, and the two
  honest error paths — empty session, unsupported --source — were only proven by the live smoke).
- Contract: valid session → ok envelope + evidence[<out>] + a schema-valid file on disk; empty
  session → error exit 1 (no file written); --source git-ref → error exit 1 (Phase 3); text mode
  → one-line summary.
- Quality: pins the act/envelope/exit + fs-write wiring with fakes (no real fs).
*/
describe('registerTelemetryAct — telemetry session save', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Drive the SYNC `session save` action; the mocked exit throw surfaces synchronously. */
  function runSave(args: string[], io: CliIo, fs: FakeFs): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs,
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-06-23T11:00:00.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
    });
    expect(() => program.parse(['node', 'harness', 'telemetry', 'session', ...args])).toThrow(
      /^exit:/,
    );
    return code;
  }

  /** A v2 segment combineSession can read: identity + one turn event carrying tokens. */
  function saveSeg(): string {
    return JSON.stringify({
      schema_version: '2.2',
      command: 'flow',
      harness: 'claude-code',
      harness_version: '0.6.0',
      harness_session_id: 'sessSave',
      timecode: '2026-06-23T11:00:00.000Z',
      branch: 'main',
      tokens: {
        input: 10,
        output: 20,
        cache_read: 0,
        cache_create: 0,
        total: 30,
        subagent_tokens: 0,
        grand_total: 30,
      },
      models: { 'claude-opus-4-8': { turns: 1, output_tokens: 20 } },
      event_stream: [{ t: '2026-06-23T11:00:01.000Z', kind: 'turn', dur_s: 1, in: 10, out: 20 }],
      rollup: null,
    });
  }

  /** Buffer under cwd ('/repo' → TEL), one session subdir 'sessSave' holding one segment. */
  function saveBufferFs(): FakeFs {
    return new FakeFs(
      { [`${TEL}/sessSave/0.json`]: saveSeg() },
      { [TEL]: ['sessSave'], [`${TEL}/sessSave`]: ['0.json'] },
    );
  }

  it('valid session → ok envelope (exit 0), evidence[<out>], and a schema-valid file on disk', () => {
    const { io, out } = ioFor('json');
    const fs = saveBufferFs();
    const code = runSave(
      ['save', 'sessSave', '--source', 'temp', '--out', '/out/sessSave.session.json'],
      io,
      fs,
    );
    const env = JSON.parse(out());
    expect(env.command).toBe('telemetry');
    expect(env.status).toBe('ok');
    expect(env.data).toMatchObject({ session_id: 'sessSave', segment_count: 1 });
    expect(env.evidence).toEqual([{ label: 'session export', path: '/out/sessSave.session.json' }]);
    // The file was actually written and is a valid SessionExport envelope.
    const written = fs.readText('/out/sessSave.session.json');
    expect(written).not.toBeNull();
    const doc = JSON.parse(written as string);
    expect(doc.schema_version).toBe('harness.session-export/v1');
    expect(doc.identity.harness_session_id).toBe('sessSave');
    expect(doc.identity.models).toEqual(['claude-opus-4-8']);
    expect(doc.signals.logs.resourceLogs).toHaveLength(1);
    expect(code).toBe(0);
  });

  it('empty/unknown session → error envelope (exit 1), no file written', () => {
    const { io, out } = ioFor('json');
    const fs = saveBufferFs();
    const code = runSave(['save', 'noSuchSession', '--out', '/out/x.session.json'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(fs.readText('/out/x.session.json')).toBeNull(); // buffer/output untouched
    expect(code).toBe(1);
  });

  it('--source git-ref → honest error envelope (exit 1) — the Phase 3 seam', () => {
    const { io, out } = ioFor('json');
    const code = runSave(['save', 'sessSave', '--source', 'git-ref'], io, saveBufferFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.message).toContain('git-ref');
    expect(code).toBe(1);
  });

  it('text mode prints a one-line summary', () => {
    const { io, out } = ioFor('text');
    const code = runSave(['save', 'sessSave', '--out', '/out/s.session.json'], io, saveBufferFs());
    expect(out()).toContain('telemetry session save: combined 1 segment(s)');
    expect(code).toBe(0);
  });
});
