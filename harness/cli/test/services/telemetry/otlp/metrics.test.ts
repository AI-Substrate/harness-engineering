import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rollupToOtlpMetrics } from '../../../../src/services/telemetry/otlp/metrics.js';
import type { NumberDataPoint } from '../../../../src/services/telemetry/otlp/types.js';
import type { Segment } from '../../../../src/services/telemetry/segment.js';
import { conformMetrics } from '../../../conformance/otlp-conformance.js';

/**
 * T008 — rollup → OTLP Metrics, cumulative-per-session. Conformance + a value
 * cross-check against the stored rollup on the real fixtures, plus the
 * `rollup === null` ⇒ no-datapoints rule (AC-10).
 */

const WITH_ROLLUP = [
  'claude/2026-06-25-static-site',
  'copilot-cli/2026-06-24-checks-run',
  'cursor/2026-06-25-checks-walkthrough',
] as const;

function loadGolden(rel: string): Segment {
  const p = fileURLToPath(
    new URL(`../fixtures/real/${rel}/expected-segment.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(p, 'utf8')) as Segment;
}

function metricByName(seg: Segment, name: string) {
  const md = rollupToOtlpMetrics(seg);
  return md.resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === name);
}

function dpValue(dp: NumberDataPoint): number {
  return dp.asInt !== undefined ? Number(dp.asInt) : (dp.asDouble ?? Number.NaN);
}

describe('rollup → OTLP Metrics (T008)', () => {
  for (const rel of WITH_ROLLUP) {
    const seg = loadGolden(rel);

    it(`${rel}: emitted metrics pass OTLP conformance`, () => {
      expect(conformMetrics(rollupToOtlpMetrics(seg))).toEqual({ ok: true });
    });

    it(`${rel}: wall_seconds datapoint equals rollup.activity.wall_s (cross-check)`, () => {
      const m = metricByName(seg, 'harness.session.wall_seconds');
      expect(m?.sum?.dataPoints[0]?.asDouble).toBe(seg.rollup?.activity.wall_s);
    });

    it(`${rel}: cumulative temporality + one datapoint per session-activity measure`, () => {
      const m = metricByName(seg, 'harness.session.agent_working_seconds');
      expect(m?.sum?.aggregationTemporality).toBe(2); // CUMULATIVE
      expect(m?.sum?.dataPoints).toHaveLength(1);
    });
  }

  it('claude: gen_ai token usage cross-checks the rollup token buckets', () => {
    const seg = loadGolden('claude/2026-06-25-static-site');
    const tok = metricByName(seg, 'gen_ai.client.token.usage');
    const dps = tok?.sum?.dataPoints ?? [];
    const input = dps.find(
      (d) =>
        d.attributes?.some((a) => a.value.stringValue === 'input') && d.attributes?.length === 1,
    );
    expect(input && dpValue(input)).toBe(seg.rollup?.tokens?.in);
  });

  it('rollup === null ⇒ no datapoints emitted (AC-10), envelope still valid', () => {
    const empty: Segment = {
      schema_version: '2.0',
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sess-empty',
      timecode: '2026-06-27T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 0 },
      branch: null,
      tokens: null,
      effort: null,
      event_stream: [],
      rollup: null,
    };
    const md = rollupToOtlpMetrics(empty);
    expect(md.resourceMetrics[0].scopeMetrics[0].metrics).toEqual([]);
    expect(conformMetrics(md)).toEqual({ ok: true });
  });
});
