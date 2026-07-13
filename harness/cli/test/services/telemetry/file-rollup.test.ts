import { describe, expect, it } from 'vitest';
import type { Event } from '../../../src/services/telemetry/events.js';
import { computeAuthorship, computeRollup } from '../../../src/services/telemetry/rollup.js';

/**
 * plan 056 · T007 — `file` events are EXCLUDED from rollup gap/wall/stage math
 * (AC-06 — a capture-time snapshot must not re-sort into activity timing), and the
 * derived {@link computeAuthorship} aggregate is a pure function of the stream.
 */

const work: Event[] = [
  { t: '2026-07-07T09:00:00Z', kind: 'prompt', words: 5 },
  { t: '2026-07-07T09:00:10Z', kind: 'turn', dur_s: 10 },
  { t: '2026-07-07T09:00:20Z', kind: 'tools', name: 'Bash', count: 1, span_s: 0 },
];

const fileEvents: Event[] = [
  // a file event stamped WAY in the past — if it entered gap math it would
  // fabricate a huge idle/agent gap at the front.
  {
    t: '2026-07-07T08:00:00Z',
    kind: 'file',
    path: 'src/a.ts',
    change: 'written',
    delta: { lines_added: 10, lines_removed: 0, bytes_added: 100, bytes_removed: 0 },
  },
  {
    t: '2026-07-07T09:00:15Z',
    kind: 'file',
    path: 'src/a.ts',
    change: 'edited',
    delta: { lines_added: 2, lines_removed: 1, bytes_added: 20, bytes_removed: 8 },
  },
  {
    t: '2026-07-07T09:00:16Z',
    kind: 'file',
    path: 'src/b.ts',
    change: 'edited',
    delta: { lines_added: 3, lines_removed: 3, bytes_added: 30, bytes_removed: 30 },
  },
];

describe('rollup file-event exclusion (T007 · AC-06)', () => {
  it('a stream with file events yields a byte-identical rollup vs without them', () => {
    const withFiles = computeRollup([...work, ...fileEvents]);
    const withoutFiles = computeRollup(work);
    expect(withFiles).toEqual(withoutFiles);
  });

  it('the far-past file event does not corrupt wall_s / agent / idle', () => {
    const r = computeRollup([...work, ...fileEvents]);
    // wall spans only the 20s of real work, not back to 08:00.
    expect(r.activity.wall_s).toBe(20);
  });
});

describe('computeAuthorship (T007)', () => {
  it('folds multiple writes/edits per path into one row (deltas summed)', () => {
    const a = computeAuthorship([...work, ...fileEvents]);
    const fileA = a.files.find((f) => f.path === 'src/a.ts');
    expect(fileA).toEqual({
      path: 'src/a.ts',
      change: 'edited', // latest change wins
      lines_added: 12,
      lines_removed: 1,
      bytes_added: 120,
      bytes_removed: 8,
      events: 2,
    });
  });

  it('totals aggregate across all files (files count + line/byte sums)', () => {
    const a = computeAuthorship(fileEvents);
    expect(a.totals).toEqual({
      files: 2,
      lines_added: 15,
      lines_removed: 4,
      bytes_added: 150,
      bytes_removed: 38,
    });
  });

  it('a stream with no file events yields an empty authorship', () => {
    expect(computeAuthorship(work)).toEqual({
      files: [],
      totals: { files: 0, lines_added: 0, lines_removed: 0, bytes_added: 0, bytes_removed: 0 },
    });
  });
});
