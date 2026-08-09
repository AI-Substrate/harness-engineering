import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExecGit } from '../../../src/adapters/git/exec-git.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

describe('FakeGit', () => {
  it('given_seeded_state_when_queried_then_returns_state_and_records_calls', () => {
    /*
    Test Doc:
    - Why: doctor reports branch context; tests must not shell out to real git.
    - Contract: FakeGit returns the seeded isRepo/branch and records each method on calls[].
    - Usage Notes: construct with {isRepo, branch}; assert on `calls`.
    - Quality Contribution: keeps the doctor service test free of real git process calls.
    - Worked Example: new FakeGit({isRepo:true, branch:'main'}).currentBranch() === 'main'.
    */
    const git = new FakeGit({ isRepo: true, branch: 'feat/x' });
    expect(git.isRepo()).toBe(true);
    expect(git.currentBranch()).toBe('feat/x');
    expect(git.calls).toEqual(['isRepo', 'currentBranch']);
  });

  it('defaults to not-a-repo / null branch when unseeded', () => {
    const git = new FakeGit();
    expect(git.isRepo()).toBe(false);
    expect(git.currentBranch()).toBeNull();
  });

  it('returns a normalized seeded current commit and records the call', () => {
    const git = new FakeGit({ currentCommit: 'A'.repeat(40) });
    expect(git.currentCommit()).toBe('a'.repeat(40));
    expect(git.calls).toEqual(['currentCommit']);
    expect(new FakeGit({ currentCommit: 'not-an-oid' }).currentCommit()).toBeNull();
    expect(new FakeGit().currentCommit()).toBeNull();
  });

  it('returns the seeded remoteUrl (→ provenance `repo`), null when unseeded, and records the call', () => {
    // Why: the provenance header's `repo` key comes from GitPort.remoteUrl(); the
    // service must be unit-testable without a real `origin` remote.
    const withRemote = new FakeGit({
      isRepo: true,
      branch: 'main',
      remoteUrl: 'git@github.com:AI-Substrate/harness-engineering.git',
    });
    expect(withRemote.remoteUrl()).toBe('git@github.com:AI-Substrate/harness-engineering.git');
    expect(withRemote.calls).toContain('remoteUrl');

    // A repo with a branch but no seeded remote → null (no remote configured).
    expect(new FakeGit({ isRepo: true, branch: 'main' }).remoteUrl()).toBeNull();
    // Not-a-repo (unseeded) → null.
    expect(new FakeGit().remoteUrl()).toBeNull();
  });
});

describe('FakeGit — bounded known-worktree roots (P063 T003)', () => {
  it('dedupes roots in stable first-seen order and records one bounded query', () => {
    const git = new FakeGit({
      worktreeRoots: ['/repo/main', '/repo/worktrees/b', '/repo/main', '/repo/worktrees/a'],
    });

    expect(git.knownWorktreeRoots(3)).toEqual({
      status: 'ok',
      roots: ['/repo/main', '/repo/worktrees/b', '/repo/worktrees/a'],
    });
    expect(git.calls).toEqual(['knownWorktreeRoots:3']);
  });

  it('fails closed when the unique-root bound is exceeded instead of truncating', () => {
    const git = new FakeGit({
      worktreeRoots: ['/repo/main', '/repo/worktrees/a', '/repo/worktrees/b'],
    });

    expect(git.knownWorktreeRoots(2)).toEqual({
      status: 'unavailable',
      reason: 'too-many',
    });
  });

  it('models malformed porcelain as a typed unavailable result', () => {
    const git = new FakeGit({ worktreeFailure: 'malformed' });
    expect(git.knownWorktreeRoots(8)).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    });
  });
});

describe('ExecGit', () => {
  it('reports the real repo as a work tree with a string-or-null branch', () => {
    // This suite runs inside the project's own git repo. currentBranch() is
    // null under detached HEAD (common in CI/packaging checkouts) — accept both;
    // the null contract is covered explicitly by the FakeGit case above.
    const git = new ExecGit();
    expect(git.isRepo()).toBe(true);
    const branch = git.currentBranch();
    expect(branch === null || typeof branch === 'string').toBe(true);
  });

  it('reports the current product commit as a lowercase full OID', () => {
    expect(new ExecGit().currentCommit()).toMatch(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
  });

  it('handles no-repo, unborn, and detached repositories without guessing provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-current-commit-'));
    // Shared hermetic env: no ambient GIT_CONFIG_*, no global/system config, and
    // trace2 off so an installed git-ai daemon cannot write refs into this
    // throwaway repo while the provenance assertions below are running.
    const git = (cwd: string, args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8', env: hermeticGitEnv() }).trim();
    try {
      expect(new ExecGit(dir).currentCommit()).toBeNull();

      git(dir, ['init', '-q']);
      expect(new ExecGit(dir).currentCommit()).toBeNull();

      git(dir, ['config', 'user.name', 'Harness Test']);
      git(dir, ['config', 'user.email', 'harness@example.invalid']);
      writeFileSync(join(dir, 'a.txt'), 'a\n');
      git(dir, ['add', 'a.txt']);
      git(dir, ['commit', '-qm', 'seed']);
      const oid = git(dir, ['rev-parse', 'HEAD']).toLowerCase();
      git(dir, ['checkout', '-q', '--detach', oid]);
      expect(new ExecGit(dir).currentCommit()).toBe(oid);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the origin remote URL as a string, or null when there is none', () => {
    // Real `git remote get-url origin`: this repo usually has an origin, but
    // detached/remote-less checkouts (CI/packaging) legitimately return null —
    // accept both; the null contract is pinned deterministically by FakeGit above.
    const url = new ExecGit().remoteUrl();
    expect(url === null || typeof url === 'string').toBe(true);
  });
});

describe('FakeGit — the reflog read (plan 082 tk-0002)', () => {
  const SHA = 'a'.repeat(40);

  it('returns the seeded entries newest-first, bounded by `limit`, and records the query', () => {
    const git = new FakeGit({
      reflog: [
        { sha: SHA, selector: 'HEAD@{0}', subject: 'commit: newest' },
        { sha: 'b'.repeat(40), selector: 'HEAD@{1}', subject: 'pull: Fast-forward' },
      ],
    });

    expect(git.readReflog('HEAD', 1)).toEqual({
      status: 'ok',
      entries: [{ sha: SHA, selector: 'HEAD@{0}', subject: 'commit: newest' }],
    });
    expect(git.calls).toEqual(['readReflog:HEAD:1']);
  });

  it('models an existing ref with NO reflog as ok-and-empty, not as a failure', () => {
    // The unseeded default has to be the honest case: git exits 0 with empty
    // output there, and a guard that read this as a failure would refuse to act
    // on a repository that is merely young.
    expect(new FakeGit().readReflog('HEAD', 5)).toEqual({ status: 'ok', entries: [] });
  });

  it.each([
    'unreadable',
    'malformed',
    'bad-limit',
  ] as const)('models a %s read as a typed unavailable result', (reason) => {
    expect(new FakeGit({ reflogFailure: reason }).readReflog('HEAD', 5)).toEqual({
      status: 'unavailable',
      reason,
    });
  });

  it('rejects a non-positive limit ahead of any seeded failure', () => {
    expect(new FakeGit({ reflog: [] }).readReflog('HEAD', 0)).toEqual({
      status: 'unavailable',
      reason: 'bad-limit',
    });
  });
});

describe('ExecGit — the reflog read against REAL git (plan 082 tk-0002)', () => {
  it('reads real reflog subjects, including the squash-merge that reads as an authored commit', () => {
    /*
    Test Doc:
    - Why: the commit guard has to tell "authored here" from "HEAD moved for another
      reason", and the reflog SUBJECT is the discriminator that separates a
      fast-forward pull, cherry-pick, revert and amend from a real commit. A fake
      alone would only prove we can echo strings we invented; this proves the
      adapter reads what git actually writes.
    - Contract: readReflog(ref, limit) returns the newest `limit` entries, newest
      first, each carrying the FULL `%gs` subject.
    - Worked Example: after `merge --squash` + commit, HEAD@{0} reads `commit: <msg>`.
    - Quality Contribution: pins the ONE measured fact the guard must be designed
      around — a squash-merge is BYTE-IDENTICAL to an authored commit on subject
      (and on parent count), so the subject is a hard limit, not a total answer.
    */
    const dir = mkdtempSync(join(tmpdir(), 'harness-reflog-'));
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: hermeticGitEnv() }).trim();
    try {
      // Not a repository yet → a failed read, distinct from an empty one.
      expect(new ExecGit(dir).readReflog('HEAD', 1)).toEqual({
        status: 'unavailable',
        reason: 'unreadable',
      });

      git(['init', '-q', '-b', 'main']);
      // An unborn HEAD cannot be read either — also `unreadable`, never `ok: []`.
      expect(new ExecGit(dir).readReflog('HEAD', 1)).toEqual({
        status: 'unavailable',
        reason: 'unreadable',
      });

      writeFileSync(join(dir, 'a.txt'), 'a\n');
      git(['add', 'a.txt']);
      git(['commit', '-qm', 'seed: the first thing']);

      const authored = new ExecGit(dir).readReflog('HEAD', 1);
      expect(authored.status).toBe('ok');
      if (authored.status !== 'ok') throw new Error('unreachable');
      // The subject is whole — a whitespace split would have cut this to `commit`.
      expect(authored.entries[0].subject).toBe('commit (initial): seed: the first thing');
      expect(authored.entries[0].selector).toBe('HEAD@{0}');
      expect(authored.entries[0].sha).toBe(git(['rev-parse', 'HEAD']).toLowerCase());

      // A squash-merge: one parent, first parent IS the previous HEAD, and — the
      // measured point — a reflog subject byte-identical to an authored commit.
      git(['checkout', '-q', '-b', 'side']);
      writeFileSync(join(dir, 'b.txt'), 'b\n');
      git(['add', 'b.txt']);
      git(['commit', '-qm', 'side work']);
      git(['checkout', '-q', 'main']);
      git(['merge', '-q', '--squash', 'side']);
      git(['commit', '-qm', 'squashed in']);

      const squashed = new ExecGit(dir).readReflog('HEAD', 3);
      expect(squashed.status).toBe('ok');
      if (squashed.status !== 'ok') throw new Error('unreachable');
      expect(squashed.entries).toHaveLength(3);
      expect(squashed.entries[0].subject).toBe('commit: squashed in');
      // One parent, exactly like an authored commit — so parent-count cannot
      // separate them either. Recorded here so the guard is never designed as if
      // it could.
      expect(git(['rev-list', '--parents', '-1', 'HEAD']).split(' ')).toHaveLength(2);

      // `-n` is honoured: newest-first, bounded.
      const one = new ExecGit(dir).readReflog('HEAD', 1);
      expect(one).toEqual({
        status: 'ok',
        entries: [squashed.entries[0]],
      });

      expect(new ExecGit(dir).readReflog('refs/heads/nope', 1)).toEqual({
        status: 'unavailable',
        reason: 'unreadable',
      });
      expect(new ExecGit(dir).readReflog('HEAD', 0)).toEqual({
        status: 'unavailable',
        reason: 'bad-limit',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
