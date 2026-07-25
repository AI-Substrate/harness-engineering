import { describe, expect, it } from 'vitest';
import { parseWorktreePorcelain } from '../../../src/adapters/git/exec-git.js';

const OID = 'a'.repeat(40);

function worktreeRecord(path: string): string {
  return `worktree ${path}\0HEAD ${OID}\0branch refs/heads/main\0\0`;
}

describe('parseWorktreePorcelain — bounded known-worktree roots (P063 T003)', () => {
  it('dedupes paths in stable first-seen order before enforcing the bound', () => {
    const raw = [
      worktreeRecord('/repo/main'),
      worktreeRecord('/repo/worktrees/zeta'),
      worktreeRecord('/repo/main'),
      worktreeRecord('/repo/worktrees/alpha'),
    ].join('');

    expect(parseWorktreePorcelain(raw, 3)).toEqual({
      status: 'ok',
      roots: ['/repo/main', '/repo/worktrees/zeta', '/repo/worktrees/alpha'],
    });
  });

  it('fails closed instead of truncating or choosing when the unique-root bound is exceeded', () => {
    const raw = [
      worktreeRecord('/repo/main'),
      worktreeRecord('/repo/worktrees/one'),
      worktreeRecord('/repo/worktrees/two'),
    ].join('');

    expect(parseWorktreePorcelain(raw, 2)).toEqual({
      status: 'unavailable',
      reason: 'too-many',
    });
  });

  it.each([
    ['missing worktree field', `HEAD ${OID}\0branch refs/heads/main\0\0`],
    ['empty worktree path', `worktree \0HEAD ${OID}\0\0`],
    ['relative worktree path', `worktree relative/path\0HEAD ${OID}\0\0`],
    ['missing HEAD field', 'worktree /repo/main\0branch refs/heads/main\0\0'],
    ['unterminated record', `worktree /repo/main\0HEAD ${OID}`],
  ])('returns one typed malformed result for %s', (_name, raw) => {
    expect(parseWorktreePorcelain(raw, 8)).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    });
  });
});
