import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import {
  A,
  GENAI_INPUT_TOKENS,
  GENAI_OUTPUT_TOKENS,
  GENAI_TOKEN_USAGE_METRIC,
  RES_PRODUCT_COMMIT,
  RES_SCHEMA_VERSION,
} from '../../../src/services/telemetry/otlp/semconv.js';
import {
  HARNESS_SCHEMA_URL,
  type KeyValue,
  LEGACY_HARNESS_SCHEMA_URL,
  LEGACY_OTLP_SCOPE_VERSION,
  type LogRecord,
  type LogsData,
  type MetricsData,
  OTLP_SCOPE_VERSION,
  type Resource,
  SCOPE_NAME,
} from '../../../src/services/telemetry/otlp/types.js';
import { SEGMENT_SCHEMA_VERSION, type Segment } from '../../../src/services/telemetry/segment.js';
import { conformLogs, conformMetrics } from '../../conformance/otlp-conformance.js';

const LEGACY_SEGMENT_VERSION = '2.4';
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const VERSION_SENTINEL = '<versioned-metadata>';

function compatibilitySegmentView(segment: Segment): Record<string, unknown> {
  const view: Record<string, unknown> = { ...segment };
  delete view.product_commit;
  delete view.tokens;
  view.schema_version = VERSION_SENTINEL;
  view.event_stream = segment.event_stream
    .filter((event) => event.kind !== 'usage')
    .map((event) => {
      // plan 069: `tools.control` post-dates the frozen 2.4 oracle — project it,
      // exactly as the 2.6 usage channel below.
      if (event.kind === 'tools') {
        const projected: Record<string, unknown> = { ...event };
        delete projected.control;
        return projected;
      }
      if (event.kind !== 'turn') return event;
      const projected: Record<string, unknown> = { ...event };
      delete projected.in;
      delete projected.out;
      delete projected.cache_read;
      delete projected.cache_create;
      return projected;
    });
  const rollup = structuredClone(segment.rollup);
  delete (rollup as { tokens?: unknown }).tokens;
  view.rollup = rollup;
  return view;
}

/**
 * Compare the current Segment producer with a frozen Segment-2.4 golden after
 * projecting the intentional Segment-2.6 usage channel and version metadata.
 */
export function expectCurrentSegmentMatchesLegacy(current: Segment, legacy: Segment): void {
  expect(SEGMENT_SCHEMA_VERSION).toBe('2.6');
  expect(current.schema_version).toBe('2.6');
  expect(legacy.schema_version).toBe(LEGACY_SEGMENT_VERSION);
  expect(legacy.product_commit).toBeUndefined();
  if (current.product_commit !== undefined) {
    expect(current.product_commit).toMatch(FULL_OID);
    expect(current.product_commit).toBe(current.product_commit.toLowerCase());
  }
  expect(compatibilitySegmentView(current)).toEqual(compatibilitySegmentView(legacy));
}

function expectResourceMetadata(
  attributes: readonly KeyValue[],
  version: string,
  expectedProductCommit: string | undefined,
): void {
  const schema = attributes.filter((attribute) => attribute.key === RES_SCHEMA_VERSION);
  expect(schema).toHaveLength(1);
  expect(schema[0]?.value).toEqual({ stringValue: version });

  const product = attributes.filter((attribute) => attribute.key === RES_PRODUCT_COMMIT);
  if (expectedProductCommit === undefined) {
    expect(product).toEqual([]);
  } else {
    expect(expectedProductCommit).toMatch(FULL_OID);
    expect(expectedProductCommit).toBe(expectedProductCommit.toLowerCase());
    expect(product).toEqual([
      { key: RES_PRODUCT_COMMIT, value: { stringValue: expectedProductCommit } },
    ]);
  }
}

function compatibilityResource(resource: Resource | undefined): Resource | undefined {
  if (resource === undefined) return undefined;
  return {
    ...resource,
    attributes: resource.attributes
      .filter((attribute) => attribute.key !== RES_PRODUCT_COMMIT)
      .map((attribute) =>
        attribute.key === RES_SCHEMA_VERSION
          ? { ...attribute, value: { stringValue: VERSION_SENTINEL } }
          : attribute,
      ),
  };
}

function expectLogsMetadata(
  data: LogsData,
  schemaUrl: string,
  scopeVersion: string,
  productCommit: string | undefined,
): void {
  for (const resource of data.resourceLogs) {
    expect(resource.schemaUrl).toBe(schemaUrl);
    expectResourceMetadata(resource.resource?.attributes ?? [], scopeVersion, productCommit);
    for (const scope of resource.scopeLogs) {
      expect(scope.schemaUrl).toBe(schemaUrl);
      expect(scope.scope).toEqual({ name: SCOPE_NAME, version: scopeVersion });
    }
  }
}

function compatibilityLogsView(data: LogsData): LogsData {
  // Attributes the frozen v0.1 oracle predates — the typed usage channel (2.6) and
  // the `tools` control-signature counts (plan 069). Projected away on BOTH sides,
  // so the comparison still pins every attribute the oracle actually froze.
  const postFreezeAttributes = new Set([
    GENAI_INPUT_TOKENS,
    GENAI_OUTPUT_TOKENS,
    A.CACHE_READ,
    A.CACHE_CREATE,
    A.TOOL_CONTROL,
  ]);
  const eventKind = (record: LogRecord): string | undefined =>
    record.attributes?.find((attribute) => attribute.key === A.KIND)?.value.stringValue;
  return {
    resourceLogs: data.resourceLogs.map((resource) => ({
      ...resource,
      resource: compatibilityResource(resource.resource),
      schemaUrl: VERSION_SENTINEL,
      scopeLogs: resource.scopeLogs.map((scope) => ({
        ...scope,
        scope:
          scope.scope === undefined ? undefined : { ...scope.scope, version: VERSION_SENTINEL },
        schemaUrl: VERSION_SENTINEL,
        logRecords: scope.logRecords
          .filter((record) => eventKind(record) !== 'usage')
          .map((record) => ({
            ...record,
            attributes: record.attributes?.filter(
              (attribute) => !postFreezeAttributes.has(attribute.key),
            ),
          })),
      })),
    })),
  };
}

function expectMetricsMetadata(
  data: MetricsData,
  schemaUrl: string,
  scopeVersion: string,
  productCommit: string | undefined,
): void {
  for (const resource of data.resourceMetrics) {
    expect(resource.schemaUrl).toBe(schemaUrl);
    expectResourceMetadata(resource.resource?.attributes ?? [], scopeVersion, productCommit);
    for (const scope of resource.scopeMetrics) {
      expect(scope.schemaUrl).toBe(schemaUrl);
      expect(scope.scope).toEqual({ name: SCOPE_NAME, version: scopeVersion });
    }
  }
}

function compatibilityMetricsView(data: MetricsData): MetricsData {
  const view: MetricsData = {
    resourceMetrics: data.resourceMetrics.map((resource) => ({
      ...resource,
      resource: compatibilityResource(resource.resource),
      schemaUrl: VERSION_SENTINEL,
      scopeMetrics: resource.scopeMetrics.map((scope) => ({
        ...scope,
        scope:
          scope.scope === undefined ? undefined : { ...scope.scope, version: VERSION_SENTINEL },
        schemaUrl: VERSION_SENTINEL,
        metrics: scope.metrics.filter((metric) => metric.name !== GENAI_TOKEN_USAGE_METRIC),
      })),
    })),
  };
  return JSON.parse(
    JSON.stringify(view, (key, value) =>
      key === 'startTimeUnixNano' || key === 'timeUnixNano' ? '<time>' : value,
    ),
  ) as MetricsData;
}

function metricsPayloads(data: MetricsData) {
  return data.resourceMetrics.map((resource) =>
    resource.scopeMetrics.map((scope) => scope.metrics),
  );
}

/**
 * The committed real-corpus goldens are permanently frozen Segment-2.4 / OTLP
 * v0.1 compatibility evidence. Current output is compared after projecting
 * version metadata, an optional valid product commit, and the additive 2.6 usage
 * channel whose exact current values are pinned by the companion invariants.
 */
export function registerOtlpGoldens(seg: Segment, goldenSegmentPath: string): void {
  if (process.env.REGEN_GOLDEN) {
    throw new Error('legacy telemetry goldens are frozen; regeneration is disabled');
  }

  const dir = dirname(goldenSegmentPath);
  const logsPath = join(dir, 'expected-otlp-logs.jsonl');
  const metricsPath = join(dir, 'expected-otlp-metrics.jsonl');
  const currentLogs = segmentToOtlpLogs(seg);
  const currentMetrics = rollupToOtlpMetrics(seg);

  it('matches frozen OTLP v0.1 goldens modulo approved v0.3 metadata and usage', () => {
    const legacyLogs = JSON.parse(readFileSync(logsPath, 'utf8')) as LogsData;
    const legacyMetrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as MetricsData;

    expect(conformLogs(currentLogs)).toEqual({ ok: true });
    expect(conformMetrics(currentMetrics)).toEqual({ ok: true });
    expect(conformLogs(legacyLogs)).toEqual({ ok: true });
    expect(conformMetrics(legacyMetrics)).toEqual({ ok: true });

    expectLogsMetadata(currentLogs, HARNESS_SCHEMA_URL, OTLP_SCOPE_VERSION, seg.product_commit);
    expectLogsMetadata(legacyLogs, LEGACY_HARNESS_SCHEMA_URL, LEGACY_OTLP_SCOPE_VERSION, undefined);
    expectMetricsMetadata(
      currentMetrics,
      HARNESS_SCHEMA_URL,
      OTLP_SCOPE_VERSION,
      seg.product_commit,
    );
    expectMetricsMetadata(
      legacyMetrics,
      LEGACY_HARNESS_SCHEMA_URL,
      LEGACY_OTLP_SCOPE_VERSION,
      undefined,
    );

    // The frozen oracle predates the typed usage channel. Project only that
    // additive channel; every remaining Logs field stays byte-model equivalent.
    expect(compatibilityLogsView(currentLogs)).toEqual(compatibilityLogsView(legacyLogs));
    const currentCompatibleMetrics = compatibilityMetricsView(currentMetrics);
    const legacyCompatibleMetrics = compatibilityMetricsView(legacyMetrics);
    expect(metricsPayloads(currentCompatibleMetrics)).toEqual(
      metricsPayloads(legacyCompatibleMetrics),
    );
    expect(currentCompatibleMetrics).toEqual(legacyCompatibleMetrics);
  });
}
