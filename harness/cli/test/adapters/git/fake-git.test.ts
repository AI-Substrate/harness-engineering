import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExecGit } from '../../../src/adapters/git/exec-git.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';

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
    const git = (cwd: string, args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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
