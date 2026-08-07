import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import type { ShardBlob } from '../../../src/adapters/git/git-read-port.js';
import { telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  concatJsonl,
  ROLLED_LOGS_NAME,
  ROLLED_MANIFEST_NAME,
  ROLLED_METRICS_NAME,
  ROLLUP_FORMAT,
  serializeManifest,
} from '../../../src/services/telemetry/rolled-shard.js';
import { type SyncDeps, syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * Plan 067 — the COST contract of `telemetry sync`: O(sessions in the buffer), never
 * O(corpus). Measured 2026-08-04, an empty sync burned 18,217 git subprocesses and
 * ~2m07s because the migration trigger classified every committed ref by READING ITS
 * WHOLE TREE, and one legacy pre-rollup ref carries 17,566 blobs.
 *
 * These pin the contract with call-count assertions over the fakes' recorded history
 * (fakes over mocks), so they hold independently of machine load:
 *
 *   • AC-1 — an empty-buffer sync performs NO tree/blob read of any committed ref, and
 *     the steady state (second run onwards) touches the ref namespace not at all.
 *   • AC-2 — the whole sync's git call count is INDEPENDENT of corpus size.
 *   • AC-3 — a huge legacy ref elsewhere in the corpus is never read while flushing an
 *     unrelated session.
 *
 * The read port's per-ref surface is `readShardTree` / `readTreeAtCommit` /
 * `listRefHistory`; `refsWithBlob` is the batched header-only probe (ONE git
 * subprocess for the whole corpus), which is why it is excluded from the "reads" set
 * and separately asserted to be called at most once.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const TODAY = '2026-08-04T00:00:00.000Z';

/** The read-port calls that cost one-or-more git subprocesses PER REF. */
const PER_REF_READS = new Set(['readShardTree', 'readTreeAtCommit', 'listRefHistory']);

function logsBlob(seq: number): string {
  return `${JSON.stringify({ resourceLogs: [{ seq }] })}\n`;
}
function metricsBlob(seq: number): string {
  return `${JSON.stringify({ resourceMetrics: [{ seq }] })}\n`;
}

/** A normal ROLLED ref tree (3 entries — the shape every migrated session has). */
function rolledTree(session: string, seqs: number[], startDate: string): ShardBlob[] {
  return [
    { name: ROLLED_LOGS_NAME, content: concatJsonl(seqs.map(logsBlob)) },
    { name: ROLLED_METRICS_NAME, content: concatJsonl(seqs.map(metricsBlob)) },
    {
      name: ROLLED_MANIFEST_NAME,
      content: serializeManifest({
        format: ROLLUP_FORMAT,
        session,
        start_date: startDate,
        max_seq: Math.max(...seqs),
      }),
    },
  ];
}

/**
 * The real corpus's pathological ref: rolled (it carries a manifest) but ALSO dragging
 * `blobCount` loose per-seq blobs — the June session that made every sync cost minutes.
 */
function legacyTree(session: string, blobCount: number): ShardBlob[] {
  const blobs: ShardBlob[] = [
    {
      name: ROLLED_MANIFEST_NAME,
      content: serializeManifest({
        format: ROLLUP_FORMAT,
        session,
        start_date: '2026/06/23',
        max_seq: blobCount,
      }),
    },
  ];
  for (let seq = 1; seq <= blobCount; seq++) {
    blobs.push({ name: `${seq}.json`, content: `{"command":"flow","seq":${seq}}\n` });
  }
  return blobs;
}

/** A corpus of `count` ordinary rolled refs, none of them the buffered session's. */
function seedCorpus(gitRead: FakeGitRead, count: number): FakeGitRead {
  for (let i = 0; i < count; i++) {
    const session = `corpus-${i}`;
    gitRead.seedShard(
      telemetryRefFor('2026/07/01', session),
      rolledTree(session, [1], '2026/07/01'),
    );
  }
  return gitRead;
}

/** One buffered segment for `session` (the whole spool triple capture writes). */
function bufferedSession(session: string): {
  files: Record<string, string>;
  dirs: Record<string, string[]>;
} {
  return {
    files: {
      [`${TEL}/${session}/1.json`]: `${JSON.stringify({
        command: 'flow',
        timecode: '2026-08-04T00:00:00.000Z',
        plans_touched: ['067-x'],
      })}\n`,
      [`${TEL}/${session}/1.logs.jsonl`]: logsBlob(1),
      [`${TEL}/${session}/1.metrics.jsonl`]: metricsBlob(1),
    },
    dirs: {
      [TEL]: [session],
      [`${TEL}/${session}`]: ['1.json', '1.logs.jsonl', '1.metrics.jsonl'],
    },
  };
}

function makeDeps(
  gitRead: FakeGitRead,
  git: FakeGitWrite,
  buffer: { files?: Record<string, string>; dirs?: Record<string, string[]> } = {},
): { deps: SyncDeps; fs: FakeFs } {
  const fs = new FakeFs(buffer.files ?? {}, buffer.dirs ?? {});
  return {
    deps: {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
      proc: new FakeProcess({}, REPO),
      git,
      clock: new FakeClock(TODAY),
      gitRead,
    },
    fs,
  };
}

describe('telemetry sync cost — O(buffer), not O(corpus) (plan 067)', () => {
  it('AC-1: an EMPTY-buffer sync never tree/blob-reads a committed ref', () => {
    const gitRead = seedCorpus(new FakeGitRead(), 40);
    gitRead.seedShard(telemetryRefFor('2026/06/23', 'legacy-june'), legacyTree('legacy-june', 500));
    const { deps } = makeDeps(gitRead, new FakeGitWrite());

    const r = syncTelemetry(deps);

    expect(r.ok).toBe(true);
    expect(r.segments).toBe(0);
    // Not ONE ref's tree was read — the classification is header-only.
    expect(gitRead.readRefs).toEqual([]);
    expect(gitRead.calls.filter((c) => PER_REF_READS.has(c))).toEqual([]);
    // …and the whole 41-ref corpus was classified in ONE batched probe.
    expect(gitRead.calls.filter((c) => c === 'refsWithBlob')).toHaveLength(1);
  });

  it('AC-1: once the clone is known-migrated, an empty sync does not touch the ref namespace at all', () => {
    const gitRead = seedCorpus(new FakeGitRead(), 40);
    const { deps, fs } = makeDeps(gitRead, new FakeGitWrite());

    syncTelemetry(deps); // first run: classifies the corpus once, and RECORDS that
    expect(fs.readText(`${TEL}/.migrated`)).not.toBeNull();

    const callsAfterFirst = gitRead.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    syncTelemetry(deps); // steady state
    syncTelemetry(deps);

    // Zero further reads: no enumeration, no classification, no tree read.
    expect(gitRead.calls).toHaveLength(callsAfterFirst);
  });

  it('AC-2: the sync call count is INDEPENDENT of how many refs the corpus holds', () => {
    const run = (corpusSize: number): { reads: number; writes: number } => {
      const gitRead = seedCorpus(new FakeGitRead(), corpusSize);
      const git = new FakeGitWrite();
      const buffer = bufferedSession('sess-flushing');
      const { deps } = makeDeps(gitRead, git, buffer);
      const r = syncTelemetry(deps);
      expect(r.ok).toBe(true);
      expect(r.segments).toBe(1); // the flush really happened — never a vacuous count
      return { reads: gitRead.calls.length, writes: git.calls.length };
    };

    const small = run(2);
    const large = run(400);
    expect(large).toEqual(small);
  });

  it('AC-3: a 1000-blob legacy ref is never read while flushing an unrelated session', () => {
    const legacyRef = telemetryRefFor('2026/06/23', 'legacy-june');
    const gitRead = seedCorpus(new FakeGitRead(), 5);
    gitRead.seedShard(legacyRef, legacyTree('legacy-june', 1000));
    const git = new FakeGitWrite();
    const buffer = bufferedSession('sess-unrelated');
    const { deps } = makeDeps(gitRead, git, buffer);

    const r = syncTelemetry(deps);

    expect(r.ok).toBe(true);
    expect(r.segments).toBe(1);
    // The legacy ref is never tree-read, never history-walked — zero blobs lifted.
    expect(gitRead.readRefs).not.toContain(legacyRef);
    expect(gitRead.calls.filter((c) => PER_REF_READS.has(c))).toEqual([]);
    // The flush read the FLUSHING session's own ref only (write-port manifest probe).
    expect(git.readBlobNames).toEqual([ROLLED_MANIFEST_NAME]);
  });

  it('AC-3: an old-shape ref STILL migrates — the cheap probe classifies, it does not skip', () => {
    // The batched probe must be a faithful replacement for the whole-tree scan: a ref
    // with no manifest is old-shape and MUST still be migrated (plan 049 stays intact).
    const oldRef = telemetryRefFor('2026/06/24', 'sess-old');
    const gitRead = seedCorpus(new FakeGitRead(), 20);
    gitRead.seedHistory(oldRef, [[{ name: '1.logs.jsonl', content: logsBlob(1) }]]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([oldRef]);
    const { deps } = makeDeps(gitRead, git);

    syncTelemetry(deps);

    const target = telemetryRefFor('2026/06/24', 'sess-old');
    expect(git.pushed).toContain(`+${target}:${target}`);
    // Only the OLD ref's material was walked — the 20 rolled corpus refs were not.
    expect(gitRead.readRefs).not.toContain(telemetryRefFor('2026/07/01', 'corpus-0'));
  });
});
