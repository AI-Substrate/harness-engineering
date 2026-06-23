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
