import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { conformLogs, conformMetrics } from '../../conformance/otlp-conformance.js';

/**
 * T005 — the per-instance OTLP goldens. DERIVED artifacts (never hand-edited),
 * minted from the SAME real, scrubbed segment as `expected-segment.json`:
 *   - `expected-otlp-logs.jsonl`    = segmentToOtlpLogs(seg)
 *   - `expected-otlp-metrics.jsonl` = rollupToOtlpMetrics(seg)
 *
 * Under `REGEN_GOLDEN` they are (re)written; otherwise the re-derived OTLP must
 * deep-equal the committed golden AND pass conformance — so a silent
 * serializer drift over the REAL corpus is impossible. Driven by
 * `scripts/telemetry-fixtures.mjs` (regenerate) + `--check` (the CI drift guard).
 *
 * Call inside an instance's describe block, passing its `expected-segment.json`
 * path (the goldens land beside it). Registers one `it()`.
 */
export function registerOtlpGoldens(seg: Segment, goldenSegmentPath: string): void {
  const dir = dirname(goldenSegmentPath);
  const logsPath = join(dir, 'expected-otlp-logs.jsonl');
  const metricsPath = join(dir, 'expected-otlp-metrics.jsonl');
  const logs = segmentToOtlpLogs(seg);
  const metrics = rollupToOtlpMetrics(seg);

  if (process.env.REGEN_GOLDEN) {
    writeFileSync(logsPath, `${JSON.stringify(logs)}\n`);
    writeFileSync(metricsPath, `${JSON.stringify(metrics)}\n`);
  }

  it('matches the committed OTLP goldens (logs + metrics) and passes conformance', () => {
    // Collector-ingestible (the goldens are valid OTLP, not just our shape).
    expect(conformLogs(logs)).toEqual({ ok: true });
    expect(conformMetrics(metrics)).toEqual({ ok: true });
    // Drift guard: the re-derived OTLP must equal the committed golden byte-for-byte.
    expect(logs).toEqual(JSON.parse(readFileSync(logsPath, 'utf8')));
    expect(metrics).toEqual(JSON.parse(readFileSync(metricsPath, 'utf8')));
  });
}
