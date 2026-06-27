import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { type SyncDeps, syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * T003 (plan 034 Phase 4 · 4.3 · AC-08/14) — the sync-service flush, exercised
 * with FakeFs + FakeGitWrite. Pins the team-scale SHARD model: telemetry flushes
 * to per-(capture-date, session) refs (`refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>`),
 * never one shared mutable ref, so concurrent writers never contend. Also pins:
 * flush-once + consume-via-watermark (a second sync re-flushes nothing), plan-link
 * dedupe per shard (AC-08), offline-safety (a failed shard push leaves the buffer
 * + watermark intact, AC-14), the empty-buffer no-op, the kill-switch no-op, the
 * ff-retry on a concurrent-writer race, and a session whose work crosses midnight
 * (one shard per date). Tests-first → T004.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

/** A counts-only buffer segment (sync only reads `timecode` + `plans_touched`). */
function seg(plans: string[], opts: { command?: string; timecode?: string } = {}): string {
  return `${JSON.stringify(
    {
      command: opts.command ?? 'flow',
      timecode: opts.timecode ?? '2026-03-23T10:00:00.000Z',
      plans_touched: plans,
    },
    null,
    2,
  )}\n`;
}

/** The push refspec for a shard ref (`<ref>:<ref>`). */
function refspec(datePath: string, session: string): string {
  const ref = telemetryRefFor(datePath, session);
  return `${ref}:${ref}`;
}

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
  over: { env?: Record<string, string>; git?: FakeGitWrite } = {},
): { deps: SyncDeps; fs: FakeFs; git: FakeGitWrite } {
  const fs = new FakeFs(files, dirs);
  const git = over.git ?? new FakeGitWrite();
  const deps: SyncDeps = {
    fs,
    env: new FakeEnv(over.env ?? {}),
    proc: new FakeProcess({}, REPO),
    git,
  };
  return { deps, fs, git };
}

describe('syncTelemetry — flush buffered segments to dated per-session shard refs', () => {
  it('flushes each session to its own dated ref, pushes per-shard, then consumes (second sync is a no-op)', () => {
    const { deps, fs, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['034-x']),
        [`${TEL}/sessA/2.json`]: seg(['034-x']),
        [`${TEL}/sessB/1.json`]: seg(['055-y']),
      },
      {
        [TEL]: ['sessA', 'sessB'],
        [`${TEL}/sessA`]: ['1.json', '2.json'],
        [`${TEL}/sessB`]: ['1.json'],
      },
    );

    const r1 = syncTelemetry(deps);
    expect(r1.ok).toBe(true);
    expect(r1.pushed).toBe(true);
    expect(r1.segments).toBe(3);
    expect(r1.sessions).toBe(2);
    // ONE commit per (date, session) shard — sessA and sessB are distinct refs (no contention).
    expect(git.commits).toHaveLength(2);
    expect(git.commits.every((c) => c.parent === null)).toBe(true); // each shard is a fresh ref
    expect(git.pushed.sort()).toEqual(
      [refspec('2026/03/23', 'sessA'), refspec('2026/03/23', 'sessB')].sort(),
    );
    // watermarks advanced to each session's max seq
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('2');
    expect(fs.readText(`${TEL}/sessB.flushed`)?.trim()).toBe('1');

    // Second sync: nothing new past the watermark → clean no-op, no new commit/push.
    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.segments).toBe(0);
    expect(git.commits).toHaveLength(2);
    expect(git.pushed).toHaveLength(2);
  });

  it('a session whose work crosses midnight flushes one shard per date (date is in the ref)', () => {
    const { deps, fs, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['034-x'], { timecode: '2026-03-23T23:50:00.000Z' }),
        [`${TEL}/sessA/2.json`]: seg(['034-x'], { timecode: '2026-03-24T00:10:00.000Z' }),
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json'] },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(2);
    expect(r.sessions).toBe(1);
    expect(git.commits).toHaveLength(2); // one per date
    expect(git.pushed.sort()).toEqual(
      [refspec('2026/03/23', 'sessA'), refspec('2026/03/24', 'sessA')].sort(),
    );
    // single per-session watermark advances across both shards
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('2');
  });

  it('dedupes plan links per shard into a sorted set (AC-08) and records them in the commit', () => {
    const { deps, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['plan-P', 'plan-Q']),
        [`${TEL}/sessA/2.json`]: seg(['plan-P', 'plan-R']), // plan-P repeats, same date → same shard
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json'] },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.plans).toEqual(['plan-P', 'plan-Q', 'plan-R']); // deduped + sorted
    expect(git.commits).toHaveLength(1);
    expect(git.commits[0].message).toContain('plan-P,plan-Q,plan-R');
  });

  it('leaves the buffer + watermark intact when a shard push fails (offline-safe, AC-14)', () => {
    const git = new FakeGitWrite();
    git.failPush = true;
    const { deps, fs } = makeDeps(
      { [`${TEL}/sessA/1.json`]: seg(['034-x']) },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json'] },
      { git },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(false);
    // buffer untouched: no watermark written → nothing consumed
    expect(fs.exists(`${TEL}/sessA.flushed`)).toBe(false);
    // local ref rolled back (orphan create → deleted), so the next sync starts clean
    expect(git.tip(telemetryRefFor('2026/03/23', 'sessA'))).toBeNull();
    expect(git.calls).toContain('deleteRef');

    // Retry once the push works → the SAME segment flushes successfully.
    git.failPush = false;
    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.pushed).toBe(true);
    expect(r2.segments).toBe(1);
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('1');
  });

  it('publishes the OTLP .jsonl spool companions in the shard tree, not the segment json (T011)', () => {
    const { deps, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['038-x']),
        [`${TEL}/sessA/1.logs.jsonl`]: '{"resourceLogs":[1]}\n',
        [`${TEL}/sessA/1.metrics.jsonl`]: '{"resourceMetrics":[2]}\n',
      },
      {
        [TEL]: ['sessA'],
        [`${TEL}/sessA`]: ['1.json', '1.logs.jsonl', '1.metrics.jsonl'],
      },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(1); // one segment flushed (seq count), two signal blobs
    // the shard tree holds the OTLP signal files — the segment buffer json stays LOCAL
    const names = git.trees
      .flat()
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(['1.logs.jsonl', '1.metrics.jsonl']);
    // the published blob bytes are the spool's, not the segment's
    expect(git.blobs).toContain('{"resourceLogs":[1]}\n');
    expect(git.blobs).toContain('{"resourceMetrics":[2]}\n');
    expect(git.blobs).not.toContain(seg(['038-x']));
    // plan link + date still derived from the local buffer segment
    expect(r.plans).toEqual(['038-x']);
    expect(git.pushed).toEqual([refspec('2026/03/23', 'sessA')]);
    // single-writer-per-ref preserved: orphan create, no fetch-to-write
    expect(git.commits.every((c) => c.parent === null)).toBe(true);
  });

  it('a re-flush of an already-published shard skips the duplicate commit but STILL re-pushes (H5 — crash-before-push safety, no NFF)', () => {
    const { deps, fs, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['038-x']),
        [`${TEL}/sessA/1.logs.jsonl`]: '{"resourceLogs":[1]}\n',
        [`${TEL}/sessA/1.metrics.jsonl`]: '{"resourceMetrics":[2]}\n',
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '1.logs.jsonl', '1.metrics.jsonl'] },
    );

    const r1 = syncTelemetry(deps);
    expect(r1.ok).toBe(true);
    expect(r1.pushed).toBe(true);
    expect(git.commits).toHaveLength(1);
    expect(git.pushed).toHaveLength(1);

    // Watermark lost (a crash before writeFlushed) → reset so the SAME seqs re-flush
    // against the now-existing local ref.
    fs.writeText(`${TEL}/sessA.flushed`, '0');

    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.segments).toBe(0); // no NEW content flushed
    expect(git.commits).toHaveLength(1); // de-duped: NO duplicate commit
    // …but the ref IS re-pushed — a local ref-tree match cannot prove the remote got
    // it (a crash between updateRef and push leaves the local ref ahead), so the buffer
    // must never be consumed without re-delivering. Re-push is idempotent on the remote.
    expect(git.pushed).toHaveLength(2);
    expect(git.pushed[1]).toBe(refspec('2026/03/23', 'sessA'));
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('1'); // watermark advances only after the re-push
  });

  it('the idempotent re-push path surfaces a push failure (does NOT consume the buffer) — crash-before-push never silently loses telemetry', () => {
    const git = new FakeGitWrite();
    const { deps, fs } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['038-x']),
        [`${TEL}/sessA/1.logs.jsonl`]: '{"resourceLogs":[1]}\n',
        [`${TEL}/sessA/1.metrics.jsonl`]: '{"resourceMetrics":[2]}\n',
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '1.logs.jsonl', '1.metrics.jsonl'] },
      { git },
    );

    expect(syncTelemetry(deps).ok).toBe(true); // first flush lands the local ref
    fs.writeText(`${TEL}/sessA.flushed`, '0'); // lost watermark → re-flush hits the idempotent path
    git.failPush = true; // the re-push (the delivery the remote actually needs) fails

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(false); // surfaced, not swallowed
    // the buffer is NOT consumed past the failed re-push → next sync retries delivery
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('0');
  });

  it('falls back to the segment json when the spool is PARTIAL — logs without metrics (companion c7ce: never publish-and-consume a half-signal)', () => {
    const { deps, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: seg(['038-z']),
        [`${TEL}/sessA/1.logs.jsonl`]: '{"resourceLogs":[1]}\n', // metrics absent (crash between writes)
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '1.logs.jsonl'] },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(1);
    // an incomplete pair must NOT be published — fall back to the full segment json
    expect(git.trees.flat().map((e) => e.name)).toEqual(['1.json']);
    expect(git.blobs).not.toContain('{"resourceLogs":[1]}\n');
  });

  it('falls back to the segment json when the .jsonl spool is absent (AC-14: never drop a buffered segment)', () => {
    const { deps, git } = makeDeps(
      { [`${TEL}/sessA/1.json`]: seg(['038-y']) },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json'] },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(1);
    // no spool companions → the segment json still flushes, so nothing is lost
    expect(git.trees.flat().map((e) => e.name)).toEqual(['1.json']);
  });

  it('does NOT skip an un-flushed lower seq when an interleaved date bucket fails (F1 — contiguous-prefix watermark)', () => {
    const git = new FakeGitWrite();
    // The dated shard's push fails; the UNDATED (corrupt-timecode) shard's succeeds.
    git.failPushMatching = (r) => r.includes('2026/03/23');
    const { deps, fs } = makeDeps(
      {
        // seq1 + seq3 are the SAME date; seq2 has a corrupt timecode → UNDATED bucket.
        // So the date buckets INTERLEAVE: dated={1,3} (maxSeq 3), undated={2} (maxSeq 2).
        [`${TEL}/sessA/1.json`]: seg(['x'], { timecode: '2026-03-23T10:00:00.000Z' }),
        [`${TEL}/sessA/2.json`]: '{ corrupt not json',
        [`${TEL}/sessA/3.json`]: seg(['x'], { timecode: '2026-03-23T10:05:00.000Z' }),
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json', '3.json'] },
      { git },
    );

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(false); // the dated shard (seq1+seq3) failed to push
    // The undated shard (seq2, maxSeq 2) pushed first and succeeded — but seq1 (LOWER,
    // stranded in the failed dated shard) is un-flushed, so the watermark must NOT
    // advance past it. Pre-fix it leapt to 2 and skipped seq1 forever.
    expect(fs.exists(`${TEL}/sessA.flushed`)).toBe(false); // never advanced past seq1
    expect(git.pushed).toEqual([refspec('0000/00/00', 'sessA')]); // only the undated shard landed

    // Recovery: once the dated push works, the SAME seq1+seq3 flush — nothing was lost.
    git.failPushMatching = null;
    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('3'); // all three now consumed
  });

  it('is a clean no-op when there is no buffer (no telemetry dir, nothing to flush)', () => {
    const { deps, git } = makeDeps({}, {});
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(0);
    expect(git.calls).toEqual([]); // no git work at all
  });

  it('the kill-switch disables sync entirely (zero git + fs writes)', () => {
    const { deps, fs, git } = makeDeps(
      { [`${TEL}/sessA/1.json`]: seg(['034-x']) },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json'] },
      { env: { HARNESS_NO_TELEMETRY: '1' } },
    );
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(0);
    expect(git.calls).toEqual([]);
    expect(fs.writes).toEqual([]);
  });

  it('survives a concurrent-writer race via ff-retry (updateRef loses once, then wins)', () => {
    const git = new FakeGitWrite();
    git.staleOnce = true;
    const { deps } = makeDeps(
      { [`${TEL}/sessA/1.json`]: seg(['034-x']) },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json'] },
      { git },
    );
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(true);
    // two updateRef attempts on the shard ref: the first lost the race, the retry won
    expect(git.calls.filter((c) => c === 'updateRef')).toHaveLength(2);
  });

  it('never throws to the host — a corrupt segment file is skipped, not fatal', () => {
    const { deps, git } = makeDeps(
      {
        [`${TEL}/sessA/1.json`]: '{ this is not json',
        [`${TEL}/sessA/2.json`]: seg(['034-x']),
      },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json'] },
    );
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    // the corrupt file's bytes still flush (under the undated bucket); only its plan parse is skipped
    expect(r.plans).toEqual(['034-x']);
    expect(r.segments).toBe(2);
    // the good segment lands in its dated shard; the corrupt one in the undated shard
    expect(git.pushed.sort()).toEqual(
      [refspec('0000/00/00', 'sessA'), refspec('2026/03/23', 'sessA')].sort(),
    );
  });
});
