import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  parseManifest,
  ROLLED_LOGS_NAME,
  ROLLED_MANIFEST_NAME,
  ROLLED_METRICS_NAME,
  splitJsonl,
} from '../../../src/services/telemetry/rolled-shard.js';
import { type SyncDeps, syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * Plan 049 Phase 1 · T002a (failing-first) — the ROLLED sync-service. Pins the new
 * shape: ONE ref per session at its START date (`refs/harness-telemetry/<start>/…`),
 * ONE rolled tree (`session.logs.jsonl` + `session.metrics.jsonl` concatenated
 * seq-ordered + `manifest.json`) rebuilt from the WHOLE local buffer every sync
 * (tip tree = the whole session, fixing F-03), an orphan-commit rewrite force-pushed
 * with `+ref:ref` on EVERY push (incl. the idempotent re-push), the `.startdate`
 * sidecar, manifest max-seq idempotency, and the fetch-free-append invariant (AC-03).
 *
 * Buffer seqs are 1-based (capture's `nextSeq` = max+1); the watermark filter is
 * `seq > flushed` from an initial 0.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

/** A counts-only buffer segment (pretty-printed, as capture writes it). */
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

/** A single-line OTLP logs spool record for one seq (distinguishable by seq). */
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
  plans: string[],
  timecode?: string,
): void {
  files[`${TEL}/${session}/${seq}.json`] = seg(plans, timecode ? { timecode } : {});
  files[`${TEL}/${session}/${seq}.logs.jsonl`] = logsBlob(seq);
  files[`${TEL}/${session}/${seq}.metrics.jsonl`] = metricsBlob(seq);
  dirNames.push(`${seq}.json`, `${seq}.logs.jsonl`, `${seq}.metrics.jsonl`);
}

/** The forced refspec every rolled push must use. */
function forced(startDate: string, session: string): string {
  const ref = telemetryRefFor(startDate, session);
  return `+${ref}:${ref}`;
}

/** Names of the entries in the most recent mktree call (sorted). */
function latestTreeNames(git: FakeGitWrite): string[] {
  return (git.trees.at(-1) ?? []).map((e) => e.name).sort();
}

/** Content of a named entry in the most recent rolled tree (content-addressed lookup). */
function latestBlob(git: FakeGitWrite, name: string): string | undefined {
  const entry = (git.trees.at(-1) ?? []).find((e) => e.name === name);
  return entry ? git.contentOf(entry.sha) : undefined;
}

/** The parsed manifest from the most recent rolled tree. */
function latestManifest(git: FakeGitWrite) {
  return parseManifest(latestBlob(git, ROLLED_MANIFEST_NAME));
}

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
  over: {
    env?: Record<string, string>;
    git?: FakeGitWrite;
    gitRead?: FakeGitRead;
    clock?: FakeClock;
    withMigrationPorts?: boolean;
  } = {},
): { deps: SyncDeps; fs: FakeFs; git: FakeGitWrite; gitRead: FakeGitRead } {
  const fs = new FakeFs(files, dirs);
  const git = over.git ?? new FakeGitWrite();
  const gitRead = over.gitRead ?? new FakeGitRead();
  const clock = over.clock ?? new FakeClock('2026-03-30T00:00:00.000Z');
  const deps: SyncDeps = {
    fs,
    env: new FakeEnv(over.env ?? {}),
    proc: new FakeProcess({}, REPO),
    git,
    // The migration ports are optional; default them ON so the trigger is exercised
    // (a no-op with no old refs) and the AC-03 fetch-free proof is non-vacuous.
    ...(over.withMigrationPorts === false ? {} : { clock, gitRead }),
  };
  return { deps, fs, git, gitRead };
}

describe('syncTelemetry — rolled one-ref-per-session-at-start-date (plan 049)', () => {
  it('flushes each session to ONE rolled ref, forced-pushes, then consumes (second sync no-op)', () => {
    const files: Record<string, string> = {};
    const aNames: string[] = [];
    const bNames: string[] = [];
    seqTriple(files, aNames, 'sessA', 1, ['049-x']);
    seqTriple(files, aNames, 'sessA', 2, ['049-x']);
    seqTriple(files, bNames, 'sessB', 1, ['055-y']);
    const { deps, fs, git } = makeDeps(files, {
      [TEL]: ['sessA', 'sessB'],
      [`${TEL}/sessA`]: aNames,
      [`${TEL}/sessB`]: bNames,
    });

    const r1 = syncTelemetry(deps);
    expect(r1.ok).toBe(true);
    expect(r1.pushed).toBe(true);
    expect(r1.segments).toBe(3);
    expect(r1.sessions).toBe(2);
    // ONE commit per session (not per date/seq), each an orphan rewrite.
    expect(git.commits).toHaveLength(2);
    expect(git.commits.every((c) => c.parent === null)).toBe(true);
    // Every push is FORCED (+ref:ref) — orphan-rewrite semantics NFF a plain push.
    expect(git.pushed.sort()).toEqual(
      [forced('2026/03/23', 'sessA'), forced('2026/03/23', 'sessB')].sort(),
    );
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('2');
    expect(fs.readText(`${TEL}/sessB.flushed`)?.trim()).toBe('1');

    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.segments).toBe(0);
    expect(git.commits).toHaveLength(2); // no new commit
    expect(git.pushed).toHaveLength(2); // no new push (nothing past the watermark)
  });

  it('AC-01: a multi-day session lives at ONE ref, keyed at its START date', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x'], '2026-03-23T23:50:00.000Z');
    seqTriple(files, names, 'sessA', 2, ['x'], '2026-03-24T00:10:00.000Z');
    const { deps, fs, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(2);
    expect(git.commits).toHaveLength(1); // ONE ref, ONE commit — not one-per-day
    expect(git.pushed).toEqual([forced('2026/03/23', 'sessA')]); // START date
    expect(fs.readText(`${TEL}/sessA.startdate`)?.trim()).toBe('2026/03/23');
    const logs = latestBlob(git, ROLLED_LOGS_NAME);
    expect(splitJsonl(logs ?? '')).toHaveLength(2);
    expect(latestManifest(git)?.start_date).toBe('2026/03/23');
    expect(latestManifest(git)?.max_seq).toBe(2);
  });

  it('AC-02: the tip tree is the WHOLE session — sync-2 rebuilds sync-1 segments (F-03 fix)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    seqTriple(files, names, 'sessA', 2, ['x']);
    const dirs: Record<string, string[]> = { [TEL]: ['sessA'], [`${TEL}/sessA`]: names };
    const { deps, fs, git } = makeDeps(files, dirs);

    expect(syncTelemetry(deps).segments).toBe(2); // sync 1: seq 1,2

    // A 3rd segment lands, then sync again (register it in the dir listing too).
    fs.writeText(`${TEL}/sessA/3.json`, seg(['x']));
    fs.writeText(`${TEL}/sessA/3.logs.jsonl`, logsBlob(3));
    fs.writeText(`${TEL}/sessA/3.metrics.jsonl`, metricsBlob(3));
    names.push('3.json', '3.logs.jsonl', '3.metrics.jsonl');
    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.segments).toBe(1); // only seq 3 is NEW

    // The load-bearing assertion (F-03): sync-2's tree contains ALL of seq 1,2,3 —
    // NOT just the new seq 3. The mutation "build the tree from PENDING only" drops
    // seq 1,2 from this tree and flips this RED.
    const logs = splitJsonl(latestBlob(git, ROLLED_LOGS_NAME) ?? '');
    expect(logs).toHaveLength(3);
    expect(logs.join('\n')).toContain('"seq":1');
    expect(logs.join('\n')).toContain('"seq":2');
    expect(logs.join('\n')).toContain('"seq":3');
    expect(latestManifest(git)?.max_seq).toBe(3);
  });

  it('AC-03: steady-state sync is fetch-free — zero ls-remote / fetch / history-walk', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x'], '2026-03-23T23:00:00.000Z');
    const dirs: Record<string, string[]> = { [TEL]: ['sessA'], [`${TEL}/sessA`]: names };
    const { deps, git, gitRead, fs } = makeDeps(files, dirs);

    expect(syncTelemetry(deps).ok).toBe(true);
    fs.writeText(`${TEL}/sessA/2.json`, seg(['x'], { timecode: '2026-03-24T09:00:00.000Z' }));
    fs.writeText(`${TEL}/sessA/2.logs.jsonl`, logsBlob(2));
    fs.writeText(`${TEL}/sessA/2.metrics.jsonl`, metricsBlob(2));
    names.push('2.json', '2.logs.jsonl', '2.metrics.jsonl');
    expect(syncTelemetry(deps).ok).toBe(true);

    // NON-VACUOUS proof: the write port never pulled, and the read port never walked
    // history — the append built purely from the LOCAL buffer + local ref-tree read.
    expect(git.calls).not.toContain('lsRemoteTelemetryRefs');
    expect(git.calls).not.toContain('fetchRef');
    expect(gitRead.calls).not.toContain('listRefHistory');
    expect(gitRead.calls).not.toContain('readTreeAtCommit');
    // …AND the union base IS read locally: `readRefTree` (a `cat-file` of the ref's
    // OWN tree) is called — the fetch-free union source that lets the buffer be pruned.
    expect(git.calls).toContain('readRefTree');
  });

  it('AC-04: a lost-watermark re-flush skips the duplicate commit but STILL force-re-pushes', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    const { deps, fs, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    const r1 = syncTelemetry(deps);
    expect(r1.pushed).toBe(true);
    expect(git.commits).toHaveLength(1);
    expect(git.pushed).toEqual([forced('2026/03/23', 'sessA')]);

    fs.writeText(`${TEL}/sessA.flushed`, '0'); // watermark lost → the SAME seq re-flushes
    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.segments).toBe(0); // nothing NEW
    expect(git.commits).toHaveLength(1); // de-duped: NO duplicate commit (tree matched)
    expect(git.pushed).toHaveLength(2);
    expect(git.pushed[1]).toBe(forced('2026/03/23', 'sessA')); // re-push, and forced
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('1'); // advances after the re-push
  });

  it('AC-04 (divergent remote): the idempotent re-push is forced even when the remote diverged', () => {
    const git = new FakeGitWrite();
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    const { deps, fs } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names }, { git });
    expect(syncTelemetry(deps).ok).toBe(true);
    fs.writeText(`${TEL}/sessA.flushed`, '0'); // force the idempotent re-flush path

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    // Every push carries the '+' force marker (the only thing that lands over a
    // divergent remote); a bare `ref:ref` re-push would be rejected non-fast-forward.
    expect(git.pushed.every((p) => p.startsWith('+'))).toBe(true);
  });

  it('F2 contract: an idempotent re-push force-delivers but reports pushed:false (no fresh commit)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    const { deps, fs, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    // First sync publishes a fresh commit → pushed:true.
    expect(syncTelemetry(deps).pushed).toBe(true);
    expect(git.commits).toHaveLength(1);

    // Lose the watermark → the SAME seq re-flushes; the ref already holds the exact
    // rolled tree, so NO fresh commit is written.
    fs.writeText(`${TEL}/sessA.flushed`, '0');
    const pushesBefore = git.pushed.length;
    const r = syncTelemetry(deps);

    // The contract (F2): `pushed` means "a FRESH commit was published this run".
    expect(r.pushed).toBe(false); // no fresh commit ⇒ counter NOT inflated by the re-run
    expect(git.commits).toHaveLength(1); // proof: still exactly ONE commit ever
    // …yet a real FORCED push DID happen (the re-delivery the contract excludes from
    // the counter but never skips) — so pushed:false is a counter semantic, not "no push".
    expect(git.pushed.length).toBe(pushesBefore + 1);
    expect(git.pushed.at(-1)).toBe(forced('2026/03/23', 'sessA'));
  });

  it('lost watermark + PRUNED buffer: reconstructs the identical tree from the REF, idempotent re-push', () => {
    // The strongest AC-04: after T007 prunes the buffer, a lost watermark has NO buffer
    // to re-flush from — the whole-session tree must be reconstructed from the rolled
    // ref (the flushed truth) and hit the idempotent no-op path (no fresh commit), while
    // still force-re-delivering (belt-and-suspenders for an unproven remote).
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    seqTriple(files, names, 'sessA', 2, ['x']);
    const { deps, fs, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    // Sync 1 publishes seq 1,2 to the ref; T007 then prunes the buffer to EMPTY.
    expect(syncTelemetry(deps).pushed).toBe(true);
    expect(git.commits).toHaveLength(1);
    expect(fs.readdir(`${TEL}/sessA`)).toEqual([]); // buffer fully pruned

    // Lose the watermark with an already-empty buffer (the crash/corruption case).
    fs.writeText(`${TEL}/sessA.flushed`, '0');
    const commitsBefore = git.commits.length;
    const pushesBefore = git.pushed.length;

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(false); // reconstructed tree == ref tree → NO fresh commit
    expect(git.commits.length).toBe(commitsBefore); // idempotent: no duplicate commit
    // The union base came from the REF, read locally — not from the empty buffer.
    expect(git.calls).toContain('readRefTree');
    // …yet a FORCED re-push still delivered it.
    expect(git.pushed.length).toBe(pushesBefore + 1);
    expect(git.pushed.at(-1)).toBe(forced('2026/03/23', 'sessA'));
    // Nothing was lost: the reconstructed tree still holds BOTH seq 1 and seq 2.
    const logs = splitJsonl(latestBlob(git, ROLLED_LOGS_NAME) ?? '');
    expect(logs).toHaveLength(2);
    expect(logs.join('\n')).toContain('"seq":1');
    expect(logs.join('\n')).toContain('"seq":2');
    // The watermark is re-advanced to the ref's max (repaired from the ref, not the buffer).
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('2');
  });

  it('FAIL CLOSED: a partial/failed readRefTree does NOT rewrite the ref or prune — sync ok:false, everything untouched (plan 049 round-2 F1)', () => {
    // The union base is the flushed ref tree; if the real adapter cannot read it in
    // full (an ENOBUFS-truncated / failed blob read) it throws rather than hand back a
    // short tree. That throw must abort the rewrite: no fresh commit, no force-push, the
    // ref tip, the buffer, and the watermark all left exactly as they were, sync ok:false.
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    seqTriple(files, names, 'sessA', 2, ['x']);
    const { deps, fs, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    // Sync 1 publishes seq 1,2 to the ref and T007 prunes the buffer; a new seq 3 lands.
    expect(syncTelemetry(deps).pushed).toBe(true);
    fs.writeText(`${TEL}/sessA/3.json`, seg(['x']));
    fs.writeText(`${TEL}/sessA/3.logs.jsonl`, logsBlob(3));
    fs.writeText(`${TEL}/sessA/3.metrics.jsonl`, metricsBlob(3));
    names.push('3.json', '3.logs.jsonl', '3.metrics.jsonl');

    const ref = telemetryRefFor('2026/03/23', 'sessA');
    const tipBefore = git.tip(ref);
    const commitsBefore = git.commits.length;
    const pushesBefore = git.pushed.length;
    const bufferBefore = fs.readdir(`${TEL}/sessA`).sort();

    // The next union read fails closed (a partial/ENOBUFS blob read in the real adapter).
    git.failReadRefTree = true;
    const r = syncTelemetry(deps);

    expect(r.ok).toBe(false); // the failure surfaces — never a silent partial roll
    expect(git.commits.length).toBe(commitsBefore); // ref NOT rewritten (no fresh commit)
    expect(git.pushed.length).toBe(pushesBefore); // NOT force-pushed
    expect(git.tip(ref)).toBe(tipBefore); // ref tip unchanged
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('2'); // watermark untouched
    expect(fs.readdir(`${TEL}/sessA`).sort()).toEqual(bufferBefore); // buffer NOT pruned (seq 3 survives)
  });

  it('the .startdate sidecar is AUTHORITATIVE — a pre-seeded date wins over the buffer timecode', () => {
    const files: Record<string, string> = { [`${TEL}/sessA.startdate`]: '2026/01/05\n' };
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x'], '2026-03-23T10:00:00.000Z');
    const { deps, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    // The ref honours the sidecar's start date, NOT the segment's own capture date.
    expect(git.pushed).toEqual([forced('2026/01/05', 'sessA')]);
    expect(latestManifest(git)?.start_date).toBe('2026/01/05');
  });

  it('leaves the buffer + watermark intact when the rolled push fails (offline-safe, AC-14)', () => {
    const git = new FakeGitWrite();
    git.failPush = true;
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    const { deps, fs } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names }, { git });

    const r = syncTelemetry(deps);
    expect(r.ok).toBe(false);
    expect(r.pushed).toBe(false);
    expect(fs.exists(`${TEL}/sessA.flushed`)).toBe(false); // nothing consumed
    expect(git.tip(telemetryRefFor('2026/03/23', 'sessA'))).toBeNull(); // orphan rolled back

    git.failPush = false;
    const r2 = syncTelemetry(deps);
    expect(r2.ok).toBe(true);
    expect(r2.segments).toBe(1);
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('1');
  });

  it('dedupes plan links into a sorted set and records them in the rolled commit (AC-08)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['plan-P', 'plan-Q']);
    seqTriple(files, names, 'sessA', 2, ['plan-P', 'plan-R']);
    const { deps, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });
    const r = syncTelemetry(deps);
    expect(r.plans).toEqual(['plan-P', 'plan-Q', 'plan-R']);
    expect(git.commits).toHaveLength(1);
    expect(git.commits[0].message).toContain('plan-P,plan-Q,plan-R');
  });

  it('falls back to a loose <seq>.json when the spool pair is PARTIAL or absent (AC-14)', () => {
    const files: Record<string, string> = {
      // seq 1: complete pair → concatenated into session.logs.jsonl
      [`${TEL}/sessA/1.json`]: seg(['x']),
      [`${TEL}/sessA/1.logs.jsonl`]: logsBlob(1),
      [`${TEL}/sessA/1.metrics.jsonl`]: metricsBlob(1),
      // seq 2: logs but no metrics (partial) → loose 2.json fallback
      [`${TEL}/sessA/2.json`]: seg(['x']),
      [`${TEL}/sessA/2.logs.jsonl`]: logsBlob(2),
      // seq 3: no spool at all → loose 3.json fallback
      [`${TEL}/sessA/3.json`]: seg(['x']),
    };
    const { deps, git } = makeDeps(files, {
      [TEL]: ['sessA'],
      [`${TEL}/sessA`]: [
        '1.json',
        '1.logs.jsonl',
        '1.metrics.jsonl',
        '2.json',
        '2.logs.jsonl',
        '3.json',
      ],
    });
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(3);
    const names = latestTreeNames(git);
    expect(names).toContain(ROLLED_LOGS_NAME);
    expect(names).toContain(ROLLED_METRICS_NAME);
    expect(names).toContain('2.json'); // partial-spool fallback
    expect(names).toContain('3.json'); // absent-spool fallback
    expect(names).toContain(ROLLED_MANIFEST_NAME);
    expect(splitJsonl(latestBlob(git, ROLLED_LOGS_NAME) ?? '')).toHaveLength(1); // only seq 1's logs
  });

  it('a loose <seq>.json fallback in the ref SURVIVES the union rebuild (partial-spool preserved across syncs)', () => {
    // seq 1 has NO spool pair → published as a loose 1.json fallback. After T007 prunes
    // the buffer, a later sync must re-source that loose blob FROM THE REF (readRefTree),
    // not the emptied buffer — proving the partial-spool fallback is union-preserved.
    const names = ['1.json'];
    const files: Record<string, string> = { [`${TEL}/sessA/1.json`]: seg(['x']) };
    const { deps, fs, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });

    expect(syncTelemetry(deps).ok).toBe(true);
    expect(latestTreeNames(git)).toContain('1.json'); // ref holds the loose fallback

    // A complete seq 2 lands (the pruned buffer no longer holds seq 1).
    fs.writeText(`${TEL}/sessA/2.json`, seg(['x']));
    fs.writeText(`${TEL}/sessA/2.logs.jsonl`, logsBlob(2));
    fs.writeText(`${TEL}/sessA/2.metrics.jsonl`, metricsBlob(2));
    names.push('2.json', '2.logs.jsonl', '2.metrics.jsonl');

    expect(syncTelemetry(deps).ok).toBe(true);
    const tree = latestTreeNames(git);
    expect(tree).toContain('1.json'); // loose fallback carried through the union from the ref
    expect(tree).toContain(ROLLED_LOGS_NAME);
    expect(splitJsonl(latestBlob(git, ROLLED_LOGS_NAME) ?? '')).toHaveLength(1); // seq 2's logs
    expect(latestManifest(git)?.max_seq).toBe(2);
  });

  it('is a clean no-op with no buffer (no telemetry dir)', () => {
    const { deps, git } = makeDeps({}, {});
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.segments).toBe(0);
    expect(git.calls).not.toContain('commitTree');
    expect(git.calls).not.toContain('push');
  });

  it('the kill-switch disables sync entirely (zero git + fs writes)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    const { deps, fs, git } = makeDeps(
      files,
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: names },
      {
        env: { HARNESS_NO_TELEMETRY: '1' },
      },
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
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    const { deps } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names }, { git });
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.pushed).toBe(true);
    expect(git.calls.filter((c) => c === 'updateRef')).toHaveLength(2);
  });

  it('never throws to the host — a corrupt segment file still publishes its bytes (AC-14)', () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    seqTriple(files, names, 'sessA', 1, ['x']);
    files[`${TEL}/sessA/2.json`] = '{ this is not json';
    names.push('2.json');
    const { deps, git } = makeDeps(files, { [TEL]: ['sessA'], [`${TEL}/sessA`]: names });
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);
    expect(r.plans).toEqual(['x']); // corrupt file's plan parse skipped, good one kept
    expect(r.segments).toBe(2);
    expect(latestTreeNames(git)).toContain('2.json'); // corrupt bytes still ship (loose)
  });

  it('AC-09 / P12: the rolled blobs are the per-seq OTLP bytes VERBATIM — no re-encoding', () => {
    // OPAQUE spool records — deliberately NON-canonical bytes: interior whitespace
    // AND integer-like keys OUT of ascending order. A JSON.parse→stringify anywhere
    // in the writer (the reviewer's laundering mutation at rolled-shard.ts concatJsonl)
    // would strip the spaces and re-sort the numeric keys, so these fixtures are
    // re-encoding TRIPWIRES: the captured spool bytes must ship byte-for-byte (P12 —
    // the publication boundary is layout-only, never a re-serialized stream).
    const logsRec = [
      '{ "resourceLogs": [ { "seq": 1, "extra": "alpha" } ],  "2": "b", "1": "a" }\n',
      '{"resourceLogs":[{"seq":2,"extra":"beta"}]}\n',
    ];
    const metricsRec = [
      '{ "resourceMetrics": [ { "seq": 1 } ],  "z": 1, "a": 2 }\n',
      '{"resourceMetrics":[{"seq":2}]}\n',
    ];
    const files: Record<string, string> = {
      [`${TEL}/sessA/1.json`]: seg(['x']),
      [`${TEL}/sessA/1.logs.jsonl`]: logsRec[0],
      [`${TEL}/sessA/1.metrics.jsonl`]: metricsRec[0],
      [`${TEL}/sessA/2.json`]: seg(['x']),
      [`${TEL}/sessA/2.logs.jsonl`]: logsRec[1],
      [`${TEL}/sessA/2.metrics.jsonl`]: metricsRec[1],
    };
    const { deps, git } = makeDeps(files, {
      [TEL]: ['sessA'],
      [`${TEL}/sessA`]: [
        '1.json',
        '1.logs.jsonl',
        '1.metrics.jsonl',
        '2.json',
        '2.logs.jsonl',
        '2.metrics.jsonl',
      ],
    });
    const r = syncTelemetry(deps);
    expect(r.ok).toBe(true);

    // RAW BYTE equality — the rolled blob is EXACTLY the per-seq records with each
    // trailing newline collapsed to one, joined by \n, final \n. NOT `splitJsonl`
    // (which trims per line and would MASK a re-encode — the F1 laundering-vacuity
    // the old assertion had). Re-apply the reviewer's parse+re-stringify mutation in
    // `concatJsonl` → both these assertions go RED (the opaque fixtures canonicalize).
    const rawExpect = (recs: readonly string[]): string =>
      `${recs.map((s) => s.replace(/\n+$/, '')).join('\n')}\n`;
    expect(latestBlob(git, ROLLED_LOGS_NAME) ?? '').toBe(rawExpect(logsRec));
    expect(latestBlob(git, ROLLED_METRICS_NAME) ?? '').toBe(rawExpect(metricsRec));

    // The ONLY new blob is the layout manifest — its keys are layout metadata, never
    // captured event fields (P12: the publication boundary is layout-only).
    const manifest = latestManifest(git);
    expect(manifest).not.toBeNull();
    expect(Object.keys(manifest ?? {}).sort()).toEqual([
      'format',
      'max_seq',
      'session',
      'start_date',
    ]);
  });
});
