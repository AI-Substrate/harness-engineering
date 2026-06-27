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
import type { Segment } from '../segment.js';
import { resourceAttrs } from './resource.js';
import { A, GENAI_TOKEN_TYPE, GENAI_TOKEN_USAGE_METRIC } from './semconv.js';
import {
  AGG_TEMPORALITY_CUMULATIVE,
  HARNESS_SCHEMA_URL,
  type KeyValue,
  kv,
  type Metric,
  type MetricsData,
  type NumberDataPoint,
  OTLP_SCOPE_VERSION,
  SCOPE_NAME,
  sv,
} from './types.js';

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
    const sum = (
      name: string,
      unit: string,
      dataPoints: NumberDataPoint[],
      monotonic = true,
    ): Metric => ({
      name,
      unit,
      sum: {
        dataPoints,
        aggregationTemporality: AGG_TEMPORALITY_CUMULATIVE,
        isMonotonic: monotonic,
      },
    });
    const gauge = (name: string, unit: string, dataPoints: NumberDataPoint[]): Metric => ({
      name,
      unit,
      gauge: { dataPoints },
    });

    // activity — wall/agent/human/idle seconds (sum, non-monotonic: a window total)
    metrics.push(
      sum('harness.session.wall_seconds', 's', [dpD(r.activity.wall_s)], false),
      sum('harness.session.agent_working_seconds', 's', [dpD(r.activity.agent_working_s)], false),
      sum('harness.session.human_seconds', 's', [dpD(r.activity.human_s)], false),
      sum('harness.session.idle_seconds', 's', [dpD(r.activity.idle_s)], false),
      gauge('harness.session.working_ratio', '1', [dpD(r.activity.working_ratio)]),
    );

    // flow stage time
    const stageDps = Object.entries(r.flow_stage_time_s).map(([stage, secs]) =>
      dpD(secs, [kv(A.FLOW_STAGE, sv(stage))]),
    );
    if (stageDps.length > 0) metrics.push(sum('harness.flow.stage_seconds', 's', stageDps, false));

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
      metrics.push(sum(GENAI_TOKEN_USAGE_METRIC, '{token}', tokDps));
    }

    // tools — calls per tool
    const toolDps = Object.entries(r.tools).map(([name, c]) => dpI(c, [kv(A.TOOL_NAME, sv(name))]));
    if (toolDps.length > 0) metrics.push(sum('harness.tool.calls', '{call}', toolDps));

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
    if (skillDps.length > 0) metrics.push(sum('harness.skill.runs', '{run}', skillDps, false));

    // command exits — last-seen exit code per verb (gauge: a code, not a running count)
    const exitDps = Object.entries(r.outcomes.exits).map(([verb, code]) =>
      dpI(code, [kv(A.CMD_VERB, sv(verb))]),
    );
    if (exitDps.length > 0) metrics.push(gauge('harness.command.exit_code', '1', exitDps));
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttrs(seg) },
        schemaUrl: HARNESS_SCHEMA_URL,
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: OTLP_SCOPE_VERSION },
            schemaUrl: HARNESS_SCHEMA_URL,
            metrics,
          },
        ],
      },
    ],
  };
}
