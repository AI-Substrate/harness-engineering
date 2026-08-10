import { describe, expect, it } from 'vitest';
import {
  parseReflogPorcelain,
  parseWorktreePorcelain,
} from '../../../src/adapters/git/exec-git.js';

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

/**
 * `parseReflogPorcelain` — the framing of the reflog read (plan 082 tk-0002).
 *
 * Driven as a pure function over raw bytes rather than through a repository,
 * because what needs proving is the FRAMING: fields are NUL-separated and a
 * reflog subject may contain spaces, colons and quotes, so a naive whitespace
 * split would cut `commit: fix the thing` down to `commit:` — and `commit:` is
 * precisely the prefix the guard cannot distinguish from a squash-merge on. The
 * subject is the discriminator; a truncated one is a wrong answer that still
 * looks like an answer.
 */
describe('parseReflogPorcelain — the reflog read frames the FULL subject (plan 082 tk-0002)', () => {
  const SHA_A = 'a'.repeat(40);
  const SHA_B = 'b'.repeat(40);
  const record = (sha: string, selector: string, subject: string): string =>
    `${sha}\0${selector}\0${subject}`;

  it('keeps a multi-word subject whole, newest first', () => {
    const raw = `${record(SHA_A, 'HEAD@{0}', 'commit: fix the thing: properly')}\n${record(
      SHA_B,
      'HEAD@{1}',
      'pull: Fast-forward',
    )}\n`;

    expect(parseReflogPorcelain(raw, 5)).toEqual({
      status: 'ok',
      entries: [
        { sha: SHA_A, selector: 'HEAD@{0}', subject: 'commit: fix the thing: properly' },
        { sha: SHA_B, selector: 'HEAD@{1}', subject: 'pull: Fast-forward' },
      ],
    });
  });

  it('reads an existing ref with no reflog as a successful EMPTY answer, never a failure', () => {
    // Verified against real git: `git reflog show HEAD` with .git/logs removed
    // exits 0 with empty output. A caller that cannot tell this from a failed
    // read would report "nothing here" on evidence it never gathered.
    expect(parseReflogPorcelain('', 5)).toEqual({ status: 'ok', entries: [] });
  });

  it('accepts an empty subject — `update-ref` without -m writes one', () => {
    expect(parseReflogPorcelain(`${record(SHA_A, 'HEAD@{0}', '')}\n`, 1)).toEqual({
      status: 'ok',
      entries: [{ sha: SHA_A, selector: 'HEAD@{0}', subject: '' }],
    });
  });

  it('normalises an uppercase OID and accepts a sha256 repository', () => {
    const sha256 = 'c'.repeat(64);
    expect(parseReflogPorcelain(`${record('A'.repeat(40), 'HEAD@{0}', 'commit: x')}\n`, 1)).toEqual(
      {
        status: 'ok',
        entries: [{ sha: SHA_A, selector: 'HEAD@{0}', subject: 'commit: x' }],
      },
    );
    expect(parseReflogPorcelain(`${record(sha256, 'HEAD@{0}', 'commit: x')}\n`, 1)).toEqual({
      status: 'ok',
      entries: [{ sha: sha256, selector: 'HEAD@{0}', subject: 'commit: x' }],
    });
  });

  it.each([
    ['a missing field', `${SHA_A}\0HEAD@{0}\n`],
    ['an extra field', `${SHA_A}\0HEAD@{0}\0commit: x\0stray\n`],
    ['a non-OID sha', `not-an-oid\0HEAD@{0}\0commit: x\n`],
    ['an empty selector', `${SHA_A}\0\0commit: x\n`],
  ])('fails closed on %s rather than yielding a partial list', (_name, raw) => {
    expect(parseReflogPorcelain(raw, 8)).toEqual({ status: 'unavailable', reason: 'malformed' });
  });

  it('refuses when one record is malformed even though the others parse', () => {
    // Fail CLOSED: dropping the bad record silently would shift which entry is
    // "the newest", and the guard reasons about exactly that.
    const raw = `${record(SHA_A, 'HEAD@{0}', 'commit: good')}\nbroken\n`;
    expect(parseReflogPorcelain(raw, 8)).toEqual({ status: 'unavailable', reason: 'malformed' });
  });

  it('refuses when git returned more records than the `-n` bound allowed', () => {
    const raw = `${record(SHA_A, 'HEAD@{0}', 'a')}\n${record(SHA_B, 'HEAD@{1}', 'b')}\n`;
    expect(parseReflogPorcelain(raw, 1)).toEqual({ status: 'unavailable', reason: 'malformed' });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the non-positive-integer limit %s', (limit) => {
    expect(parseReflogPorcelain('', limit)).toEqual({
      status: 'unavailable',
      reason: 'bad-limit',
    });
  });
});
