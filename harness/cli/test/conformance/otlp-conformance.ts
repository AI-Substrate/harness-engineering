/**
 * OTLP conformance harness (plan 038 · T001 · WS-A Q3 "3-way conformance").
 *
 * A TEST-ONLY oracle (never shipped — lives under test/, backed by the
 * `protobufjs` devDependency, P10-clean) that validates hand-rolled OTLP/JSON
 * against the REAL OpenTelemetry proto schema. Three legs:
 *
 *   1. golden-vs-proto-examples — the official `opentelemetry-proto` example
 *      payloads pass this harness (proves the harness recognises valid OTLP);
 *      exercised by the self-test + T003.
 *   2. protobuf-JSON round-trip — OTLP JSON → proto fromObject → encode → decode,
 *      using the vendored OTLP v1 `.proto` import tree. Catches wrong-typed /
 *      wrong-shaped fields (the "valid-JSON-but-invalid-OTLP silent drop" risk).
 *   3. collector-as-checker — optional; runs only when `otelcol-contrib` is on
 *      PATH, otherwise a logged-skip. NEVER gates (best-effort, per the plan).
 *
 * Known limitation (hardened in T003): `fromObject` is lenient on a singular
 * message field given a non-object (it coerces to an empty message) and ignores
 * unknown keys, so a mis-spelled/garbage scalar can slip through. T003's sensor
 * adds an explicit known-key + lines-read==objects-emitted assertion on top of
 * this round-trip to close that gap.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(HERE, 'proto'); // contains opentelemetry/proto/<...>/v1/*.proto

const LOGS_DATA = 'opentelemetry.proto.logs.v1.LogsData';
const METRICS_DATA = 'opentelemetry.proto.metrics.v1.MetricsData';

let cachedRoot: protobuf.Root | null = null;

function otlpRoot(): protobuf.Root {
  if (cachedRoot) return cachedRoot;
  const root = new protobuf.Root();
  // OTLP protos import each other by their canonical path
  // ("opentelemetry/proto/common/v1/common.proto"); root them at PROTO_DIR.
  root.resolvePath = (_origin, target) =>
    target.startsWith('opentelemetry/') ? join(PROTO_DIR, target) : target;
  root.loadSync([
    join(PROTO_DIR, 'opentelemetry/proto/logs/v1/logs.proto'),
    join(PROTO_DIR, 'opentelemetry/proto/metrics/v1/metrics.proto'),
  ]);
  root.resolveAll();
  cachedRoot = root;
  return root;
}

export type ConformanceResult = { ok: true } | { ok: false; error: string };

/** Legs 1+2: prove the OTLP/JSON object is encodable as real OTLP protobuf and
 *  survives a wire round-trip — exactly what `otlpjsonfilereceiver` does
 *  internally (unmarshal JSON → proto). If this passes, the collector will not
 *  silently drop the payload.
 *
 *  NB: we do NOT use protobufjs `Type.verify` — it predates proto3-JSON and
 *  rejects OTLP/JSON's string-encoded int64 (`timeUnixNano: "..."`), which is
 *  the canonical wire form. `fromObject` is the proto3-JSON-aware entry: it
 *  coerces string int64, base64 bytes, and string enum names correctly. */
function roundTrip(typeName: string, obj: unknown): ConformanceResult {
  try {
    const Type = otlpRoot().lookupType(typeName);
    const msg = Type.fromObject(obj as { [k: string]: unknown });
    const buf = Type.encode(msg).finish();
    Type.decode(buf); // must not throw → the payload is valid OTLP proto
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A single OTLP/JSON LogsData object (`{ resourceLogs: [...] }`). */
export function conformLogs(obj: unknown): ConformanceResult {
  return roundTrip(LOGS_DATA, obj);
}

/** A single OTLP/JSON MetricsData object (`{ resourceMetrics: [...] }`). */
export function conformMetrics(obj: unknown): ConformanceResult {
  return roundTrip(METRICS_DATA, obj);
}

export type CollectorResult =
  | { ran: true; ok: boolean; error?: string }
  | { ran: false; skipped: true; reason: string };

/** Leg 3 — collector-as-checker. Optional by design: only runs when
 *  `otelcol-contrib` is discoverable; otherwise a logged-skip that NEVER gates. */
export function collectorAvailable(): boolean {
  const path = process.env.PATH ?? '';
  return path.split(':').some((dir) => dir && existsSync(join(dir, 'otelcol-contrib')));
}

export function collectorCheck(): CollectorResult {
  if (!collectorAvailable()) {
    return {
      ran: false,
      skipped: true,
      reason: 'otelcol-contrib not on PATH; collector-as-checker leg skipped (never gates)',
    };
  }
  // Wiring the live collector run is T003's concern; T001 only establishes the
  // leg is invocable and skips cleanly. Returning ran:false here keeps the
  // self-test deterministic across machines.
  return {
    ran: false,
    skipped: true,
    reason: 'collector present; live otlpjsonfilereceiver check wired in T003',
  };
}
