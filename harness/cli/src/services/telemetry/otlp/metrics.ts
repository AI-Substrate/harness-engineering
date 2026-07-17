/**
 * rollup → OTLP Metrics (plan 038 · T008).
 *
 * One `ResourceMetrics` per session. CUMULATIVE-per-session temporality
 * (research A4 / WS-A): each CLI run is a fresh metric lifetime — one datapoint
 * per measure, `startTimeUnixNano` = session start, `timeUnixNano` = session end;
 * partition by session, never stitch. `rollup === null` (empty stream) ⇒ NO
 * datapoints (omit the metric, never zero-fill).
 *
 * Metrics are the rollup's honest gap/usage math for upstreams + a cross-check;
 * the reconstruction substrate is the logs (T002). `flow_log` is already excluded
 * from the rollup, so it never reaches metrics.
 */
import type { Event } from '../events.js';
import { parseIso } from '../rollup.js';
import { isTelemetryExtensionString, type Segment } from '../segment.js';
import { resourceAttrs } from './resource.js';
import { A, GENAI_TOKEN_TYPE, GENAI_TOKEN_USAGE_METRIC } from './semconv.js';
import {
  AGG_TEMPORALITY_CUMULATIVE,
  type KeyValue,
  kv,
  type Metric,
  type MetricsData,
  type NumberDataPoint,
  SCOPE_NAME,
  schemaIdentityForSegmentVersion,
  sv,
} from './types.js';

export interface MetricAttributeDefinition {
  key: string;
  required: boolean;
  values?: readonly string[];
}

export interface MetricDefinition {
  name: string;
  unit: string;
  kind: 'gauge' | 'sum';
  monotonic: boolean;
  point: 'int' | 'double' | 'double-ratio';
  attributes: readonly MetricAttributeDefinition[];
  tuple: 'independent' | 'token-buckets';
}

/** One closed producer-owned contract consumed by construction and strict reads. */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    name: 'harness.session.wall_seconds',
    unit: 's',
    kind: 'sum',
    monotonic: false,
    point: 'double',
    attributes: [],
    tuple: 'independent',
  },
  {
    name: 'harness.session.agent_working_seconds',
    unit: 's',
    kind: 'sum',
    monotonic: false,
    point: 'double',
    attributes: [],
    tuple: 'independent',
  },
  {
    name: 'harness.session.human_seconds',
    unit: 's',
    kind: 'sum',
    monotonic: false,
    point: 'double',
    attributes: [],
    tuple: 'independent',
  },
  {
    name: 'harness.session.idle_seconds',
    unit: 's',
    kind: 'sum',
    monotonic: false,
    point: 'double',
    attributes: [],
    tuple: 'independent',
  },
  {
    name: 'harness.session.working_ratio',
    unit: '1',
    kind: 'gauge',
    monotonic: false,
    point: 'double-ratio',
    attributes: [],
    tuple: 'independent',
  },
  {
    name: 'harness.flow.stage_seconds',
    unit: 's',
    kind: 'sum',
    monotonic: false,
    point: 'double',
    attributes: [{ key: A.FLOW_STAGE, required: true }],
    tuple: 'independent',
  },
  {
    name: GENAI_TOKEN_USAGE_METRIC,
    unit: '{token}',
    kind: 'sum',
    monotonic: true,
    point: 'int',
    attributes: [
      { key: GENAI_TOKEN_TYPE, required: true, values: ['input', 'output'] },
      { key: A.TOKEN_TYPE, required: false, values: ['cache_read', 'cache_create'] },
    ],
    tuple: 'token-buckets',
  },
  {
    name: 'harness.tool.calls',
    unit: '{call}',
    kind: 'sum',
    monotonic: true,
    point: 'int',
    attributes: [{ key: A.TOOL_NAME, required: true }],
    tuple: 'independent',
  },
  {
    name: 'harness.skill.runs',
    unit: '{run}',
    kind: 'sum',
    monotonic: false,
    point: 'int',
    attributes: [
      { key: A.SKILL_NAME, required: true },
      {
        key: A.SKILL_STATUS,
        required: true,
        values: ['runs', 'abandoned', 'superseded'],
      },
    ],
    tuple: 'independent',
  },
  {
    name: 'harness.command.exit_code',
    unit: '1',
    kind: 'gauge',
    monotonic: false,
    point: 'int',
    attributes: [{ key: A.CMD_VERB, required: true }],
    tuple: 'independent',
  },
];

export const METRIC_DEFINITION_BY_NAME: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((definition) => [definition.name, definition]),
);

/** Validate exact attributes and producer-dependent combinations for one datapoint. */
export function validateMetricDataPointTuple(
  definition: MetricDefinition,
  attributes: readonly KeyValue[] | undefined,
): boolean {
  const values = new Map<string, string>();
  for (const attribute of attributes ?? []) {
    if (
      values.has(attribute.key) ||
      Object.keys(attribute.value).length !== 1 ||
      typeof attribute.value.stringValue !== 'string' ||
      !isTelemetryExtensionString(attribute.value.stringValue)
    ) {
      return false;
    }
    values.set(attribute.key, attribute.value.stringValue);
  }
  const allowed = new Map(definition.attributes.map((attribute) => [attribute.key, attribute]));
  if ([...values.keys()].some((key) => !allowed.has(key))) return false;
  for (const attribute of definition.attributes) {
    const value = values.get(attribute.key);
    if (value === undefined) {
      if (attribute.required) return false;
      continue;
    }
    if (attribute.values !== undefined && !attribute.values.includes(value)) return false;
  }
  if (definition.tuple === 'token-buckets') {
    const tokenType = values.get(GENAI_TOKEN_TYPE);
    const cacheType = values.get(A.TOKEN_TYPE);
    return cacheType === undefined || tokenType === 'input';
  }
  return true;
}

function metricTupleIdentity(attributes: readonly KeyValue[] | undefined): string | null {
  const parts: string[] = [];
  for (const attribute of attributes ?? []) {
    if (
      Object.keys(attribute.value).length !== 1 ||
      typeof attribute.value.stringValue !== 'string'
    ) {
      return null;
    }
    parts.push(`${attribute.key}\0${attribute.value.stringValue}`);
  }
  parts.sort();
  return parts.join('\0');
}

/** Validate the complete producer datapoint set, including cross-point cardinality. */
export function validateMetricDataPointSet(
  definition: MetricDefinition,
  dataPoints: readonly NumberDataPoint[],
): boolean {
  if (dataPoints.length === 0) return false;
  const identities: string[] = [];
  for (const point of dataPoints) {
    if (!validateMetricDataPointTuple(definition, point.attributes)) return false;
    const identity = metricTupleIdentity(point.attributes);
    if (identity === null) return false;
    identities.push(identity);
  }
  if (new Set(identities).size !== identities.length) return false;
  if (definition.tuple !== 'token-buckets') return true;
  const expected = [
    `${GENAI_TOKEN_TYPE}\0input`,
    `${GENAI_TOKEN_TYPE}\0input\0${A.TOKEN_TYPE}\0cache_create`,
    `${GENAI_TOKEN_TYPE}\0input\0${A.TOKEN_TYPE}\0cache_read`,
    `${GENAI_TOKEN_TYPE}\0output`,
  ];
  return (
    identities.length === expected.length &&
    identities
      .slice()
      .sort()
      .every((identity, index) => identity === expected[index])
  );
}

function metricDefinition(name: string, kind: MetricDefinition['kind']): MetricDefinition {
  const definition = METRIC_DEFINITION_BY_NAME.get(name);
  if (definition === undefined || definition.kind !== kind) {
    throw new Error('unknown metric definition');
  }
  return definition;
}

function bounds(events: readonly Event[]): { startNs: string; endNs: string } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    // EXCLUDE flow_log — like computeRollup. flow_log markers carry their own
    // `fired_at`, which can predate the window (backfilled flight-plan history);
    // including them here would skew the metric session start/end the same way it
    // would skew the rollup's wall/gap math (review finding F001, run …ab81).
    if (e.kind === 'flow_log') continue;
    const s = parseIso(e.t);
    if (Number.isFinite(s)) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
  }
  const toNs = (secs: number): string =>
    Number.isFinite(secs) ? String(BigInt(Math.round(secs * 1000)) * 1_000_000n) : '0';
  return { startNs: toNs(min), endNs: toNs(max) };
}

export function rollupToOtlpMetrics(seg: Segment): MetricsData {
  const r = seg.rollup;
  const identity = schemaIdentityForSegmentVersion(seg.schema_version);
  const metrics: Metric[] = [];

  if (r !== null) {
    const { startNs, endNs } = bounds(seg.event_stream);
    const dpD = (asDouble: number, attributes?: KeyValue[]): NumberDataPoint => ({
      startTimeUnixNano: startNs,
      timeUnixNano: endNs,
      asDouble,
      ...(attributes && attributes.length > 0 ? { attributes } : {}),
    });
    const dpI = (n: number, attributes?: KeyValue[]): NumberDataPoint => ({
      startTimeUnixNano: startNs,
      timeUnixNano: endNs,
      asInt: String(n),
      ...(attributes && attributes.length > 0 ? { attributes } : {}),
    });
    const checkedPoints = (
      definition: MetricDefinition,
      dataPoints: NumberDataPoint[],
    ): NumberDataPoint[] => {
      if (!validateMetricDataPointSet(definition, dataPoints)) {
        throw new Error(`invalid producer metric set: ${definition.name}`);
      }
      return dataPoints;
    };
    const sum = (name: string, dataPoints: NumberDataPoint[]): Metric => {
      const definition = metricDefinition(name, 'sum');
      return {
        name: definition.name,
        unit: definition.unit,
        sum: {
          dataPoints: checkedPoints(definition, dataPoints),
          aggregationTemporality: AGG_TEMPORALITY_CUMULATIVE,
          isMonotonic: definition.monotonic,
        },
      };
    };
    const gauge = (name: string, dataPoints: NumberDataPoint[]): Metric => {
      const definition = metricDefinition(name, 'gauge');
      return {
        name: definition.name,
        unit: definition.unit,
        gauge: { dataPoints: checkedPoints(definition, dataPoints) },
      };
    };

    // activity — wall/agent/human/idle seconds (sum, non-monotonic: a window total)
    metrics.push(
      sum('harness.session.wall_seconds', [dpD(r.activity.wall_s)]),
      sum('harness.session.agent_working_seconds', [dpD(r.activity.agent_working_s)]),
      sum('harness.session.human_seconds', [dpD(r.activity.human_s)]),
      sum('harness.session.idle_seconds', [dpD(r.activity.idle_s)]),
      gauge('harness.session.working_ratio', [dpD(r.activity.working_ratio)]),
    );

    // flow stage time
    const stageDps = Object.entries(r.flow_stage_time_s).map(([stage, secs]) =>
      dpD(secs, [kv(A.FLOW_STAGE, sv(stage))]),
    );
    if (stageDps.length > 0) metrics.push(sum('harness.flow.stage_seconds', stageDps));

    // tokens — gen_ai.client.token.usage; cache buckets keep gen_ai.token.type=input
    // (they ARE input tokens) + a harness.token.type discriminator.
    if (r.tokens !== null) {
      const t = r.tokens;
      const tokDps: NumberDataPoint[] = [
        dpI(t.in, [kv(GENAI_TOKEN_TYPE, sv('input'))]),
        dpI(t.out, [kv(GENAI_TOKEN_TYPE, sv('output'))]),
        dpI(t.cache_read, [kv(GENAI_TOKEN_TYPE, sv('input')), kv(A.TOKEN_TYPE, sv('cache_read'))]),
        dpI(t.cache_create, [
          kv(GENAI_TOKEN_TYPE, sv('input')),
          kv(A.TOKEN_TYPE, sv('cache_create')),
        ]),
      ];
      metrics.push(sum(GENAI_TOKEN_USAGE_METRIC, tokDps));
    }

    // tools — calls per tool
    const toolDps = Object.entries(r.tools).map(([name, c]) => dpI(c, [kv(A.TOOL_NAME, sv(name))]));
    if (toolDps.length > 0) metrics.push(sum('harness.tool.calls', toolDps));

    // skills — runs/abandoned/superseded per skill, status-tagged
    const skillDps: NumberDataPoint[] = [];
    for (const [name, s] of Object.entries(r.skills)) {
      skillDps.push(dpI(s.runs, [kv(A.SKILL_NAME, sv(name)), kv(A.SKILL_STATUS, sv('runs'))]));
      skillDps.push(
        dpI(s.abandoned, [kv(A.SKILL_NAME, sv(name)), kv(A.SKILL_STATUS, sv('abandoned'))]),
      );
      skillDps.push(
        dpI(s.superseded, [kv(A.SKILL_NAME, sv(name)), kv(A.SKILL_STATUS, sv('superseded'))]),
      );
    }
    if (skillDps.length > 0) metrics.push(sum('harness.skill.runs', skillDps));

    // command exits — last-seen exit code per verb (gauge: a code, not a running count)
    const exitDps = Object.entries(r.outcomes.exits).map(([verb, code]) =>
      dpI(code, [kv(A.CMD_VERB, sv(verb))]),
    );
    if (exitDps.length > 0) metrics.push(gauge('harness.command.exit_code', exitDps));
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttrs(seg) },
        schemaUrl: identity.schemaUrl,
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: identity.scopeVersion },
            schemaUrl: identity.schemaUrl,
            metrics,
          },
        ],
      },
    ],
  };
}
