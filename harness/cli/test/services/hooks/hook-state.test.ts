import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { ExecGit } from '../../../src/adapters/git/exec-git.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import { NodeHash } from '../../../src/adapters/hash/node-hash.js';
import { CLAIM_KEEP, HookStateStore } from '../../../src/services/hooks/hook-state.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

const REPO = '/repo/alpha';
const HEAD = 'a'.repeat(40);

const store = (fs: FakeFs, token = () => 'tok1') =>
  new HookStateStore(fs, new FakeHash(), '/state', token);

describe('HookStateStore — the PRE record (plan 082 tk-0003)', () => {
  it('writes through a UNIQUE temp file and only then renames — never in place', () => {
    /*
    Test Doc:
    - Why: a POST fire reading a half-written record would classify on nonsense.
      The temp+rename pair is what makes every read see a whole record.
    - Contract: recordPre writes a sibling temp, then renames it onto the target.
    - Quality Contribution: pins the ORDER, not just the end state — an in-place
      write would leave the same final bytes and be wrong.
    */
    const fs = new FakeFs();
    expect(
      store(fs).recordPre(REPO, { head: HEAD, index: 'clean', recordedAt: 'T0', command: null }),
    ).toBe(true);

    // The write landed on the temp path; the target was reached only by rename.
    expect(fs.writes.some((p) => p.endsWith('.tok1.tmp'))).toBe(true);
    expect(fs.writes.some((p) => p.endsWith('.json'))).toBe(false);
    expect(fs.renames).toHaveLength(1);
    const [from, to] = fs.renames[0].split('->');
    expect(from).toMatch(/\.tok1\.tmp$/);
    expect(to).toMatch(/\.json$/);
    expect(fs.mkdirs).toContain('/state');
  });

  it('round-trips the index state — the value POST actually decides on', () => {
    const fs = new FakeFs();
    store(fs).recordPre(REPO, {
      head: HEAD,
      index: 'already-staged',
      recordedAt: 'T0',
      command: null,
    });

    const read = store(fs).readPre(REPO);
    expect(read).toEqual({
      status: 'ok',
      record: { head: HEAD, index: 'already-staged', recordedAt: 'T0', command: null },
    });
  });

  it('gives two racing fires DIFFERENT temp paths, so neither can corrupt the other', () => {
    // The temp name carries a per-fire token. Sharing one temp name would let the
    // slower writer's partial bytes be renamed into place by the faster one.
    const fs = new FakeFs();
    store(fs, () => 'fire-A').recordPre(REPO, {
      head: HEAD,
      index: 'clean',
      recordedAt: 'T0',
      command: null,
    });
    store(fs, () => 'fire-B').recordPre(REPO, {
      head: HEAD,
      index: 'clean',
      recordedAt: 'T1',
      command: null,
    });

    const temps = fs.writes.filter((p) => p.endsWith('.tmp'));
    expect(new Set(temps).size).toBe(temps.length);
    expect(temps).toHaveLength(2);
  });

  it('keeps an unborn HEAD as null rather than inventing a sha', () => {
    const fs = new FakeFs();
    store(fs).recordPre(REPO, { head: null, index: 'clean', recordedAt: 'T0', command: null });
    expect(store(fs).readPre(REPO)).toEqual({
      status: 'ok',
      record: { head: null, index: 'clean', recordedAt: 'T0', command: null },
    });
  });

  it('separates ABSENT from UNREADABLE, and never defaults a broken record into a valid one', () => {
    const fs = new FakeFs();
    expect(store(fs).readPre(REPO)).toEqual({ status: 'absent' });

    const path = `/state/${new FakeHash().sha256Hex(REPO).slice(0, 32)}.json`;
    for (const bad of [
      '{ not json',
      '"a string"',
      '{"head":"x"}',
      '{"head":"x","index":"nope","recordedAt":"T"}',
    ]) {
      fs.writeText(path, bad);
      expect(store(fs).readPre(REPO)).toEqual({ status: 'unreadable' });
    }
  });

  it('reports a failed write instead of throwing into the agent it observes', () => {
    const fs = new FakeFs();
    fs.rename = () => {
      throw new Error('disk full');
    };
    expect(
      store(fs).recordPre(REPO, { head: HEAD, index: 'clean', recordedAt: 'T0', command: null }),
    ).toBe(false);
  });
});

describe('HookStateStore — the exclusive transition claim (plan 082 tk-0003)', () => {
  it('lets exactly ONE of two racing claims win', () => {
    /*
    Test Doc:
    - Why: two POST fires on the same commit would both read the same prior state
      and both emit, giving the collector two sessions for one commit. A
      read-then-write pair cannot prevent that; the window between them IS the bug.
    - Contract: claimTransition returns true once per (repo, head) and false after.
    */
    const fs = new FakeFs();
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(true);
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(false);
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(false);
  });

  it('claims per COMMIT, not per invocation — the next commit gets its own claim', () => {
    const fs = new FakeFs();
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(true);
    expect(store(fs).claimTransition(REPO, 'b'.repeat(40))).toBe(true);
  });

  it('keeps repositories independent', () => {
    const fs = new FakeFs();
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(true);
    expect(store(fs).claimTransition('/repo/beta', HEAD)).toBe(true);
  });

  it('prunes its OWN old markers so the state dir cannot grow without bound', () => {
    /*
    Test Doc:
    - Why: one marker per commit, never removed, is unbounded growth in a hidden
      directory. When it eventually meets an inode/quota limit, createExclusive
      starts returning false — which means "someone else won" — so the guard fails
      closed and SILENTLY STOPS EMITTING while still exiting 0. A cap turns an
      eventual silent outage into a bounded directory.
    - Contract: after N > CLAIM_KEEP claims, exactly the newest CLAIM_KEEP survive.
    - Quality Contribution: asserts the IDENTITY of the survivors, not a total file
      count — a count could be satisfied by unrelated cleanup, or by deleting the
      WRONG markers (which would let a re-fire re-claim and double-emit).
    */
    const fs = new FakeFs();
    const heads = Array.from({ length: CLAIM_KEEP + 10 }, (_, i) =>
      i.toString(16).padStart(40, '0'),
    );
    for (const head of heads) expect(store(fs).claimTransition(REPO, head)).toBe(true);

    const prefix = new FakeHash().sha256Hex(REPO).slice(0, 32);
    const survivors = (fs.listRegularFilesNoFollow('/state') ?? []).filter(
      (n) => n.startsWith(prefix) && n.endsWith('.claim'),
    );
    // The NEWEST CLAIM_KEEP, by identity — the last claims made, in any order.
    expect(new Set(survivors)).toEqual(
      new Set(heads.slice(-CLAIM_KEEP).map((h) => `${prefix}.json.${h}.claim`)),
    );

    // And the pruned ones are genuinely gone, so a re-fire of an OLD transition
    // would re-claim. That is the accepted cost of the cap, stated rather than
    // discovered: the bound is chosen so it cannot happen inside one session.
    expect(survivors).toHaveLength(CLAIM_KEEP);
  });

  it("never prunes ANOTHER repository's markers", () => {
    const fs = new FakeFs();
    expect(store(fs).claimTransition('/repo/beta', HEAD)).toBe(true);
    for (const head of Array.from({ length: CLAIM_KEEP + 5 }, (_, i) =>
      i.toString(16).padStart(40, '0'),
    )) {
      store(fs).claimTransition(REPO, head);
    }
    const betaPrefix = new FakeHash().sha256Hex('/repo/beta').slice(0, 32);
    const betaMarkers = (fs.listRegularFilesNoFollow('/state') ?? []).filter((n) =>
      n.startsWith(betaPrefix),
    );
    expect(betaMarkers).toEqual([`${betaPrefix}.json.${HEAD}.claim`]);
    // Beta's claim is still held — the prune did not silently free it.
    expect(store(fs).claimTransition('/repo/beta', HEAD)).toBe(false);
  });

  it('keeps the claim when pruning fails — a prune miss must not cost an emission', () => {
    const fs = new FakeFs();
    fs.listRegularFilesNoFollow = () => {
      throw new Error('unreadable directory');
    };
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(true);
  });

  it('treats an unestablished claim as LOST, never as won', () => {
    const fs = new FakeFs();
    fs.mkdirp = () => {
      throw new Error('read-only filesystem');
    };
    expect(store(fs).claimTransition(REPO, HEAD)).toBe(false);
  });
});

describe('HookStateStore — against a REAL filesystem and REAL git (plan 082 tk-0003)', () => {
  it('records index-clean vs already-staged, and the value SURVIVES the commit that follows', () => {
    /*
    Test Doc:
    - Why: dw-0003. The whole design rests on the index being readable at PRE and
      the recorded value still being there at POST — after the commit that erases
      the index evidence itself.
    - Contract: an agent edit reaches PRE with a CLEAN index; a squash-merge
      reaches it ALREADY-STAGED; both records survive the commit.
    - Worked Example: git merge --squash side  ->  indexState() === 'already-staged'.
    - Quality Contribution: drives REAL git, so it cannot pass by agreeing with a
      fabricated state.
    */
    const dir = mkdtempSync(join(tmpdir(), 'harness-hookstate-'));
    const repo = join(dir, 'repo');
    const stateDir = join(dir, 'state');
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: hermeticGitEnv() }).trim();
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
      writeFileSync(join(repo, 'a.txt'), 'a\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'base']);

      const fs = new NodeFs();
      let n = 0;
      const real = new HookStateStore(fs, new NodeHash(), stateDir, () => {
        n += 1;
        return `t${n}`;
      });

      // --- The POSITIVE case: an agent edits a file and has staged NOTHING. ---
      writeFileSync(join(repo, 'a.txt'), 'edited by the agent\n');
      const cleanAtPre = new ExecGit(repo).indexState();
      expect(cleanAtPre).toBe('clean');
      expect(
        real.recordPre(repo, {
          head: git(['rev-parse', 'HEAD']),
          index: cleanAtPre,
          recordedAt: 'T0',
        }),
      ).toBe(true);

      git(['add', 'a.txt']);
      git(['commit', '-qm', 'the agent authored this']);

      // The commit has happened. The index is clean again and MERGE_HEAD/SQUASH_MSG
      // do not exist — but the PRE record still carries what was true before it.
      const afterCommit = real.readPre(repo);
      expect(afterCommit.status).toBe('ok');
      if (afterCommit.status !== 'ok') throw new Error('unreachable');
      expect(afterCommit.record.index).toBe('clean');

      // --- A DEFEATER: merge --squash stages content it did not author here. ---
      git(['checkout', '-q', '-b', 'side']);
      writeFileSync(join(repo, 'b.txt'), 'from elsewhere\n');
      git(['add', 'b.txt']);
      git(['commit', '-qm', 'side work']);
      git(['checkout', '-q', 'main']);
      git(['merge', '-q', '--squash', 'side']);

      const stagedAtPre = new ExecGit(repo).indexState();
      expect(stagedAtPre).toBe('already-staged');
      real.recordPre(repo, {
        head: git(['rev-parse', 'HEAD']),
        index: stagedAtPre,
        recordedAt: 'T1',
      });
      git(['commit', '-qm', 'squashed in']);

      const afterSquash = real.readPre(repo);
      expect(afterSquash.status).toBe('ok');
      if (afterSquash.status !== 'ok') throw new Error('unreachable');
      expect(afterSquash.record.index).toBe('already-staged');

      // And the evidence a `.git`-state discriminator would have needed is GONE —
      // this is why `.git` state is not a classifier parameter (tk-0004 dw-0006).
      expect(fs.exists(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
      expect(fs.exists(join(repo, '.git', 'SQUASH_MSG'))).toBe(false);

      // The exclusive claim works on a real filesystem, not just in the fake.
      const head = git(['rev-parse', 'HEAD']);
      expect(real.claimTransition(repo, head)).toBe(true);
      expect(real.claimTransition(repo, head)).toBe(false);

      // And the prune bounds a REAL directory. Only the BOUND is asserted here,
      // not which markers survive: real mtimes have millisecond resolution, so 55
      // creates inside one millisecond can tie and the survivor set is then
      // genuinely arbitrary. Identity is pinned in the FakeFs test above, where
      // the ordering is deterministic — asserting it here would be a flake.
      for (const n of Array.from({ length: CLAIM_KEEP + 5 }, (_, i) =>
        i.toString(16).padStart(40, '0'),
      )) {
        real.claimTransition(repo, n);
      }
      const onDisk = (fs.listRegularFilesNoFollow(stateDir) ?? []).filter((n) =>
        n.endsWith('.claim'),
      );
      expect(onDisk).toHaveLength(CLAIM_KEEP);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
