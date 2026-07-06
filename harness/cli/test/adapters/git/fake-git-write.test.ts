import { describe, expect, it } from 'vitest';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';

/** A representative shard ref — the GitWritePort contract is ref-agnostic, so any concrete ref exercises it. */
const TELEMETRY_REF = telemetryRefFor('2026/03/23', 'sessA');

/**
 * T001 (plan 034 Phase 4 · 4.1 · AC-07/13) — the GitWritePort plumbing contract,
 * exercised through the test double the sync-service will use. Pins: the orphan
 * commit shape (parent null on first write, prior tip on append), the
 * compare-and-set updateRef + ff-retry race, the rollback (deleteRef), the
 * push-failure path, and the load-bearing §T1 governance fact — author AND
 * committer are the NON-INDIVIDUAL identity, never a parameter, never an email a
 * caller could swap for an engineer's. Tests-first → T002.
 */

describe('FakeGitWrite — GitWritePort plumbing contract', () => {
  it('records each plumbing call in order', () => {
    const g = new FakeGitWrite();
    const b1 = g.hashObject('{"a":1}\n');
    const b2 = g.hashObject('{"b":2}\n');
    const tree = g.mktree([
      { mode: '100644', type: 'blob', sha: b1, name: '1.json' },
      { mode: '100644', type: 'blob', sha: b2, name: '2.json' },
    ]);
    const parent = g.refTip(TELEMETRY_REF);
    const commit = g.commitTree(tree, parent, 'telemetry: flush 2 segments');
    const ok = g.updateRef(TELEMETRY_REF, commit, parent);
    g.push(`${TELEMETRY_REF}:${TELEMETRY_REF}`);

    expect(g.calls).toEqual([
      'hashObject',
      'hashObject',
      'mktree',
      'refTip',
      'commitTree',
      'updateRef',
      'push',
    ]);
    expect(ok).toBe(true);
    expect(g.pushed).toEqual([`${TELEMETRY_REF}:${TELEMETRY_REF}`]);
  });

  it('first write is an orphan (parent null); the next write parents on the prior tip', () => {
    const g = new FakeGitWrite();
    // First flush — no prior tip.
    expect(g.refTip(TELEMETRY_REF)).toBeNull();
    const c1 = g.commitTree('tree1', null, 'flush 1');
    expect(g.updateRef(TELEMETRY_REF, c1, null)).toBe(true);
    expect(g.commits[0].parent).toBeNull();

    // Second flush — parents on c1.
    const tip = g.refTip(TELEMETRY_REF);
    expect(tip).toBe(c1);
    const c2 = g.commitTree('tree2', tip, 'flush 2');
    expect(g.updateRef(TELEMETRY_REF, c2, tip)).toBe(true);
    expect(g.commits[1].parent).toBe(c1);
    expect(g.refTip(TELEMETRY_REF)).toBe(c2);
  });

  it('updateRef is compare-and-set: false on a stale oldSha, true on a match', () => {
    const g = new FakeGitWrite({ [TELEMETRY_REF]: 'abc' });
    expect(g.updateRef(TELEMETRY_REF, 'def', null)).toBe(false); // stale: tip is abc, not null
    expect(g.refTip(TELEMETRY_REF)).toBe('abc'); // unchanged
    expect(g.updateRef(TELEMETRY_REF, 'def', 'abc')).toBe(true); // match
    expect(g.refTip(TELEMETRY_REF)).toBe('def');
  });

  it('simulates a concurrent-writer race (ff-retry): first updateRef loses, a re-read + retry wins', () => {
    const g = new FakeGitWrite();
    g.staleOnce = true; // a concurrent writer moves the tip out from under the first CAS

    // First attempt: parent we saw was null; the race makes the CAS fail.
    const firstParent = g.refTip(TELEMETRY_REF); // null
    const c1 = g.commitTree('tree1', firstParent, 'flush');
    expect(g.updateRef(TELEMETRY_REF, c1, firstParent)).toBe(false);

    // Retry: re-read the (now moved) tip, re-commit on it, CAS again → wins.
    const retryParent = g.refTip(TELEMETRY_REF);
    expect(retryParent).not.toBe(firstParent); // the tip moved
    const c2 = g.commitTree('tree2', retryParent, 'flush');
    expect(g.updateRef(TELEMETRY_REF, c2, retryParent)).toBe(true);
    expect(g.refTip(TELEMETRY_REF)).toBe(c2);
  });

  it('deleteRef rolls the ref away (orphan rollback when a first push fails)', () => {
    const g = new FakeGitWrite();
    const c1 = g.commitTree('tree1', null, 'flush');
    g.updateRef(TELEMETRY_REF, c1, null);
    expect(g.refTip(TELEMETRY_REF)).toBe(c1);
    g.deleteRef(TELEMETRY_REF);
    expect(g.refTip(TELEMETRY_REF)).toBeNull();
  });

  it('push throws when configured to fail (the offline-safe path the service must catch)', () => {
    const g = new FakeGitWrite();
    g.failPush = true;
    expect(() => g.push(`${TELEMETRY_REF}:${TELEMETRY_REF}`)).toThrow();
    expect(g.pushed).toEqual([]); // nothing recorded as pushed
  });

  it('attribution: every commit author AND committer is the contributor identity', () => {
    const engineer = { name: 'Jordan Knight', email: 'jordan@example.com' };
    const g = new FakeGitWrite({}, engineer);
    g.commitTree('tree1', null, 'flush');

    const { author, committer } = g.commits[0];
    for (const identity of [author, committer]) {
      expect(identity).toEqual(engineer); // attributable to who pushed it
    }
  });

  it('attribution: defaults to a representative engineer identity when none is given', () => {
    const g = new FakeGitWrite();
    g.commitTree('tree1', null, 'flush');
    expect(g.commits[0].author.email).toBe('engineer@example.com');
    expect(g.commits[0].committer.email).toBe('engineer@example.com');
  });
});

/**
 * T001 (plan 049 Phase 1) — the additive migration capability on the write port:
 * `lsRemoteTelemetryRefs` (the ONE sanctioned remote read), `fetchRef`,
 * `deleteRemoteRef`, plus the `refTreeOverride` TOCTOU seam. Fakes RECORD every call
 * (enables the AC-03 zero-fetch proof by exclusion) and model a mutable remote set.
 */
describe('FakeGitWrite — migration capability (plan 049 T001)', () => {
  it('lsRemoteTelemetryRefs reports the seeded remote set and records the call', () => {
    const remote = [telemetryRefFor('2026/06/24', 's1'), telemetryRefFor('2026/06/25', 's2')];
    const g = new FakeGitWrite().seedRemoteTelemetryRefs(remote);
    expect(g.lsRemoteTelemetryRefs()).toEqual(remote);
    expect(g.calls).toEqual(['lsRemoteTelemetryRefs']);
  });

  it('fetchRef records the fetched ref (no local mutation — the read port sees fetched refs)', () => {
    const g = new FakeGitWrite();
    g.fetchRef(TELEMETRY_REF);
    expect(g.fetched).toEqual([TELEMETRY_REF]);
    expect(g.calls).toEqual(['fetchRef']);
  });

  it('deleteRemoteRef records the delete and removes the ref from the remote set', () => {
    const a = telemetryRefFor('2026/06/24', 's1');
    const b = telemetryRefFor('2026/06/25', 's2');
    const g = new FakeGitWrite().seedRemoteTelemetryRefs([a, b]);
    g.deleteRemoteRef(a);
    expect(g.deletedRemote).toEqual([a]);
    expect(g.lsRemoteTelemetryRefs()).toEqual([b]); // a is gone from the remote
  });

  it('refTreeOverride models a racing forced push — refTree diverges, refTip/writes do not', () => {
    const g = new FakeGitWrite();
    const commit = g.commitTree('our-tree', null, 'roll');
    g.updateRef(TELEMETRY_REF, commit, null);
    expect(g.refTree(TELEMETRY_REF)).toBe('our-tree');
    expect(g.refTip(TELEMETRY_REF)).toBe(commit);
    // A racer overwrote the ref's CONTENT (TOCTOU seam) — refTree diverges…
    g.refTreeOverride.set(TELEMETRY_REF, 'racer-tree');
    expect(g.refTree(TELEMETRY_REF)).toBe('racer-tree');
    // …but the tip (identity of our write) is untouched.
    expect(g.refTip(TELEMETRY_REF)).toBe(commit);
  });

  it('lsRemoteTelemetryRefs throws when the transport is down (failPush), so a migration can defer', () => {
    const g = new FakeGitWrite().seedRemoteTelemetryRefs([TELEMETRY_REF]);
    g.failPush = true;
    expect(() => g.lsRemoteTelemetryRefs()).toThrow();
  });

  it('readRefTree lifts a written ref tree back to its flat blobs (the T007 union source)', () => {
    // The rolled writer reads the ref's OWN tree (local, fetch-free) to rebuild the
    // whole-session tip after the buffer is pruned — assert the fake round-trips a
    // written tree to name+bytes, and returns null for a ref that does not exist.
    const g = new FakeGitWrite();
    expect(g.readRefTree(TELEMETRY_REF)).toBeNull(); // absent ref → null (fresh session)

    const logs = g.hashObject('{"resourceLogs":[{"seq":1}]}\n');
    const manifest = g.hashObject(
      '{"format":"x","session":"sessA","start_date":"2026/03/23","max_seq":1}\n',
    );
    const tree = g.mktree([
      { mode: '100644', type: 'blob', sha: logs, name: 'session.logs.jsonl' },
      { mode: '100644', type: 'blob', sha: manifest, name: 'manifest.json' },
    ]);
    const commit = g.commitTree(tree, null, 'roll');
    g.updateRef(TELEMETRY_REF, commit, null);

    expect(g.readRefTree(TELEMETRY_REF)).toEqual([
      { name: 'session.logs.jsonl', content: '{"resourceLogs":[{"seq":1}]}\n' },
      {
        name: 'manifest.json',
        content: '{"format":"x","session":"sessA","start_date":"2026/03/23","max_seq":1}\n',
      },
    ]);
    expect(g.calls).toContain('readRefTree');
  });
});
