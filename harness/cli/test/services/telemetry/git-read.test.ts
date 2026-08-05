import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { ExecGitRead } from '../../../src/adapters/git/exec-git-read.js';
import { ExecGitWrite } from '../../../src/adapters/git/exec-git-write.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import type { ShardBlob } from '../../../src/adapters/git/git-read-port.js';
import { TELEMETRY_REF_GLOB, telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, OutputMode, Writers } from '../../../src/output/output-port.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * Plan 047 Phase 3 (T004–T008) — the git-ref READ path.
 *
 * TDD-load-bearing (Testing Strategy): the committed-shard shape ≠ the temp-buffer
 * shape. `sync-service` publishes `<seq>.logs.jsonl` + `<seq>.metrics.jsonl` and
 * keeps the segment json LOCAL, so a naive combine over a real shard discovers ZERO
 * seqs (`/^(\d+)\.json$/`) → `segment_count:0` + no identity. These tests prove the
 * **logs-rooted reconstruction** fills that gap: a logs+metrics-only shard yields a
 * non-empty, identity-bearing `SessionExport` with `source.kind:'git-ref'`. The
 * non-vacuity mutation (corrupt the logs blob) flips the reconstructed identity to
 * `unknown`, and the real-git round-trip proves the read leaves the working tree
 * byte-identical (`git status --porcelain`).
 *
 * Fakes over mocks; real corpus blobs (`fixtures/real/copilot-cli`) are the natural
 * committed-shard seed; port imports type-only.
 */

const CORPUS = fileURLToPath(
  new URL('./fixtures/real/copilot-cli/2026-06-24-checks-run/', import.meta.url),
);
const LOGS_BLOB = readFileSync(`${CORPUS}expected-otlp-logs.jsonl`, 'utf8');
const METRICS_BLOB = readFileSync(`${CORPUS}expected-otlp-metrics.jsonl`, 'utf8');

/**
 * A budget sized for REAL git under CONTENTION, not for pure computation.
 *
 * Measured on this box: the two real-git cases below spend **46 git children**
 * between them, and each runs in 200–460ms uncontended. But `spawnSync` blocks on
 * a child this file cannot influence, and sixteen other suites in this repo spawn
 * real subprocesses of their own — sampled during a loaded full run, one such
 * child has a p50 of 73ms and a MAX of 1202ms. Twenty-odd children behind that
 * tail is how a ~220ms case was observed timing out at vitest's 5s default: the
 * assertion's subject was never in doubt, the wallclock allowance was.
 *
 * Set once for the file rather than per-case, because the property is true of
 * every case that shells out to git, and a per-case number invites the next author
 * to guess one. The same idiom, for the same measured reason, as
 * `exec-remote-telemetry-git.int.test.ts`. Note this is a BUDGET, not a fix: the
 * fixture setup was moved into a hook first (see the describe below), and this
 * covers only the irreducible real-git work that IS each case's subject.
 */
vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

/** The session id + capture date carried by the copilot-cli corpus blob (RES_SESSION). */
const SID = 'b67cd3ce-e0ee-4048-831e-7f4591f20a60';
const DATE_PATH = '2026/06/24';
const REF = telemetryRefFor(DATE_PATH, SID);

/** The canonical committed shard (logs + metrics, NO `<seq>.json`). */
function committedShard(logs = LOGS_BLOB, metrics = METRICS_BLOB): ShardBlob[] {
  return [
    { name: '0.logs.jsonl', content: logs },
    { name: '0.metrics.jsonl', content: metrics },
  ];
}

// ── T004: the recording FakeGitRead ─────────────────────────────────────────────

describe('FakeGitRead — recording read-only fake (T004)', () => {
  it('replays a seeded shard tree and records every call', () => {
    const gr = new FakeGitRead({ [REF]: committedShard() });
    const blobs = gr.readShardTree(REF);
    expect(blobs.map((b) => b.name)).toEqual(['0.logs.jsonl', '0.metrics.jsonl']);
    expect(blobs[0].content).toBe(LOGS_BLOB);
    expect(gr.calls).toEqual(['readShardTree']);
    expect(gr.readRefs).toEqual([REF]);
  });

  it('listTelemetryRefs matches only seeded refs under the glob prefix', () => {
    const gr = new FakeGitRead({
      [REF]: committedShard(),
      'refs/harness-telemetry/2026/06/25/other': committedShard(),
      'refs/heads/main': [],
    });
    expect(gr.listTelemetryRefs(TELEMETRY_REF_GLOB)).toEqual([
      REF,
      'refs/harness-telemetry/2026/06/25/other',
    ]);
    expect(gr.calls).toEqual(['listTelemetryRefs']);
  });

  it('returns a COPY so a caller cannot corrupt the seed', () => {
    const gr = new FakeGitRead({ [REF]: committedShard() });
    gr.readShardTree(REF)[0].content = 'mutated';
    expect(gr.readShardTree(REF)[0].content).toBe(LOGS_BLOB);
  });
});

// ── T005/T007: logs-rooted reconstruction over combineSession ────────────────────

/** Seed a FakeFs holding ONLY a session's committed-shape blobs under the buffer dir. */
function shardFs(blobs: ShardBlob[], cwd = '/repo'): CombineSessionDeps {
  const dir = `${cwd}/.harness/temp/telemetry/${SID}`;
  const files: Record<string, string> = {};
  for (const b of blobs) files[`${dir}/${b.name}`] = b.content;
  return {
    fs: new FakeFs(files, { [dir]: blobs.map((b) => b.name) }),
    proc: new FakeProcess({}, cwd),
    env: new FakeEnv({}, '/home/dev'),
  };
}

describe('combineSession — logs-rooted reconstruction of a committed shard (T005/T007)', () => {
  it('a logs+metrics-only shard (NO <seq>.json) reconstructs a non-empty, identity-bearing export', () => {
    const exp = combineSession(SID, shardFs(committedShard()), {
      kind: 'git-ref',
      sourceRoot: TELEMETRY_REF_GLOB,
    });

    // The load-bearing gap: segment_count > 0 (a naive json-anchored combine = 0).
    expect(exp.source.segment_count).toBe(1);
    expect(exp.source.kind).toBe('git-ref');
    expect(exp.source.root).toBe(TELEMETRY_REF_GLOB);

    // Identity lifted from the OTLP `harness.*` resource attributes.
    expect(exp.identity.harness).toBe('copilot-cli');
    expect(exp.identity.harness_version).toBe('0.0.0-fixture');
    expect(exp.identity.harness_session_id).toBe(SID);

    // Events reconstructed from the logs blob → a non-empty regenerated logs signal.
    expect(exp.signals.logs.resourceLogs[0].scopeLogs[0].logRecords.length).toBeGreaterThan(0);
  });

  it('NON-VACUITY: corrupting the logs blob collapses the reconstruction (identity → unknown, 0 segments)', () => {
    const good = combineSession(SID, shardFs(committedShard()), { kind: 'git-ref' });
    const bad = combineSession(SID, shardFs(committedShard('not-json{{{', METRICS_BLOB)), {
      kind: 'git-ref',
    });

    // The GOOD reconstruction really carries the harness identity...
    expect(good.identity.harness).toBe('copilot-cli');
    expect(good.source.segment_count).toBe(1);
    // ...and the corrupt blob flips it — so the assertion above is not vacuous.
    expect(bad.identity.harness).not.toBe('copilot-cli');
    expect(bad.identity.harness).toBe('unknown');
    expect(bad.source.segment_count).toBe(0);
  });

  it('the temp path stays byte-identical — no opts ⇒ kind:temp + the buffer root', () => {
    // The SAME reconstruction code, driven with no source opts, must be indistinguishable
    // from Phase 1: a logs-only shard still reconstructs, but the envelope is temp-shaped.
    const exp = combineSession(SID, shardFs(committedShard()));
    expect(exp.source.kind).toBe('temp');
    expect(exp.source.root).toBe('.harness/temp/telemetry');
  });
});

// ── T007: session save --source git-ref | auto (the act wiring) ──────────────────

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

describe('session save --source git-ref|auto — act wiring (T007)', () => {
  afterEach(() => vi.restoreAllMocks());

  function runSave(args: string[], io: CliIo, fs: FakeFs, gitRead: FakeGitRead): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs,
      proc: new FakeProcess({}, '/repo'),
      clock: new FakeClock('2026-06-24T11:00:00.000Z'),
      env: new FakeEnv(),
      gitWrite: new FakeGitWrite(),
      gitRead,
    });
    expect(() => program.parse(['node', 'harness', 'telemetry', 'session', ...args])).toThrow(
      /^exit:/,
    );
    return code;
  }

  it('reads a committed shard back into a git-ref SessionExport (--out json)', () => {
    const { io } = ioFor('json');
    const fs = new FakeFs();
    const gr = new FakeGitRead({ [REF]: committedShard() });
    const code = runSave(
      ['save', SID, '--source', 'git-ref', '--no-html', '--out', `/out/${SID}.session.json`],
      io,
      fs,
      gr,
    );
    expect(code).toBe(0);
    const doc = JSON.parse(fs.readText(`/out/${SID}.session.json`) as string) as SessionExport;
    expect(doc.source.kind).toBe('git-ref');
    expect(doc.source.segment_count).toBe(1);
    expect(doc.identity.harness).toBe('copilot-cli');
    // The read port was actually driven (for-each-ref + cat-file), never the write port.
    expect(gr.calls).toContain('listTelemetryRefs');
    expect(gr.calls).toContain('readShardTree');
  });

  it('a git-ref session with no committed ref → honest "no segments" error (exit 1)', () => {
    const { io } = ioFor('json');
    const gr = new FakeGitRead({}); // nothing published for this id
    const code = runSave([`save`, SID, '--source', 'git-ref', '--no-html'], io, new FakeFs(), gr);
    expect(code).toBe(1);
  });

  it('--source auto reads a git-ref-shadows-temp union in ONE combine', () => {
    const { io } = ioFor('json');
    const fs = new FakeFs();
    const gr = new FakeGitRead({ [REF]: committedShard() });
    const code = runSave(
      ['save', SID, '--source', 'auto', '--no-html', '--out', `/out/${SID}.session.json`],
      io,
      fs,
      gr,
    );
    expect(code).toBe(0);
    const doc = JSON.parse(fs.readText(`/out/${SID}.session.json`) as string) as SessionExport;
    expect(doc.source.kind).toBe('git-ref');
    expect(doc.identity.harness).toBe('copilot-cli');
  });

  /**
   * REGRESSION (review HIGH — temp contamination): `--source auto` must shadow temp
   * at SEQ granularity. A canonical git shard is `<seq>.logs.jsonl`+`<seq>.metrics.jsonl`
   * while temp is `<seq>.json` — DIFFERENT names — so a filename-only union leaves the
   * temp `<seq>.json` un-shadowed: `readSessionSeqs` takes its json branch and `auto`
   * reads the TEMP identity/tokens while still stamping `kind:'git-ref'`.
   *
   * Fixture: temp seq 0 (`0.json`) carries a DISTINCT identity (`temp-harness`,
   * `leaked-temp-model`, an absurd 999_999_999-token input) AND git-ref owns the SAME
   * seq 0 (`copilot-cli`). Temp seq 1 (`1.json`) is temp-ONLY (no git-ref shard).
   *
   * NON-VACUOUS: with the seq-shadow, identity/tokens for seq 0 come from git-ref and
   * NO temp value leaks, while temp-only seq 1 still contributes (git-ref fills gaps,
   * never erases). Remove the seq-shadow (revert to the filename union) and the temp
   * `0.json` json branch wins → `identity.harness:'temp-harness'`, `leaked-temp-model`,
   * and the billion-token input leak — every assertion below flips RED.
   */
  it('--source auto shadows temp at SEQ granularity — git-ref wins a shared seq, temp fills gaps (no leak)', () => {
    const { io } = ioFor('json');
    const dir = `/repo/.harness/temp/telemetry/${SID}`;
    // Temp seq 0: SAME seq the git-ref shard owns, with a poisoned identity/tokens.
    const tempSeq0 = JSON.stringify({
      schema_version: '2.7',
      command: 'session',
      harness: 'acme-harness-1',
      harness_version: '0.0.0-temp',
      harness_session_id: SID,
      timecode: '2026-06-24T10:00:00.000Z',
      window: { since: 'session-start', from: 0, to: 0 },
      branch: null,
      tokens: {
        input: 999_999_999,
        output: 0,
        cache_read: 0,
        cache_create: 0,
        total: 999_999_999,
        subagent_tokens: 0,
        grand_total: 999_999_999,
      },
      effort: null,
      event_stream: [],
      rollup: null,
      models: { 'leaked-temp-model': { turns: 1, output_tokens: 1 } },
    });
    // Temp-only seq 1: NO git-ref shard — must survive (git-ref fills gaps only).
    const tempSeq1 = JSON.stringify({
      schema_version: '2.7',
      command: 'session',
      harness: 'acme-harness-2',
      harness_version: '0.0.0-temp',
      harness_session_id: SID,
      timecode: '2026-06-24T10:05:00.000Z',
      window: { since: 'last-command', from: 0, to: 0 },
      branch: null,
      tokens: {
        input: 5,
        output: 3,
        cache_read: 0,
        cache_create: 0,
        total: 8,
        subagent_tokens: 0,
        grand_total: 8,
      },
      effort: null,
      event_stream: [
        {
          t: '2026-06-24T10:05:00.000Z',
          kind: 'turn',
          dur_s: 1,
          out: 3,
          model: 'temp-only-gap-model',
        },
      ],
      rollup: null,
      models: { 'temp-only-gap-model': { turns: 1, output_tokens: 3 } },
    });
    const fs = new FakeFs(
      { [`${dir}/0.json`]: tempSeq0, [`${dir}/1.json`]: tempSeq1 },
      { [dir]: ['0.json', '1.json'] },
    );
    const gr = new FakeGitRead({ [REF]: committedShard() }); // git-ref owns seq 0 only

    const code = runSave(
      ['save', SID, '--source', 'auto', '--no-html', '--out', `/out/${SID}.session.json`],
      io,
      fs,
      gr,
    );
    expect(code).toBe(0);
    const doc = JSON.parse(fs.readText(`/out/${SID}.session.json`) as string) as SessionExport;

    // Git-ref wins the shared seq 0: identity is the shard's, NOT the temp poison.
    expect(doc.source.kind).toBe('git-ref');
    expect(doc.identity.harness).toBe('copilot-cli');
    expect(doc.identity.harness).not.toBe('acme-harness-1'); // the poisoned temp identity
    expect(doc.identity.models).not.toContain('leaked-temp-model');
    // The billion-token temp input never leaks (seq 0 tokens come from the git-ref rollup).
    expect(doc.summary.tokens.in).toBeLessThan(999_999_999);

    // Temp-only seq 1 still contributes — git-ref fills gaps, never erases a temp-only seq.
    expect(doc.identity.models).toContain('temp-only-gap-model');
    expect(doc.source.segment_count).toBe(2);
  });
});

// ── T005/T006/T008: ExecGitRead read-only invariant over a REAL committed ref ─────

/** `git status --porcelain` — the working-tree fingerprint the read must not disturb. */
function porcelain(cwd: string): string {
  return spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).stdout;
}

describe('ExecGitRead — real-git round-trip + read-only invariant (T006/T008, KF-06/AC-08)', () => {
  /**
   * A committed, clean repo — built ONCE per case in a hook, not inside the
   * assertion.
   *
   * The subject here is a REAL git round-trip, so unlike a scan whose tree walk
   * was incidental, the git work cannot be taken out without taking the test's
   * subject with it. What CAN come out is the fixture: `init`, two `config`s,
   * `add` and `commit` are setup, and vitest budgets a hook separately from a
   * case. The `bash -c 'echo …'` child goes entirely — a file write needs no
   * shell, and one fewer subprocess is one fewer thing to queue behind.
   */
  const seedRepo = (prefix: string): string => {
    const repo = mkdtempSync(join(tmpdir(), prefix));
    const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'README.md'), 'hello\n');
    git('add', 'README.md');
    git('commit', '-qm', 'init');
    return repo;
  };

  let roundTripRepo = '';
  let historyRepo = '';

  beforeAll(() => {
    roundTripRepo = seedRepo('harness-gitread-');
    historyRepo = seedRepo('harness-gitread-hist-');
  });

  afterAll(() => {
    for (const repo of [roundTripRepo, historyRepo])
      if (repo.length > 0) rmSync(repo, { recursive: true, force: true });
  });

  it('reads a committed shard back byte-identical, leaving the working tree untouched', () => {
    const repo = roundTripRepo;
    {
      const before = porcelain(repo);
      expect(before).toBe(''); // clean

      // Publish the canonical committed shard as an orphan telemetry ref via the
      // REAL write plumbing (the exact path production uses).
      const gw = new ExecGitWrite(repo);
      const tree = gw.mktree(
        committedShard().map((b) => ({
          mode: '100644' as const,
          type: 'blob' as const,
          sha: gw.hashObject(b.content),
          name: b.name,
        })),
      );
      const commit = gw.commitTree(tree, null, 'telemetry: test shard');
      expect(gw.updateRef(REF, commit, null)).toBe(true);

      // Read it back with the REAL read adapter.
      const gr = new ExecGitRead(repo);
      expect(gr.listTelemetryRefs(TELEMETRY_REF_GLOB)).toContain(REF);
      const blobs = gr.readShardTree(REF);
      const byName = Object.fromEntries(blobs.map((b) => [b.name, b.content]));
      expect(byName['0.logs.jsonl']).toBe(LOGS_BLOB);
      expect(byName['0.metrics.jsonl']).toBe(METRICS_BLOB);

      // The read never touched the working tree (read-only by construction).
      expect(porcelain(repo)).toBe(before);

      // End-to-end: the REAL git bytes reconstruct the same identity-bearing export.
      const exp = combineSession(SID, shardFs(blobs), { kind: 'git-ref' });
      expect(exp.source.segment_count).toBe(1);
      expect(exp.identity.harness).toBe('copilot-cli');
    }
  });

  /**
   * Plan 049 T001 — the migration recovery-walk primitives against real git:
   * `listRefHistory` (every commit sha, tip-first) + `readTreeAtCommit` (the tree at
   * an arbitrary commit). Models the F-03 clobber: two syncs, each an orphan commit
   * carrying DISJOINT seq blobs, one parented on the other. The tip tree holds only
   * the 2nd sync's blobs — walking the history recovers the 1st sync's buried blobs.
   */
  it('listRefHistory + readTreeAtCommit recover segments buried in non-tip commits (F-03)', () => {
    const repo = historyRepo;
    {
      const gw = new ExecGitWrite(repo);
      const blob = (name: string, content: string) => ({
        mode: '100644' as const,
        type: 'blob' as const,
        sha: gw.hashObject(content),
        name,
      });
      // Sync 1: tree holds ONLY seq 0's blob.
      const tree1 = gw.mktree([blob('0.logs.jsonl', '{"resourceLogs":[0]}\n')]);
      const commit1 = gw.commitTree(tree1, null, 'sync 1');
      expect(gw.updateRef(REF, commit1, null)).toBe(true);
      // Sync 2 (the clobber): a fresh tree with ONLY seq 1's blob, parented on sync 1.
      const tree2 = gw.mktree([blob('1.logs.jsonl', '{"resourceLogs":[1]}\n')]);
      const commit2 = gw.commitTree(tree2, commit1, 'sync 2');
      expect(gw.updateRef(REF, commit2, commit1)).toBe(true);

      const gr = new ExecGitRead(repo);
      // The tip tree hides seq 0 (the clobber) — this is exactly F-03.
      expect(gr.readShardTree(REF).map((b) => b.name)).toEqual(['1.logs.jsonl']);

      // The full history is walkable, tip-first.
      const history = gr.listRefHistory(REF);
      expect(history[0]).toBe(commit2);
      expect(history).toContain(commit1);

      // Unioning the tree at EVERY commit recovers both seqs.
      const recovered = new Set<string>();
      for (const c of history) for (const b of gr.readTreeAtCommit(c)) recovered.add(b.name);
      expect([...recovered].sort()).toEqual(['0.logs.jsonl', '1.logs.jsonl']);

      // Still read-only.
      expect(porcelain(repo)).toBe('');
    }
  });
});
