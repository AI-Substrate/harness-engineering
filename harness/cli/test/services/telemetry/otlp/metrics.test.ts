import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  METRIC_DEFINITION_BY_NAME,
  METRIC_DEFINITIONS,
  rollupToOtlpMetrics,
  validateMetricDataPointSet,
  validateMetricDataPointTuple,
} from '../../../../src/services/telemetry/otlp/metrics.js';
import {
  HARNESS_SCHEMA_URL,
  LEGACY_HARNESS_SCHEMA_URL,
  type NumberDataPoint,
} from '../../../../src/services/telemetry/otlp/types.js';
import { type Segment, serializeSegment } from '../../../../src/services/telemetry/segment.js';
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
  it('exports one closed producer-owned definition for every emitted metric family', () => {
    expect(METRIC_DEFINITIONS).toMatchObject([
      {
        name: 'harness.session.wall_seconds',
        unit: 's',
        kind: 'sum',
        monotonic: false,
        point: 'double',
        attributes: [],
      },
      {
        name: 'harness.session.agent_working_seconds',
        unit: 's',
        kind: 'sum',
        monotonic: false,
        point: 'double',
        attributes: [],
      },
      {
        name: 'harness.session.human_seconds',
        unit: 's',
        kind: 'sum',
        monotonic: false,
        point: 'double',
        attributes: [],
      },
      {
        name: 'harness.session.idle_seconds',
        unit: 's',
        kind: 'sum',
        monotonic: false,
        point: 'double',
        attributes: [],
      },
      {
        name: 'harness.session.working_ratio',
        unit: '1',
        kind: 'gauge',
        monotonic: false,
        point: 'double-ratio',
        attributes: [],
      },
      {
        name: 'harness.flow.stage_seconds',
        unit: 's',
        kind: 'sum',
        monotonic: false,
        point: 'double',
        attributes: [{ key: 'harness.flow.stage', required: true }],
      },
      {
        name: 'gen_ai.client.token.usage',
        unit: '{token}',
        kind: 'sum',
        monotonic: true,
        point: 'int',
        attributes: [
          { key: 'gen_ai.token.type', required: true, values: ['input', 'output'] },
          { key: 'harness.token.type', required: false, values: ['cache_read', 'cache_create'] },
        ],
      },
      {
        name: 'harness.tool.calls',
        unit: '{call}',
        kind: 'sum',
        monotonic: true,
        point: 'int',
        attributes: [{ key: 'harness.tool.name', required: true }],
      },
      {
        name: 'harness.skill.runs',
        unit: '{run}',
        kind: 'sum',
        monotonic: false,
        point: 'int',
        attributes: [
          { key: 'harness.skill.name', required: true },
          {
            key: 'harness.skill.status',
            required: true,
            values: ['runs', 'abandoned', 'superseded'],
          },
        ],
      },
      {
        name: 'harness.command.exit_code',
        unit: '1',
        kind: 'gauge',
        monotonic: false,
        point: 'int',
        attributes: [{ key: 'harness.command.verb', required: true }],
      },
    ]);
  });

  it('pins a producer-owned tuple policy on every metric family', () => {
    expect(METRIC_DEFINITIONS.map(({ name, tuple }) => [name, tuple])).toEqual([
      ['harness.session.wall_seconds', 'independent'],
      ['harness.session.agent_working_seconds', 'independent'],
      ['harness.session.human_seconds', 'independent'],
      ['harness.session.idle_seconds', 'independent'],
      ['harness.session.working_ratio', 'independent'],
      ['harness.flow.stage_seconds', 'independent'],
      ['gen_ai.client.token.usage', 'token-buckets'],
      ['harness.tool.calls', 'independent'],
      ['harness.skill.runs', 'independent'],
      ['harness.command.exit_code', 'independent'],
    ]);
  });

  it('validates every producer-emitted tuple and rejects missing/extra attributes for all ten families', () => {
    const t = '2026-07-16T00:00:00Z';
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: 'tuple-matrix',
        timecode: t,
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        event_stream: [
          { t, kind: 'turn', dur_s: 1, in: 2, out: 3, cache_read: 4, cache_create: 5 },
          {
            t: '2026-07-16T00:00:01Z',
            kind: 'flow',
            flow: 'x',
            stage: 'plan',
            status: 'in_progress',
          },
          { t: '2026-07-16T00:00:02Z', kind: 'tools', name: 'Bash', count: 1, span_s: 1 },
          { t: '2026-07-16T00:00:03Z', kind: 'skill', name: 'the-flow', status: 'completed' },
          {
            t: '2026-07-16T00:00:04Z',
            kind: 'command_exit',
            verb: 'checks',
            exit: 0,
            status: 'ok',
          },
        ],
      },
      '/repo',
    );
    const emitted = rollupToOtlpMetrics(segment).resourceMetrics[0].scopeMetrics[0].metrics;
    expect(emitted).toHaveLength(10);
    for (const metric of emitted) {
      const definition = METRIC_DEFINITION_BY_NAME.get(metric.name);
      if (definition === undefined) throw new Error(`missing ${metric.name}`);
      const points = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
      expect(validateMetricDataPointSet(definition, points), `${metric.name} full set`).toBe(true);
      if (points.length > 0) {
        expect(
          validateMetricDataPointSet(definition, [...points, structuredClone(points[0])]),
          `${metric.name} duplicate tuple`,
        ).toBe(false);
      }
      for (const point of points) {
        expect(validateMetricDataPointTuple(definition, point.attributes), metric.name).toBe(true);
        expect(
          validateMetricDataPointTuple(definition, [
            ...(point.attributes ?? []),
            { key: 'harness.unknown', value: { stringValue: 'safe' } },
          ]),
          `${metric.name} extra`,
        ).toBe(false);
        for (const required of definition.attributes.filter((attribute) => attribute.required)) {
          expect(
            validateMetricDataPointTuple(
              definition,
              (point.attributes ?? []).filter((attribute) => attribute.key !== required.key),
            ),
            `${metric.name} missing ${required.key}`,
          ).toBe(false);
        }
      }
    }
  });

  it('accepts only producer-possible token bucket tuples', () => {
    const definition = METRIC_DEFINITION_BY_NAME.get('gen_ai.client.token.usage');
    if (definition === undefined) throw new Error('missing token definition');
    const attributes = (genAi: string, cache?: string) => [
      { key: 'gen_ai.token.type', value: { stringValue: genAi } },
      ...(cache === undefined
        ? []
        : [{ key: 'harness.token.type', value: { stringValue: cache } }]),
    ];
    expect(validateMetricDataPointTuple(definition, attributes('input'))).toBe(true);
    expect(validateMetricDataPointTuple(definition, attributes('output'))).toBe(true);
    expect(validateMetricDataPointTuple(definition, attributes('input', 'cache_read'))).toBe(true);
    expect(validateMetricDataPointTuple(definition, attributes('input', 'cache_create'))).toBe(
      true,
    );
    expect(validateMetricDataPointTuple(definition, attributes('output', 'cache_read'))).toBe(
      false,
    );
    expect(validateMetricDataPointTuple(definition, attributes('output', 'cache_create'))).toBe(
      false,
    );
    const point = (genAi: string, cache?: string): NumberDataPoint => ({
      startTimeUnixNano: '1',
      timeUnixNano: '2',
      asInt: '1',
      attributes: attributes(genAi, cache),
    });
    const exact = [
      point('input'),
      point('output'),
      point('input', 'cache_read'),
      point('input', 'cache_create'),
    ];
    expect(validateMetricDataPointSet(definition, exact)).toBe(true);
    expect(
      validateMetricDataPointSet(
        definition,
        exact.filter((_point, index) => index !== 1),
      ),
    ).toBe(false);
    expect(validateMetricDataPointSet(definition, [...exact, structuredClone(exact[0])])).toBe(
      false,
    );
  });

  it('emits exactly the definition-key set when every optional family is observed', () => {
    const t = '2026-07-16T00:00:00Z';
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'claude-code',
        harness_session_id: 'all-metrics',
        timecode: t,
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        event_stream: [
          { t, kind: 'turn', dur_s: 1, in: 2, out: 3 },
          { t: '2026-07-16T00:00:01Z', kind: 'flow', flow: 'x', stage: 'plan', status: 'active' },
          { t: '2026-07-16T00:00:02Z', kind: 'tools', name: 'Bash', count: 1, span_s: 1 },
          { t: '2026-07-16T00:00:03Z', kind: 'skill', name: 'the-flow', status: 'done' },
          {
            t: '2026-07-16T00:00:04Z',
            kind: 'command_exit',
            verb: 'checks',
            exit: 0,
            status: 'ok',
          },
        ],
      },
      '/repo',
    );
    const names = rollupToOtlpMetrics(segment).resourceMetrics[0].scopeMetrics[0].metrics.map(
      (metric) => metric.name,
    );
    expect(names).toEqual(METRIC_DEFINITIONS.map((definition) => definition.name));
  });
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

  it('keeps old Segment-2.4 Metrics on immutable v0.1 metadata', () => {
    const old = rollupToOtlpMetrics(loadGolden('claude/2026-06-25-static-site'));
    expect(old.resourceMetrics[0].schemaUrl).toBe(LEGACY_HARNESS_SCHEMA_URL);
  });

  it('new Segment-2.5 provenance changes only shared metadata, never metric payloads', () => {
    const input = {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'metrics-provenance',
      timecode: '2026-07-16T00:00:00Z',
      window: { since: 'session-start' as const, from: 0, to: 1 },
      branch: 'main',
      event_stream: [{ t: '2026-07-16T00:00:00Z', kind: 'turn' as const, dur_s: 1, in: 2, out: 3 }],
    };
    const withoutCommit = rollupToOtlpMetrics(serializeSegment(input, '/repo'));
    const withCommit = rollupToOtlpMetrics(
      serializeSegment({ ...input, product_commit: 'a'.repeat(40) }, '/repo'),
    );
    expect(withCommit.resourceMetrics[0].schemaUrl).toBe(HARNESS_SCHEMA_URL);
    expect(withCommit.resourceMetrics[0].scopeMetrics[0].metrics).toEqual(
      withoutCommit.resourceMetrics[0].scopeMetrics[0].metrics,
    );
    expect(withCommit.resourceMetrics[0].resource?.attributes).not.toEqual(
      withoutCommit.resourceMetrics[0].resource?.attributes,
    );
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
