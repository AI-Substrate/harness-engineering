import { describe, expect, it } from 'vitest';
import { computeFileDelta, writtenDelta } from '../../../src/services/telemetry/file-delta.js';

describe('file-delta (plan 056 · T002)', () => {
  it('writtenDelta: a new file is fully added, nothing removed (AC-01)', () => {
    const d = writtenDelta('alpha\nbeta\ngamma\n');
    expect(d).toEqual({
      lines_added: 3,
      lines_removed: 0,
      bytes_added: 'alpha'.length + 'beta'.length + 'gamma'.length,
      bytes_removed: 0,
    });
  });

  it('writtenDelta: empty content → all-zero delta', () => {
    expect(writtenDelta('')).toEqual({
      lines_added: 0,
      lines_removed: 0,
      bytes_added: 0,
      bytes_removed: 0,
    });
  });

  it('computeFileDelta: empty→empty is all-zero', () => {
    expect(computeFileDelta('', '')).toEqual({
      lines_added: 0,
      lines_removed: 0,
      bytes_added: 0,
      bytes_removed: 0,
    });
  });

  it('computeFileDelta: an edit adds AND removes only the changed lines, not the shared anchors (AC-02)', () => {
    // one line changes; the surrounding two lines are unchanged anchors.
    const d = computeFileDelta('a\nb\nc', 'a\nX\nc');
    expect(d.lines_added).toBe(1);
    expect(d.lines_removed).toBe(1);
    expect(d.bytes_added).toBe('X'.length);
    expect(d.bytes_removed).toBe('b'.length);
  });

  it('computeFileDelta: pure additions (grow) count as added, 0 removed', () => {
    const d = computeFileDelta('a\nb', 'a\nb\nc\nd');
    expect(d).toEqual({
      lines_added: 2,
      lines_removed: 0,
      bytes_added: 'c'.length + 'd'.length,
      bytes_removed: 0,
    });
  });

  it('computeFileDelta: pure deletions (shrink) count as removed, 0 added', () => {
    const d = computeFileDelta('a\nb\nc\nd', 'a\nb');
    expect(d).toEqual({
      lines_added: 0,
      lines_removed: 2,
      bytes_added: 0,
      bytes_removed: 'c'.length + 'd'.length,
    });
  });

  it('computeFileDelta: counts UTF-8 bytes, not code units', () => {
    // '€' is 3 UTF-8 bytes.
    const d = computeFileDelta('', '€');
    expect(d.lines_added).toBe(1);
    expect(d.bytes_added).toBe(3);
  });

  it('computeFileDelta: a trailing newline is not an extra empty line', () => {
    expect(computeFileDelta('a\nb\nc\n', 'a\nb\nc')).toEqual({
      lines_added: 0,
      lines_removed: 0,
      bytes_added: 0,
      bytes_removed: 0,
    });
  });

  it('computeFileDelta: identical text is all-zero (unchanged multiset)', () => {
    expect(computeFileDelta('same\ntext\nhere', 'same\ntext\nhere')).toEqual({
      lines_added: 0,
      lines_removed: 0,
      bytes_added: 0,
      bytes_removed: 0,
    });
  });
});
