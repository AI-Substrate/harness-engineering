import { describe, expect, it } from 'vitest';
import { buildDetailView } from '../../../src/services/sensors/tui/view-model.js';
import type {
  SensorHistoryView,
  SensorRunRecord,
  SensorStatusItem,
} from '../../../src/services/sensors/types.js';

const AT = '2026-07-15T02:11:04.512Z';

function run(runId: number): SensorRunRecord {
  const states = ['pass', 'warn', 'fail', 'skip', 'pass'] as const;
  return {
    sensor: 'coverage',
    runId,
    runStatus: 'ok',
    reading: {
      state: states[5 - runId] ?? 'pass',
      score: 75 + runId,
      direction: 'higher',
      details: `details-${runId}`,
      report: `report-${runId}\nline-two-${runId}`,
      ...(runId === 3 && { guidance: 'reading guidance wins' }),
    },
    error: null,
    startedAt: AT,
    wallclockMs: 100 + runId,
    trigger: 'watch',
    stale: false,
    lastTriggerHash: `hash-${runId}`,
  };
}

function sensor(history: readonly SensorRunRecord[]): SensorStatusItem {
  const latest = history[0] ?? null;
  return {
    name: 'coverage',
    summary: 'Coverage detail',
    trigger: 'watch',
    watch: ['src/**', 'test/**'],
    timeoutMs: 30_000,
    record: latest,
    runStatus: latest?.runStatus ?? null,
    reading: latest?.reading ?? null,
    error: latest?.error ?? null,
    stats: {
      runCount: 5,
      lastRunAt: AT,
      lastWallclockMs: 105,
      avgWallclockMs: 103,
      failStreak: 0,
    },
    ageMs: 1_000,
    stale: false,
    delta: 1,
    trend: 'better',
    guidance: 'declaration guidance',
  };
}

describe('sensor detail playback model (workshop 003 D1/D4/D9-14)', () => {
  it('scrubs all five newest-first records with their own state, details, and report', () => {
    const records = [5, 4, 3, 2, 1].map(run);
    const history: SensorHistoryView = { records, degraded: false, note: null };
    const source = sensor(records);

    for (const [index, expected] of records.entries()) {
      const detail = buildDetailView(source, history, index);
      expect(detail.record?.reading).toMatchObject({
        state: expected.reading?.state,
        details: `details-${expected.runId}`,
        report: `report-${expected.runId}\nline-two-${expected.runId}`,
      });
      expect(detail.historyIndex).toBe(index);
      expect(detail.historyCount).toBe(5);
    }
    expect(buildDetailView(source, history, 0).playbackBanner).toBeNull();
    expect(buildDetailView(source, history, 4).playbackBanner).toContain('viewing run 1 of 5');
  });

  it('applies reading guidance before declaration guidance', () => {
    const records = [run(5), run(3)];
    const history: SensorHistoryView = { records, degraded: false, note: null };
    expect(buildDetailView(sensor(records), history, 1).guidance).toBe('reading guidance wins');
    expect(buildDetailView(sensor(records), history, 0).guidance).toBe('declaration guidance');
  });

  it('keeps the detail view alive with an honest unavailable marker when history is missing', () => {
    const source = sensor([run(5)]);
    const detail = buildDetailView(
      source,
      { records: [], degraded: true, note: 'history unavailable' },
      4,
    );
    expect(detail).toMatchObject({
      historyUnavailable: true,
      historyNote: 'history unavailable',
      historyCount: 0,
      record: { runId: 5 },
    });
    expect(detail.historyLabel).toBe('run 5 of 5 (live)');
  });
});
