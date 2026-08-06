import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../src/acts/telemetry.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGitWrite } from '../../src/adapters/git/fake-git-write.js';
import { FakeRemoteTelemetryGit } from '../../src/adapters/git/fake-remote-telemetry-git.js';
import { telemetryRefFor } from '../../src/adapters/git/git-write-port.js';
import { FakeHash } from '../../src/adapters/hash/fake-hash.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import type { Event } from '../../src/services/telemetry/events.js';
import { segmentToOtlpLogs } from '../../src/services/telemetry/otlp/logs.js';
import { buildReport, buildReportFromInputs } from '../../src/services/telemetry/report.js';
import { serializeSegment } from '../../src/services/telemetry/segment.js';
import type { SessionExport } from '../../src/services/telemetry/session-export.js';
import { buildTelemetryBundle } from '../../src/services/telemetry/telemetry-bundle.js';

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

function generatedRemoteCredentialUsernames(): string[] {
  return [
    `${['g', 'h', 'p'].join('')}_${'A'.repeat(20)}`,
    `${['github', 'pat'].join('_')}_${'B'.repeat(20)}`,
    `${['A', 'K', 'I', 'A'].join('')}${'C'.repeat(16)}`,
    `${['s', 'k'].join('')}_${['li', 've'].join('')}_${'D'.repeat(16)}`,
  ];
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
    // Plan 073: capture/publish are OFF by default, so a sync test that wants
    // the buffer flushed must opt in exactly as a migrating operator would.
    env: FakeEnv = new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
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
    expect(git.pushed).toEqual([`+${TELEMETRY_REF}:${TELEMETRY_REF}`]);
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

  function partialEvidenceSeg(pijId: string): string {
    const segment = JSON.parse(evidenceSeg(pijId)) as Record<string, unknown>;
    segment.event_stream = [
      {
        t: '2026-06-23T11:00:01.000Z',
        kind: 'usage',
        observation_kind: 'final_shutdown',
        out: 22,
      },
    ];
    return JSON.stringify(segment);
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

  it('partial token evidence returns a degraded get envelope', async () => {
    const fs = new FakeFs(
      { [`${TEL}/sessA/0.json`]: partialEvidenceSeg('pij-partial') },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['0.json'] },
    );
    const { io, out } = ioFor('json');
    const code = await runGet(['get', 'pij-partial'], io, fs);
    const env = JSON.parse(out());

    expect(env.status).toBe('degraded');
    expect(env.data.token_evidence).toMatchObject({ coverage: 'partial', cause: 'unknown' });
    expect(env.next_action).toContain('Token coverage is partial');
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

describe('registerTelemetryAct — telemetry get-fleet coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns degraded when a joined lane has partial token evidence', async () => {
    const root = 'pij-root';
    const child = 'pij-child';
    const segment = {
      schema_version: '2.6',
      command: 'flow',
      harness: 'copilot-cli',
      harness_version: 'test',
      harness_session_id: 'hs-child',
      timecode: '2026-07-23T00:00:00.000Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: null,
      tokens: null,
      effort: null,
      event_stream: [
        {
          t: '2026-07-23T00:00:00.000Z',
          kind: 'usage',
          observation_kind: 'final_shutdown',
          out: 22,
        },
      ],
      rollup: null,
      captured_env: {
        PIJ_SESSION_ID: child,
        PIJ_PARENT_ID: root,
        PIJ_HARNESS: 'copilot',
      },
    };
    const fs = new FakeFs(
      { [`${TEL}/hs-child/0.json`]: JSON.stringify(segment) },
      { [TEL]: ['hs-child'], [`${TEL}/hs-child`]: ['0.json'] },
    );
    const { io, out } = ioFor('json');
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
      code = value ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs,
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-07-23T00:00:01.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
    });

    await expect(
      program.parseAsync(['node', 'harness', 'telemetry', 'get-fleet', root]),
    ).rejects.toThrow(/^exit:/);
    const envelope = JSON.parse(out());
    expect(envelope.status).toBe('degraded');
    expect(envelope.data.sessions[0].token_evidence).toMatchObject({ coverage: 'partial' });
    expect(envelope.next_action).toContain('partial/unavailable');
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

  function partialSaveBufferFs(): FakeFs {
    const partial = JSON.parse(saveSeg()) as Record<string, unknown>;
    partial.schema_version = '2.6';
    partial.window = { since: 'session-start', from: 0, to: 1 };
    partial.effort = null;
    partial.event_stream = [
      {
        t: '2026-06-23T11:00:01.000Z',
        kind: 'usage',
        observation_kind: 'final_shutdown',
        out: 20,
      },
    ];
    return new FakeFs(
      { [`${TEL}/sessSave/0.json`]: JSON.stringify(partial) },
      { [TEL]: ['sessSave'], [`${TEL}/sessSave`]: ['0.json'] },
    );
  }

  it('valid session → ok envelope (exit 0), evidence[<out> + <html>], and a schema-valid file on disk', () => {
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
    // F4: a compact totals block so `flow-eval score` can populate telemetry_summary
    // from ONE stable source (non-cache tokens + cache + turns; active time present).
    expect(env.data.totals).toMatchObject({
      tokens: { input: 10, output: 20 },
      cache: { read: 0, create: 0 },
      turns: 1,
    });
    expect(typeof env.data.totals.active_time_s).toBe('number');
    // T008: session save co-produces the N=1 HTML view beside the .session.json.
    expect(env.evidence).toEqual([
      { label: 'session export', path: '/out/sessSave.session.json' },
      { label: 'session view', path: '/out/sessSave.html' },
    ]);
    // The file was actually written and is a valid SessionExport envelope.
    const written = fs.readText('/out/sessSave.session.json');
    expect(written).not.toBeNull();
    const doc = JSON.parse(written as string);
    expect(doc.schema_version).toBe('harness.session-export/v1');
    expect(doc.identity.harness_session_id).toBe('sessSave');
    expect(doc.identity.models).toEqual(['claude-opus-4-8']);
    expect(doc.signals.logs.resourceLogs).toHaveLength(1);
    // The co-produced HTML is self-contained (inline-embed, no fetch) and carries the report.
    const html = fs.readText('/out/sessSave.html');
    expect(html).not.toBeNull();
    expect(html as string).toContain('class="report-column"');
    expect(html as string).not.toMatch(/fetch\s*\(/);
    expect(html as string).toContain('harness.telemetry-report/v1');
    expect(code).toBe(0);
  });

  it('partial token coverage returns a degraded envelope with a next action', () => {
    const { io, out } = ioFor('json');
    const code = runSave(
      ['save', 'sessSave', '--out', '/out/partial.session.json', '--no-html'],
      io,
      partialSaveBufferFs(),
    );
    const env = JSON.parse(out());

    expect(env.status).toBe('degraded');
    expect(env.data.token_evidence).toMatchObject({
      coverage: 'partial',
      reason: 'partial_observation',
      cause: 'unknown',
    });
    expect(env.next_action).toContain('token_evidence.fields');
    expect(code).toBe(0);
  });
  it('--no-html suppresses the co-produced view (only the .session.json is written)', () => {
    const { io, out } = ioFor('json');
    const fs = saveBufferFs();
    const code = runSave(['save', 'sessSave', '--out', '/out/s.session.json', '--no-html'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.evidence).toEqual([{ label: 'session export', path: '/out/s.session.json' }]);
    expect(env.data.html).toBeNull();
    expect(fs.readText('/out/s.html')).toBeNull(); // no HTML written
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

  it('an EXPLICIT --source auto with no git read port → honest error (never a silent temp read)', () => {
    // R2-04. `auto` is the default, and a DEFAULTED auto degrades to temp on purpose
    // (combineSession then marks a flushed session partial). But an operator who TYPED
    // `--source auto` asked for the union; answering with a temp subset would be the
    // silent under-report finding 02 exists to kill. The two paths must stay distinct.
    const { io, out } = ioFor('json');
    const code = runSave(['save', 'sessSave', '--source', 'auto'], io, saveBufferFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(env.error.message).toContain('auto');
    expect(code).toBe(1);
  });

  it('text mode prints a one-line summary', () => {
    const { io, out } = ioFor('text');
    const code = runSave(['save', 'sessSave', '--out', '/out/s.session.json'], io, saveBufferFs());
    expect(out()).toContain('telemetry session save: combined 1 segment(s)');
    expect(code).toBe(0);
  });
});

/*
Test Doc:
- Why: `telemetry report <paths…>` + `report-render <folder>` are the Phase 2 CORE verbs — they
  sweep saved *.session.json recursively, build a TelemetryReport, and co-produce a self-contained
  HTML (inline-embed, no fetch). The act layer owns the sweep/dedupe, filter parsing, folder-vs-file
  output, --no-html suppression, provenance path sanitation (P12), and the Envelope + evidence[].
- Contract: sweep → <out>/<name>.report.json (+ index.html unless --no-html); --out *.json = data-only;
  filters narrow; report-render renders every *.report.json in a folder into N labelled columns;
  no sessions / empty folder → honest error exit 1.
- Quality: fakes-over-mocks (FakeFs/FakeClock), real serializeSegment→OTLP inputs, self-contained-HTML
  + path-leak assertions.
*/

describe('registerTelemetryAct — remote telemetry grammar (P060 T001 RED)', () => {
  function registeredTelemetry(): Command {
    const program = new Command().name('harness');
    registerTelemetryAct(program, ioFor('json').io, {
      fs: new FakeFs(),
      proc: new FakeProcess({}, '/not-a-repository'),
      clock: new FakeClock('2026-06-23T11:00:00.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
    });
    const telemetry = program.commands.find((command) => command.name() === 'telemetry');
    expect(telemetry).toBeDefined();
    return telemetry as Command;
  }

  it('registers exactly one ls and one pull subcommand with no positional arguments', () => {
    const telemetry = registeredTelemetry();
    expect(telemetry.commands.filter((command) => command.name() === 'ls')).toHaveLength(1);
    expect(telemetry.commands.filter((command) => command.name() === 'pull')).toHaveLength(1);
    expect(
      telemetry.commands.find((command) => command.name() === 'ls')?.registeredArguments,
    ).toEqual([]);
    expect(
      telemetry.commands.find((command) => command.name() === 'pull')?.registeredArguments,
    ).toEqual([]);
  });

  it('pins ls help to repeatable repositories plus zero-or-one selector family', () => {
    const ls = registeredTelemetry().commands.find((command) => command.name() === 'ls');
    expect(ls).toBeDefined();
    const help = (ls as Command).helpInformation();
    expect(help).toContain('Usage: harness telemetry ls [options]');
    for (const option of [
      '--repo <url>',
      '--repo-file <path>',
      '--session <id>',
      '--from-date <YYYY-MM-DD>',
      '--to-date <YYYY-MM-DD>',
      '--from-commit <full-oid>',
      '--to-commit <full-oid>',
    ]) {
      expect(help).toContain(option);
    }
    for (const rejected of ['--pij', '--agent', '--source', '--offline', '--refresh', '--out']) {
      expect(help).not.toContain(rejected);
    }
  });

  it('pins pull help to repeatable repositories, one required selector family, and exact --out', () => {
    const pull = registeredTelemetry().commands.find((command) => command.name() === 'pull');
    expect(pull).toBeDefined();
    const help = (pull as Command).helpInformation();
    expect(help).toContain('Usage: harness telemetry pull [options]');
    for (const option of [
      '--repo <url>',
      '--repo-file <path>',
      '--session <id>',
      '--from-date <YYYY-MM-DD>',
      '--to-date <YYYY-MM-DD>',
      '--from-commit <full-oid>',
      '--to-commit <full-oid>',
      '--out <exact-folder>',
    ]) {
      expect(help).toContain(option);
    }
    for (const rejected of ['--pij', '--agent', '--source', '--offline', '--refresh']) {
      expect(help).not.toContain(rejected);
    }
  });
});

describe('registerTelemetryAct — remote telemetry envelopes', () => {
  afterEach(() => vi.restoreAllMocks());

  async function runRemote(
    args: string[],
    mode: OutputMode,
    git = new FakeRemoteTelemetryGit(),
    fs = new FakeFs(),
    env = new FakeEnv(),
    cwd = '/not-a-repository',
  ): Promise<{
    code: number;
    out: string;
    fs: FakeFs;
    git: FakeRemoteTelemetryGit;
    hash: FakeHash;
  }> {
    let code = -1;
    const ioState = ioFor(mode);
    const hash = new FakeHash();
    vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
      code = value ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, ioState.io, {
      fs,
      proc: new FakeProcess({}, cwd),
      clock: new FakeClock('2026-07-16T00:00:00.000Z'),
      env,
      gitWrite: new FakeGitWrite(),
      remoteGit: git,
      hash,
    });
    await expect(program.parseAsync(['node', 'harness', 'telemetry', ...args])).rejects.toThrow(
      /^exit:/,
    );
    return { code, out: ioState.out(), fs, git, hash };
  }

  it.each([
    ['ls', '--pij', 'pij-local'],
    ['ls', '--agent', 'agent-local'],
    ['ls', '--source', 'local'],
    ['ls', '--offline', undefined],
    ['ls', '--refresh', undefined],
    ['pull', '--pij', 'pij-local'],
    ['pull', '--agent', 'agent-local'],
    ['pull', '--source', 'local'],
    ['pull', '--offline', undefined],
    ['pull', '--refresh', undefined],
  ] as const)('rejects former runtime flag %s %s before effects', async (verb, flag, value) => {
    const args = [verb, '--repo', 'https://example.com/team/repo.git'];
    if (verb === 'pull') args.push('--session', 's', '--out', '/exports/former');
    args.push(flag);
    if (value !== undefined) args.push(value);
    const result = await runRemote(args, 'json');
    expect(result.code).toBe(1);
    expect(result.git.calls).toEqual([]);
    expect(result.fs.writes).toEqual([]);
  });

  it('invalid repository grammar is E108 before network or output writes', async () => {
    const result = await runRemote(['ls', '--repo', '../local'], 'json');
    const envelope = JSON.parse(result.out);
    expect(envelope).toMatchObject({ status: 'error', error: { code: 'E108' } });
    expect(result.git.calls).toEqual([]);
    expect(result.fs.writes).toEqual([]);
    expect(result.code).toBe(1);
  });

  it.each([
    { label: 'ls URL credential username', verb: 'ls', form: 'url', shape: 0 },
    { label: 'ls scp credential username', verb: 'ls', form: 'scp', shape: 1 },
    { label: 'pull URL credential username', verb: 'pull', form: 'url', shape: 2 },
    { label: 'pull scp credential username', verb: 'pull', form: 'scp', shape: 3 },
  ] as const)('rejects $label with E108 before Git, hash, or filesystem effects', async (testCase) => {
    const username = generatedRemoteCredentialUsernames()[testCase.shape] ?? '';
    const repository =
      testCase.form === 'url'
        ? `https://${username}@example.com/team/repo.git`
        : `${username}@example.com:team/repo.git`;
    const output = `/exports/rejected-${testCase.shape}`;
    const args =
      testCase.verb === 'ls'
        ? ['ls', '--repo', repository]
        : ['pull', '--repo', repository, '--session', 's', '--out', output];
    const result = await runRemote(args, 'json');
    const envelope = JSON.parse(result.out);

    expect({
      status: envelope.status,
      code: envelope.error?.code ?? null,
      exit: result.code,
      gitCalls: result.git.calls.length,
      hashCalls: result.hash.calls.length,
      writes: result.fs.writes.length,
      mkdirs: result.fs.mkdirs.length,
      siblingTemps: result.fs.siblingTemps.length,
      publishes: result.fs.publishedDirectories.length,
      outputExists: result.fs.exists(output),
      rawEcho: result.out.includes(username),
    }).toEqual({
      status: 'error',
      code: 'E108',
      exit: 1,
      gitCalls: 0,
      hashCalls: 0,
      writes: 0,
      mkdirs: 0,
      siblingTemps: 0,
      publishes: 0,
      outputExists: false,
      rawEcho: false,
    });
  });

  it('is independent of poisoned local origin/ref/buffer/vendor/PIJ state and never falls back', async () => {
    const poisonPaths = [
      '/poison/.git/config',
      '/poison/.git/refs/harness-telemetry/local',
      '/poison/.harness/temp/telemetry/session/1.json',
      '/home/.config/Cursor/User/globalStorage/vendor/session.json',
      '/home/.pij/pij-local/state.json',
    ];
    const poisonFiles = Object.fromEntries(poisonPaths.map((path) => [path, 'poison']));
    const poisonEnv = new FakeEnv(
      {
        PIJ_SESSION_ID: 'pij-local',
        PIJ_PARENT_ID: 'pij-parent',
        HARNESS_TELEMETRY_DIR: '/poison/.harness/temp/telemetry',
      },
      '/home',
    );
    const cleanGit = new FakeRemoteTelemetryGit();
    const poisonedGit = new FakeRemoteTelemetryGit();
    const clean = await runRemote(
      ['ls', '--repo', 'https://example.com/team/repo.git'],
      'json',
      cleanGit,
      new FakeFs(),
    );
    const poisonedFs = new FakeFs(poisonFiles);
    const poisoned = await runRemote(
      ['ls', '--repo', 'https://example.com/team/repo.git'],
      'json',
      poisonedGit,
      poisonedFs,
      poisonEnv,
      '/poison',
    );
    expect(poisoned.out).toBe(clean.out);
    expect(poisonedGit.calls).toEqual(cleanGit.calls);
    expect(poisonedFs.reads.some((path) => poisonPaths.includes(path))).toBe(false);
    expect(poisonedFs.writes.some((path) => poisonPaths.includes(path))).toBe(false);
    expect(poisonEnv.gets).toEqual([]);
    expect(poisonEnv.homeCalls).toBe(0);

    const failedGit = new FakeRemoteTelemetryGit({
      advertisement: {
        ok: false,
        kind: 'transport',
        message: 'safe remote failure',
        repositoryKey: 'repo-failed00000000',
      },
    });
    const failedFs = new FakeFs(poisonFiles);
    const failed = await runRemote(
      [
        'pull',
        '--repo',
        'https://example.com/team/repo.git',
        '--session',
        's',
        '--out',
        '/exports/no-fallback',
      ],
      'json',
      failedGit,
      failedFs,
      poisonEnv,
      '/poison',
    );
    expect(JSON.parse(failed.out)).toMatchObject({
      status: 'error',
      error: { code: 'E220' },
    });
    expect(failedGit.calls.map((call) => call.kind)).toEqual(['advertise']);
    expect(failedFs.exists('/exports/no-fallback')).toBe(false);
    expect(failedFs.reads.some((path) => poisonPaths.includes(path))).toBe(false);
  });

  it('ls empty is ok in JSON and text with no durable output', async () => {
    const json = await runRemote(['ls', '--repo', 'https://example.com/team/repo.git'], 'json');
    expect(JSON.parse(json.out)).toMatchObject({
      status: 'ok',
      data: { rows: [], completeness: 'complete' },
      evidence: [{ label: 'remote inventory', none: true }],
    });
    expect(json.fs.writes).toEqual([]);

    const text = await runRemote(['ls', '--repo', 'https://example.com/team/repo.git'], 'text');
    expect(text.out).toContain('telemetry ls: 0 session(s)');
  });

  it('a complete zero-match date pull publishes a valid empty bundle and reports effects', async () => {
    const result = await runRemote(
      [
        'pull',
        '--repo',
        'https://example.com/team/repo.git',
        '--from-date',
        '2026-07-01',
        '--to-date',
        '2026-07-02',
        '--out',
        '/exports/empty',
      ],
      'json',
    );
    const envelope = JSON.parse(result.out);
    expect(envelope).toMatchObject({
      status: 'ok',
      data: {
        sessions: 0,
        completeness: 'complete',
        written: true,
        effects: { callerRepositoryMutated: false },
      },
      evidence: [{ label: 'telemetry pull bundle', path: '/exports/empty/bundle.json' }],
    });
    expect(result.fs.readText('/exports/empty/bundle.json')).toContain(
      'harness.telemetry-pull-bundle/v1',
    );
  });

  it('feeds a verified complete-empty bundle through the existing report command', async () => {
    const pulled = await runRemote(
      [
        'pull',
        '--repo',
        'https://example.com/team/repo.git',
        '--from-date',
        '2026-07-01',
        '--to-date',
        '2026-07-02',
        '--out',
        '/exports/empty-report',
      ],
      'json',
    );
    const reported = await runRemote(
      ['report', '/exports/empty-report', '--out', '/reports/empty.json'],
      'json',
      new FakeRemoteTelemetryGit(),
      pulled.fs,
    );
    expect(JSON.parse(reported.out)).toMatchObject({ status: 'ok', data: { sessions: 0 } });
    const report = JSON.parse(reported.fs.readText('/reports/empty.json') as string);
    expect(report.provenance.input_coverage).toMatchObject({ accepted_sessions: 0, gaps: [] });
    expect(report.evidence_totals.events).toEqual({
      state: 'unavailable',
      value: null,
      contributors: 0,
    });
  });

  it('maps conclusive exact absence to E221', async () => {
    const result = await runRemote(
      [
        'pull',
        '--repo',
        'https://example.com/team/repo.git',
        '--session',
        'absent',
        '--out',
        '/exports/none',
      ],
      'json',
    );
    expect(JSON.parse(result.out)).toMatchObject({
      status: 'error',
      error: { code: 'E221' },
    });
    expect(result.fs.exists('/exports/none')).toBe(false);
  });
});

describe('registerTelemetryAct — telemetry report / report-render', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(args: string[], io: CliIo, fs: FakeFs, cwd = '/repo'): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs,
      proc: new FakeProcess({}, cwd),
      clock: new FakeClock('2026-06-24T09:00:00.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
      hash: new FakeHash(),
    });
    expect(() => program.parse(['node', 'harness', 'telemetry', ...args])).toThrow(/^exit:/);
    return code;
  }

  /** A minimal, valid SessionExport JSON built through the REAL serializer + OTLP encode. */
  function exportJson(id: string, harness: string, model: string, events: Event[]): string {
    const seg = serializeSegment(
      {
        command: 'flow',
        harness,
        harness_session_id: id,
        timecode: '2026-06-24T09:00:00Z',
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        models: { [model]: { turns: 1, output_tokens: 1 } },
        event_stream: events,
      },
      '/repo',
    );
    const exp: SessionExport = {
      schema_version: 'harness.session-export/v1',
      identity: {
        harness_session_id: id,
        harness,
        harness_version: '0.7.0',
        pij_session_id: null,
        branch: 'main',
        models: [model],
      },
      source: { kind: 'temp', root: '.harness/temp/telemetry', segment_count: 1 },
      summary: {
        segment_schema_versions: { '2.2': 1 },
        first_timecode: events[0]?.t ?? null,
        last_timecode: events[events.length - 1]?.t ?? null,
        tokens: {
          in: 0,
          out: 0,
          cache_read: 0,
          cache_create: 0,
          total: 0,
          subagent_tokens: 0,
          grand_total: 0,
        },
        degraded: [],
      },
      signals: { logs: segmentToOtlpLogs(seg), metrics: { resourceMetrics: [] } },
    };
    return JSON.stringify(exp);
  }

  const bashEv = (t: string): Event => ({ t, kind: 'tools', name: 'Bash', count: 3, span_s: 0 });

  /** Two sessions across a nested folder (proves the recursive sweep). */
  function sessionsFs(): FakeFs {
    return new FakeFs(
      {
        '/data/a.session.json': exportJson('sA', 'claude-code', 'claude-opus-4-8', [
          bashEv('2026-06-24T09:00:01Z'),
        ]),
        '/data/nested/b.session.json': exportJson('sB', 'copilot-cli', 'gpt-5.5', [
          bashEv('2026-06-24T09:00:02Z'),
        ]),
      },
      { '/data': ['a.session.json', 'nested'], '/data/nested': ['b.session.json'] },
    );
  }

  it('documents --filter-repo as applied to bundle inputs and echo-only for legacy exports', () => {
    const program = new Command().name('harness');
    registerTelemetryAct(program, ioFor('json').io, {
      fs: new FakeFs(),
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-06-24T09:00:00.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
    });
    const telemetry = program.commands.find((command) => command.name() === 'telemetry');
    const report = telemetry?.commands.find((command) => command.name() === 'report');
    const help = (report?.helpInformation() ?? '').replace(/\s+/g, ' ');
    expect(help).toContain('Applied only to bundle origins');
    expect(help).toContain('mixed inputs retain every legacy SessionExport');
    expect(help).toContain('echo-only');
  });

  it('applies repo filtering to tagged bundle inputs but only echoes it for legacy exports', () => {
    const expA = JSON.parse(
      exportJson('sA', 'claude-code', 'claude-opus-4-8', [bashEv('2026-06-24T09:00:01Z')]),
    ) as SessionExport;
    const expB = JSON.parse(
      exportJson('sB', 'copilot-cli', 'gpt-5.5', [bashEv('2026-06-24T09:00:02Z')]),
    ) as SessionExport;
    const filter = { repo: ['repo-a'] };
    const legacy = buildReport([expA, expB], { filter });
    expect(legacy.scope.session_count).toBe(2);
    expect(legacy.filter.repo).toEqual(['repo-a']);

    const coverage = {
      events: { state: 'full' as const, count: 1 },
      measurements: { state: 'unavailable' as const, count: null },
      gaps: ['measurements_unavailable' as const],
    };
    const tagged = buildReportFromInputs(
      [
        {
          origin: 'bundle',
          kind: 'full',
          repositoryKey: 'repo-a',
          repository: 'https://example.com/a',
          sessionId: 'sA',
          sessionExport: expA,
          coverage,
          gaps: [],
        },
        {
          origin: 'bundle',
          kind: 'full',
          repositoryKey: 'repo-b',
          repository: 'https://example.com/b',
          sessionId: 'sB',
          sessionExport: expB,
          coverage,
          gaps: [],
        },
      ],
      { filter },
    );
    expect(tagged.scope.session_count).toBe(1);
    expect(tagged.scope.session_ids).toEqual(['sA']);
    expect(tagged.provenance.input_coverage?.accepted_sessions).toBe(1);
  });

  it('keeps a legacy export in the real mixed-input act path under --filter-repo', () => {
    const hash = new FakeHash();
    const url = 'https://example.com/team/repo';
    const key = `repo-${hash.sha256Hex(url).slice(0, 16)}`;
    const bundle = buildTelemetryBundle(
      {
        selector: { kind: 'date', from: '2026-07-01', to: '2026-07-02' },
        completeness: 'complete',
        selectionGaps: [],
        sessions: [],
        repositorySnapshots: [{ key, identity: url, advertisedRefs: 0, selectedRefs: 0 }],
      },
      hash,
    );
    const fs = new FakeFs(
      {
        '/data/a.session.json': exportJson('legacy-kept', 'claude-code', 'claude-opus-4-8', [
          bashEv('2026-06-24T09:00:01Z'),
        ]),
      },
      { '/data': ['a.session.json'], '/bundle': ['bundle.json'] },
    );
    for (const file of bundle.files) fs.writeBytes(`/bundle/${file.path}`, file.bytes);
    const { io } = ioFor('json');
    run(['report', '/data', '/bundle', '--out', '/r/mixed.json', '--filter-repo', key], io, fs);
    const report = JSON.parse(fs.readText('/r/mixed.json') as string);
    expect(report.scope).toMatchObject({ session_count: 1, session_ids: ['legacy-kept'] });
    expect(report.filter.repo).toEqual([key]);
    expect(report.provenance.input_coverage).toMatchObject({
      accepted_sessions: 1,
      repositories: [],
    });
  });

  it('keeps unresolved-only bundle gaps through the real act when filtering by key or identity', () => {
    const hash = new FakeHash();
    const url = 'https://example.com/team/unresolved';
    const key = `repo-${hash.sha256Hex(url).slice(0, 16)}`;
    const bundle = buildTelemetryBundle(
      {
        selector: { kind: 'date', from: '2026-07-01', to: '2026-07-02' },
        completeness: 'partial',
        selectionGaps: [
          {
            repositoryKey: key,
            sessionId: 'unresolved',
            ref: 'refs/harness-telemetry/not/a/date/unresolved',
            reason: 'date_provenance_unavailable',
          },
        ],
        sessions: [],
        repositorySnapshots: [{ key, identity: url, advertisedRefs: 1, selectedRefs: 0 }],
      },
      hash,
    );

    for (const [index, requested] of [key, url].entries()) {
      const fs = new FakeFs({}, { '/bundle': ['bundle.json'] });
      for (const file of bundle.files) fs.writeBytes(`/bundle/${file.path}`, file.bytes);
      run(
        ['report', '/bundle', '--out', `/r/unresolved-${index}.json`, '--filter-repo', requested],
        ioFor('json').io,
        fs,
      );
      const report = JSON.parse(fs.readText(`/r/unresolved-${index}.json`) as string);
      expect(report.scope.session_count).toBe(0);
      expect(report.provenance.repos).toEqual([url]);
      expect(report.provenance.input_coverage).toMatchObject({
        accepted_sessions: 0,
        repositories: [{ key, identity: url, sessions: 0 }],
        gaps: [`${key}:unresolved:date_provenance_unavailable`],
      });
    }
  });

  it('sweeps *.session.json recursively → report.json + self-contained index.html; evidence lists both', () => {
    const { io, out } = ioFor('json');
    const fs = sessionsFs();
    const code = run(['report', '/data', '--out', '/r'], io, fs);
    const env = JSON.parse(out());
    expect(env.status).toBe('degraded');
    expect(env.data.sessions).toBe(2);
    expect(env.data.single).toBe(false);
    expect(env.evidence).toEqual([
      { label: 'report', path: '/r/report.report.json' },
      { label: 'report view', path: '/r/index.html' },
    ]);
    // Report JSON is schema-pinned and rolled both sessions' Bash into the tool dimension.
    const report = JSON.parse(fs.readText('/r/report.report.json') as string);
    expect(report.schema_version).toBe('harness.telemetry-report/v1');
    expect(report.rollups.tool.entries.find((e: { key: string }) => e.key === 'Bash').count).toBe(
      6,
    );
    // HTML is self-contained (inline-embed, no fetch) with the report embedded.
    const html = fs.readText('/r/index.html') as string;
    expect(html).toContain('class="report-column"');
    expect(html).not.toMatch(/fetch\s*\(/);
    expect(code).toBe(0);
  });

  it('--filter-harness narrows the sweep and echoes the facet into report.filter', () => {
    const { io, out } = ioFor('json');
    const fs = sessionsFs();
    run(['report', '/data', '--out', '/r', '--filter-harness', 'copilot-cli', '--no-html'], io, fs);
    const env = JSON.parse(out());
    expect(env.data.sessions).toBe(1);
    expect(env.data.filter.harness).toEqual(['copilot-cli']);
    expect(env.data.html).toBeNull(); // --no-html suppressed the render
    expect(fs.readText('/r/index.html')).toBeNull();
  });

  it('--out *.json is data-only (single file, no HTML)', () => {
    const { io, out } = ioFor('json');
    const fs = sessionsFs();
    run(['report', '/data', '--out', '/r/only.json'], io, fs);
    const env = JSON.parse(out());
    expect(env.data.out).toBe('/r/only.json');
    expect(env.data.html).toBeNull();
    expect(fs.readText('/r/only.json')).not.toBeNull();
    expect(fs.readText('/r/index.html')).toBeNull();
  });

  it('provenance source_paths are sanitized — an absolute path outside cwd never leaks (P12)', () => {
    const { io } = ioFor('json');
    const fs = sessionsFs();
    run(['report', '/data', '--out', '/r/x.json'], io, fs, '/repo');
    const report = JSON.parse(fs.readText('/r/x.json') as string);
    // '/data' is outside cwd '/repo' → collapsed to its basename, no absolute home path.
    expect(report.provenance.source_paths).toEqual(['data']);
    expect(JSON.stringify(report)).not.toContain('/Users/');
  });

  it('--filter-repo is home-stripped — a path-like repo filter never leaks /Users/ into report JSON or HTML (P12)', () => {
    const { io } = ioFor('json');
    const fs = sessionsFs();
    // Folder out ⇒ BOTH report.json AND the inline-embed index.html are produced.
    run(
      ['report', '/data', '--out', '/r', '--filter-repo', '/Users/someone/secret/path'],
      io,
      fs,
      '/repo',
    );
    const report = JSON.parse(fs.readText('/r/report.report.json') as string);
    // The path-like repo filter is echoed as a bare basename in BOTH places it lands
    // (filter.repo + provenance.repos) — never the absolute /Users/… home path.
    expect(report.filter.repo).toEqual(['path']);
    expect(report.provenance.repos).toEqual(['path']);
    expect(JSON.stringify(report)).not.toContain('/Users/');
    // The self-contained HTML inline-embeds that same JSON — it must be clean too.
    expect(fs.readText('/r/index.html') as string).not.toContain('/Users/');
  });

  it('no sessions found → honest error envelope (exit 1)', () => {
    const { io, out } = ioFor('json');
    const code = run(['report', '/empty', '--out', '/r'], io, new FakeFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(code).toBe(1);
  });

  it('report-render renders every *.report.json in a folder into N labelled columns', () => {
    // Produce two pre-filtered arms as data-only report JSON (real builder output)...
    const gen = sessionsFs();
    run(
      ['report', '/data', '--out', '/tmp/Opus.report.json', '--filter-harness', 'claude-code'],
      ioFor('json').io,
      gen,
    );
    run(
      ['report', '/data', '--out', '/tmp/GPT.report.json', '--filter-harness', 'copilot-cli'],
      ioFor('json').io,
      gen,
    );
    const opus = gen.readText('/tmp/Opus.report.json') as string;
    const gpt = gen.readText('/tmp/GPT.report.json') as string;

    // ...drop both into ONE folder and render it (co-location = the comparison).
    const cmpFs = new FakeFs(
      { '/cmp/Opus.report.json': opus, '/cmp/GPT.report.json': gpt },
      { '/cmp': ['Opus.report.json', 'GPT.report.json'] },
    );
    const { io, out } = ioFor('json');
    const code = run(['report-render', '/cmp'], io, cmpFs);
    const env = JSON.parse(out());
    expect(env.status).toBe('ok');
    expect(env.data.columns).toBe(2);
    expect(env.evidence).toEqual([{ label: 'report view', path: '/cmp/index.html' }]);
    const html = cmpFs.readText('/cmp/index.html') as string;
    expect(html.match(/class="report-column"/g) ?? []).toHaveLength(2);
    expect(html).toContain('Opus'); // column labelled by each file stem
    expect(html).toContain('GPT');
    expect(html).not.toMatch(/fetch\s*\(/);
    expect(code).toBe(0);
  });

  it('report-render on a folder with no *.report.json → honest error (exit 1)', () => {
    const { io, out } = ioFor('json');
    const code = run(['report-render', '/nada'], io, new FakeFs());
    const env = JSON.parse(out());
    expect(env.status).toBe('error');
    expect(code).toBe(1);
  });
});
