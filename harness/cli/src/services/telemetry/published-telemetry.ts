import type {
  RemoteRepository,
  RemoteTelemetryRefSnapshot,
} from '../../adapters/git/remote-telemetry-git-port.js';
import { posixJoin } from '../shared/posix-path.js';
import { telemetryDir } from './cursor.js';
import { reconstructSegmentFromOtlpLogs, validateLogRecordContract } from './otlp/logs.js';
import {
  METRIC_DEFINITION_BY_NAME,
  type MetricDefinition,
  validateMetricDataPointSet,
  validateMetricDataPointTuple,
} from './otlp/metrics.js';
import type { AnyValue, KeyValue, LogRecord, LogsData, NumberDataPoint } from './otlp/types.js';
import { compareUnsignedUtf8, type SelectableTelemetrySession } from './remote-selection.js';
import {
  type ProductCommitCoverage,
  ROLLED_LOGS_NAME,
  ROLLED_MANIFEST_NAME,
  ROLLED_METRICS_NAME,
  ROLLUP_FORMAT,
  type RollManifest,
  splitJsonl,
  verifyProductCommitCoverage,
} from './rolled-shard.js';
import {
  isCapturedEnvEntry,
  isCredentialShaped,
  isTelemetryCommand,
  isTelemetryExtensionString,
  isTelemetryHarness,
  isTelemetryModel,
  isTelemetryRelativePath,
  isTelemetryServiceVersion,
  isTelemetrySessionId,
  isTelemetrySignature,
  isTelemetryTime,
  SEGMENT_FIELD_KEYS,
  type Segment,
} from './segment.js';
import { combineSession, type SessionExport } from './session-export.js';

export type PublishedShape =
  | 'canonical-pair'
  | 'pair-plus-fallback'
  | 'fallback-only'
  | 'legacy-history'
  | 'metrics-only'
  | 'identity-only';

export type PublishedDataFidelity = 'full' | 'partial' | 'identity-only';

export interface PublishedDataCoverage {
  events: { state: 'full' | 'observed' | 'unavailable'; count: number | null };
  measurements: { state: 'complete' | 'measured' | 'unavailable'; count: number | null };
  gaps: Array<'events_unavailable' | 'measurements_unavailable'>;
}

export interface ValidatedPublishedBlob {
  repositoryKey: string;
  sessionId: string;
  refName: string;
  advertisedOid: string;
  commitOid: string;
  path: string;
  gitOid: string;
  mode: '100644';
  bytes: Uint8Array;
}

export interface PublishedTelemetrySessionInput {
  group: SelectableTelemetrySession;
  refs: readonly RemoteTelemetryRefSnapshot[];
}

export interface PublishedRefEvidence {
  name: string;
  shape: PublishedShape;
  product: SelectableTelemetrySession['product'];
}

export interface PublishedTelemetrySession {
  repository: RemoteRepository;
  sessionId: string;
  fidelity: PublishedDataFidelity;
  coverage: PublishedDataCoverage;
  product: SelectableTelemetrySession['product'];
  shapes: PublishedShape[];
  gaps: SelectableTelemetrySession['gaps'];
  refs: readonly RemoteTelemetryRefSnapshot[];
  refEvidence: PublishedRefEvidence[];
  blobs: ValidatedPublishedBlob[];
  sessionExport: SessionExport | null;
}

export type PublishedTelemetryDecodeResult =
  | { ok: true; session: PublishedTelemetrySession }
  | { ok: false; reason: 'malformed_or_unsafe' };

const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REMOTE_MANIFEST_FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SAFE_PATH =
  /^(?:manifest\.json|session\.(?:logs|metrics)\.jsonl|\d+\.(?:json|logs\.jsonl|metrics\.jsonl))$/;
const SAFE_UNKNOWN_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const FORBIDDEN_UNKNOWN_KEY =
  /prompt|response|message|content|body|args|argv|command|secret|password|credential|cookie/i;
const RELATIVE_PATH_STRING =
  /^(?![A-Za-z]:[\\/])(?![\\/])(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$)).{1,1024}$/;

const KNOWN_KEYS = new Set<string>([
  ...SEGMENT_FIELD_KEYS,
  'format',
  'session',
  'start_date',
  'max_seq',
  'product_commits',
  'resourceLogs',
  'resourceMetrics',
  'resource',
  'attributes',
  'schemaUrl',
  'scopeLogs',
  'scopeMetrics',
  'scope',
  'name',
  'version',
  'logRecords',
  'metrics',
  'key',
  'value',
  'stringValue',
  'intValue',
  'doubleValue',
  'boolValue',
  'arrayValue',
  'kvlistValue',
  'values',
  'timeUnixNano',
  'observedTimeUnixNano',
  'severityNumber',
  'severityText',
  'body',
  'traceId',
  'spanId',
  'flags',
  'droppedAttributesCount',
  'description',
  'unit',
  'gauge',
  'sum',
  'histogram',
  'dataPoints',
  'aggregationTemporality',
  'isMonotonic',
  'startTimeUnixNano',
  'asInt',
  'asDouble',
  'count',
  'sum',
  'bucketCounts',
  'explicitBounds',
  'min',
  'max',
  'exemplars',
  'kind',
  't',
  't_precision',
  'dur_s',
  'in',
  'out',
  'cache_read',
  'cache_create',
  'words',
  'span_s',
  'status',
  'model',
  'effort',
  'verdict',
  'reason',
  'path',
  'change',
  'delta',
  'lines_added',
  'lines_removed',
  'bytes_added',
  'bytes_removed',
  'from',
  'to',
  'since',
  'input',
  'output',
  'total',
  'subagent_tokens',
  'grand_total',
  'events',
  'blocks',
  'files',
  'written',
  'edited',
  'turns',
  'output_tokens',
  'activity',
  'wall_s',
  'agent_s',
  'human_s',
  'idle_s',
]);

const DYNAMIC_MAP_KEYS = new Set(['captured_env', 'skills', 'tools', 'harness_commands', 'models']);

class StrictJsonParser {
  private offset = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value(0);
    this.space();
    if (this.offset !== this.source.length) throw new Error('trailing');
    return value;
  }

  private space(): void {
    while (/\s/.test(this.source[this.offset] ?? '')) this.offset++;
  }

  private value(depth: number): unknown {
    if (depth > 64 || ++this.nodes > 100_000) throw new Error('bounds');
    this.space();
    const char = this.source[this.offset];
    if (char === '{') return this.object(depth + 1);
    if (char === '[') return this.array(depth + 1);
    if (char === '"') return this.string();
    if (this.source.startsWith('true', this.offset)) {
      this.offset += 4;
      return true;
    }
    if (this.source.startsWith('false', this.offset)) {
      this.offset += 5;
      return false;
    }
    if (this.source.startsWith('null', this.offset)) {
      this.offset += 4;
      return null;
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.offset),
    );
    if (match === null) throw new Error('value');
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error('number');
    return value;
  }

  private string(): string {
    const start = this.offset++;
    let escaped = false;
    while (this.offset < this.source.length) {
      const char = this.source[this.offset++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') return JSON.parse(this.source.slice(start, this.offset)) as string;
      if (char !== undefined && char.charCodeAt(0) < 0x20) throw new Error('control');
    }
    throw new Error('string');
  }

  private object(depth: number): Record<string, unknown> {
    this.offset++;
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.space();
    if (this.source[this.offset] === '}') {
      this.offset++;
      return result;
    }
    while (true) {
      this.space();
      if (this.source[this.offset] !== '"') throw new Error('key');
      const key = this.string();
      if (keys.has(key)) throw new Error('duplicate');
      keys.add(key);
      this.space();
      if (this.source[this.offset++] !== ':') throw new Error('colon');
      result[key] = this.value(depth);
      this.space();
      const next = this.source[this.offset++];
      if (next === '}') return result;
      if (next !== ',') throw new Error('comma');
    }
  }

  private array(depth: number): unknown[] {
    this.offset++;
    const result: unknown[] = [];
    this.space();
    if (this.source[this.offset] === ']') {
      this.offset++;
      return result;
    }
    while (true) {
      result.push(this.value(depth));
      this.space();
      const next = this.source[this.offset++];
      if (next === ']') return result;
      if (next !== ',') throw new Error('comma');
    }
  }
}

export function parseJsonWithoutDuplicateKeys(raw: string): unknown {
  const source = raw.startsWith('\ufeff') ? raw.slice(1) : raw;
  return new StrictJsonParser(source).parse();
}

const strictJson = parseJsonWithoutDuplicateKeys;

function strictJsonLines(raw: string): unknown[] {
  const source = raw.startsWith('\ufeff') ? raw.slice(1) : raw;
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => strictJson(line));
}

interface GuardState {
  nodes: number;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeString(value: string, strictUnknown: boolean): boolean {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\')) return false;
  if (hasControlCharacter(value)) return false;
  if (isCredentialShaped(value)) return false;
  // Unknown additive strings have no producer-owned role contract, so no value
  // grammar can make them publishable. Named fields are validated later by
  // their owning Segment/Logs/Metrics contract; only the unknown state rejects
  // unconditionally here. Credential detection remains defense in depth.
  return !strictUnknown;
}

function privacySafe(
  value: unknown,
  parentKey: string | null = null,
  strictUnknown = false,
  depth = 0,
  state: GuardState = { nodes: 0 },
): boolean {
  if (strictUnknown && (depth > 8 || ++state.nodes > 10_000)) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 1024 && safeString(value, strictUnknown);
  if (Array.isArray(value)) {
    return value.every((entry) => privacySafe(entry, parentKey, strictUnknown, depth + 1, state));
  }
  if (typeof value !== 'object') return false;

  const dynamicMap = parentKey !== null && DYNAMIC_MAP_KEYS.has(parentKey);
  for (const [key, child] of Object.entries(value)) {
    const known = KNOWN_KEYS.has(key) || dynamicMap;
    if (!known && (!SAFE_UNKNOWN_KEY.test(key) || FORBIDDEN_UNKNOWN_KEY.test(key))) return false;
    if (!privacySafe(child, key, strictUnknown || !known, depth + 1, state)) return false;
  }
  return true;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
  );
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:@+/{}-]{1,256}$/;
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/;
const UINT64_MAX = '18446744073709551615';

function canonicalUint64(value: string): boolean {
  return (
    DECIMAL_INTEGER.test(value) &&
    value.length <= UINT64_MAX.length &&
    (value.length < UINT64_MAX.length || value <= UINT64_MAX)
  );
}

function compareUint64(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
const SCHEMA_URLS = {
  '2.4': 'https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.1.0',
  '2.5': 'https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.2.0',
} as const;
const EVENT_KINDS = new Set([
  'api_error',
  'compaction',
  'file_change',
  'local_command',
  'prompt',
  'subagent',
  'tool',
  'turn',
]);

function safeKnownString(key: string | null, value: string): boolean {
  if (!safeString(value, false)) return false;
  if (key === 'schema_version') return value === '2.4' || value === '2.5';
  if (key === 'product_commit') return FULL_OID.test(value) && value === value.toLowerCase();
  if (key === 'timecode' || key === 't') return isTelemetryTime(value);
  if (key === 'kind') return EVENT_KINDS.has(value);
  if (key === 'since')
    return value === 'last-command' || value === 'session-start' || value === 'mark';
  if (key === 'effort') {
    return new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).has(value);
  }
  if (key === 'command' || key === 'verb') return isTelemetryCommand(value);
  if (key === 'harness') return isTelemetryHarness(value);
  if (key === 'harness_version') return isTelemetryServiceVersion(value);
  if (key === 'harness_session_id') return isTelemetrySessionId(value);
  if (key === 'model') return isTelemetryModel(value);
  if (key === 'signature') return isTelemetrySignature(value);
  if (key === 'path' || key === 'written' || key === 'edited' || key === 'branch') {
    return isTelemetryRelativePath(value);
  }
  return isTelemetryExtensionString(value);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safeIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && safeKnownString(null, value);
}

function validStringArray(value: unknown, path = false): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'string' &&
        (path ? isTelemetryRelativePath(entry) : isTelemetryExtensionString(entry)),
    )
  );
}

function validNumericMap(value: unknown): boolean {
  const map = record(value);
  return (
    map !== null &&
    Object.entries(map).every(
      ([key, count]) =>
        SAFE_UNKNOWN_KEY.test(key) && isTelemetryExtensionString(key) && nonNegativeInteger(count),
    )
  );
}

const SEGMENT_EVENT_KINDS = new Set([
  'prompt',
  'turn',
  'tools',
  'skill',
  'flow',
  'flow_log',
  'branch',
  'harness',
  'checks',
  'command_exit',
  'subagent',
  'compaction',
  'model',
  'api_error',
  'artifact',
  'file',
  'mark',
]);
const T_PRECISION_VALUES = new Set(['exact', 'anchored', 'interpolated', 'interval']);
const OBSERVE_KINDS = new Set([
  'difficulty',
  'magic-wand',
  'gift',
  'insight',
  'coordination',
  'improvement-suggestion',
  'confusion',
  'win',
]);
const ARTIFACT_TYPES = new Set([
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
]);
const EVENT_STRING_KEYS = new Set([
  'model',
  'name',
  'status',
  'flow',
  'stage',
  'op',
  'node',
  'type',
  'edge_op',
  'from',
  'to',
  'verb',
  'signature',
  'arg',
  'plan_id',
]);
const EVENT_NUMBER_KEYS = new Set([
  'words',
  'dur_s',
  'in',
  'out',
  'cache_read',
  'cache_create',
  'count',
  'span_s',
  'exit',
  'result_tokens',
]);

function validEvent(value: unknown): boolean {
  const event = record(value);
  if (
    event === null ||
    typeof event.t !== 'string' ||
    !isTelemetryTime(event.t) ||
    typeof event.kind !== 'string' ||
    !SEGMENT_EVENT_KINDS.has(event.kind)
  ) {
    return false;
  }
  for (const [key, child] of Object.entries(event)) {
    if (key === 't' || key === 'kind') continue;
    if (key === 't_precision') {
      if (typeof child !== 'string' || !T_PRECISION_VALUES.has(child)) return false;
    } else if (EVENT_STRING_KEYS.has(key)) {
      if (typeof child !== 'string') return false;
      if (key === 'model' && !isTelemetryModel(child)) return false;
      if (key === 'signature' && !isTelemetrySignature(child)) return false;
      if (key === 'verb' && !isTelemetryCommand(child)) return false;
      if (
        key !== 'model' &&
        key !== 'signature' &&
        key !== 'verb' &&
        !isTelemetryExtensionString(child)
      ) {
        return false;
      }
    } else if (EVENT_NUMBER_KEYS.has(key)) {
      if (!nonNegativeNumber(child)) return false;
    } else if (key === 'observe_kind') {
      if (typeof child !== 'string' || !OBSERVE_KINDS.has(child)) return false;
    } else if (key === 'artifact_type') {
      if (typeof child !== 'string' || !ARTIFACT_TYPES.has(child)) return false;
    } else if (key === 'mark_kind' || key === 'verdict') {
      if (typeof child !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(child)) return false;
    } else if (key === 'path') {
      if (typeof child !== 'string' || !RELATIVE_PATH_STRING.test(child) || child.includes('\\')) {
        return false;
      }
    } else if (key === 'change') {
      if (child !== 'written' && child !== 'edited') return false;
    } else if (key === 'gates') {
      const gates = record(child);
      if (
        gates === null ||
        Object.entries(gates).some(
          ([gate, state]) => !SAFE_UNKNOWN_KEY.test(gate) || !safeIdentity(state),
        )
      ) {
        return false;
      }
    } else if (key === 'counts') {
      if (!validNumericMap(child)) return false;
    } else if (key === 'enums') {
      const enums = record(child);
      if (
        enums === null ||
        Object.entries(enums).some(
          ([enumKey, enumValue]) => !SAFE_UNKNOWN_KEY.test(enumKey) || !safeIdentity(enumValue),
        )
      ) {
        return false;
      }
    } else if (key === 'delta') {
      const delta = record(child);
      if (
        delta === null ||
        !hasExactKeys(delta, ['lines_added', 'lines_removed', 'bytes_added', 'bytes_removed']) ||
        Object.values(delta).some((count) => !nonNegativeInteger(count))
      ) {
        return false;
      }
    } else if (key === 'size') {
      const size = record(child);
      if (
        size === null ||
        !hasExactKeys(size, ['lines', 'bytes']) ||
        Object.values(size).some((count) => !nonNegativeInteger(count))
      ) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function validTokens(value: unknown, keys: readonly string[]): boolean {
  const tokens = record(value);
  return (
    tokens !== null && hasExactKeys(tokens, keys) && Object.values(tokens).every(nonNegativeInteger)
  );
}

function validRollup(value: unknown): boolean {
  if (value === null) return true;
  const rollup = record(value);
  if (
    rollup === null ||
    !hasExactKeys(rollup, [
      'activity',
      'flow_stage_time_s',
      'skills',
      'tokens',
      'tools',
      'outcomes',
    ])
  ) {
    return false;
  }
  const activity = record(rollup.activity);
  if (
    activity === null ||
    !hasExactKeys(activity, ['wall_s', 'agent_working_s', 'human_s', 'idle_s', 'working_ratio']) ||
    !nonNegativeNumber(activity.wall_s) ||
    !nonNegativeNumber(activity.agent_working_s) ||
    !nonNegativeNumber(activity.human_s) ||
    !nonNegativeNumber(activity.idle_s) ||
    !nonNegativeNumber(activity.working_ratio) ||
    activity.working_ratio > 1 ||
    !validNumericMap(rollup.flow_stage_time_s) ||
    !validNumericMap(rollup.tools)
  ) {
    return false;
  }
  const skills = record(rollup.skills);
  if (
    skills === null ||
    Object.entries(skills).some(([key, skill]) => {
      const item = record(skill);
      return (
        !SAFE_UNKNOWN_KEY.test(key) ||
        item === null ||
        !hasExactKeys(item, ['runs', 'abandoned', 'superseded']) ||
        Object.values(item).some((count) => !nonNegativeInteger(count))
      );
    })
  ) {
    return false;
  }
  if (
    rollup.tokens !== null &&
    !validTokens(rollup.tokens, ['in', 'out', 'cache_read', 'cache_create'])
  ) {
    return false;
  }
  const outcomes = record(rollup.outcomes);
  return (
    outcomes !== null &&
    hasExactKeys(outcomes, ['exits'], ['checks']) &&
    (outcomes.checks === undefined || safeIdentity(outcomes.checks)) &&
    validNumericMap(outcomes.exits)
  );
}

function validSegmentKnownField(key: string, value: unknown, version: '2.4' | '2.5'): boolean {
  switch (key) {
    case 'schema_version':
      return value === '2.4' || value === '2.5';
    case 'command':
      return typeof value === 'string' && isTelemetryCommand(value);
    case 'harness':
      return typeof value === 'string' && isTelemetryHarness(value);
    case 'harness_version':
      return typeof value === 'string' && isTelemetryServiceVersion(value);
    case 'harness_session_id':
      return typeof value === 'string' && isTelemetrySessionId(value);
    case 'timecode':
      return typeof value === 'string' && isTelemetryTime(value);
    case 'window': {
      const window = record(value);
      return (
        window !== null &&
        hasExactKeys(window, ['since', 'from', 'to']) &&
        (window.since === 'session-start' || window.since === 'last-command') &&
        nonNegativeInteger(window.from) &&
        nonNegativeInteger(window.to) &&
        window.from <= window.to
      );
    }
    case 'branch':
      return value === null || (typeof value === 'string' && isTelemetryRelativePath(value));
    case 'tokens':
      return (
        value === null ||
        validTokens(value, [
          'input',
          'output',
          'cache_create',
          'cache_read',
          'total',
          'subagent_tokens',
          'grand_total',
        ])
      );
    case 'effort':
      return (
        value === null ||
        (typeof value === 'string' &&
          new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).has(value))
      );
    case 'event_stream':
      return Array.isArray(value) && value.every(validEvent);
    case 'rollup':
      return validRollup(value);
    case 'models': {
      const models = record(value);
      return (
        models !== null &&
        Object.entries(models).every(([name, stat]) => {
          const item = record(stat);
          return (
            isTelemetryModel(name) &&
            item !== null &&
            hasExactKeys(item, ['turns', 'output_tokens']) &&
            nonNegativeInteger(item.turns) &&
            nonNegativeInteger(item.output_tokens)
          );
        })
      );
    }
    case 'skills':
    case 'tools':
      return validNumericMap(value);
    case 'user_prompts':
      return Array.isArray(value) && value.every(nonNegativeInteger);
    case 'subagents':
      return (
        Array.isArray(value) &&
        value.every((entry) => {
          const item = record(entry);
          if (
            item === null ||
            !hasExactKeys(
              item,
              ['count'],
              ['type', 'agent_name', 'model', 'status', 'tokens', 'tool_uses'],
            ) ||
            !nonNegativeInteger(item.count)
          ) {
            return false;
          }
          return Object.entries(item).every(([field, child]) => {
            if (field === 'count' || field === 'tokens' || field === 'tool_uses') {
              return nonNegativeInteger(child);
            }
            if (typeof child !== 'string') return false;
            return field === 'model' ? isTelemetryModel(child) : isTelemetryExtensionString(child);
          });
        })
      );
    case 'files': {
      const files = record(value);
      return (
        files !== null &&
        hasExactKeys(files, ['written', 'edited']) &&
        validStringArray(files.written, true) &&
        validStringArray(files.edited, true)
      );
    }
    case 'plans_touched':
      return validStringArray(value, true);
    case 'events': {
      const events = record(value);
      return (
        events !== null &&
        hasExactKeys(events, ['compactions', 'api_errors', 'local_commands']) &&
        nonNegativeInteger(events.api_errors) &&
        nonNegativeInteger(events.local_commands) &&
        Array.isArray(events.compactions) &&
        events.compactions.every((entry) => {
          const item = record(entry);
          return (
            item !== null &&
            hasExactKeys(item, ['trigger', 'pre_tokens', 'post_tokens']) &&
            (item.trigger === null || safeIdentity(item.trigger)) &&
            nonNegativeInteger(item.pre_tokens) &&
            nonNegativeInteger(item.post_tokens)
          );
        })
      );
    }
    case 'thinking': {
      if (value === null) return true;
      const thinking = record(value);
      return (
        thinking !== null &&
        hasExactKeys(thinking, ['blocks']) &&
        nonNegativeInteger(thinking.blocks)
      );
    }
    case 'captured_env': {
      const env = record(value);
      return (
        env !== null &&
        Object.entries(env).every(
          ([name, envValue]) =>
            typeof envValue === 'string' && isCapturedEnvEntry(name, envValue, version),
        )
      );
    }
    case 'product_commit':
      return typeof value === 'string' && FULL_OID.test(value) && value === value.toLowerCase();
    default:
      return false;
  }
}

function validSegment(value: unknown): boolean {
  const segment = record(value);
  if (segment === null || (segment.schema_version !== '2.4' && segment.schema_version !== '2.5')) {
    return false;
  }
  const required = [
    'schema_version',
    'command',
    'harness',
    'harness_version',
    'harness_session_id',
    'timecode',
    'window',
    'branch',
    'tokens',
    'effort',
    'event_stream',
    'rollup',
  ];
  if (required.some((key) => !(key in segment))) return false;
  if (segment.product_commit !== undefined && segment.schema_version !== '2.5') return false;
  for (const [key, child] of Object.entries(segment)) {
    if ((SEGMENT_FIELD_KEYS as readonly string[]).includes(key)) {
      if (!validSegmentKnownField(key, child, segment.schema_version)) return false;
    } else if (
      !SAFE_UNKNOWN_KEY.test(key) ||
      FORBIDDEN_UNKNOWN_KEY.test(key) ||
      !privacySafe(child, key, true)
    ) {
      return false;
    }
  }
  return true;
}

interface ValidatedAttribute {
  key: string;
  value: Record<string, unknown>;
}

function validAttributeValue(
  value: unknown,
  allowKvlist: boolean,
): value is Record<string, unknown> {
  const attribute = record(value);
  if (attribute === null) return false;
  const present = ['stringValue', 'intValue', 'doubleValue', 'boolValue', 'kvlistValue'].filter(
    (key) => key in attribute,
  );
  if (present.length !== 1 || Object.keys(attribute).length !== 1) return false;
  if ('stringValue' in attribute) {
    return typeof attribute.stringValue === 'string' && safeString(attribute.stringValue, false);
  }
  if ('intValue' in attribute) {
    return typeof attribute.intValue === 'string' && DECIMAL_INTEGER.test(attribute.intValue);
  }
  if ('doubleValue' in attribute) {
    return typeof attribute.doubleValue === 'number' && Number.isFinite(attribute.doubleValue);
  }
  if ('boolValue' in attribute) return typeof attribute.boolValue === 'boolean';
  if (!allowKvlist) return false;
  const kvlist = record(attribute.kvlistValue);
  if (kvlist === null || !hasExactKeys(kvlist, ['values']) || !Array.isArray(kvlist.values))
    return false;
  const keys = new Set<string>();
  return kvlist.values.every((entry) => {
    const pair = record(entry);
    if (
      pair === null ||
      !hasExactKeys(pair, ['key', 'value']) ||
      typeof pair.key !== 'string' ||
      !SAFE_IDENTIFIER.test(pair.key) ||
      keys.has(pair.key) ||
      !validAttributeValue(pair.value, false)
    ) {
      return false;
    }
    keys.add(pair.key);
    return true;
  });
}

function attributes(value: unknown, allowKvlist = false): ValidatedAttribute[] | null {
  if (!Array.isArray(value)) return null;
  const result: ValidatedAttribute[] = [];
  const keys = new Set<string>();
  for (const entry of value) {
    const attribute = record(entry);
    if (
      attribute === null ||
      !hasExactKeys(attribute, ['key', 'value']) ||
      typeof attribute.key !== 'string' ||
      !/^(?:service|harness|gen_ai)\.[A-Za-z0-9_.-]+$/.test(attribute.key) ||
      keys.has(attribute.key) ||
      !validAttributeValue(attribute.value, allowKvlist)
    ) {
      return null;
    }
    keys.add(attribute.key);
    result.push({ key: attribute.key, value: attribute.value as Record<string, unknown> });
  }
  return result;
}

function requiredResourceString(
  map: ReadonlyMap<string, Record<string, unknown>>,
  key: string,
): string | null {
  const value = map.get(key);
  return value !== undefined &&
    hasExactKeys(value, ['stringValue']) &&
    typeof value.stringValue === 'string' &&
    safeString(value.stringValue, false)
    ? value.stringValue
    : null;
}

function validResourceEnv(
  value: Record<string, unknown> | undefined,
  version: '2.4' | '2.5',
): boolean {
  if (value === undefined) return true;
  const kvlist = record(value.kvlistValue);
  if (
    !hasExactKeys(value, ['kvlistValue']) ||
    kvlist === null ||
    !hasExactKeys(kvlist, ['values'])
  ) {
    return false;
  }
  if (!Array.isArray(kvlist.values)) return false;
  return kvlist.values.every((entry) => {
    const pair = record(entry);
    const itemValue = record(pair?.value);
    return (
      pair !== null &&
      itemValue !== null &&
      hasExactKeys(pair, ['key', 'value']) &&
      typeof pair.key === 'string' &&
      hasExactKeys(itemValue, ['stringValue']) &&
      typeof itemValue.stringValue === 'string' &&
      isCapturedEnvEntry(pair.key, itemValue.stringValue, version)
    );
  });
}

function resourceVersion(value: unknown): '2.4' | '2.5' | null {
  const resource = record(value);
  if (resource === null || !hasExactKeys(resource, ['attributes'])) return null;
  const list = attributes(resource.attributes, true);
  if (list === null) return null;
  const allowed = new Set([
    'service.name',
    'service.version',
    'harness.session_id',
    'harness.harness',
    'harness.command',
    'harness.schema_version',
    'harness.branch',
    'harness.product.commit',
    'harness.env',
  ]);
  if (list.some((item) => !allowed.has(item.key))) return null;
  const map = new Map(list.map((item) => [item.key, item.value]));
  const serviceName = requiredResourceString(map, 'service.name');
  const serviceVersion = requiredResourceString(map, 'service.version');
  const sessionId = requiredResourceString(map, 'harness.session_id');
  const harness = requiredResourceString(map, 'harness.harness');
  const command = requiredResourceString(map, 'harness.command');
  const version = requiredResourceString(map, 'harness.schema_version');
  if (
    serviceName !== 'harness' ||
    serviceVersion === null ||
    !isTelemetryServiceVersion(serviceVersion) ||
    sessionId === null ||
    !isTelemetrySessionId(sessionId) ||
    harness === null ||
    !isTelemetryHarness(harness) ||
    command === null ||
    !isTelemetryCommand(command) ||
    (version !== '2.4' && version !== '2.5')
  ) {
    return null;
  }
  const branch = map.get('harness.branch');
  if (branch !== undefined) {
    const branchValue = requiredResourceString(map, 'harness.branch');
    if (branchValue === null || !isTelemetryRelativePath(branchValue)) return null;
  }
  const commitValue = map.get('harness.product.commit');
  if (commitValue !== undefined) {
    const commit = requiredResourceString(map, 'harness.product.commit');
    if (version !== '2.5' || commit === null || !FULL_OID.test(commit)) return null;
  }
  if (!validResourceEnv(map.get('harness.env'), version)) return null;
  return version;
}

function validScope(value: unknown, version: '2.4' | '2.5'): boolean {
  const scope = record(value);
  return (
    scope !== null &&
    hasExactKeys(scope, ['name', 'version']) &&
    scope.name === 'harness.telemetry' &&
    scope.version === version
  );
}

function validLogs(value: unknown): boolean {
  const root = record(value);
  if (root === null || !hasExactKeys(root, ['resourceLogs']) || !Array.isArray(root.resourceLogs)) {
    return false;
  }
  if (root.resourceLogs.length !== 1) return false;
  const resourceLog = record(root.resourceLogs[0]);
  if (
    resourceLog === null ||
    !hasExactKeys(resourceLog, ['resource', 'scopeLogs', 'schemaUrl']) ||
    !Array.isArray(resourceLog.scopeLogs) ||
    resourceLog.scopeLogs.length !== 1
  ) {
    return false;
  }
  const version = resourceVersion(resourceLog.resource);
  if (version === null || resourceLog.schemaUrl !== SCHEMA_URLS[version]) return false;
  const scopeLogs = record(resourceLog.scopeLogs[0]);
  if (
    scopeLogs === null ||
    !hasExactKeys(scopeLogs, ['scope', 'schemaUrl', 'logRecords']) ||
    scopeLogs.schemaUrl !== SCHEMA_URLS[version] ||
    !validScope(scopeLogs.scope, version) ||
    !Array.isArray(scopeLogs.logRecords)
  ) {
    return false;
  }
  for (const entry of scopeLogs.logRecords) {
    const log = record(entry);
    if (
      log === null ||
      !hasExactKeys(log, ['timeUnixNano', 'severityNumber', 'severityText', 'attributes']) ||
      typeof log.timeUnixNano !== 'string' ||
      !DECIMAL_INTEGER.test(log.timeUnixNano) ||
      typeof log.severityNumber !== 'number' ||
      typeof log.severityText !== 'string'
    ) {
      return false;
    }
    const attributeList = attributes(log.attributes, true);
    if (attributeList === null) return false;
    const recordValue: LogRecord = {
      timeUnixNano: log.timeUnixNano,
      severityNumber: log.severityNumber,
      severityText: log.severityText,
      attributes: attributeList.map(
        (item): KeyValue => ({ key: item.key, value: item.value as AnyValue }),
      ),
    };
    if (!validateLogRecordContract(recordValue)) return false;
  }
  return reconstructSegmentFromOtlpLogs(value as LogsData).ok;
}

function validMetricAttributes(value: unknown, definition: MetricDefinition): boolean {
  const list = value === undefined ? [] : attributes(value);
  if (list === null) return false;
  return validateMetricDataPointTuple(
    definition,
    list.map((item): KeyValue => ({ key: item.key, value: item.value as AnyValue })),
  );
}

function validDataPoint(value: unknown, definition: MetricDefinition): boolean {
  const point = record(value);
  if (
    point === null ||
    !hasExactKeys(
      point,
      ['startTimeUnixNano', 'timeUnixNano'],
      ['asInt', 'asDouble', 'attributes'],
    ) ||
    typeof point.startTimeUnixNano !== 'string' ||
    typeof point.timeUnixNano !== 'string' ||
    !canonicalUint64(point.startTimeUnixNano) ||
    !canonicalUint64(point.timeUnixNano) ||
    compareUint64(point.startTimeUnixNano, point.timeUnixNano) > 0 ||
    Number('asInt' in point) + Number('asDouble' in point) !== 1 ||
    !validMetricAttributes(point.attributes, definition)
  ) {
    return false;
  }
  if (definition.point === 'int') {
    return typeof point.asInt === 'string' && DECIMAL_INTEGER.test(point.asInt);
  }
  return (
    typeof point.asDouble === 'number' &&
    Number.isFinite(point.asDouble) &&
    point.asDouble >= 0 &&
    (definition.point !== 'double-ratio' || point.asDouble <= 1)
  );
}

function validMetric(value: unknown): boolean {
  const metric = record(value);
  if (metric === null || typeof metric.name !== 'string') return false;
  const contract = METRIC_DEFINITION_BY_NAME.get(metric.name);
  if (
    contract === undefined ||
    metric.unit !== contract.unit ||
    !hasExactKeys(metric, ['name', 'unit', contract.kind])
  ) {
    return false;
  }
  const data = record(metric[contract.kind]);
  const required =
    contract.kind === 'sum'
      ? ['dataPoints', 'aggregationTemporality', 'isMonotonic']
      : ['dataPoints'];
  if (
    data === null ||
    !hasExactKeys(data, required) ||
    !Array.isArray(data.dataPoints) ||
    (contract.kind === 'sum' &&
      (data.aggregationTemporality !== 2 || data.isMonotonic !== contract.monotonic))
  ) {
    return false;
  }
  return (
    data.dataPoints.every((point) => validDataPoint(point, contract)) &&
    validateMetricDataPointSet(contract, data.dataPoints as NumberDataPoint[])
  );
}

function validMetrics(value: unknown): boolean {
  const root = record(value);
  if (
    root === null ||
    !hasExactKeys(root, ['resourceMetrics']) ||
    !Array.isArray(root.resourceMetrics) ||
    root.resourceMetrics.length > 1
  ) {
    return false;
  }
  if (root.resourceMetrics.length === 0) return true;
  const resourceMetric = record(root.resourceMetrics[0]);
  if (
    resourceMetric === null ||
    !hasExactKeys(resourceMetric, ['resource', 'scopeMetrics', 'schemaUrl']) ||
    !Array.isArray(resourceMetric.scopeMetrics) ||
    resourceMetric.scopeMetrics.length !== 1
  ) {
    return false;
  }
  const version = resourceVersion(resourceMetric.resource);
  if (version === null || resourceMetric.schemaUrl !== SCHEMA_URLS[version]) return false;
  const scopeMetrics = record(resourceMetric.scopeMetrics[0]);
  if (
    scopeMetrics === null ||
    !hasExactKeys(scopeMetrics, ['scope', 'schemaUrl', 'metrics']) ||
    scopeMetrics.schemaUrl !== SCHEMA_URLS[version] ||
    !validScope(scopeMetrics.scope, version) ||
    !Array.isArray(scopeMetrics.metrics)
  ) {
    return false;
  }
  const names = new Set<string>();
  let sharedStart: string | undefined;
  let sharedEnd: string | undefined;
  for (const metric of scopeMetrics.metrics) {
    const item = record(metric);
    if (
      item === null ||
      typeof item.name !== 'string' ||
      names.has(item.name) ||
      !validMetric(item)
    ) {
      return false;
    }
    names.add(item.name);
    const contract = METRIC_DEFINITION_BY_NAME.get(item.name);
    const data = contract === undefined ? null : record(item[contract.kind]);
    if (data === null || !Array.isArray(data.dataPoints)) return false;
    for (const value of data.dataPoints) {
      const point = record(value);
      if (
        point === null ||
        typeof point.startTimeUnixNano !== 'string' ||
        typeof point.timeUnixNano !== 'string'
      ) {
        return false;
      }
      if (sharedStart === undefined) {
        sharedStart = point.startTimeUnixNano;
        sharedEnd = point.timeUnixNano;
      } else if (point.startTimeUnixNano !== sharedStart || point.timeUnixNano !== sharedEnd) {
        return false;
      }
    }
  }
  return true;
}

interface ExactTimeBounds {
  start: string;
  end: string;
}

function metricDocumentBounds(value: unknown): ExactTimeBounds | null {
  const root = record(value);
  const resourceMetrics = root?.resourceMetrics;
  if (!Array.isArray(resourceMetrics) || resourceMetrics.length === 0) return null;
  const resourceMetric = record(resourceMetrics[0]);
  const scopeMetrics = Array.isArray(resourceMetric?.scopeMetrics)
    ? record(resourceMetric.scopeMetrics[0])
    : null;
  if (!Array.isArray(scopeMetrics?.metrics)) return null;
  for (const value of scopeMetrics.metrics) {
    const metric = record(value);
    const contract =
      typeof metric?.name === 'string' ? METRIC_DEFINITION_BY_NAME.get(metric.name) : undefined;
    const data = contract === undefined ? null : record(metric?.[contract.kind]);
    const point = Array.isArray(data?.dataPoints) ? record(data.dataPoints[0]) : null;
    if (typeof point?.startTimeUnixNano === 'string' && typeof point.timeUnixNano === 'string') {
      return { start: point.startTimeUnixNano, end: point.timeUnixNano };
    }
  }
  return null;
}

function logsDocumentBounds(value: unknown): ExactTimeBounds | null {
  const reconstructed = reconstructSegmentFromOtlpLogs(value as LogsData);
  if (!reconstructed.ok) return null;
  const nanos = reconstructed.segment.event_stream
    .filter((event) => event.kind !== 'flow_log')
    .map((event) => String(BigInt(Math.round(Date.parse(event.t))) * 1_000_000n));
  if (nanos.length === 0) return null;
  let start = nanos[0] as string;
  let end = start;
  for (const value of nanos.slice(1)) {
    if (compareUint64(value, start) < 0) start = value;
    if (compareUint64(value, end) > 0) end = value;
  }
  return { start, end };
}

function parsedDocuments(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function pairedDocumentsHaveExactBounds(logs: unknown, metrics: unknown): boolean {
  const logDocuments = parsedDocuments(logs);
  const metricDocuments = parsedDocuments(metrics);
  return (
    logDocuments.length === metricDocuments.length &&
    logDocuments.every((document, index) => {
      const expected = logsDocumentBounds(document);
      const actual = metricDocumentBounds(metricDocuments[index]);
      return expected === null
        ? actual === null
        : actual !== null && actual.start === expected.start && actual.end === expected.end;
    })
  );
}

function validPairedSignalBounds(parsedByPath: ReadonlyMap<string, unknown>): boolean {
  const canonicalLogs = parsedByPath.get(ROLLED_LOGS_NAME);
  const canonicalMetrics = parsedByPath.get(ROLLED_METRICS_NAME);
  if (
    canonicalLogs !== undefined &&
    canonicalMetrics !== undefined &&
    !pairedDocumentsHaveExactBounds(canonicalLogs, canonicalMetrics)
  ) {
    return false;
  }
  for (const path of parsedByPath.keys()) {
    const match = /^(\d+)\.logs\.jsonl$/.exec(path);
    if (match === null) continue;
    const metrics = parsedByPath.get(`${match[1]}.metrics.jsonl`);
    if (metrics !== undefined && !pairedDocumentsHaveExactBounds(parsedByPath.get(path), metrics)) {
      return false;
    }
  }
  return true;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function manifestDate(value: string): string | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value);
  if (match === null) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function strictRemoteManifest(value: unknown, expectedSession: string): RollManifest | null {
  const manifest = record(value);
  if (
    manifest === null ||
    !hasExactKeys(manifest, ['format', 'session', 'start_date', 'max_seq'], ['product_commits']) ||
    manifest.format !== ROLLUP_FORMAT ||
    manifest.session !== expectedSession ||
    typeof manifest.session !== 'string' ||
    !isTelemetrySessionId(manifest.session) ||
    typeof manifest.start_date !== 'string' ||
    (manifest.start_date !== '0000/00/00' && manifestDate(manifest.start_date) === null) ||
    !nonNegativeInteger(manifest.max_seq)
  ) {
    return null;
  }
  const productCommits = manifest.product_commits;
  if (productCommits === undefined) return manifest as unknown as RollManifest;
  if (
    !Array.isArray(productCommits) ||
    productCommits.length === 0 ||
    productCommits.some(
      (oid) =>
        typeof oid !== 'string' || !REMOTE_MANIFEST_FULL_OID.test(oid) || oid !== oid.toLowerCase(),
    ) ||
    new Set(productCommits).size !== productCommits.length ||
    productCommits.some(
      (oid) => typeof oid !== 'string' || oid.length !== productCommits[0]?.length,
    )
  ) {
    return null;
  }
  return manifest as unknown as RollManifest;
}

function countMeasurements(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countMeasurements(entry), 0);
  if (value === null || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'dataPoints' && Array.isArray(child)) count += child.length;
    else count += countMeasurements(child);
  }
  return count;
}

function sourceFileMap(
  sessionId: string,
  files: ReadonlyMap<string, string>,
): {
  fs: { readText(path: string): string | null; readdir(path: string): string[] };
  root: string;
} {
  const root = '/published';
  const directory = posixJoin(telemetryDir(root), sessionId);
  return {
    root,
    fs: {
      readText(path: string): string | null {
        return path.startsWith(`${directory}/`)
          ? (files.get(path.slice(directory.length + 1)) ?? null)
          : null;
      },
      readdir(path: string): string[] {
        return path === directory ? [...files.keys()].sort(compareUnsignedUtf8) : [];
      },
    },
  };
}

function productFromCoverage(
  coverage: ProductCommitCoverage,
): SelectableTelemetrySession['product'] | null {
  if (!coverage.ok) return null;
  return coverage.state === 'unavailable'
    ? { state: 'unavailable', commits: null }
    : { state: coverage.state, commits: coverage.productCommits ?? [] };
}

function eventCount(session: SessionExport): number {
  return session.signals.logs.resourceLogs.reduce(
    (sum, resource) =>
      sum + resource.scopeLogs.reduce((scopeSum, scope) => scopeSum + scope.logRecords.length, 0),
    0,
  );
}

function evidenceForRef(
  ref: RemoteTelemetryRefSnapshot,
  validatedManifest: RollManifest | null,
): PublishedRefEvidence | null {
  const textByPath = new Map<string, string>();
  for (const commit of ref.history) {
    for (const entry of commit.entries) {
      if (textByPath.has(entry.path)) continue;
      const text = decodeText(entry.bytes);
      if (text === null) return null;
      textByPath.set(entry.path, text.startsWith('\ufeff') ? text.slice(1) : text);
    }
  }
  const paths = [...textByPath.keys()];
  const pair = textByPath.has(ROLLED_LOGS_NAME) && textByPath.has(ROLLED_METRICS_NAME);
  const loose = paths.some((path) => /^\d+\.json$/.test(path));
  const shape: PublishedShape = pair
    ? loose
      ? 'pair-plus-fallback'
      : 'canonical-pair'
    : loose && textByPath.has(ROLLED_MANIFEST_NAME)
      ? 'fallback-only'
      : textByPath.has(ROLLED_METRICS_NAME) && !textByPath.has(ROLLED_LOGS_NAME)
        ? 'metrics-only'
        : paths.some((path) => /^\d+\.logs\.jsonl$/.test(path))
          ? 'legacy-history'
          : 'identity-only';

  const manifests = validatedManifest === null ? [] : [validatedManifest];
  const segmentProducts: Array<string | null> = [];
  const canonicalLogs = textByPath.get(ROLLED_LOGS_NAME);
  let canonicalSegments = 0;
  if (canonicalLogs !== undefined) {
    const lines = splitJsonl(canonicalLogs);
    canonicalSegments = lines.length;
    for (const line of lines) {
      const reconstructed = reconstructSegmentFromOtlpLogs(strictJson(line) as LogsData);
      if (!reconstructed.ok) return null;
      segmentProducts.push(reconstructed.segment.product_commit ?? null);
    }
  }
  const numericSeqs = new Set<number>();
  for (const path of paths) {
    const match = /^(\d+)\.(?:json|logs\.jsonl)$/.exec(path);
    if (match !== null) numericSeqs.add(Number(match[1]));
  }
  for (const seq of [...numericSeqs].sort((a, b) => a - b)) {
    if (canonicalLogs !== undefined && seq <= canonicalSegments) continue;
    const jsonText = textByPath.get(`${seq}.json`);
    const logsText = textByPath.get(`${seq}.logs.jsonl`);
    let product: string | null = null;
    if (logsText !== undefined) {
      const lines = splitJsonl(logsText);
      if (lines.length !== 1) return null;
      const reconstructed = reconstructSegmentFromOtlpLogs(
        strictJson(lines[0] as string) as LogsData,
      );
      if (!reconstructed.ok) return null;
      product = reconstructed.segment.product_commit ?? null;
    } else if (jsonText !== undefined) {
      const segment = record(strictJson(jsonText));
      const value = segment?.product_commit;
      if (value !== undefined && (typeof value !== 'string' || !FULL_OID.test(value))) return null;
      product = (value as string | undefined) ?? null;
    }
    segmentProducts.push(product);
  }
  const aggregate = manifests.flatMap((manifest) => manifest.product_commits ?? []);
  const manifest =
    manifests.length === 0
      ? null
      : {
          ...(manifests[0] as RollManifest),
          ...([...new Set(aggregate)].length > 0 && { product_commits: [...new Set(aggregate)] }),
        };
  const product = productFromCoverage(verifyProductCommitCoverage(manifest, segmentProducts));
  return product === null ? null : { name: ref.name, shape, product };
}

/**
 * Validate, reconstruct, and classify one repository-scoped logical session. Raw
 * bytes are never rewritten; every failure is deliberately non-echoing for E222.
 */
export function decodePublishedTelemetrySession(
  input: PublishedTelemetrySessionInput,
): PublishedTelemetryDecodeResult {
  try {
    return decodeUnsafe(input);
  } catch {
    return { ok: false, reason: 'malformed_or_unsafe' };
  }
}

interface PerRefFiles {
  textByPath: Map<string, string>;
  parsedByPath: Map<string, unknown>;
  manifest: RollManifest | null;
}

interface SegmentClaim {
  explicitSequence: number | null;
  localSequence: number;
  refIndex: number;
  internalIndex: number;
  segment: Segment;
  semantic: string;
  sourceKind: 'json' | 'logs';
  sourceText: string;
}

function normalizedSemanticJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    const object = record(entry);
    if (object === null) return entry;
    return Object.fromEntries(
      Object.keys(object)
        .sort(compareUnsignedUtf8)
        .map((key) => [key, normalize(object[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

function segmentFromSingleLogs(text: string): Segment | null {
  const lines = splitJsonl(text);
  if (lines.length !== 1) return null;
  const reconstructed = reconstructSegmentFromOtlpLogs(strictJson(lines[0] as string) as LogsData);
  return reconstructed.ok ? reconstructed.segment : null;
}

function decodeUnsafe(input: PublishedTelemetrySessionInput): PublishedTelemetryDecodeResult {
  const expectedRefs = new Map(input.group.refs.map((ref) => [ref.name, ref]));
  const orderedRefs = [...input.refs].sort(
    (a, b) =>
      compareUnsignedUtf8(a.name, b.name) || compareUnsignedUtf8(a.advertisedOid, b.advertisedOid),
  );
  if (orderedRefs.length !== expectedRefs.size) return { ok: false, reason: 'malformed_or_unsafe' };

  const rawBlobs: ValidatedPublishedBlob[] = [];
  const refFiles: PerRefFiles[] = [];
  const manifests: RollManifest[] = [];
  const measurementDocuments = new Map<string, number>();
  const gaps = [...input.group.gaps];

  for (const ref of orderedRefs) {
    const advertised = expectedRefs.get(ref.name);
    if (
      advertised === undefined ||
      ref.advertisedOid !== advertised.oid ||
      !FULL_OID.test(ref.advertisedOid) ||
      ref.history.length === 0 ||
      ref.history[0]?.oid !== ref.advertisedOid
    ) {
      return { ok: false, reason: 'malformed_or_unsafe' };
    }
    const textByPath = new Map<string, string>();
    const parsedByPath = new Map<string, unknown>();
    let refManifest: RollManifest | null = null;
    for (const commit of ref.history) {
      if (!FULL_OID.test(commit.oid) || commit.parents.some((parent) => !FULL_OID.test(parent))) {
        return { ok: false, reason: 'malformed_or_unsafe' };
      }
      const paths = new Set<string>();
      for (const entry of commit.entries) {
        if (
          paths.has(entry.path) ||
          entry.mode !== '100644' ||
          entry.type !== 'blob' ||
          !SAFE_PATH.test(entry.path) ||
          !FULL_OID.test(entry.oid)
        ) {
          return { ok: false, reason: 'malformed_or_unsafe' };
        }
        paths.add(entry.path);
        const text = decodeText(entry.bytes);
        if (text === null) return { ok: false, reason: 'malformed_or_unsafe' };
        const isJsonl = entry.path.endsWith('.jsonl');
        const values = isJsonl ? strictJsonLines(text) : [strictJson(text)];
        if (values.length === 0 || values.some((value) => !privacySafe(value))) {
          return { ok: false, reason: 'malformed_or_unsafe' };
        }
        if (/^(?:\d+\.json)$/.test(entry.path) && values.some((value) => !validSegment(value))) {
          return { ok: false, reason: 'malformed_or_unsafe' };
        }
        if (entry.path.endsWith('.logs.jsonl') && values.some((value) => !validLogs(value))) {
          return { ok: false, reason: 'malformed_or_unsafe' };
        }
        if (entry.path.endsWith('.metrics.jsonl') && values.some((value) => !validMetrics(value))) {
          return { ok: false, reason: 'malformed_or_unsafe' };
        }
        const firstForRef = !textByPath.has(entry.path);
        if (entry.path === ROLLED_MANIFEST_NAME) {
          const manifest = strictRemoteManifest(values[0], input.group.sessionId);
          if (manifest === null) return { ok: false, reason: 'malformed_or_unsafe' };
          if (firstForRef) {
            manifests.push(manifest);
            refManifest = manifest;
          }
          const knownManifestDate = manifestDate(manifest.start_date);
          if (
            firstForRef &&
            knownManifestDate !== null &&
            advertised.refDate !== null &&
            knownManifestDate !== advertised.refDate &&
            !gaps.includes('manifest_date_conflict')
          ) {
            gaps.push('manifest_date_conflict');
          }
        }
        rawBlobs.push({
          repositoryKey: input.group.repository.key,
          sessionId: input.group.sessionId,
          refName: ref.name,
          advertisedOid: ref.advertisedOid,
          commitOid: commit.oid,
          path: entry.path,
          gitOid: entry.oid,
          mode: '100644',
          bytes: entry.bytes,
        });
        if (firstForRef) {
          textByPath.set(entry.path, text.startsWith('\ufeff') ? text.slice(1) : text);
          parsedByPath.set(entry.path, values.length === 1 ? values[0] : values);
        }
      }
    }
    if (!validPairedSignalBounds(parsedByPath)) {
      return { ok: false, reason: 'malformed_or_unsafe' };
    }
    for (const [path, parsed] of parsedByPath) {
      if (!path.endsWith('.metrics.jsonl')) continue;
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const semantic = normalizedSemanticJson(values);
      if (!measurementDocuments.has(semantic)) {
        measurementDocuments.set(
          semantic,
          values.reduce<number>((sum, value) => sum + countMeasurements(value), 0),
        );
      }
    }
    refFiles.push({ textByPath, parsedByPath, manifest: refManifest });
  }

  const refEvidence = orderedRefs.map((ref, index) =>
    evidenceForRef(ref, refFiles[index]?.manifest ?? null),
  );
  if (refEvidence.some((evidence) => evidence === null)) {
    return { ok: false, reason: 'malformed_or_unsafe' };
  }
  const shapes = [
    ...new Set(refEvidence.map((evidence) => (evidence as PublishedRefEvidence).shape)),
  ].sort(compareUnsignedUtf8);
  const claims: SegmentClaim[] = [];
  for (let refIndex = 0; refIndex < refFiles.length; refIndex++) {
    const files = refFiles[refIndex] as PerRefFiles;
    const canonicalLogs = files.textByPath.get(ROLLED_LOGS_NAME);
    const canonicalMetrics = files.textByPath.get(ROLLED_METRICS_NAME);
    let canonicalSegments = 0;
    if (canonicalLogs !== undefined) {
      const lines = splitJsonl(canonicalLogs);
      canonicalSegments = lines.length;
      for (let internalIndex = 0; internalIndex < lines.length; internalIndex++) {
        const line = lines[internalIndex] as string;
        const reconstructed = reconstructSegmentFromOtlpLogs(strictJson(line) as LogsData);
        if (!reconstructed.ok) return { ok: false, reason: 'malformed_or_unsafe' };
        claims.push({
          // Canonical rolled JSONL position is the sequence identity. Two equal
          // payloads on lines 1 and 2 are distinct evidence; line 1 across refs
          // is one claim and must dedupe-or-conflict by semantic content.
          explicitSequence: internalIndex + 1,
          localSequence: internalIndex + 1,
          refIndex,
          internalIndex,
          segment: reconstructed.segment,
          semantic: normalizedSemanticJson(reconstructed.segment),
          sourceKind: 'logs',
          sourceText: line,
        });
      }
    }
    const numericSeqs = new Set<number>();
    for (const path of files.textByPath.keys()) {
      const match = /^(\d+)\.(?:json|logs\.jsonl)$/.exec(path);
      if (match !== null) numericSeqs.add(Number(match[1]));
    }
    for (const seq of [...numericSeqs].sort((a, b) => a - b)) {
      if (
        canonicalLogs !== undefined &&
        canonicalMetrics !== undefined &&
        seq <= canonicalSegments
      ) {
        continue;
      }
      const jsonText = files.textByPath.get(`${seq}.json`);
      const logsText = files.textByPath.get(`${seq}.logs.jsonl`);
      const jsonSegment =
        jsonText === undefined ? null : (files.parsedByPath.get(`${seq}.json`) as Segment);
      const logsSegment = logsText === undefined ? null : segmentFromSingleLogs(logsText);
      if (logsText !== undefined && logsSegment === null) {
        return { ok: false, reason: 'malformed_or_unsafe' };
      }
      if (
        jsonSegment !== null &&
        logsSegment !== null &&
        (jsonSegment.product_commit ?? null) !== (logsSegment.product_commit ?? null)
      ) {
        return { ok: false, reason: 'malformed_or_unsafe' };
      }
      const segment = logsSegment ?? jsonSegment;
      if (segment === null) continue;
      claims.push({
        explicitSequence: seq,
        localSequence: seq,
        refIndex,
        internalIndex: seq,
        segment,
        semantic: normalizedSemanticJson(segment),
        sourceKind: logsText === undefined ? 'json' : 'logs',
        sourceText: logsText ?? (jsonText as string),
      });
    }
  }

  const explicitClaims = new Map<number, SegmentClaim>();
  const identityLessClaims: SegmentClaim[] = [];
  for (const claim of claims) {
    if (claim.explicitSequence !== null) {
      const existing = explicitClaims.get(claim.explicitSequence);
      if (existing !== undefined) {
        if (existing.semantic !== claim.semantic) {
          return { ok: false, reason: 'malformed_or_unsafe' };
        }
        continue;
      }
      explicitClaims.set(claim.explicitSequence, claim);
      continue;
    }
    // Truly identity-less legacy evidence has no legal payload-only dedupe rule.
    // Preserve each claim in deterministic ref/internal order.
    identityLessClaims.push(claim);
  }
  const logicalClaims = [...explicitClaims.values(), ...identityLessClaims].sort(
    (a, b) =>
      a.localSequence - b.localSequence ||
      a.refIndex - b.refIndex ||
      a.internalIndex - b.internalIndex,
  );
  const virtualFiles = new Map<string, string>();
  const segmentProducts: Array<string | null> = [];
  for (let index = 0; index < logicalClaims.length; index++) {
    const claim = logicalClaims[index] as SegmentClaim;
    const seq = index + 1;
    virtualFiles.set(
      claim.sourceKind === 'logs' ? `${seq}.logs.jsonl` : `${seq}.json`,
      claim.sourceText,
    );
    segmentProducts.push(claim.segment.product_commit ?? null);
  }

  const hasManifest = manifests.length > 0;

  const aggregateCommits: string[] = [];
  for (const manifest of manifests) {
    for (const productOid of manifest.product_commits ?? []) {
      if (!aggregateCommits.includes(productOid)) aggregateCommits.push(productOid);
    }
  }
  const aggregateManifest: RollManifest | null = hasManifest
    ? {
        ...(manifests[0] as RollManifest),
        ...(aggregateCommits.length > 0 && { product_commits: aggregateCommits }),
      }
    : null;
  const coverage = verifyProductCommitCoverage(aggregateManifest, segmentProducts);
  const product = productFromCoverage(coverage);
  if (product === null) return { ok: false, reason: 'malformed_or_unsafe' };

  const memory = sourceFileMap(input.group.sessionId, virtualFiles);
  const combined = combineSession(
    input.group.sessionId,
    { fs: memory.fs, proc: { cwd: () => memory.root } },
    {
      root: memory.root,
      kind: 'git-ref',
      sourceRoot: `refs/harness-telemetry/**/${input.group.sessionId}`,
    },
  );
  const sessionExport = combined.source.segment_count > 0 ? combined : null;
  const events = sessionExport === null ? null : eventCount(sessionExport);
  const metricsObserved = measurementDocuments.size > 0;
  const measurementCount = [...measurementDocuments.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const dataCoverage: PublishedDataCoverage = {
    events:
      sessionExport !== null
        ? { state: 'full', count: events ?? 0 }
        : { state: 'unavailable', count: null },
    measurements: metricsObserved
      ? { state: 'complete', count: measurementCount }
      : { state: 'unavailable', count: null },
    gaps: [],
  };
  if (dataCoverage.events.state === 'unavailable') dataCoverage.gaps.push('events_unavailable');
  if (dataCoverage.measurements.state === 'unavailable') {
    dataCoverage.gaps.push('measurements_unavailable');
  }
  const fidelity: PublishedDataFidelity =
    sessionExport !== null
      ? 'full'
      : metricsObserved || dataCoverage.events.count !== null
        ? 'partial'
        : 'identity-only';

  gaps.sort(compareUnsignedUtf8);
  return {
    ok: true,
    session: {
      repository: input.group.repository,
      sessionId: input.group.sessionId,
      fidelity,
      coverage: dataCoverage,
      product,
      shapes,
      gaps,
      refs: orderedRefs,
      refEvidence: refEvidence as PublishedRefEvidence[],
      blobs: rawBlobs,
      sessionExport,
    },
  };
}
