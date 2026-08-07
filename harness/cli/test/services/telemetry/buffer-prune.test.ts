import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  pruneFlushedBuffer,
  type SyncDeps,
  syncTelemetry,
} from '../../../src/services/telemetry/sync-service.js';

/**
 * Plan 049 Phase 1 · T007 (AC-10) — the post-flush buffer prune. Sync's "consume"
 * was watermark-only, so `.harness/temp/telemetry` grew unboundedly (live repo:
 * 100 MB / 104 entries). The prune deletes a session's flushed `<seq>` buffer files
 * once their bytes are DURABLY pushed (push + watermark + `.startdate` sidecar), never
 * touches unflushed seqs, forgets an aged-out fully-flushed session dir whole (sidecars
 * last), and can never fail a sync.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

/** A counts-only buffer segment with a controllable timecode (drives start-date + age-out). */
function seg(plans: string[], timecode = '2026-03-23T10:00:00.000Z'): string {
  return `${JSON.stringify({ command: 'flow', timecode, plans_touched: plans }, null, 2)}\n`;
}
function logsBlob(seq: number): string {
  return `${JSON.stringify({ resourceLogs: [{ seq }] })}\n`;
}
function metricsBlob(seq: number): string {
  return `${JSON.stringify({ resourceMetrics: [{ seq }] })}\n`;
}

/** Seed one seq's full spool triple (buffer json + logs + metrics) into files+dirs. */
function seqTriple(
  files: Record<string, string>,
  dirNames: string[],
  session: string,
  seq: number,
  timecode?: string,
): void {
  files[`${TEL}/${session}/${seq}.json`] = seg(['x'], timecode);
  files[`${TEL}/${session}/${seq}.logs.jsonl`] = logsBlob(seq);
  files[`${TEL}/${session}/${seq}.metrics.jsonl`] = metricsBlob(seq);
  dirNames.push(`${seq}.json`, `${seq}.logs.jsonl`, `${seq}.metrics.jsonl`);
}

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
  clockIso = '2026-03-30T00:00:00.000Z',
): { deps: SyncDeps; fs: FakeFs; git: FakeGitWrite } {
  const fs = new FakeFs(files, dirs);
  const git = new FakeGitWrite();
  const deps: SyncDeps = {
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
    proc: new FakeProcess({}, REPO),
    git,
    clock: new FakeClock(clockIso),
    gitRead: new FakeGitRead(),
  };
  return { deps, fs, git };
}

describe('buffer prune (plan 049 T007 / AC-10)', () => {
  it('deletes flushed seqs only AFTER the durable watermark advances (ordering mutation → RED)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1);
    seqTriple(files, names, 'sessA', 2);
    seqTriple(files, names, 'sessA', 3);
    const { deps, fs } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(true);
    // The durable watermark advanced to the whole session's max seq.
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('3');

    // Every flushed seq's companion files are GONE from the buffer.
    for (const seq of [1, 2, 3]) {
      expect(fs.readText(`${TEL}/sessA/${seq}.json`)).toBeNull();
      expect(fs.readText(`${TEL}/sessA/${seq}.logs.jsonl`)).toBeNull();
      expect(fs.readText(`${TEL}/sessA/${seq}.metrics.jsonl`)).toBeNull();
    }
    expect(fs.readdir(`${TEL}/sessA`)).toEqual([]); // the whole prefix pruned

    // NAMED ORDERING GUARD (the T007 mutation): the prune reads the DURABLE watermark
    // from `.flushed`. Moving pruneFlushedBuffer ABOVE writeFlushed makes it read the
    // STALE watermark (0 for a fresh session) → it deletes NOTHING → these recorded
    // deletes vanish and the files above survive. This assertion is what flips RED.
    expect(fs.deletes).toEqual(
      expect.arrayContaining([`${TEL}/sessA/1.json`, `${TEL}/sessA/2.json`, `${TEL}/sessA/3.json`]),
    );
  });

  it('never touches unflushed seqs — a partial flush prunes only the flushed prefix', () => {
    // The prune ceiling is the DURABLE watermark; seqs above it (captured after the
    // flush read) MUST survive. Exercised directly with a watermark below max present.
    const files: Record<string, string> = {
      [`${TEL}/sessA.flushed`]: '2\n',
      [`${TEL}/sessA/1.json`]: 'a',
      [`${TEL}/sessA/2.json`]: 'b',
      [`${TEL}/sessA/3.json`]: 'c',
    };
    const { deps, fs } = makeDeps(files, {
      [`${TEL}/sessA`]: ['1.json', '2.json', '3.json'],
    });

    pruneFlushedBuffer(deps, TEL, 'sessA', null);

    expect(fs.readText(`${TEL}/sessA/1.json`)).toBeNull(); // seq 1 ≤ 2 → pruned
    expect(fs.readText(`${TEL}/sessA/2.json`)).toBeNull(); // seq 2 ≤ 2 → pruned
    // THE unflushed-survival assertion: seq 3 is above the watermark → kept.
    expect(fs.readText(`${TEL}/sessA/3.json`)).toBe('c');
  });

  it('a prune failure never fails the sync (ok stays true, the push already landed)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1);
    const { deps, fs } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });
    // Model a real I/O error on the delete — the prune must swallow it.
    fs.failDeletes.add(`${TEL}/sessA/1.json`);

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true); // prune threw internally, was swallowed
    expect(r.pushed).toBe(true); // the flush + push still happened
    expect(fs.deletes).toContain(`${TEL}/sessA/1.json`); // the attempt was made
    expect(fs.readText(`${TEL}/sessA/1.json`)).not.toBeNull(); // and the file survived the failure
  });

  it('forgets an aged-out fully-flushed session dir whole, but keeps a younger one', () => {
    const files: Record<string, string> = {};
    // sessOld: newest segment 29 days before the clock → aged out (> 14 days).
    const oldNames: string[] = [];
    seqTriple(files, oldNames, 'sessOld', 1, '2026-03-01T10:00:00.000Z');
    // sessNew: newest segment 2 days before the clock → within the window, kept.
    const newNames: string[] = [];
    seqTriple(files, newNames, 'sessNew', 1, '2026-03-28T10:00:00.000Z');
    const { deps, fs } = makeDeps(files, {
      [TEL]: ['sessOld', 'sessNew'],
      [`${TEL}/sessOld`]: oldNames,
      [`${TEL}/sessNew`]: newNames,
    });

    expect(syncTelemetry(deps).ok).toBe(true);

    // Aged-out session: the whole dir is removed AND its sidecars (deleted last).
    expect(fs.removedDirs).toContain(`${TEL}/sessOld`);
    expect(fs.readText(`${TEL}/sessOld.flushed`)).toBeNull();
    expect(fs.readText(`${TEL}/sessOld.startdate`)).toBeNull();

    // Younger session: only its flushed seqs are pruned; the dir + sidecars remain.
    expect(fs.removedDirs).not.toContain(`${TEL}/sessNew`);
    expect(fs.readText(`${TEL}/sessNew.startdate`)?.trim()).toBe('2026/03/28');
    expect(fs.readText(`${TEL}/sessNew.flushed`)?.trim()).toBe('1');
  });

  it('.startdate survives the prune while the session is live (start-date authority intact)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1); // recent timecode → NOT aged out
    const { deps, fs } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    expect(syncTelemetry(deps).ok).toBe(true);

    // The seqs are pruned…
    expect(fs.readdir(`${TEL}/sessA`)).toEqual([]);
    // …but the start-date sidecar (the ref-bucket authority) is untouched — a live
    // session's date must never be destroyed before the session ages out.
    expect(fs.readText(`${TEL}/sessA.startdate`)?.trim()).toBe('2026/03/23');
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('1');
    expect(fs.removedDirs).not.toContain(`${TEL}/sessA`);
  });
});
