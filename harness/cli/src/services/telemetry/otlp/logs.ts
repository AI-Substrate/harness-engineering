/**
 * event_stream ⇄ OTLP Logs (plan 038 · T007 + the reconstruction inverse).
 *
 * `segmentToOtlpLogs` emits ONE `ResourceLogs` per session (resource attrs once)
 * and one `logRecord` per event, from the ALREADY-SERIALIZED segment — never raw
 * adapter output — so the counts-only allowlist (P12) is inherited, not re-earned.
 *
 * `otlpLogsToEvents` is the exact inverse: it rebuilds the serialized `Event[]`
 * losslessly (the reconstruction invariant). `kind` comes from a `harness.*`
 * attribute (OTLP 1.3.2 has no `event_name` field), and the exact original `t`
 * string rides in `harness.event.t` (ns→ISO would lose the source format), so a
 * round-trip is byte-faithful and `computeRollup` of the result equals the
 * stored rollup.
 */
import type {
  ApiErrorEvent,
  ArtifactEvent,
  ArtifactType,
  BranchEvent,
  ChecksEvent,
  ChecksStatus,
  CommandExitEvent,
  CompactionEvent,
  Event,
  EventKind,
  FlowEvent,
  FlowLogEvent,
  HarnessEvent,
  ModelEvent,
  PromptEvent,
  SkillEvent,
  SkillStatus,
  SubagentEvent,
  ToolsEvent,
  TPrecision,
  TurnEvent,
} from '../events.js';
import type { Segment } from '../segment.js';
import { resourceAttrs } from './resource.js';
import { A, GENAI_INPUT_TOKENS, GENAI_MODEL, GENAI_OUTPUT_TOKENS } from './semconv.js';
import {
  type AnyValue,
  attrMap,
  HARNESS_SCHEMA_URL,
  type KeyValue,
  kv,
  type LogRecord,
  type LogsData,
  nv,
  OTLP_SCOPE_VERSION,
  readNum,
  readStr,
  SCOPE_NAME,
  SEV_ERROR,
  SEV_INFO,
  SEV_WARN,
  severityText,
  sv,
} from './types.js';

/** RFC3339 → nanoseconds-since-epoch decimal string (OTLP `timeUnixNano`). */
function toNanos(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? String(BigInt(Math.round(ms)) * 1_000_000n) : '0';
}

function encodeEvent(e: Event): LogRecord {
  const attrs: KeyValue[] = [kv(A.KIND, sv(e.kind)), kv(A.T, sv(e.t))];
  if (e.t_precision !== undefined) attrs.push(kv(A.T_PRECISION, sv(e.t_precision)));
  let sev = SEV_INFO;

  switch (e.kind) {
    case 'prompt':
      attrs.push(kv(A.PROMPT_WORDS, nv(e.words)));
      break;
    case 'turn':
      attrs.push(kv(A.TURN_DUR_S, nv(e.dur_s)));
      if (e.in !== undefined) attrs.push(kv(GENAI_INPUT_TOKENS, nv(e.in)));
      if (e.out !== undefined) attrs.push(kv(GENAI_OUTPUT_TOKENS, nv(e.out)));
      if (e.cache_read !== undefined) attrs.push(kv(A.CACHE_READ, nv(e.cache_read)));
      if (e.cache_create !== undefined) attrs.push(kv(A.CACHE_CREATE, nv(e.cache_create)));
      if (e.model !== undefined) attrs.push(kv(GENAI_MODEL, sv(e.model)));
      break;
    case 'tools':
      attrs.push(
        kv(A.TOOL_NAME, sv(e.name)),
        kv(A.TOOL_COUNT, nv(e.count)),
        kv(A.TOOL_SPAN_S, nv(e.span_s)),
      );
      if (e.signature !== undefined) attrs.push(kv(A.TOOL_SIG, sv(e.signature)));
      if (e.result_tokens !== undefined) attrs.push(kv(A.TOOL_RESULT_TOKENS, nv(e.result_tokens)));
      break;
    case 'skill':
      attrs.push(kv(A.SKILL_NAME, sv(e.name)), kv(A.SKILL_STATUS, sv(e.status)));
      if (e.dur_s !== undefined) attrs.push(kv(A.SKILL_DUR_S, nv(e.dur_s)));
      if (e.arg !== undefined) attrs.push(kv(A.SKILL_ARG, sv(e.arg)));
      break;
    case 'flow':
      attrs.push(
        kv(A.FLOW_NAME, sv(e.flow)),
        kv(A.FLOW_STAGE, sv(e.stage)),
        kv(A.FLOW_STATUS, sv(e.status)),
      );
      if (e.from !== undefined) attrs.push(kv(A.FLOW_FROM, sv(e.from)));
      break;
    case 'flow_log':
      attrs.push(kv(A.FLOWLOG_OP, sv(e.op)));
      if (e.node !== undefined) attrs.push(kv(A.FLOWLOG_NODE, sv(e.node)));
      if (e.from !== undefined) attrs.push(kv(A.FLOWLOG_FROM, sv(e.from)));
      if (e.to !== undefined) attrs.push(kv(A.FLOWLOG_TO, sv(e.to)));
      if (e.type !== undefined) attrs.push(kv(A.FLOWLOG_TYPE, sv(e.type)));
      if (e.edge_op !== undefined) attrs.push(kv(A.FLOWLOG_EDGE_OP, sv(e.edge_op)));
      break;
    case 'branch':
      attrs.push(kv(A.BRANCH_TO, sv(e.to)));
      if (e.from !== undefined) attrs.push(kv(A.BRANCH_FROM, sv(e.from)));
      break;
    case 'harness':
      attrs.push(kv(A.VERB, sv(e.verb)));
      break;
    case 'checks':
      attrs.push(kv(A.CHECKS_STATUS, sv(e.status)));
      if (e.gates !== undefined) {
        const values: KeyValue[] = Object.entries(e.gates).map(([k, v]) => kv(k, sv(v)));
        attrs.push(kv(A.CHECKS_GATES, { kvlistValue: { values } }));
      }
      sev = e.status === 'ok' ? SEV_INFO : e.status === 'degraded' ? SEV_WARN : SEV_ERROR;
      break;
    case 'command_exit':
      attrs.push(kv(A.CMD_VERB, sv(e.verb)), kv(A.CMD_EXIT, nv(e.exit)));
      if (e.status !== undefined) attrs.push(kv(A.CMD_STATUS, sv(e.status)));
      sev = e.exit !== 0 ? SEV_ERROR : SEV_INFO;
      break;
    case 'subagent':
      attrs.push(kv(A.SUBAGENT_NAME, sv(e.name)), kv(A.SUBAGENT_STATUS, sv(e.status)));
      if (e.dur_s !== undefined) attrs.push(kv(A.SUBAGENT_DUR_S, nv(e.dur_s)));
      break;
    case 'compaction':
      break;
    case 'model':
      attrs.push(kv(GENAI_MODEL, sv(e.model)));
      if (e.effort !== undefined) attrs.push(kv(A.EFFORT, sv(e.effort)));
      break;
    case 'api_error':
      if (e.signature !== undefined) attrs.push(kv(A.API_ERROR_SIG, sv(e.signature)));
      sev = SEV_ERROR;
      break;
    case 'artifact': {
      attrs.push(
        kv(A.ARTIFACT_TYPE, sv(e.artifact_type)),
        kv(A.ARTIFACT_PATH, sv(e.path)),
        kv(A.ARTIFACT_CHANGE, sv(e.change)),
        kv(A.ARTIFACT_SIZE_LINES, nv(e.size.lines)),
        kv(A.ARTIFACT_SIZE_BYTES, nv(e.size.bytes)),
      );
      if (e.plan_id !== undefined) attrs.push(kv(A.ARTIFACT_PLAN_ID, sv(e.plan_id)));
      // counts/enums ride as kvlist attrs (like `checks.gates`); an empty map is
      // OMITTED, so decode's `{}` default round-trips a garbage artifact exactly.
      const countEntries = Object.entries(e.counts);
      if (countEntries.length > 0) {
        const values: KeyValue[] = countEntries.map(([k, v]) => kv(k, nv(v)));
        attrs.push(kv(A.ARTIFACT_COUNTS, { kvlistValue: { values } }));
      }
      const enumEntries = Object.entries(e.enums);
      if (enumEntries.length > 0) {
        const values: KeyValue[] = enumEntries.map(([k, v]) => kv(k, sv(v)));
        attrs.push(kv(A.ARTIFACT_ENUMS, { kvlistValue: { values } }));
      }
      break;
    }
  }

  return {
    timeUnixNano: toNanos(e.t),
    severityNumber: sev,
    severityText: severityText(sev),
    attributes: attrs,
  };
}

/** Rebuild the shared `{ t, t_precision? }` base of a serialized event. */
function decodeBase(m: Map<string, AnyValue>): { t: string; t_precision?: TPrecision } {
  const base: { t: string; t_precision?: TPrecision } = { t: readStr(m.get(A.T)) ?? '' };
  const tp = readStr(m.get(A.T_PRECISION));
  if (tp !== undefined) base.t_precision = tp as TPrecision;
  return base;
}

function decodeEvent(rec: LogRecord): Event {
  const m = attrMap(rec.attributes);
  const kind = (readStr(m.get(A.KIND)) ?? '') as EventKind;
  const base = decodeBase(m);

  switch (kind) {
    case 'prompt':
      return { ...base, kind, words: readNum(m.get(A.PROMPT_WORDS)) ?? 0 } satisfies PromptEvent;
    case 'turn': {
      const ev: TurnEvent = { ...base, kind, dur_s: readNum(m.get(A.TURN_DUR_S)) ?? 0 };
      const i = readNum(m.get(GENAI_INPUT_TOKENS));
      const o = readNum(m.get(GENAI_OUTPUT_TOKENS));
      const cr = readNum(m.get(A.CACHE_READ));
      const cc = readNum(m.get(A.CACHE_CREATE));
      const model = readStr(m.get(GENAI_MODEL));
      if (i !== undefined) ev.in = i;
      if (o !== undefined) ev.out = o;
      if (cr !== undefined) ev.cache_read = cr;
      if (cc !== undefined) ev.cache_create = cc;
      if (model !== undefined) ev.model = model;
      return ev;
    }
    case 'tools': {
      const ev: ToolsEvent = {
        ...base,
        kind,
        name: readStr(m.get(A.TOOL_NAME)) ?? '',
        count: readNum(m.get(A.TOOL_COUNT)) ?? 0,
        span_s: readNum(m.get(A.TOOL_SPAN_S)) ?? 0,
      };
      const sig = readStr(m.get(A.TOOL_SIG));
      if (sig !== undefined) ev.signature = sig;
      const resultTokens = readNum(m.get(A.TOOL_RESULT_TOKENS));
      if (resultTokens !== undefined) ev.result_tokens = resultTokens;
      return ev;
    }
    case 'skill': {
      const ev: SkillEvent = {
        ...base,
        kind,
        name: readStr(m.get(A.SKILL_NAME)) ?? '',
        status: (readStr(m.get(A.SKILL_STATUS)) ?? 'completed') as SkillStatus,
      };
      const d = readNum(m.get(A.SKILL_DUR_S));
      if (d !== undefined) ev.dur_s = d;
      const arg = readStr(m.get(A.SKILL_ARG));
      if (arg !== undefined) ev.arg = arg;
      return ev;
    }
    case 'flow': {
      const ev: FlowEvent = {
        ...base,
        kind,
        flow: readStr(m.get(A.FLOW_NAME)) ?? '',
        stage: readStr(m.get(A.FLOW_STAGE)) ?? '',
        status: readStr(m.get(A.FLOW_STATUS)) ?? '',
      };
      const from = readStr(m.get(A.FLOW_FROM));
      if (from !== undefined) ev.from = from;
      return ev;
    }
    case 'flow_log': {
      const ev: FlowLogEvent = { ...base, kind, op: readStr(m.get(A.FLOWLOG_OP)) ?? '' };
      const node = readStr(m.get(A.FLOWLOG_NODE));
      const from = readStr(m.get(A.FLOWLOG_FROM));
      const to = readStr(m.get(A.FLOWLOG_TO));
      const type = readStr(m.get(A.FLOWLOG_TYPE));
      const edgeOp = readStr(m.get(A.FLOWLOG_EDGE_OP));
      if (node !== undefined) ev.node = node;
      if (from !== undefined) ev.from = from;
      if (to !== undefined) ev.to = to;
      if (type !== undefined) ev.type = type;
      if (edgeOp !== undefined) ev.edge_op = edgeOp;
      return ev;
    }
    case 'branch': {
      const ev: BranchEvent = { ...base, kind, to: readStr(m.get(A.BRANCH_TO)) ?? '' };
      const from = readStr(m.get(A.BRANCH_FROM));
      if (from !== undefined) ev.from = from;
      return ev;
    }
    case 'harness':
      return { ...base, kind, verb: readStr(m.get(A.VERB)) ?? '' } satisfies HarnessEvent;
    case 'checks': {
      const ev: ChecksEvent = {
        ...base,
        kind,
        status: (readStr(m.get(A.CHECKS_STATUS)) ?? 'ok') as ChecksStatus,
      };
      const gatesAny = m.get(A.CHECKS_GATES);
      if (gatesAny?.kvlistValue !== undefined) {
        const gates: Record<string, string> = {};
        for (const g of gatesAny.kvlistValue.values) gates[g.key] = readStr(g.value) ?? '';
        ev.gates = gates;
      }
      return ev;
    }
    case 'command_exit': {
      const ev: CommandExitEvent = {
        ...base,
        kind,
        verb: readStr(m.get(A.CMD_VERB)) ?? '',
        exit: readNum(m.get(A.CMD_EXIT)) ?? 0,
      };
      const status = readStr(m.get(A.CMD_STATUS));
      if (status !== undefined) ev.status = status;
      return ev;
    }
    case 'subagent': {
      const ev: SubagentEvent = {
        ...base,
        kind,
        name: readStr(m.get(A.SUBAGENT_NAME)) ?? '',
        status: (readStr(m.get(A.SUBAGENT_STATUS)) ?? 'completed') as 'completed' | 'active',
      };
      const d = readNum(m.get(A.SUBAGENT_DUR_S));
      if (d !== undefined) ev.dur_s = d;
      return ev;
    }
    case 'compaction':
      return { ...base, kind } satisfies CompactionEvent;
    case 'model': {
      const ev: ModelEvent = { ...base, kind, model: readStr(m.get(GENAI_MODEL)) ?? '' };
      const effort = readStr(m.get(A.EFFORT));
      if (effort !== undefined) ev.effort = effort;
      return ev;
    }
    case 'api_error': {
      const ev: ApiErrorEvent = { ...base, kind };
      const sig = readStr(m.get(A.API_ERROR_SIG));
      if (sig !== undefined) ev.signature = sig;
      return ev;
    }
    case 'artifact': {
      // Rebuild counts/enums into plain maps at the wire boundary, then assign —
      // the closed key discipline lives in the schema + the extractor authoring
      // site (events.ts ArtifactCountKey/ArtifactEnumKey), not this reconstruction.
      const counts: Record<string, number> = {};
      const enums: Record<string, string> = {};
      const countsAny = m.get(A.ARTIFACT_COUNTS);
      if (countsAny?.kvlistValue !== undefined)
        for (const c of countsAny.kvlistValue.values) counts[c.key] = readNum(c.value) ?? 0;
      const enumsAny = m.get(A.ARTIFACT_ENUMS);
      if (enumsAny?.kvlistValue !== undefined)
        for (const en of enumsAny.kvlistValue.values) enums[en.key] = readStr(en.value) ?? '';
      const ev: ArtifactEvent = {
        ...base,
        kind,
        path: readStr(m.get(A.ARTIFACT_PATH)) ?? '',
        artifact_type: (readStr(m.get(A.ARTIFACT_TYPE)) ?? 'plan') as ArtifactType,
        change: (readStr(m.get(A.ARTIFACT_CHANGE)) ?? 'edited') as 'written' | 'edited',
        counts,
        enums,
        size: {
          lines: readNum(m.get(A.ARTIFACT_SIZE_LINES)) ?? 0,
          bytes: readNum(m.get(A.ARTIFACT_SIZE_BYTES)) ?? 0,
        },
      };
      const planId = readStr(m.get(A.ARTIFACT_PLAN_ID));
      if (planId !== undefined) ev.plan_id = planId;
      return ev;
    }
    default:
      return { ...base, kind } as Event;
  }
}

/** Serialize a segment's `event_stream` to one `ResourceLogs` (OTLP Logs). */
export function segmentToOtlpLogs(seg: Segment): LogsData {
  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttrs(seg) },
        schemaUrl: HARNESS_SCHEMA_URL,
        scopeLogs: [
          {
            scope: { name: SCOPE_NAME, version: OTLP_SCOPE_VERSION },
            schemaUrl: HARNESS_SCHEMA_URL,
            logRecords: seg.event_stream.map(encodeEvent),
          },
        ],
      },
    ],
  };
}

/** Reconstruct the exact serialized `Event[]` from OTLP Logs (the inverse). */
export function otlpLogsToEvents(logs: LogsData): Event[] {
  const out: Event[] = [];
  for (const rl of logs.resourceLogs ?? [])
    for (const sl of rl.scopeLogs ?? [])
      for (const rec of sl.logRecords ?? []) out.push(decodeEvent(rec));
  return out;
}
