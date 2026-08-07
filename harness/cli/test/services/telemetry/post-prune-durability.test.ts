import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, Writers } from '../../../src/output/output-port.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { getFleetEvidence } from '../../../src/services/telemetry/fleet-evidence.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  getSessionEvidence,
  type SessionEvidenceDeps,
} from '../../../src/services/telemetry/session-evidence.js';
import { combineSession } from '../../../src/services/telemetry/session-export.js';
import { type SyncDeps, syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * Finding 02 (CRITICAL) — post-prune durability, the reviewer's named composition
 * test: capture → sync/prune → capture → read, and the read must still equal the
 * WHOLE session, not the post-commit delta.
 *
 * This is the repo's own recommended workflow: the post-commit flush hook syncs and
 * prunes mid-session, so every later `telemetry session save` / `getSessionEvidence`
 * / fleet live-lane read saw only the tokens captured SINCE the last commit — and
 * labelled that subset `measured`. The loss scales with how early the first commit
 * lands. The rolled ref stays whole by construction; the readers just never asked it.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const SESSION = 'hs-session-1';
const PIJ = 'pij-subject';
const REF = `refs/harness-telemetry/2026/03/23/${SESSION}`;

/** One captured window: N tokens of each bucket, as a real serialized segment. */
function window(seq: number, tokens: { input: number; output: number }): SegmentInput {
  const t = `2026-03-23T10:0${seq}:00.000Z`;
  return {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: SESSION,
    timecode: t,
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      cache_create: 0,
      cache_read: 0,
      total: tokens.input + tokens.output,
      subagent_tokens: 0,
      grand_total: tokens.input + tokens.output,
    },
    event_stream: [{ t, kind: 'turn', dur_s: 0, in: tokens.input, out: tokens.output }] as Event[],
    captured_env: { PIJ_SESSION_ID: PIJ, PIJ_HARNESS: 'claude' },
  };
}

/** Write one seq's full spool triple into the buffer (segment + OTLP logs + metrics). */
function capture(
  files: Record<string, string>,
  names: string[],
  seq: number,
  tokens: { input: number; output: number },
): void {
  const seg = serializeSegment(window(seq, tokens), REPO);
  files[`${TEL}/${SESSION}/${seq}.json`] = `${JSON.stringify(seg, null, 2)}\n`;
  files[`${TEL}/${SESSION}/${seq}.logs.jsonl`] = `${JSON.stringify(segmentToOtlpLogs(seg))}\n`;
  files[`${TEL}/${SESSION}/${seq}.metrics.jsonl`] = `${JSON.stringify({ resourceMetrics: [] })}\n`;
  names.push(`${seq}.json`, `${seq}.logs.jsonl`, `${seq}.metrics.jsonl`);
}

function syncDeps(fs: FakeFs, git: FakeGitWrite): SyncDeps {
  return {
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
    proc: new FakeProcess({}, REPO),
    git,
    clock: new FakeClock('2026-03-23T10:05:00.000Z'),
  };
}

/** Bridge the pushed ref tree back through the READ port — same bytes, read-only. */
function gitReadFor(git: FakeGitWrite): FakeGitRead {
  const blobs = git.readRefTree(REF) ?? [];
  return new FakeGitRead({ [REF]: blobs.map((b) => ({ name: b.name, content: b.content })) });
}

/** Capture the act's JSON envelope without touching stdout. */
function actIo(): { io: CliIo; out: () => string } {
  let o = '';
  const writers: Writers = {
    out: (t) => {
      o += t;
    },
    err: () => {},
  };
  return { io: { mode: 'json', writers }, out: () => o };
}

/**
 * Drive the REAL registered `telemetry session save` act. Only the host boundary is
 * stubbed (`process.exit` throws so the synchronous action unwinds) — every telemetry
 * decision runs for real over the fakes.
 */
function runSessionSave(args: string[], io: CliIo, fs: FakeFs, gitRead: FakeGitRead): number {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerTelemetryAct(program, io, {
    fs,
    proc: new FakeProcess({}, REPO),
    clock: new FakeClock('2026-03-23T10:06:00.000Z'),
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
    gitWrite: new FakeGitWrite(),
    gitRead,
  });
  expect(() => program.parse(['node', 'harness', 'telemetry', 'session', ...args])).toThrow(
    /^exit:/,
  );
  return code;
}

describe('finding 02 — a mid-session sync/prune must not shrink what a read reports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('capture → sync/prune → capture → read still reports the whole session', async () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    // ── capture: two windows before the first commit ──────────────────────────
    capture(files, names, 1, { input: 1000, output: 500 });
    capture(files, names, 2, { input: 2000, output: 300 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    const git = new FakeGitWrite();

    const readDeps = (gitRead?: FakeGitRead): SessionEvidenceDeps => ({
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
      proc: new FakeProcess({}, REPO),
      ...(gitRead ? { gitRead } : {}),
    });

    // The pre-prune truth — what an operator would have seen before committing.
    const before = await getSessionEvidence(PIJ, readDeps());
    expect(before?.token_evidence.fields.input.value).toBe(3000);
    expect(before?.token_evidence.fields.output.value).toBe(800);

    // ── sync + prune: the post-commit flush hook ──────────────────────────────
    expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);
    expect(fs.readText(`${TEL}/${SESSION}.flushed`)?.trim()).toBe('2');
    expect(fs.readText(`${TEL}/${SESSION}/1.json`)).toBeNull(); // pruned
    expect(fs.readText(`${TEL}/${SESSION}/2.json`)).toBeNull(); // pruned

    // ── capture again: one more window AFTER the prune ────────────────────────
    const seg3 = serializeSegment(window(3, { input: 10, output: 5 }), REPO);
    fs.writeText(`${TEL}/${SESSION}/3.json`, `${JSON.stringify(seg3, null, 2)}\n`);
    fs.writeText(`${TEL}/${SESSION}/3.logs.jsonl`, `${JSON.stringify(segmentToOtlpLogs(seg3))}\n`);
    names.push('3.json', '3.logs.jsonl');

    // ── read: must equal the whole session (flushed ∪ unflushed), not the delta ─
    const after = await getSessionEvidence(PIJ, readDeps(gitReadFor(git)));
    expect(after).not.toBeNull();
    expect(after?.token_evidence.fields.input.value).toBe(3010);
    expect(after?.token_evidence.fields.output.value).toBe(805);
    expect(after?.token_evidence.coverage).toBe('measured');
  });

  it('degrades honestly when the flushed truth cannot be reached', async () => {
    // Same prune, but no git read port (or no ref): the reader CANNOT recover the
    // flushed half. It must say so rather than pass the delta off as measured.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    const git = new FakeGitWrite();
    expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);

    const seg2 = serializeSegment(window(2, { input: 10, output: 5 }), REPO);
    fs.writeText(`${TEL}/${SESSION}/2.json`, `${JSON.stringify(seg2, null, 2)}\n`);
    names.push('2.json');

    const evidence = await getSessionEvidence(PIJ, {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
      proc: new FakeProcess({}, REPO),
    });

    expect(evidence).not.toBeNull();
    expect(evidence?.token_evidence.coverage).not.toBe('measured');
    expect(evidence?.token_evidence.reason).toBe('flushed_segments_unreadable');
  });

  it('a pure-temp session save of a flushed session reports partial, not measured', () => {
    // `harness telemetry session save <id> --source temp` after a mid-session sync.
    // The buffer holds the delta only; the export must not label that whole.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    expect(syncTelemetry(syncDeps(fs, new FakeGitWrite())).ok).toBe(true);

    const seg2 = serializeSegment(window(2, { input: 10, output: 5 }), REPO);
    fs.writeText(`${TEL}/${SESSION}/2.json`, `${JSON.stringify(seg2, null, 2)}\n`);
    names.push('2.json');

    const exported = combineSession(SESSION, {
      fs,
      proc: new FakeProcess({}, REPO),
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
    });

    expect(exported.summary.token_evidence.coverage).toBe('partial');
    expect(exported.summary.token_evidence.reason).toBe('flushed_segments_unreadable');
    expect(exported.summary.degraded).toContain('pruned_buffer');
  });

  it('a LAGGING prune must not double-count: the reader drops seqs the ref already owns', async () => {
    // R2-03: the sync pushed the ref and advanced the watermark, but the buffer delete
    // did not happen (kill/crash between push and prune, or an fs delete failure). Both
    // halves now hold seq 1. The union must count it ONCE.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    const git = new FakeGitWrite();
    expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);

    // Undo the prune — the ref and the watermark stand, the buffer files come back.
    capture(files, names, 1, { input: 1000, output: 500 });
    const laggedFs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    laggedFs.writeText(`${TEL}/${SESSION}.flushed`, '1');
    const seg2 = serializeSegment(window(2, { input: 10, output: 5 }), REPO);
    laggedFs.writeText(`${TEL}/${SESSION}/2.json`, `${JSON.stringify(seg2, null, 2)}\n`);
    laggedFs.writeText(
      `${TEL}/${SESSION}/2.logs.jsonl`,
      `${JSON.stringify(segmentToOtlpLogs(seg2))}\n`,
    );
    names.push('2.json', '2.logs.jsonl');

    const evidence = await getSessionEvidence(PIJ, {
      fs: laggedFs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
      proc: new FakeProcess({}, REPO),
      gitRead: gitReadFor(git),
    });

    expect(evidence?.token_evidence.fields.input.value).toBe(1010);
    expect(evidence?.token_evidence.fields.output.value).toBe(505);
    expect(evidence?.token_evidence.coverage).toBe('measured');
  });

  it('a LAGGING prune must not double-count: `session save --source auto` shadows the ROLLED ref', () => {
    // R2-03, the save path — and `auto` is now the DEFAULT, so this is what an operator
    // gets by typing nothing. The union shadowed temp by parsing a `<seq>` out of shard
    // FILENAMES, but a rolled ref publishes ONE `session.logs.jsonl` that carries no
    // parseable seq — so nothing was ever shadowed and the same seq was read twice, from
    // the ref lines AND the surviving temp file, reported as `measured`.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    const git = new FakeGitWrite();
    expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);
    // The ref really is the modern rolled shape, not a per-seq shard.
    expect((git.readRefTree(REF) ?? []).map((b) => b.name)).toContain('session.logs.jsonl');

    capture(files, names, 1, { input: 1000, output: 500 }); // prune lagged
    const laggedFs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    laggedFs.writeText(`${TEL}/${SESSION}.flushed`, '1');
    const seg2 = serializeSegment(window(2, { input: 10, output: 5 }), REPO);
    laggedFs.writeText(`${TEL}/${SESSION}/2.json`, `${JSON.stringify(seg2, null, 2)}\n`);
    names.push('2.json');

    const { io, out } = actIo();
    const code = runSessionSave(
      ['save', SESSION, '--source', 'auto', '--out', '/out/s.session.json', '--no-html'],
      io,
      laggedFs,
      gitReadFor(git),
    );
    const env = JSON.parse(out());

    expect(code).toBe(0);
    expect(env.data.segment_count).toBe(2); // seq 1 once, seq 2 once — never three
    expect(env.data.totals.tokens).toEqual({ input: 1010, output: 505 });
  });

  it('shadows by the ROLLED MANIFEST even with no local watermark to fall back on', () => {
    // R2-03's primary mechanism, isolated. The `<session>.flushed` watermark is a LOCAL
    // file — a clone that fetched the ref, or a cleaned temp dir, has the ref and the
    // buffer but no watermark. The manifest's `max_seq` is the ref's OWN statement of
    // which seqs it owns, so it must carry the shadow on its own.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    const git = new FakeGitWrite();
    expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);

    capture(files, names, 1, { input: 1000, output: 500 }); // prune lagged
    const seg2 = serializeSegment(window(2, { input: 10, output: 5 }), REPO);
    files[`${TEL}/${SESSION}/2.json`] = `${JSON.stringify(seg2, null, 2)}\n`;
    names.push('2.json');
    // NOTE: the `<session>.flushed` watermark is REMOVED — the manifest is the only
    // evidence left of which seqs the ref owns.
    delete files[`${TEL}/${SESSION}.flushed`];
    const noWatermarkFs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    expect(noWatermarkFs.readText(`${TEL}/${SESSION}.flushed`)).toBeNull();

    const { io, out } = actIo();
    const code = runSessionSave(
      ['save', SESSION, '--source', 'auto', '--out', '/out/m.session.json', '--no-html'],
      io,
      noWatermarkFs,
      gitReadFor(git),
    );
    const env = JSON.parse(out());

    expect(code).toBe(0);
    expect(env.data.segment_count).toBe(2);
    expect(env.data.totals.tokens).toEqual({ input: 1010, output: 505 });
  });

  it('the FLEET live lane reports the union too — a ref PREFIX must not outrank it', async () => {
    // R3-01. The fleet's tier-1 read performs the same durable union as the session
    // reader, and then `enrichOrphans` offers the SAME session's ref as a merge
    // candidate. For a legacy-token session that ref sum is stamped `session_total`
    // (scope 3) while the union carries the wire-checkpoint stamp (scope 2) — so the
    // ref won on scope and the lane reported the FLUSHED PREFIX, dropping the
    // unflushed delta while still claiming `measured`. The ref's bytes are already
    // INSIDE the union, so it can only ever subtract.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });
    const git = new FakeGitWrite();
    expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);

    // …then one more window after the prune: the delta the ref cannot know about.
    const seg2 = serializeSegment(window(2, { input: 10, output: 5 }), REPO);
    fs.writeText(`${TEL}/${SESSION}/2.json`, `${JSON.stringify(seg2, null, 2)}\n`);
    fs.writeText(`${TEL}/${SESSION}/2.logs.jsonl`, `${JSON.stringify(segmentToOtlpLogs(seg2))}\n`);
    names.push('2.json', '2.logs.jsonl');
    fs.writeText(
      `${REPO}/roster.json`,
      JSON.stringify({
        roster: { orchestrator: { pijId: PIJ, harness: 'claude', harnessSessionId: SESSION } },
      }),
    );

    const fleet = await getFleetEvidence(
      PIJ,
      {
        fs,
        env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
        proc: new FakeProcess({}, REPO),
      },
      { rosterPath: `${REPO}/roster.json`, gitRead: gitReadFor(git) },
    );

    const lane = fleet?.sessions.find((l) => l.pij_id === PIJ);
    expect(lane).toBeDefined();
    expect(lane?.token_evidence.fields.input.value).toBe(1010);
    expect(lane?.token_evidence.fields.output.value).toBe(505);
    expect(lane?.tokens.grand_total).toBe(1515);
    expect(lane?.token_evidence.coverage).toBe('measured');
  });

  it('leaves an unflushed session alone — no watermark, no degrade', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, 1, { input: 1000, output: 500 });
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });

    const exported = combineSession(SESSION, {
      fs,
      proc: new FakeProcess({}, REPO),
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
    });

    expect(exported.summary.token_evidence.coverage).toBe('measured');
    expect(exported.summary.degraded).not.toContain('pruned_buffer');
  });
});
