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
  splitJsonl,
} from '../../../src/services/telemetry/rolled-shard.js';
import { type SyncDeps, syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * Plan 049 · T004a (failing-first) — the one-time old-ref MIGRATION. Pins: full-history
 * union recovers segments buried by the F-03 clobber; all-users scope (a session this
 * clone never wrote); remote-only refs are ls-remote-discovered + fetched; a
 * pre-existing rolled ref's straggler segment is preserved; verify-before-delete +
 * the verify↔delete TOCTOU guard; today-dated refs are excluded; a re-run is a no-op
 * (sentinel); two interleaved runs converge to identical (content-addressed) content.
 *
 * These are RED against the pre-migration writer (no migration pass exists yet):
 * with an empty buffer + seeded old refs, `syncTelemetry` writes nothing.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const TODAY = '2026-06-30T00:00:00.000Z';

/** A distinguishable single-line OTLP-ish logs/metrics record per seq. */
function logsBlob(seq: number): string {
  return `${JSON.stringify({ resourceLogs: [{ seq }] })}\n`;
}
function metricsBlob(seq: number): string {
  return `${JSON.stringify({ resourceMetrics: [{ seq }] })}\n`;
}

/** An OLD-shape commit tree: flat per-seq logs+metrics blobs (no manifest). */
function oldTree(seqs: number[]): ShardBlob[] {
  const blobs: ShardBlob[] = [];
  for (const s of seqs) {
    blobs.push({ name: `${s}.logs.jsonl`, content: logsBlob(s) });
    blobs.push({ name: `${s}.metrics.jsonl`, content: metricsBlob(s) });
  }
  return blobs;
}

/** A pre-existing ROLLED ref tree (manifest present ⇒ classified rolled, folded into the union). */
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

function makeDeps(
  gitRead: FakeGitRead,
  git: FakeGitWrite,
  opts: { files?: Record<string, string>; dirs?: Record<string, string[]>; today?: string } = {},
): { deps: SyncDeps; fs: FakeFs } {
  const fs = new FakeFs(opts.files ?? {}, opts.dirs ?? {});
  const deps: SyncDeps = {
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
    proc: new FakeProcess({}, REPO),
    git,
    clock: new FakeClock(opts.today ?? TODAY),
    gitRead,
  };
  return { deps, fs };
}

/** The `session.logs.jsonl` content written for a rolled ref (searched across all trees). */
function rolledLogs(git: FakeGitWrite, mustContainSeq?: number): string | undefined {
  for (const tree of git.trees) {
    const e = tree.find((x) => x.name === ROLLED_LOGS_NAME);
    if (!e) continue;
    const c = git.contentOf(e.sha);
    if (c === undefined) continue;
    if (mustContainSeq === undefined || c.includes(`"seq":${mustContainSeq}`)) return c;
  }
  return undefined;
}

const S1 = 'sess-one';
const S2 = 'sess-two';

describe('syncTelemetry — old-ref migration (plan 049 T004a)', () => {
  it('AC-05: unions FULL history to recover clobbered segments, then deletes the later-day ref', () => {
    // S1 spans two days. The 06/24 ref is F-03-clobbered: its tip commit holds only
    // seq 2 while seq 1 survives ONLY in the parent commit. The 06/25 ref holds seq 3.
    const ref24 = telemetryRefFor('2026/06/24', S1);
    const ref25 = telemetryRefFor('2026/06/25', S1);
    const gitRead = new FakeGitRead();
    gitRead.seedHistory(ref24, [oldTree([2]), oldTree([1])]); // tip={2}, parent={1} (clobber)
    gitRead.seedHistory(ref25, [oldTree([3])]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([ref24, ref25]);
    const { deps, fs } = makeDeps(gitRead, git);

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);

    // The rolled ref lands at the START date (06/24, the min), forced.
    const target = telemetryRefFor('2026/06/24', S1);
    expect(git.pushed).toContain(`+${target}:${target}`);
    // RECOVERY (the F-03 fix): the rolled logs carry seq 1 (buried in a non-tip commit),
    // seq 2 (the clobbering tip), AND seq 3 (the later-day ref). A "walk only the tip"
    // mutation loses seq 1 and flips this RED.
    const logs = splitJsonl(rolledLogs(git) ?? '');
    expect(logs.join('\n')).toContain('"seq":1');
    expect(logs.join('\n')).toContain('"seq":2');
    expect(logs.join('\n')).toContain('"seq":3');

    // The later-day ref is deleted (remote); the start-date ref is OVERWRITTEN, not deleted.
    expect(git.deletedRemote).toContain(ref25);
    expect(git.deletedRemote).not.toContain(ref24);
    // A completion sentinel is written after the clean pass.
    expect(fs.readText(`${TEL}/.migrated`)).not.toBeNull();
  });

  it('AC-05: migrates a session this clone NEVER wrote (all-users scope, no local buffer)', () => {
    const ref = telemetryRefFor('2026/06/20', S2);
    const gitRead = new FakeGitRead().seedHistory(ref, [oldTree([1, 2])]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([ref]);
    const { deps } = makeDeps(gitRead, git);

    syncTelemetry(deps);
    const target = telemetryRefFor('2026/06/20', S2);
    expect(git.pushed).toContain(`+${target}:${target}`);
    expect(rolledLogs(git)).toBeDefined(); // migrated purely from the ref, no buffer
  });

  it('AC-05: discovers a REMOTE-ONLY old ref via ls-remote and fetches it before rolling', () => {
    // A local old ref triggers; a remote-only ref (another clone never re-ran) is
    // discovered via ls-remote and fetched.
    const localRef = telemetryRefFor('2026/06/24', S1);
    const remoteOnly = telemetryRefFor('2026/06/22', S2);
    const gitRead = new FakeGitRead();
    gitRead.seedHistory(localRef, [oldTree([1])]);
    gitRead.seedRemoteOnly(remoteOnly, [oldTree([1])]); // walkable only AFTER a fetch
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([localRef, remoteOnly]);
    const { deps } = makeDeps(gitRead, git);

    syncTelemetry(deps);
    expect(git.calls).toContain('lsRemoteTelemetryRefs'); // the ONE sanctioned pull
    expect(git.fetched).toContain(remoteOnly); // the remote-only ref was fetched
    const t2 = telemetryRefFor('2026/06/22', S2);
    expect(git.pushed).toContain(`+${t2}:${t2}`); // …and migrated
  });

  it('AC-05 (straggler): a pre-existing rolled ref segment absent from all old refs is preserved', () => {
    // A prior clone already rolled S1 at 06/23 with seq 5 (a straggler present in NO
    // old ref). An old per-day ref at 06/24 holds seqs 1,2. The union must keep seq 5.
    const rolledRef = telemetryRefFor('2026/06/23', S1);
    const oldRef = telemetryRefFor('2026/06/24', S1);
    const gitRead = new FakeGitRead();
    gitRead.seedShard(rolledRef, rolledTree(S1, [5], '2026/06/23')); // existing rolled (manifest)
    gitRead.seedHistory(oldRef, [oldTree([1, 2])]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([rolledRef, oldRef]);
    const { deps } = makeDeps(gitRead, git);

    syncTelemetry(deps);
    // Target is the rolled ref's start date (06/23, the min).
    const target = telemetryRefFor('2026/06/23', S1);
    expect(git.pushed).toContain(`+${target}:${target}`);
    const logs = rolledLogs(git) ?? '';
    // The straggler (seq 5) survives — dropping the existing-rolled fold-in flips this RED.
    expect(logs).toContain('"seq":5');
    expect(logs).toContain('"seq":1');
    expect(logs).toContain('"seq":2');
    // The old per-day ref is deleted; the rolled ref path is overwritten, not deleted.
    expect(git.deletedRemote).toContain(oldRef);
    expect(git.deletedRemote).not.toContain(rolledRef);
  });

  it('AC-06 (TOCTOU): a racer changing the rolled ref between verify and delete SKIPS that delete', () => {
    const ref24 = telemetryRefFor('2026/06/24', S1);
    const ref25 = telemetryRefFor('2026/06/25', S1);
    const gitRead = new FakeGitRead();
    gitRead.seedHistory(ref24, [oldTree([1])]);
    gitRead.seedHistory(ref25, [oldTree([2])]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([ref24, ref25]);
    // A racing forced push overwrote the rolled ref's CONTENT after our write — the
    // per-delete re-verify (refTree still == our tree?) must fail and skip the delete.
    const target = telemetryRefFor('2026/06/24', S1);
    git.refTreeOverride.set(target, 'racer-diverged-tree');
    const { deps, fs } = makeDeps(gitRead, git);

    syncTelemetry(deps);
    // The later-day ref is NOT deleted (the TOCTOU guard tripped) …
    expect(git.deletedRemote).not.toContain(ref25);
    // … and no sentinel is written, so the migration retries on the next run.
    expect(fs.readText(`${TEL}/.migrated`)).toBeNull();
  });

  it('AC-06: a ref dated TODAY is excluded (old-CLI writer protection)', () => {
    const oldRef = telemetryRefFor('2026/06/24', S1); // < today → migrated
    const todayRef = telemetryRefFor('2026/06/30', S2); // == today → left alone
    const gitRead = new FakeGitRead();
    gitRead.seedHistory(oldRef, [oldTree([1])]);
    gitRead.seedHistory(todayRef, [oldTree([1])]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([oldRef, todayRef]);
    const { deps } = makeDeps(gitRead, git);

    syncTelemetry(deps);
    // S1 (old) migrated; S2 (today) neither rewritten nor deleted.
    const t1 = telemetryRefFor('2026/06/24', S1);
    expect(git.pushed).toContain(`+${t1}:${t1}`);
    expect(git.deletedRemote).not.toContain(todayRef);
    const t2 = telemetryRefFor('2026/06/30', S2);
    expect(git.pushed).not.toContain(`+${t2}:${t2}`);
  });

  it('AC-06: a second run is a no-op (sentinel present ⇒ zero ls-remote)', () => {
    const ref = telemetryRefFor('2026/06/24', S1);
    const gitRead = new FakeGitRead().seedHistory(ref, [oldTree([1])]);
    const git = new FakeGitWrite().seedRemoteTelemetryRefs([ref]);
    const { deps } = makeDeps(gitRead, git);

    syncTelemetry(deps);
    const lsAfterFirst = git.calls.filter((c) => c === 'lsRemoteTelemetryRefs').length;
    expect(lsAfterFirst).toBe(1);

    syncTelemetry(deps); // second run
    // Sentinel present → the migration pass is skipped entirely (no second pull).
    expect(git.calls.filter((c) => c === 'lsRemoteTelemetryRefs').length).toBe(1);
  });

  it('AC-06: two interleaved runs converge to identical (content-addressed) rolled content', () => {
    const ref = telemetryRefFor('2026/06/24', S1);
    const seed = (): FakeGitRead =>
      new FakeGitRead().seedHistory(ref, [oldTree([2]), oldTree([1])]);

    const gitA = new FakeGitWrite().seedRemoteTelemetryRefs([ref]);
    syncTelemetry(makeDeps(seed(), gitA).deps);
    const gitB = new FakeGitWrite().seedRemoteTelemetryRefs([ref]);
    syncTelemetry(makeDeps(seed(), gitB).deps);

    // Two clones migrating the SAME old refs build byte-identical rolled logs.
    expect(rolledLogs(gitA)).toBe(rolledLogs(gitB));
    expect(rolledLogs(gitA)).toBeDefined();
  });
});
