import { describe, expect, it } from 'vitest';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { TELEMETRY_AUTHOR, telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';

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

  it('§T1: every commit author AND committer is the non-individual identity, never a parameter', () => {
    const g = new FakeGitWrite();
    const engineerEmail = 'jordan@example.com'; // what a per-individual impl would leak
    g.commitTree('tree1', null, 'flush');

    const { author, committer } = g.commits[0];
    for (const identity of [author, committer]) {
      expect(identity.name).toBe('harness-telemetry');
      expect(identity.email).toBe('noreply@anthropic.com');
      expect(identity.email).not.toBe(engineerEmail);
      // The exported constant is the single source of truth — no call site supplies an identity.
      expect(identity).toEqual(TELEMETRY_AUTHOR);
    }
    expect(TELEMETRY_AUTHOR.email).toBe('noreply@anthropic.com');
  });
});
