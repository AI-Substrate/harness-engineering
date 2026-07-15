import { describe, expect, it } from 'vitest';
import { computeTrend } from '../../../src/services/sensors/snapshot.js';
import {
  buildDetailView,
  buildTableRows,
  columnsForTier,
  STALE_AFTER_MS,
  shouldCollapseBanner,
  statusGlyph,
  trendGlyph,
  type VisualStatus,
  widthTier,
} from '../../../src/services/sensors/tui/view-model.js';
import type {
  SensorHistoryView,
  SensorRunRecord,
  SensorStatusItem,
} from '../../../src/services/sensors/types.js';

const AT = '2026-07-15T02:11:04.512Z';

function record(overrides: Partial<SensorRunRecord> = {}): SensorRunRecord {
  return {
    sensor: 'coverage',
    runId: 5,
    runStatus: 'ok',
    reading: {
      state: 'pass',
      score: 80.7,
      direction: 'higher',
      details: '80.7% branch coverage',
      report: 'Statements: 91.1%\nBranches: 80.7%',
    },
    error: null,
    startedAt: AT,
    wallclockMs: 5_012,
    trigger: 'watch',
    stale: false,
    lastTriggerHash: 'abc',
    ...overrides,
  };
}

function item(overrides: Partial<SensorStatusItem> = {}): SensorStatusItem {
  const current = record();
  return {
    name: 'coverage',
    summary: 'Branch coverage',
    trigger: 'watch',
    watch: ['src/**', 'test/**'],
    timeoutMs: 30_000,
    record: current,
    runStatus: current.runStatus,
    reading: current.reading,
    error: current.error,
    stats: {
      runCount: 5,
      lastRunAt: AT,
      lastWallclockMs: 5_012,
      avgWallclockMs: 5_031,
      failStreak: 0,
    },
    ageMs: 2_000,
    stale: false,
    delta: 0.2,
    trend: 'better',
    guidance: 'Add branch tests.',
    ...overrides,
  };
}

const glyphCases: Array<[VisualStatus, string, string]> = [
  ['pass', '●', '✓'],
  ['warn', '●', '!'],
  ['fail', '●', '✗'],
  ['skip', '◌', '-'],
  ['error', '✖', 'E'],
  ['timeout', '⧖', 'T'],
  ['running', '◐', '~'],
  ['queued', '·', '.'],
];

describe('sensor TUI pure view-model (workshop 003 D2/D7-D9)', () => {
  it.each(glyphCases)('pins the color and NO_COLOR glyph pair for %s', (status, color, plain) => {
    expect(statusGlyph(status)).toMatchObject({ glyph: color, meaning: status });
    expect(statusGlyph(status, true)).toEqual({ glyph: plain, color: null, meaning: status });
    expect(Array.from(color)).toHaveLength(1);
    expect(Array.from(plain)).toHaveLength(1);
  });

  it('renders a crashed sensor distinctly from a failing reading', () => {
    const crashedRecord = record({
      runStatus: 'error',
      reading: null,
      error: { code: 'E211', message: 'registry unavailable' },
    });
    const rows = buildTableRows(
      [
        item({
          name: 'crash',
          record: crashedRecord,
          runStatus: 'error',
          reading: null,
          error: crashedRecord.error,
        }),
        item({
          name: 'fail',
          record: record({ reading: { state: 'fail' } }),
          reading: { state: 'fail' },
        }),
      ],
      { columns: 120, rows: 30, watcherRunning: true },
    );

    expect(rows.map(({ status }) => status.meaning)).toEqual(['error', 'fail']);
    expect(rows[0]?.status.glyph).toBe('✖');
    expect(rows[1]?.status.glyph).toBe('●');
    expect(rows[0]?.details).toContain('E211 registry unavailable');
  });

  it('marks rows stale only from the record flag or the deterministic age threshold', () => {
    const staleRecord = record({ stale: true });
    const [stale] = buildTableRows(
      [
        item({
          record: staleRecord,
          ageMs: 2_000,
          stats: {
            runCount: 5,
            lastRunAt: AT,
            lastWallclockMs: 5_012,
            avgWallclockMs: 5_031,
            failStreak: 3,
          },
        }),
      ],
      { columns: 120, rows: 30, watcherRunning: true },
    );
    expect(stale?.lastRun).toBe('2s ago ✗3 ⚠');

    const [freshWithStoppedWatcher] = buildTableRows([item()], {
      columns: 120,
      rows: 30,
      watcherRunning: false,
    });
    expect(freshWithStoppedWatcher?.lastRun).toBe('2s ago');

    const [boundary, old] = buildTableRows(
      [item({ ageMs: STALE_AFTER_MS }), item({ name: 'old', ageMs: STALE_AFTER_MS + 1 })],
      { columns: 120, rows: 30, watcherRunning: false },
    );
    expect(boundary?.lastRun).toBe('15m ago');
    expect(old?.lastRun).toBe('15m ago ⚠');
  });

  it('pins all three width tiers and banner collapse conditions', () => {
    expect(widthTier(100)).toBe('full');
    expect(columnsForTier('full')).toEqual([
      '#',
      'Sensor',
      'When',
      'St',
      'Trend',
      'Last Run',
      'Run',
      'Details',
    ]);
    expect(widthTier(84)).toBe('reduced');
    expect(columnsForTier('reduced')).toEqual([
      '#',
      'Sensor',
      'When',
      'St',
      'Last Run',
      'Run',
      'Details',
    ]);
    const [reduced] = buildTableRows([item()], {
      columns: 84,
      rows: 30,
      watcherRunning: true,
    });
    expect(reduced?.trend).toBeNull();
    expect(reduced?.run).toBe('5.0s ~5.0s');
    expect(Array.from(reduced?.details ?? '')).toHaveLength(21);
    expect(widthTier(83)).toBe('minimal');
    expect(columnsForTier('minimal')).toEqual(['Sensor', 'St', 'Details']);
    expect(shouldCollapseBanner({ columns: 100, rows: 20 })).toBe(false);
    expect(shouldCollapseBanner({ columns: 83, rows: 30 })).toBe(true);
    expect(shouldCollapseBanner({ columns: 100, rows: 19 })).toBe(true);
    expect(shouldCollapseBanner({ columns: 120, rows: 30, ascii: true })).toBe(true);
  });

  it('keeps the rendered trend mechanically equal to the JSON trend computation', () => {
    const computed = computeTrend(
      { state: 'pass', score: 12, direction: 'higher' },
      { state: 'pass', score: 10 },
    );
    const rendered = trendGlyph(computed.trend);
    expect(computed).toEqual({ delta: 2, trend: 'better' });
    expect(rendered).toEqual({ glyph: '↗', color: 'green', trend: computed.trend });
  });

  it('builds detail and playback from the current status plus newest-first history', () => {
    const newest = record({ runId: 5 });
    const older = record({
      runId: 4,
      reading: {
        state: 'warn',
        score: 79.9,
        direction: 'higher',
        details: '79.9% branch',
        report: 'Older report',
      },
    });
    const history: SensorHistoryView = {
      records: [newest, older],
      degraded: false,
      note: null,
    };
    const detail = buildDetailView(
      item({ record: newest, reading: newest.reading, runStatus: newest.runStatus }),
      history,
      1,
    );

    expect(detail).toMatchObject({
      sensor: 'coverage',
      record: { runId: 4 },
      details: '79.9% branch',
      report: 'Older report',
      historyIndex: 1,
      historyCount: 2,
      historyUnavailable: false,
    });
    expect(detail.playbackBanner).toContain('viewing run 4 of 5');
    expect(detail.snapshotBaseline).toBeCloseTo(79.7);
  });
});
