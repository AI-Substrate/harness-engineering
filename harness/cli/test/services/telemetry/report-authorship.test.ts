import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { buildReport } from '../../../src/services/telemetry/report.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * plan 056 · T008 (AC-08) — `buildReport` surfaces the per-file authorship view
 * (which files agents wrote + deltas), aggregated from the `file` events across
 * every included session. Built from REAL serialized segments via the real combine.
 */

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
): CombineSessionDeps {
  return {
    fs: new FakeFs(files, dirs),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
}

function exportOf(sub: string, segments: object[]): SessionExport {
  const files: Record<string, string> = {};
  const names: string[] = [];
  segments.forEach((s, i) => {
    files[`${tel('/work')}/${sub}/${i}.json`] = JSON.stringify(s);
    names.push(`${i}.json`);
  });
  return combineSession(sub, makeDeps(files, { [`${tel('/work')}/${sub}`]: names }), {
    root: '/work',
  });
}

function seg(events: Event[], over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sessX',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

const fileEvent = (path: string, change: 'written' | 'edited', la: number, lr: number): Event => ({
  t: '2026-06-29T00:00:01Z',
  kind: 'file',
  path,
  change,
  delta: { lines_added: la, lines_removed: lr, bytes_added: la * 10, bytes_removed: lr * 10 },
});

describe('buildReport authorship (T008 · AC-08)', () => {
  it('includes an authorship surface with per-file deltas + totals', () => {
    const exp = exportOf('s1', [
      seg([
        { t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 },
        fileEvent('src/a.ts', 'written', 10, 0),
        fileEvent('src/b.ts', 'edited', 2, 1),
      ]),
    ]);
    const report = buildReport([exp]);
    expect(report.authorship).toBeDefined();
    expect(report.authorship?.totals).toEqual({
      files: 2,
      lines_added: 12,
      lines_removed: 1,
      bytes_added: 120,
      bytes_removed: 10,
    });
    const a = report.authorship?.files.find((f) => f.path === 'src/a.ts');
    expect(a?.change).toBe('written');
    expect(a?.lines_added).toBe(10);
  });

  it('aggregates the same path across multiple sessions', () => {
    const e1 = exportOf('s1', [seg([fileEvent('src/shared.ts', 'edited', 3, 1)])]);
    const e2 = exportOf('s2', [seg([fileEvent('src/shared.ts', 'edited', 4, 2)])]);
    const report = buildReport([e1, e2]);
    const shared = report.authorship?.files.find((f) => f.path === 'src/shared.ts');
    expect(shared?.lines_added).toBe(7);
    expect(shared?.lines_removed).toBe(3);
    expect(shared?.events).toBe(2);
  });

  it('OMITS authorship when no session carried a file event', () => {
    const exp = exportOf('s1', [seg([{ t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 }])]);
    expect(buildReport([exp]).authorship).toBeUndefined();
  });
});

/**
 * Plan 068 item 3 — a harness that records WHICH files were touched but exposes no
 * per-file payload (a `files.written`/`files.edited` path list with no `file` event
 * behind it) had its evidence dropped on the floor: `computeAuthorship` is
 * events-only, so §8 never saw it. It is now rendered explicitly, with a NAMED gap.
 *
 * Three hard rules, each pinned below: never fabricate a number; delta-backed rows
 * stay byte-identical; the marker survives to JSON and HTML.
 */
describe('plan 068 · item 3 — path-only authorship rows are visible, and honest', () => {
  it('renders a path-only row with NULL deltas and a named reason, never zeros', () => {
    const exp = exportOf('vscodeish', [
      seg([{ t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 }], {
        files: { written: ['src/new.ts'], edited: ['src/old.ts'] },
      }),
    ]);
    const report = buildReport([exp]);
    const rows = report.authorship?.files ?? [];
    expect(rows.map((f) => f.path).sort()).toEqual(['src/new.ts', 'src/old.ts']);
    for (const row of rows) {
      expect(row.delta_unavailable).toBe('no_per_file_delta_capture');
      // NULL, not 0 — a zero is a measurement, a null is a gap.
      expect(row.lines_added).toBeNull();
      expect(row.lines_removed).toBeNull();
      expect(row.bytes_added).toBeNull();
      expect(row.bytes_removed).toBeNull();
      expect(row.events).toBe(0);
    }
    expect(rows.find((f) => f.path === 'src/new.ts')?.change).toBe('written');
    expect(rows.find((f) => f.path === 'src/old.ts')?.change).toBe('edited');
    // The unmeasured rows contribute NOTHING to the sums, and the count is declared.
    expect(report.authorship?.totals).toEqual({
      files: 2,
      lines_added: 0,
      lines_removed: 0,
      bytes_added: 0,
      bytes_removed: 0,
      files_delta_unavailable: 2,
    });
  });

  it('leaves a delta-backed report BYTE-IDENTICAL to its pre-change shape', () => {
    const exp = exportOf('measured', [
      seg([
        { t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 },
        fileEvent('src/a.ts', 'written', 10, 0),
        fileEvent('src/b.ts', 'edited', 2, 1),
      ]),
    ]);
    const authorship = buildReport([exp]).authorship;
    // No new keys anywhere: the marker is ABSENT on measured rows and the
    // unavailable count is ABSENT from totals.
    expect(JSON.stringify(authorship)).toBe(
      JSON.stringify({
        files: [
          {
            path: 'src/a.ts',
            change: 'written',
            lines_added: 10,
            lines_removed: 0,
            bytes_added: 100,
            bytes_removed: 0,
            events: 1,
          },
          {
            path: 'src/b.ts',
            change: 'edited',
            lines_added: 2,
            lines_removed: 1,
            bytes_added: 20,
            bytes_removed: 10,
            events: 1,
          },
        ],
        totals: {
          files: 2,
          lines_added: 12,
          lines_removed: 1,
          bytes_added: 120,
          bytes_removed: 10,
        },
      }),
    );
  });

  it('a measured path is NEVER downgraded by also appearing in the path list', () => {
    const exp = exportOf('both', [
      seg(
        [
          { t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 },
          fileEvent('src/a.ts', 'written', 10, 0),
        ],
        {
          files: { written: ['src/a.ts'], edited: ['src/only-path.ts'] },
        },
      ),
    ]);
    const rows = buildReport([exp]).authorship?.files ?? [];
    const measured = rows.find((f) => f.path === 'src/a.ts');
    expect(measured?.delta_unavailable).toBeUndefined();
    expect(measured?.lines_added).toBe(10);
    const pathOnly = rows.find((f) => f.path === 'src/only-path.ts');
    expect(pathOnly?.delta_unavailable).toBe('no_per_file_delta_capture');
    expect(rows).toHaveLength(2);
  });

  it('carries the observed paths through the session export, de-duplicated', () => {
    const exp = exportOf('carried', [
      seg([{ t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 1 }], {
        files: { written: ['src/a.ts'], edited: [] },
      }),
      seg([{ t: '2026-06-29T00:00:02Z', kind: 'prompt', words: 1 }], {
        files: { written: ['src/a.ts', 'src/b.ts'], edited: [] },
      }),
    ]);
    expect(exp.summary.files_observed).toEqual({ written: ['src/a.ts', 'src/b.ts'], edited: [] });
  });

  it('omits files_observed entirely when no segment carried a path list', () => {
    const exp = exportOf('nolist', [
      seg([{ t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 1 }]),
    ]);
    expect('files_observed' in exp.summary).toBe(false);
  });
});
