import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  otlpLogsToEvents,
  segmentToOtlpLogs,
} from '../../../../src/services/telemetry/otlp/logs.js';
import {
  HARNESS_SCHEMA_URL,
  OTLP_SCOPE_VERSION,
} from '../../../../src/services/telemetry/otlp/types.js';
import { computeRollup } from '../../../../src/services/telemetry/rollup.js';
import {
  SEGMENT_SCHEMA_VERSION,
  type Segment,
} from '../../../../src/services/telemetry/segment.js';
import { conformLogs } from '../../../conformance/otlp-conformance.js';

/**
 * T002 — the load-bearing reconstruction invariant (WS-A INV), proven on the
 * plan-037 REAL fixtures. For each committed golden `expected-segment.json`
 * (the reconstruction oracle): segment → OTLP Logs → reconstruct →
 * deep-equal the original `event_stream`, and `computeRollup` of the
 * reconstruction equals the stored `rollup` (gaps, agent/human/idle, token
 * buckets all recovered — since rollup is a pure function of the stream).
 * Also asserts the emitted logs pass OTLP conformance (T001 harness).
 */

const FIXTURES = [
  'claude/2026-06-25-static-site',
  'copilot-cli/2026-06-24-checks-run',
  'copilot-vscode/2026-06-25-real',
  'cursor/2026-06-25-checks-walkthrough',
] as const;

function loadGolden(rel: string): Segment {
  const p = fileURLToPath(
    new URL(`../fixtures/real/${rel}/expected-segment.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(p, 'utf8')) as Segment;
}

describe('OTLP Logs reconstruction invariant (T002)', () => {
  for (const rel of FIXTURES) {
    const seg = loadGolden(rel);
    const logs = segmentToOtlpLogs(seg);

    it(`${rel}: event_stream reconstructs byte-faithfully`, () => {
      expect(otlpLogsToEvents(logs)).toEqual(seg.event_stream);
    });

    it(`${rel}: rollup recomputes from the reconstruction`, () => {
      const recon = otlpLogsToEvents(logs);
      const rollup = recon.length > 0 ? computeRollup(recon) : null;
      expect(rollup).toEqual(seg.rollup);
    });

    it(`${rel}: emitted logs pass OTLP conformance`, () => {
      expect(conformLogs(logs)).toEqual({ ok: true });
    });
  }
});

describe('schema_url pinning + version lockstep (T006)', () => {
  const seg = loadGolden(FIXTURES[0]);
  const logs = segmentToOtlpLogs(seg);

  it('pins HARNESS_SCHEMA_URL on both Resource and Scope', () => {
    const rl = logs.resourceLogs[0];
    expect(rl.schemaUrl).toBe(HARNESS_SCHEMA_URL);
    expect(rl.scopeLogs[0].schemaUrl).toBe(HARNESS_SCHEMA_URL);
  });

  it('keeps the OTLP scope version in lockstep with the segment schema version', () => {
    expect(OTLP_SCOPE_VERSION).toBe(SEGMENT_SCHEMA_VERSION);
  });
});
