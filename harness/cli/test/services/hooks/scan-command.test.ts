import { describe, expect, it } from 'vitest';
import { commandSegments, scanCommand } from '../../../src/services/hooks/scan-command.js';

/**
 * The command scan (plan 082 tk-000d) — the second guard layer.
 *
 * The load-bearing case is SEGMENTATION. The defeater and the commit are
 * different segments of ONE command line, so a scan that inspects only the first
 * token misses every real instance — which is the shape the captured Cursor
 * payloads actually contain.
 */
describe('commandSegments — the defeater is not the first token (dw-001e)', () => {
  it.each([
    ['&&', 'git merge --squash side && git commit -m x'],
    ['||', 'git merge --squash side || git commit -m x'],
    [';', 'git merge --squash side ; git commit -m x'],
    ['a newline', 'git merge --squash side\ngit commit -m x'],
    ['a pipe', 'git merge --squash side | tee log'],
  ])('splits on %s', (_name, command) => {
    expect(commandSegments(command).length).toBeGreaterThan(1);
  });

  it('drops empty segments rather than emitting blanks', () => {
    expect(commandSegments('  git status  &&&&  ')).toEqual(['git status']);
  });
});

describe('scanCommand — content-importing operations (dw-001e)', () => {
  it('refuses the MEASURED Cursor shape when the verb is an import', () => {
    /*
    Test Doc:
    - Why: parsing 76 captured Cursor PRE payloads showed the agent chaining
      `git add -A && git commit …` in ONE Shell tool call. `git merge --squash X &&
      git commit -m …` is the same sentence with a different verb, and it reaches
      PRE with a CLEAN index — so index-at-PRE cannot see it and only this can.
    - Contract: any segment naming an importing subcommand marks the whole bracket.
    - Quality Contribution: a first-token scan passes this string; this test is the
      reason the scanner is segment-aware.
    */
    expect(scanCommand('git merge --squash side && git commit -m "squashed in"')).toBe(
      'imports-content',
    );
  });

  it('passes the captured AUTHORING shape, verbatim, so the guard is not just "always silent"', () => {
    // The literal line from the capture. If this scanned as an import, the feature
    // would emit nothing at all and every silence row would pass for the wrong reason.
    expect(
      scanCommand(
        'git add -A && git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "a real change"',
      ),
    ).toBe('authors-only');
  });

  it.each([
    ['merge', 'git merge side && git commit -m x'],
    ['merge --squash', 'git merge --squash side && git commit -m x'],
    ['cherry-pick -n', 'git cherry-pick -n abc123 && git commit -m x'],
    ['revert -n', 'git revert -n HEAD && git commit -m x'],
    ['am', 'git am < patch.mbox'],
    ['apply', 'git apply --index p.patch && git commit -m x'],
    ['rebase', 'git rebase main'],
    ['read-tree', 'git read-tree -m -u HEAD side && git commit -m x'],
    ['subtree', 'git subtree add --prefix=vendor repo main'],
    ['stash pop', 'git stash pop && git commit -m x'],
    ['stash apply', 'git stash apply && git commit -m x'],
    ['pull', 'git pull --ff-only'],
    ['checkout with a pathspec', 'git checkout side -- s.txt && git commit -m x'],
    ['restore --source', 'git restore --source side --staged -- s.txt && git commit -m x'],
    ['reset to another ref', 'git reset --soft HEAD~2 && git commit -m x'],
    ['a git invoked by absolute path', '/usr/bin/git cherry-pick -n abc && git commit -m x'],
    ['git with global options first', 'git -C /repo -c user.name=x merge --squash side'],
  ])('marks %s as importing content', (_name, command) => {
    expect(scanCommand(command)).toBe('imports-content');
  });

  it.each([
    ['a plain commit', 'git commit -m "a change"'],
    ['add then commit', 'git add -A && git commit -m "a change"'],
    [
      'checkout -b (authors nothing, imports nothing)',
      'git checkout -b feature && git commit -m x',
    ],
    ['a bare stash push', 'git stash && git commit -m x'],
    ['a bare reset (unstage)', 'git reset && git commit -m x'],
    ['a bare restore', 'git restore file.txt'],
    ['status and log', 'git status && git log --oneline -3'],
    ['a non-git command', 'npm test && echo done'],
  ])('leaves %s as authors-only', (_name, command) => {
    expect(scanCommand(command)).toBe('authors-only');
  });

  it('does not let a commit MESSAGE mentioning a verb silence a real commit', () => {
    // `merge`/`rebase` here are ARGUMENTS to commit, not subcommands. Matching them
    // would silence ordinary commits whose messages describe merge or rebase work —
    // the same class of bug as substring-matching the reflog subject.
    expect(scanCommand('git commit -m "merge the config files"')).toBe('authors-only');
    expect(scanCommand('git commit -m "notes on rebase and cherry-pick"')).toBe('authors-only');
    expect(scanCommand('git add -A && git commit -m "revert the colour change by hand"')).toBe(
      'authors-only',
    );
  });

  it('sees through quoting around the subcommand', () => {
    expect(scanCommand('git "merge" --squash side')).toBe('imports-content');
  });

  it('ABSTAINS when there is no command — never reads absence as an all-clear', () => {
    /*
    Test Doc:
    - Why: `unavailable` must not silence (a client that sends no command would
      switch the whole feature off) and must not approve (an unread payload is not
      evidence). It abstains, and the other layers decide.
    - Contract: null, undefined and blank all read `unavailable`.
    */
    expect(scanCommand(null)).toBe('unavailable');
    expect(scanCommand(undefined)).toBe('unavailable');
    expect(scanCommand('   ')).toBe('unavailable');
  });
});
