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
});

describe('ExecGit', () => {
  it('reports the real repo as a work tree with a branch', () => {
    // This suite runs inside the project's own git repo.
    const git = new ExecGit();
    expect(git.isRepo()).toBe(true);
    expect(typeof git.currentBranch()).toBe('string');
  });
});
