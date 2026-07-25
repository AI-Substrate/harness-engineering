/**
 * OTLP/JSON envelope types + helpers (plan 038 · T006).
 *
 * Hand-rolled (WS-A Q3 — no runtime OTEL SDK, P10): just the slice of the OTLP
 * 1.x logs+metrics shape we emit. The envelope field names CONFORM to OTLP
 * (stable, proto v1); our reconstruction-critical data rides in `harness.*`
 * attributes under a pinned `schema_url` (the two-layer rule).
 */

// ── Pinned schema identity (the churn insulator — WS-A FN / research A3) ──────
/** Immutable Segment-2.4 wire identity retained for already-published records. */
export const LEGACY_HARNESS_SCHEMA_URL =
  'https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.1.0';
export const LEGACY_OTLP_SCOPE_VERSION = '2.4';
/** Immutable Segment-2.5 wire identity retained for already-published records. */
export const SEGMENT_2_5_HARNESS_SCHEMA_URL =
  'https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.2.0';
export const SEGMENT_2_5_OTLP_SCOPE_VERSION = '2.5';
/** Current Segment-2.6 wire identity (adds closed typed usage events). */
export const HARNESS_SCHEMA_URL =
  'https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.3.0';
/** The harness telemetry instrumentation scope. */
export const SCOPE_NAME = 'harness.telemetry';
/** Mirrors the current internal segment schema version (kept in lockstep). */
export const OTLP_SCOPE_VERSION = '2.6';

export interface OtlpSchemaIdentity {
  schemaUrl: string;
  scopeVersion: string;
}

/** Version-aware wire selection preserves both published predecessor identities. */
export function schemaIdentityForSegmentVersion(version: string): OtlpSchemaIdentity {
  if (version === '2.6') {
    return { schemaUrl: HARNESS_SCHEMA_URL, scopeVersion: OTLP_SCOPE_VERSION };
  }
  if (version === '2.5') {
    return {
      schemaUrl: SEGMENT_2_5_HARNESS_SCHEMA_URL,
      scopeVersion: SEGMENT_2_5_OTLP_SCOPE_VERSION,
    };
  }
  return { schemaUrl: LEGACY_HARNESS_SCHEMA_URL, scopeVersion: LEGACY_OTLP_SCOPE_VERSION };
}

// ── Severity (fixed OTLP 1–24 scale; we use INFO/WARN/ERROR) ──────────────────
export const SEV_INFO = 9;
export const SEV_WARN = 13;
export const SEV_ERROR = 17;
export function severityText(n: number): string {
  if (n >= SEV_ERROR) return 'ERROR';
  if (n >= SEV_WARN) return 'WARN';
  return 'INFO';
}

// ── AnyValue / KeyValue ──────────────────────────────────────────────────────
export interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string; // int64 → decimal string (OTLP/JSON)
  doubleValue?: number;
  arrayValue?: { values: AnyValue[] };
  kvlistValue?: { values: KeyValue[] };
}
export interface KeyValue {
  key: string;
  value: AnyValue;
}

export function sv(s: string): AnyValue {
  return { stringValue: s };
}
/** Integer → `intValue` (string); fractional → `doubleValue`. Round-trips exactly. */
export function nv(n: number): AnyValue {
  return Number.isInteger(n) ? { intValue: String(n) } : { doubleValue: n };
}
export function kv(key: string, value: AnyValue): KeyValue {
  return { key, value };
}
export function readStr(a: AnyValue | undefined): string | undefined {
  return a?.stringValue;
}
export function readNum(a: AnyValue | undefined): number | undefined {
  if (!a) return undefined;
  if (a.intValue !== undefined) return Number(a.intValue);
  if (a.doubleValue !== undefined) return a.doubleValue;
  return undefined;
}
export function attrMap(kvs: KeyValue[] | undefined): Map<string, AnyValue> {
  const m = new Map<string, AnyValue>();
  for (const kvp of kvs ?? []) m.set(kvp.key, kvp.value);
  return m;
}

// ── Logs ─────────────────────────────────────────────────────────────────────
export interface Resource {
  attributes: KeyValue[];
}
export interface InstrumentationScope {
  name?: string;
  version?: string;
}
export interface LogRecord {
  timeUnixNano?: string;
  severityNumber?: number;
  severityText?: string;
  attributes?: KeyValue[];
}
export interface ScopeLogs {
  scope?: InstrumentationScope;
  schemaUrl?: string;
  logRecords: LogRecord[];
}
export interface ResourceLogs {
  resource?: Resource;
  schemaUrl?: string;
  scopeLogs: ScopeLogs[];
}
export interface LogsData {
  resourceLogs: ResourceLogs[];
}

// ── Metrics ──────────────────────────────────────────────────────────────────
export const AGG_TEMPORALITY_CUMULATIVE = 2;
export interface NumberDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  asInt?: string;
  asDouble?: number;
}
export interface Sum {
  dataPoints: NumberDataPoint[];
  aggregationTemporality: number;
  isMonotonic: boolean;
}
export interface Gauge {
  dataPoints: NumberDataPoint[];
}
export interface Metric {
  name: string;
  unit?: string;
  sum?: Sum;
  gauge?: Gauge;
}
export interface ScopeMetrics {
  scope?: InstrumentationScope;
  schemaUrl?: string;
  metrics: Metric[];
}
export interface ResourceMetrics {
  resource?: Resource;
  schemaUrl?: string;
  scopeMetrics: ScopeMetrics[];
}
export interface MetricsData {
  resourceMetrics: ResourceMetrics[];
}
