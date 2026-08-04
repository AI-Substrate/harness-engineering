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
import { CONTROL_SIGNATURES } from '../command-signature.js';
import {
  type ApiErrorEvent,
  ARTIFACT_COUNT_KEYS,
  ARTIFACT_ENUM_KEYS,
  type ArtifactEvent,
  type ArtifactType,
  type BranchEvent,
  type ChecksEvent,
  type ChecksStatus,
  type CommandExitEvent,
  type CompactionEvent,
  type Event,
  type EventKind,
  type FileEvent,
  type FlowEvent,
  type FlowLogEvent,
  type HarnessEvent,
  MARK_COUNT_KEYS,
  type ModelEvent,
  type ObservationKind,
  type PromptEvent,
  type SkillEvent,
  type SkillStatus,
  type SubagentEvent,
  type ToolsEvent,
  type TPrecision,
  type TurnEvent,
  USAGE_OBSERVATION_KINDS,
  type UsageEvent,
  type UsageObservationKind,
} from '../events.js';
import { computeRollup } from '../rollup.js';
import {
  isCapturedEnvEntry,
  isTelemetryCommand,
  isTelemetryExtensionString,
  isTelemetryHarness,
  isTelemetryModel,
  isTelemetryRelativePath,
  isTelemetryServiceVersion,
  isTelemetrySessionId,
  isTelemetrySignature,
  isTelemetryTime,
  PIJ_EFFORT_VALUES,
  type Segment,
} from '../segment.js';
import { resourceAttrs } from './resource.js';
import {
  A,
  GENAI_INPUT_TOKENS,
  GENAI_MODEL,
  GENAI_OUTPUT_TOKENS,
  RES_BRANCH,
  RES_CAPTURE_MODE,
  RES_COMMAND,
  RES_ENV,
  RES_HARNESS,
  RES_PRODUCT_COMMIT,
  RES_SCHEMA_VERSION,
  RES_SERVICE,
  RES_SERVICE_VERSION,
  RES_SESSION,
} from './semconv.js';
import {
  type AnyValue,
  attrMap,
  type KeyValue,
  kv,
  type LogRecord,
  type LogsData,
  nv,
  readNum,
  readStr,
  SCOPE_NAME,
  SEV_ERROR,
  SEV_INFO,
  SEV_WARN,
  schemaIdentityForSegmentVersion,
  severityText,
  sv,
} from './types.js';

/** RFC3339 → nanoseconds-since-epoch decimal string (OTLP `timeUnixNano`). */
function toNanos(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? String(BigInt(Math.round(ms)) * 1_000_000n) : '0';
}

export type LogAttributeKind = 'string' | 'int' | 'number' | 'kv-string' | 'kv-int';
export type LogStringRole =
  | 'event-kind'
  | 'time'
  | 'identifier'
  | 'model'
  | 'signature'
  | 'path'
  | 'command'
  | 'slug'
  /** A harness error code and nothing else — `E` followed by three digits. */
  | 'e-code';
export type LogKvRole =
  | 'gates'
  | 'artifact-counts'
  | 'artifact-enums'
  | 'mark-counts'
  | 'control-signatures';

export interface LogAttributeDefinition {
  key: string;
  kind: LogAttributeKind;
  required: boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
  role?: LogStringRole;
  kvRole?: LogKvRole;
}

export interface LogEventDefinition {
  kind: EventKind;
  attributes: readonly LogAttributeDefinition[];
  severityNumbers: readonly number[];
}

const MARK_KIND = 'harness.mark.kind';
const MARK_COUNTS = 'harness.mark.counts';
const MARK_VERDICT = 'harness.mark.verdict';
const T_PRECISION_VALUES = ['exact', 'anchored', 'interpolated', 'interval'] as const;
const OBSERVE_KIND_VALUES = [
  'difficulty',
  'magic-wand',
  'gift',
  'insight',
  'coordination',
  'improvement-suggestion',
  'confusion',
  'win',
] as const;
const ARTIFACT_TYPE_VALUES = [
  'review',
  'plan',
  'workshop',
  'dossier',
  'tasks',
  'execution-log',
  'backpressure',
  'validation',
  'ship-report',
  'flight-plan',
  'retro',
] as const;

const requiredString = (
  key: string,
  role: LogStringRole,
  values?: readonly string[],
): LogAttributeDefinition => ({
  key,
  kind: 'string',
  required: true,
  role,
  ...(values && { values }),
});
const optionalString = (
  key: string,
  role: LogStringRole,
  values?: readonly string[],
): LogAttributeDefinition => ({
  key,
  kind: 'string',
  required: false,
  role,
  ...(values && { values }),
});
const requiredInt = (key: string, min = 0, max?: number): LogAttributeDefinition => ({
  key,
  kind: 'int',
  required: true,
  min,
  ...(max !== undefined && { max }),
});
const optionalInt = (key: string, min = 0, max?: number): LogAttributeDefinition => ({
  key,
  kind: 'int',
  required: false,
  min,
  ...(max !== undefined && { max }),
});
const requiredNumber = (key: string, min = 0, max?: number): LogAttributeDefinition => ({
  key,
  kind: 'number',
  required: true,
  min,
  ...(max !== undefined && { max }),
});
const optionalNumber = (key: string, min = 0, max?: number): LogAttributeDefinition => ({
  key,
  kind: 'number',
  required: false,
  min,
  ...(max !== undefined && { max }),
});
const optionalKv = (
  key: string,
  kind: 'kv-string' | 'kv-int',
  kvRole: LogKvRole,
): LogAttributeDefinition => ({
  key,
  kind,
  required: false,
  kvRole,
});
const requiredKv = (
  key: string,
  kind: 'kv-string' | 'kv-int',
  kvRole: LogKvRole,
): LogAttributeDefinition => ({
  key,
  kind,
  required: true,
  kvRole,
});
const defineEvent = (
  kind: EventKind,
  attributes: readonly LogAttributeDefinition[],
  severityNumbers: readonly number[] = [SEV_INFO],
): LogEventDefinition => ({
  kind,
  severityNumbers,
  attributes: [
    requiredString(A.KIND, 'event-kind', [kind]),
    requiredString(A.T, 'time'),
    optionalString(A.T_PRECISION, 'identifier', T_PRECISION_VALUES),
    ...attributes,
  ],
});

/** Complete producer-owned Logs vocabulary, consumed by encoding and strict reading. */
export const LOG_EVENT_DEFINITIONS: readonly LogEventDefinition[] = [
  defineEvent('prompt', [requiredInt(A.PROMPT_WORDS)]),
  defineEvent('turn', [
    requiredNumber(A.TURN_DUR_S),
    optionalInt(GENAI_INPUT_TOKENS),
    optionalInt(GENAI_OUTPUT_TOKENS),
    optionalInt(A.CACHE_READ),
    optionalInt(A.CACHE_CREATE),
    optionalString(GENAI_MODEL, 'model'),
  ]),
  defineEvent('usage', [
    requiredString(A.USAGE_OBSERVATION_KIND, 'identifier', USAGE_OBSERVATION_KINDS),
    optionalInt(GENAI_INPUT_TOKENS),
    optionalInt(GENAI_OUTPUT_TOKENS),
    optionalInt(A.CACHE_READ),
    optionalInt(A.CACHE_CREATE),
    optionalInt(A.USAGE_NANO_AIU),
  ]),
  defineEvent('tools', [
    requiredString(A.TOOL_NAME, 'identifier'),
    requiredInt(A.TOOL_COUNT),
    requiredNumber(A.TOOL_SPAN_S),
    optionalString(A.TOOL_SIG, 'signature'),
    optionalKv(A.TOOL_CONTROL, 'kv-int', 'control-signatures'),
    optionalInt(A.TOOL_RESULT_TOKENS),
  ]),
  defineEvent('skill', [
    requiredString(A.SKILL_NAME, 'identifier'),
    requiredString(A.SKILL_STATUS, 'identifier', [
      'completed',
      'abandoned',
      'superseded',
      'active',
    ]),
    optionalNumber(A.SKILL_DUR_S),
    optionalString(A.SKILL_ARG, 'identifier'),
  ]),
  defineEvent('flow', [
    requiredString(A.FLOW_NAME, 'identifier'),
    requiredString(A.FLOW_STAGE, 'identifier'),
    requiredString(A.FLOW_STATUS, 'identifier', ['done', 'blocked', 'in_progress', 'active']),
    optionalString(A.FLOW_FROM, 'identifier'),
  ]),
  defineEvent('flow_log', [
    requiredString(A.FLOWLOG_OP, 'identifier'),
    optionalString(A.FLOWLOG_NODE, 'identifier'),
    optionalString(A.FLOWLOG_FROM, 'identifier'),
    optionalString(A.FLOWLOG_TO, 'identifier'),
    optionalString(A.FLOWLOG_TYPE, 'identifier'),
    optionalString(A.FLOWLOG_EDGE_OP, 'identifier'),
  ]),
  defineEvent('branch', [
    requiredString(A.BRANCH_TO, 'path'),
    optionalString(A.BRANCH_FROM, 'path'),
  ]),
  defineEvent('harness', [
    requiredString(A.VERB, 'command'),
    optionalString(A.OBSERVE_KIND, 'identifier', OBSERVE_KIND_VALUES),
  ]),
  defineEvent(
    'checks',
    [
      requiredString(A.CHECKS_STATUS, 'identifier', ['ok', 'degraded', 'error']),
      optionalKv(A.CHECKS_GATES, 'kv-string', 'gates'),
    ],
    [SEV_INFO, SEV_WARN, SEV_ERROR],
  ),
  defineEvent(
    'command_exit',
    [
      requiredString(A.CMD_VERB, 'command'),
      requiredInt(A.CMD_EXIT, 0, 255),
      optionalString(A.CMD_STATUS, 'identifier', ['ok', 'degraded', 'error', 'fatal']),
      optionalString(A.CMD_CODE, 'e-code'),
    ],
    [SEV_INFO, SEV_ERROR],
  ),
  defineEvent('subagent', [
    requiredString(A.SUBAGENT_NAME, 'identifier'),
    requiredString(A.SUBAGENT_STATUS, 'identifier', ['completed', 'active']),
    optionalNumber(A.SUBAGENT_DUR_S),
  ]),
  defineEvent('compaction', []),
  defineEvent('model', [
    requiredString(GENAI_MODEL, 'model'),
    optionalString(A.EFFORT, 'identifier', PIJ_EFFORT_VALUES),
  ]),
  defineEvent('api_error', [optionalString(A.API_ERROR_SIG, 'signature')], [SEV_ERROR]),
  defineEvent('artifact', [
    requiredString(A.ARTIFACT_TYPE, 'identifier', ARTIFACT_TYPE_VALUES),
    requiredString(A.ARTIFACT_PATH, 'path'),
    requiredString(A.ARTIFACT_CHANGE, 'identifier', ['written', 'edited']),
    requiredInt(A.ARTIFACT_SIZE_LINES),
    requiredInt(A.ARTIFACT_SIZE_BYTES),
    optionalString(A.ARTIFACT_PLAN_ID, 'identifier'),
    optionalKv(A.ARTIFACT_COUNTS, 'kv-int', 'artifact-counts'),
    optionalKv(A.ARTIFACT_ENUMS, 'kv-string', 'artifact-enums'),
  ]),
  defineEvent('file', [
    requiredString(A.FILE_PATH, 'path'),
    requiredString(A.FILE_CHANGE, 'identifier', ['written', 'edited']),
    requiredInt(A.FILE_LINES_ADDED),
    requiredInt(A.FILE_LINES_REMOVED),
    requiredInt(A.FILE_BYTES_ADDED),
    requiredInt(A.FILE_BYTES_REMOVED),
  ]),
  defineEvent('mark', [
    requiredString(MARK_KIND, 'slug'),
    requiredKv(MARK_COUNTS, 'kv-int', 'mark-counts'),
    optionalString(MARK_VERDICT, 'slug'),
  ]),
];

export const LOG_EVENT_DEFINITION_BY_KIND: ReadonlyMap<string, LogEventDefinition> = new Map(
  LOG_EVENT_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

const ARTIFACT_ENUM_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  verdict: new Set([
    'APPROVE',
    'APPROVE_WITH_NOTES',
    'FIX_REQUIRED',
    'NEEDS_ATTENTION',
    'VALIDATED',
    'VALIDATED_WITH_FIXES',
    'other',
  ]),
  mode: new Set(['SIMPLE', 'FULL', 'other']),
  status: new Set(['READY', 'DRAFT', 'other']),
  target_proof: new Set([
    'CONTRACT_READY',
    'PREFERRED_DIRECTION',
    'DIRECTIONAL',
    'EXPLORATORY',
    'other',
  ]),
  current_proof: new Set([
    'CONTRACT_READY',
    'PREFERRED_DIRECTION',
    'DIRECTIONAL',
    'EXPLORATORY',
    'other',
  ]),
  certainty: new Set(['FULL', 'PARTIAL', 'NONE', 'COMPLETE', 'other']),
  pr_state: new Set(['OPEN', 'MERGED', 'CLOSED', 'DRAFT', 'other']),
};
const GATE_STATUS_VALUES = new Set(['ok', 'degraded', 'error', 'fail', 'timeout', 'skipped', 'na']);
/**
 * The refusal vocabulary, re-validated on the way THROUGH the wire in both
 * directions — an encoder and a decoder that trust each other are one writer away
 * from putting prose in a counts-only field.
 */
const E_CODE = /^E\d{3}$/;

function exactAnyValue(value: AnyValue, key: keyof AnyValue): boolean {
  return Object.keys(value).length === 1 && key in value;
}

function validStringRole(role: LogStringRole | undefined, value: string): boolean {
  switch (role) {
    case 'event-kind':
      return LOG_EVENT_DEFINITION_BY_KIND.has(value);
    case 'time':
      return isTelemetryTime(value);
    case 'model':
      return isTelemetryModel(value);
    case 'signature':
      return isTelemetrySignature(value);
    case 'path':
      return isTelemetryRelativePath(value);
    case 'command':
      return isTelemetryCommand(value);
    case 'slug':
      return /^[a-z][a-z0-9-]{0,31}$/.test(value);
    case 'e-code':
      return E_CODE.test(value);
    default:
      return isTelemetryExtensionString(value);
  }
}

function validKvEntry(role: LogKvRole | undefined, key: string, value: AnyValue): boolean {
  // plan 069: the control-signature keys are the 2-member closed allowlist and
  // contain a space, so they are gated HERE — before the generic extension-string
  // grammar, which admits only space-free atoms.
  if (role === 'control-signatures') {
    return CONTROL_SIGNATURES.has(key) && exactAnyValue(value, 'intValue');
  }
  if (!isTelemetryExtensionString(key)) return false;
  if (role === 'artifact-counts' && !(ARTIFACT_COUNT_KEYS as readonly string[]).includes(key)) {
    return false;
  }
  if (role === 'mark-counts' && !(MARK_COUNT_KEYS as readonly string[]).includes(key)) return false;
  if (role === 'artifact-enums') {
    const text = exactAnyValue(value, 'stringValue') ? value.stringValue : undefined;
    return (
      (ARTIFACT_ENUM_KEYS as readonly string[]).includes(key) &&
      typeof text === 'string' &&
      (ARTIFACT_ENUM_VALUES[key]?.has(text) ?? false)
    );
  }
  if (role === 'gates') {
    const text = exactAnyValue(value, 'stringValue') ? value.stringValue : undefined;
    return typeof text === 'string' && GATE_STATUS_VALUES.has(text);
  }
  if (exactAnyValue(value, 'intValue')) {
    return typeof value.intValue === 'string' && /^(?:0|[1-9]\d*)$/.test(value.intValue);
  }
  return (
    exactAnyValue(value, 'stringValue') &&
    typeof value.stringValue === 'string' &&
    isTelemetryExtensionString(value.stringValue)
  );
}

export function validateLogAttributeValue(
  definition: LogAttributeDefinition,
  value: AnyValue,
): boolean {
  if (definition.kind === 'string') {
    if (!exactAnyValue(value, 'stringValue') || typeof value.stringValue !== 'string') return false;
    return (
      validStringRole(definition.role, value.stringValue) &&
      (definition.values === undefined || definition.values.includes(value.stringValue))
    );
  }
  if (definition.kind === 'int' || definition.kind === 'number') {
    let number: number;
    if (exactAnyValue(value, 'intValue') && typeof value.intValue === 'string') {
      if (!/^(?:0|[1-9]\d*)$/.test(value.intValue)) return false;
      number = Number(value.intValue);
      if (!Number.isSafeInteger(number)) return false;
    } else if (
      definition.kind === 'number' &&
      exactAnyValue(value, 'doubleValue') &&
      typeof value.doubleValue === 'number' &&
      Number.isFinite(value.doubleValue)
    ) {
      number = value.doubleValue;
    } else {
      return false;
    }
    return (
      (definition.min === undefined || number >= definition.min) &&
      (definition.max === undefined || number <= definition.max)
    );
  }
  if (!exactAnyValue(value, 'kvlistValue') || value.kvlistValue === undefined) return false;
  const seen = new Set<string>();
  for (const entry of value.kvlistValue.values) {
    if (seen.has(entry.key) || !validKvEntry(definition.kvRole, entry.key, entry.value))
      return false;
    if (definition.kind === 'kv-string' && !exactAnyValue(entry.value, 'stringValue')) return false;
    if (definition.kind === 'kv-int' && !exactAnyValue(entry.value, 'intValue')) return false;
    seen.add(entry.key);
  }
  return true;
}

export function validateLogEventAttributes(attributes: readonly KeyValue[]): boolean {
  const byKey = new Map<string, AnyValue>();
  for (const attribute of attributes) {
    if (byKey.has(attribute.key)) return false;
    byKey.set(attribute.key, attribute.value);
  }
  const kindValue = byKey.get(A.KIND);
  const kind =
    kindValue !== undefined && exactAnyValue(kindValue, 'stringValue')
      ? kindValue.stringValue
      : undefined;
  const definition = typeof kind === 'string' ? LOG_EVENT_DEFINITION_BY_KIND.get(kind) : undefined;
  if (definition === undefined) return false;
  const allowed = new Map(definition.attributes.map((attribute) => [attribute.key, attribute]));
  if ([...byKey.keys()].some((key) => !allowed.has(key))) return false;
  for (const attribute of definition.attributes) {
    const value = byKey.get(attribute.key);
    if (value === undefined) {
      if (attribute.required) return false;
      continue;
    }
    if (!validateLogAttributeValue(attribute, value)) return false;
  }
  if (
    kind === 'usage' &&
    ![GENAI_INPUT_TOKENS, GENAI_OUTPUT_TOKENS, A.CACHE_READ, A.CACHE_CREATE, A.USAGE_NANO_AIU].some(
      (key) => byKey.has(key),
    )
  ) {
    return false;
  }
  const observe = byKey.get(A.OBSERVE_KIND);
  const verb = byKey.get(A.VERB);
  if (observe !== undefined && verb?.stringValue !== 'observe') return false;
  return true;
}

function expectedSeverity(
  kind: string,
  attributes: ReadonlyMap<string, AnyValue>,
): number | undefined {
  if (kind === 'checks') {
    const status = readStr(attributes.get(A.CHECKS_STATUS));
    return status === 'ok' ? SEV_INFO : status === 'degraded' ? SEV_WARN : SEV_ERROR;
  }
  if (kind === 'command_exit') {
    const exit = readNum(attributes.get(A.CMD_EXIT));
    return exit === undefined ? undefined : exit === 0 ? SEV_INFO : SEV_ERROR;
  }
  const definition = LOG_EVENT_DEFINITION_BY_KIND.get(kind);
  return definition?.severityNumbers.length === 1 ? definition.severityNumbers[0] : undefined;
}

export function validateLogRecordContract(record: LogRecord): boolean {
  if (
    record.attributes === undefined ||
    typeof record.timeUnixNano !== 'string' ||
    !/^(?:0|[1-9]\d*)$/.test(record.timeUnixNano) ||
    Object.hasOwn(record, 'observedTimeUnixNano') ||
    typeof record.severityNumber !== 'number' ||
    typeof record.severityText !== 'string' ||
    !validateLogEventAttributes(record.attributes)
  ) {
    return false;
  }
  const attributeMap = attrMap(record.attributes);
  const kind = readStr(attributeMap.get(A.KIND));
  const eventTime = readStr(attributeMap.get(A.T));
  const severity = kind === undefined ? undefined : expectedSeverity(kind, attributeMap);
  return (
    eventTime !== undefined &&
    record.timeUnixNano === toNanos(eventTime) &&
    severity !== undefined &&
    record.severityNumber === severity &&
    record.severityText === severityText(severity)
  );
}

/**
 * Encode ONE event, or `null` when the encoded record fails the producer contract.
 * Returning `null` (rather than throwing) is what keeps ONE unencodable event from
 * making a whole session unreadable — the caller drops it and names its kind.
 */
function encodeEventOrNull(e: Event): LogRecord | null {
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
    case 'usage':
      attrs.push(kv(A.USAGE_OBSERVATION_KIND, sv(e.observation_kind)));
      if (e.in !== undefined) attrs.push(kv(GENAI_INPUT_TOKENS, nv(e.in)));
      if (e.out !== undefined) attrs.push(kv(GENAI_OUTPUT_TOKENS, nv(e.out)));
      if (e.cache_read !== undefined) attrs.push(kv(A.CACHE_READ, nv(e.cache_read)));
      if (e.cache_create !== undefined) attrs.push(kv(A.CACHE_CREATE, nv(e.cache_create)));
      if (e.nano_aiu !== undefined) attrs.push(kv(A.USAGE_NANO_AIU, nv(e.nano_aiu)));
      break;
    case 'tools':
      attrs.push(
        kv(A.TOOL_NAME, sv(e.name)),
        kv(A.TOOL_COUNT, nv(e.count)),
        kv(A.TOOL_SPAN_S, nv(e.span_s)),
      );
      if (e.signature !== undefined) attrs.push(kv(A.TOOL_SIG, sv(e.signature)));
      if (e.control !== undefined) {
        attrs.push(
          kv(A.TOOL_CONTROL, {
            kvlistValue: {
              values: Object.entries(e.control).map(([key, value]) => kv(key, nv(value))),
            },
          }),
        );
      }
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
      // observe_kind is gated on the `observe` verb at the boundary (plan 056):
      // a stray value on any other verb is dropped, not encoded.
      if (e.verb === 'observe' && e.observe_kind !== undefined) {
        attrs.push(kv(A.OBSERVE_KIND, sv(e.observe_kind)));
      }
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
      // FX001 · D2: the refusal's code goes ON THE WIRE. Without it the roll to
      // `refs/harness-telemetry/*` erased every gate refusal the moment a commit
      // flushed the buffer — the evidence existed only until the first commit.
      if (e.code !== undefined && E_CODE.test(e.code)) attrs.push(kv(A.CMD_CODE, sv(e.code)));
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
    case 'file': {
      // path is already CONFINED by serializeEvent (repo-relative or `<external>`);
      // the delta is integer counts only (plan 056).
      attrs.push(
        kv(A.FILE_PATH, sv(e.path)),
        kv(A.FILE_CHANGE, sv(e.change)),
        kv(A.FILE_LINES_ADDED, nv(e.delta.lines_added)),
        kv(A.FILE_LINES_REMOVED, nv(e.delta.lines_removed)),
        kv(A.FILE_BYTES_ADDED, nv(e.delta.bytes_added)),
        kv(A.FILE_BYTES_REMOVED, nv(e.delta.bytes_removed)),
      );
      break;
    }
    case 'mark': {
      attrs.push(kv(MARK_KIND, sv(e.mark_kind)));
      attrs.push(
        kv(MARK_COUNTS, {
          kvlistValue: {
            values: Object.entries(e.counts).map(([key, value]) => kv(key, nv(value))),
          },
        }),
      );
      if (e.verdict !== undefined) attrs.push(kv(MARK_VERDICT, sv(e.verdict)));
      break;
    }
  }

  const record: LogRecord = {
    timeUnixNano: toNanos(e.t),
    severityNumber: sev,
    severityText: severityText(sev),
    attributes: attrs,
  };
  if (!validateLogRecordContract(record)) {
    return null;
  }
  return record;
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
    case 'usage': {
      const ev: UsageEvent = {
        ...base,
        kind,
        observation_kind: (readStr(m.get(A.USAGE_OBSERVATION_KIND)) ?? '') as UsageObservationKind,
      };
      const i = readNum(m.get(GENAI_INPUT_TOKENS));
      const o = readNum(m.get(GENAI_OUTPUT_TOKENS));
      const cr = readNum(m.get(A.CACHE_READ));
      const cc = readNum(m.get(A.CACHE_CREATE));
      const nanoAiu = readNum(m.get(A.USAGE_NANO_AIU));
      if (i !== undefined) ev.in = i;
      if (o !== undefined) ev.out = o;
      if (cr !== undefined) ev.cache_read = cr;
      if (cc !== undefined) ev.cache_create = cc;
      if (nanoAiu !== undefined) ev.nano_aiu = nanoAiu;
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
      const controlEntries = m.get(A.TOOL_CONTROL)?.kvlistValue?.values ?? [];
      if (controlEntries.length > 0) {
        const control: Record<string, number> = {};
        for (const entry of controlEntries) control[entry.key] = readNum(entry.value) ?? 0;
        ev.control = control;
      }
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
    case 'harness': {
      const ev: HarnessEvent = { ...base, kind, verb: readStr(m.get(A.VERB)) ?? '' };
      const ok = readStr(m.get(A.OBSERVE_KIND));
      if (ok !== undefined) ev.observe_kind = ok as ObservationKind;
      return ev;
    }
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
      // Re-validated on the way back, exactly as `decodeSegment` does on the way in:
      // a fixed vocabulary checked once is a fixed vocabulary until the next writer.
      const code = readStr(m.get(A.CMD_CODE));
      if (code !== undefined && E_CODE.test(code)) ev.code = code;
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
    case 'file': {
      const ev: FileEvent = {
        ...base,
        kind,
        path: readStr(m.get(A.FILE_PATH)) ?? '',
        change: (readStr(m.get(A.FILE_CHANGE)) ?? 'edited') as 'written' | 'edited',
        delta: {
          lines_added: readNum(m.get(A.FILE_LINES_ADDED)) ?? 0,
          lines_removed: readNum(m.get(A.FILE_LINES_REMOVED)) ?? 0,
          bytes_added: readNum(m.get(A.FILE_BYTES_ADDED)) ?? 0,
          bytes_removed: readNum(m.get(A.FILE_BYTES_REMOVED)) ?? 0,
        },
      };
      return ev;
    }
    case 'mark': {
      const counts: Record<string, number> = {};
      for (const entry of m.get(MARK_COUNTS)?.kvlistValue?.values ?? []) {
        counts[entry.key] = readNum(entry.value) ?? 0;
      }
      const ev: Event = {
        ...base,
        kind,
        mark_kind: readStr(m.get(MARK_KIND)) ?? '',
        counts,
      };
      const verdict = readStr(m.get(MARK_VERDICT));
      if (verdict !== undefined) ev.verdict = verdict;
      return ev;
    }
    default:
      return { ...base, kind } as Event;
  }
}

export type OtlpSegmentReconstruction =
  | { ok: true; segment: Segment }
  | {
      ok: false;
      reason: 'missing_resource' | 'schema_identity' | 'product_commit' | 'unsafe_resource';
    };

/**
 * Typed logs-rooted Segment reconstruction shared by session export and strict
 * published retrieval. It validates legacy 2.4/v0.1 and current schema identity
 * pairings while keeping product provenance even when the event list is empty.
 */
export function reconstructSegmentFromOtlpLogs(logs: LogsData): OtlpSegmentReconstruction {
  const resourceLogs = logs.resourceLogs?.[0];
  const scopeLogs = resourceLogs?.scopeLogs?.[0];
  if (resourceLogs === undefined || scopeLogs === undefined) {
    return { ok: false, reason: 'missing_resource' };
  }
  const attrs = attrMap(resourceLogs.resource?.attributes);
  const schemaVersion = readStr(attrs.get(RES_SCHEMA_VERSION)) ?? 'unknown';
  const service = readStr(attrs.get(RES_SERVICE));
  if (
    !Array.isArray(scopeLogs.logRecords) ||
    !scopeLogs.logRecords.every((record) => validateLogRecordContract(record))
  ) {
    return { ok: false, reason: 'unsafe_resource' };
  }
  const serviceVersion = readStr(attrs.get(RES_SERVICE_VERSION));
  const sessionId = readStr(attrs.get(RES_SESSION));
  const harness = readStr(attrs.get(RES_HARNESS));
  const command = readStr(attrs.get(RES_COMMAND));
  const branch = readStr(attrs.get(RES_BRANCH));
  if (
    (schemaVersion !== '2.4' &&
      schemaVersion !== '2.5' &&
      schemaVersion !== '2.6' &&
      schemaVersion !== '2.7') ||
    service !== 'harness' ||
    serviceVersion === undefined ||
    !isTelemetryServiceVersion(serviceVersion) ||
    sessionId === undefined ||
    !isTelemetrySessionId(sessionId) ||
    harness === undefined ||
    !isTelemetryHarness(harness) ||
    command === undefined ||
    !isTelemetryCommand(command) ||
    (branch !== undefined && !isTelemetryRelativePath(branch))
  ) {
    return { ok: false, reason: 'unsafe_resource' };
  }
  const identity = schemaIdentityForSegmentVersion(schemaVersion);
  if (
    resourceLogs.schemaUrl !== identity.schemaUrl ||
    scopeLogs.schemaUrl !== identity.schemaUrl ||
    scopeLogs.scope?.name !== SCOPE_NAME ||
    scopeLogs.scope?.version !== identity.scopeVersion
  ) {
    return { ok: false, reason: 'schema_identity' };
  }
  if (
    schemaVersion !== '2.6' &&
    schemaVersion !== '2.7' &&
    scopeLogs.logRecords.some((record) => {
      const kind = readStr(attrMap(record.attributes).get(A.KIND));
      return kind === 'usage';
    })
  ) {
    return { ok: false, reason: 'unsafe_resource' };
  }

  const productCommit = readStr(attrs.get(RES_PRODUCT_COMMIT));
  if (
    (productCommit !== undefined && schemaVersion === '2.4') ||
    (productCommit !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(productCommit))
  ) {
    return { ok: false, reason: 'product_commit' };
  }

  // v2.7 capture provenance. `reconciled` is the only value, and it exists only on
  // 2.7 — anything else is a forged or corrupt resource, so the read fails closed
  // rather than dropping the marker and handing back a segment that looks live.
  const captureMode = readStr(attrs.get(RES_CAPTURE_MODE));
  if (captureMode !== undefined && (schemaVersion !== '2.7' || captureMode !== 'reconciled')) {
    return { ok: false, reason: 'unsafe_resource' };
  }

  const envPairs = attrs.get(RES_ENV)?.kvlistValue?.values ?? [];
  const envKeys = new Set<string>();
  for (const { key, value } of envPairs) {
    const text = readStr(value);
    if (envKeys.has(key) || text === undefined || !isCapturedEnvEntry(key, text, schemaVersion)) {
      return { ok: false, reason: 'unsafe_resource' };
    }
    envKeys.add(key);
  }

  const events = otlpLogsToEvents(logs);
  const segment: Segment = {
    schema_version: schemaVersion,
    command,
    harness,
    harness_version: serviceVersion,
    harness_session_id: sessionId,
    timecode: events[0]?.t ?? '',
    window: { since: 'session-start', from: 0, to: 0 },
    branch: branch ?? null,
    tokens: null,
    effort: null,
    event_stream: events,
    rollup: events.length > 0 ? computeRollup(events) : null,
  };
  if (productCommit !== undefined) segment.product_commit = productCommit;
  if (captureMode === 'reconciled') segment.capture_mode = 'reconciled';
  if (envPairs.length > 0) {
    segment.captured_env = Object.fromEntries(
      envPairs.flatMap(({ key, value }) => {
        const text = readStr(value);
        return text === undefined ? [] : [[key, text]];
      }),
    );
  }
  return { ok: true, segment };
}

/** Serialize a segment's `event_stream` to one version-aware `ResourceLogs`. */
/**
 * A logs production and the honest note of what it could not carry.
 *
 * `skipped` names each event KIND dropped because its encoded record failed the
 * producer contract. Like {@link produceOtlpMetrics}, this is never an error: a throw
 * here made the WHOLE session unreadable over one unencodable event. Always warn,
 * never hide — drop the event, name its kind, return the rest.
 */
export interface OtlpLogsProduction {
  logs: LogsData;
  skipped: readonly string[];
}

/**
 * Produce this segment's OTLP logs, naming any event kind the producer contract could
 * not admit. Never throws.
 */
export function produceOtlpLogs(seg: Segment): OtlpLogsProduction {
  const identity = schemaIdentityForSegmentVersion(seg.schema_version);
  const attributes = resourceAttrs(seg);
  const logRecords: LogRecord[] = [];
  const skipped = new Set<string>();
  for (const event of seg.event_stream) {
    const record = encodeEventOrNull(event);
    if (record === null) skipped.add(event.kind);
    else logRecords.push(record);
  }
  return {
    logs: {
      resourceLogs: [
        {
          resource: { attributes },
          schemaUrl: identity.schemaUrl,
          scopeLogs: [
            {
              scope: { name: SCOPE_NAME, version: identity.scopeVersion },
              schemaUrl: identity.schemaUrl,
              logRecords,
            },
          ],
        },
      ],
    },
    skipped: [...skipped].sort(),
  };
}

/** {@link produceOtlpLogs} for callers that carry no degrade channel. Never throws. */
export function segmentToOtlpLogs(seg: Segment): LogsData {
  return produceOtlpLogs(seg).logs;
}

/** Reconstruct the exact serialized `Event[]` from OTLP Logs (the inverse). */
export function otlpLogsToEvents(logs: LogsData): Event[] {
  return otlpLogsToEventRecords(logs).map((r) => r.event);
}

/** One decoded event plus the RESOURCE-level facts a reader needs about its origin. */
export interface OtlpEventRecord {
  event: Event;
  /**
   * True when the `ResourceLogs` this event came from declared
   * `harness.capture_mode = reconciled` — i.e. the whole window was recovered
   * LATE, from an orphaned lane, by a process that never watched it happen.
   */
  reconciled: boolean;
}

/**
 * {@link otlpLogsToEvents}, but keeping each event's resource provenance (plan 070).
 *
 * A combined session export concatenates one `ResourceLogs` per segment, so capture
 * provenance is a per-RESOURCE fact that the flat event list throws away. Without
 * this, a reconciled window's events arrive at the report indistinguishable from
 * live ones and every rendered surface — timeline, attribution, discipline panel —
 * draws them the same. Correct field, indistinguishable render, is not honesty.
 *
 * Returns event objects by IDENTITY, so a caller can sort and filter the event list
 * freely and still ask "was this one recovered?" via a `Set`, without threading a
 * parallel array or widening the `Event` type with a field that must never be
 * serialized.
 */
export function otlpLogsToEventRecords(logs: LogsData): OtlpEventRecord[] {
  const out: OtlpEventRecord[] = [];
  for (const rl of logs.resourceLogs ?? []) {
    const reconciled =
      readStr(attrMap(rl.resource?.attributes).get(RES_CAPTURE_MODE)) === 'reconciled';
    for (const sl of rl.scopeLogs ?? [])
      for (const rec of sl.logRecords ?? []) out.push({ event: decodeEvent(rec), reconciled });
  }
  return out;
}
