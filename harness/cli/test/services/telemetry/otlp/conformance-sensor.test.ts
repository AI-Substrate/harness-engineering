import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Event } from '../../../../src/services/telemetry/events.js';
import { segmentToOtlpLogs } from '../../../../src/services/telemetry/otlp/logs.js';
import {
  A,
  GENAI_INPUT_TOKENS,
  GENAI_MODEL,
  GENAI_OUTPUT_TOKENS,
} from '../../../../src/services/telemetry/otlp/semconv.js';
import type { Segment } from '../../../../src/services/telemetry/segment.js';
import { conformLogs } from '../../../conformance/otlp-conformance.js';

/**
 * T003 — OTLP conformance sensor. Beyond the proto round-trip (T001), this closes
 * the harden gap D3: `fromObject` ignores unknown keys, so a mis-named attribute
 * would be silently dropped on ingest. We assert:
 *  - every emitted top-level attribute key is in the KNOWN allowlist (no typos),
 *  - logRecords count == event_stream length (no silent event drop), and
 *  - per-kind severityNumber is correct (escapes AC-01's deep-equal, which never
 *    sees severity because it isn't a Segment field).
 */

const FIXTURES = [
  'claude/2026-06-25-static-site',
  'copilot-cli/2026-06-24-checks-run',
  'copilot-vscode/2026-06-25-real',
  'cursor/2026-06-25-checks-walkthrough',
] as const;

/** Every top-level log attribute key the serializer is allowed to emit. */
const KNOWN_KEYS = new Set<string>([
  ...Object.values(A),
  GENAI_INPUT_TOKENS,
  GENAI_OUTPUT_TOKENS,
  GENAI_MODEL,
]);

function loadGolden(rel: string): Segment {
  const p = fileURLToPath(
    new URL(`../fixtures/real/${rel}/expected-segment.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(p, 'utf8')) as Segment;
}

function makeSeg(events: Event[]): Segment {
  return {
    schema_version: '2.0',
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 's',
    timecode: '2026-06-27T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 0 },
    branch: null,
    tokens: null,
    effort: null,
    event_stream: events,
    rollup: null,
  };
}

function recordsOf(seg: Segment) {
  return segmentToOtlpLogs(seg).resourceLogs[0].scopeLogs[0].logRecords;
}

describe('OTLP conformance sensor (T003)', () => {
  for (const rel of FIXTURES) {
    const seg = loadGolden(rel);
    const records = recordsOf(seg);

    it(`${rel}: no silent event drop (records == event_stream length)`, () => {
      expect(records).toHaveLength(seg.event_stream.length);
      expect(conformLogs(segmentToOtlpLogs(seg))).toEqual({ ok: true });
    });

    it(`${rel}: every emitted attribute key is in the known allowlist (no typos)`, () => {
      const unknown = new Set<string>();
      for (const r of records)
        for (const a of r.attributes ?? []) if (!KNOWN_KEYS.has(a.key)) unknown.add(a.key);
      expect([...unknown]).toEqual([]);
    });
  }

  it('per-kind severityNumber is correct (the path AC-01 deep-equal cannot see)', () => {
    const t = '2026-06-27T00:00:00Z';
    const events: Event[] = [
      { t, kind: 'checks', status: 'ok' },
      { t, kind: 'checks', status: 'degraded' },
      { t, kind: 'checks', status: 'error' },
      { t, kind: 'command_exit', verb: 'build', exit: 0 },
      { t, kind: 'command_exit', verb: 'build', exit: 1 },
      { t, kind: 'api_error', signature: 'rate_limit' },
      { t, kind: 'prompt', words: 3 },
    ];
    const sev = recordsOf(makeSeg(events)).map((r) => r.severityNumber);
    expect(sev).toEqual([
      9, // checks ok → INFO
      13, // checks degraded → WARN
      17, // checks error → ERROR
      9, // command_exit 0 → INFO
      17, // command_exit non-zero → ERROR
      17, // api_error → ERROR
      9, // prompt → INFO
    ]);
  });
});
