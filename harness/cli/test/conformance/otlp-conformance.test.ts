import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectorCheck, conformLogs, conformMetrics } from './otlp-conformance.js';

/**
 * T001 self-test — proves the conformance harness is TRUSTWORTHY before any
 * later task leans on it: the official `opentelemetry-proto` example payloads
 * pass (legs 1+2), and deliberately-malformed OTLP fails (the harness has
 * teeth — its negative controls). This is the oracle T003's RED sensor uses.
 */

const ex = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./examples/${name}`, import.meta.url)), 'utf8'));

const LOGS = ex('logs.json');
const METRICS = ex('metrics.json');

describe('OTLP conformance harness (T001)', () => {
  it('accepts the official OTLP logs example (golden + proto round-trip)', () => {
    expect(conformLogs(LOGS)).toEqual({ ok: true });
  });

  it('accepts the official OTLP metrics example', () => {
    expect(conformMetrics(METRICS)).toEqual({ ok: true });
  });

  it('has teeth — rejects a wrong-shaped logs envelope (negative control)', () => {
    expect(conformLogs({ resourceLogs: 'not-an-array' }).ok).toBe(false);
  });

  it('has teeth — rejects a non-array attributes list (negative control)', () => {
    const bad = structuredClone(LOGS);
    bad.resourceLogs[0].scopeLogs[0].logRecords[0].attributes = 'nope';
    expect(conformLogs(bad).ok).toBe(false);
  });

  it('has teeth — rejects a wrong-shaped metrics envelope (negative control)', () => {
    expect(conformMetrics({ resourceMetrics: 42 }).ok).toBe(false);
  });

  it('collector-as-checker leg logged-skips when otelcol-contrib is absent (never gates)', () => {
    const r = collectorCheck();
    expect(r.ran).toBe(false);
    expect('skipped' in r && r.skipped).toBe(true);
  });
});
