import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Event } from '../../../../src/services/telemetry/events.js';
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
  type SegmentInput,
  serializeSegment,
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

/**
 * Companion finding F002 (run …ab81): the real-fixture round-trips only exercise
 * the event kinds those sessions happened to contain. This drives ALL 14 kinds
 * (with their optional fields + a `t_precision` + `checks.gates`) through
 * serializeSegment → OTLP → reconstruct, so encode/decode symmetry is proven for
 * every kind, not just the ones a fixture sampled.
 */
const ALL_KINDS: Event[] = [
  { t: '2026-06-27T00:00:01Z', kind: 'prompt', words: 12 },
  {
    t: '2026-06-27T00:00:02Z',
    kind: 'turn',
    dur_s: 4,
    in: 100,
    out: 50,
    cache_read: 10,
    cache_create: 5,
    model: 'claude-opus-4-8',
  },
  { t: '2026-06-27T00:00:03Z', kind: 'tools', name: 'Bash', count: 3, span_s: 7 },
  { t: '2026-06-27T00:00:04Z', kind: 'skill', name: 'the-flow', status: 'completed', dur_s: 9 },
  {
    t: '2026-06-27T00:00:05Z',
    kind: 'flow',
    flow: 'the-flow',
    stage: 'plan',
    status: 'done',
    from: 'research',
    t_precision: 'anchored',
  },
  {
    t: '2026-06-27T00:00:06Z',
    kind: 'flow_log',
    op: 'cursor-moved',
    node: 'plan',
    from: 'research',
    to: 'plan',
    type: 'phase',
    edge_op: 'insert',
  },
  { t: '2026-06-27T00:00:07Z', kind: 'branch', to: 'feat/x', from: 'main' },
  { t: '2026-06-27T00:00:08Z', kind: 'harness', verb: 'checks' },
  {
    t: '2026-06-27T00:00:09Z',
    kind: 'checks',
    status: 'degraded',
    gates: { biome: 'ok', tests: 'fail' },
  },
  { t: '2026-06-27T00:00:10Z', kind: 'command_exit', verb: 'build', exit: 1, status: 'error' },
  { t: '2026-06-27T00:00:11Z', kind: 'subagent', name: 'Explore', status: 'completed', dur_s: 20 },
  { t: '2026-06-27T00:00:12Z', kind: 'compaction' },
  { t: '2026-06-27T00:00:13Z', kind: 'model', model: 'claude-opus-4-8', effort: 'high' },
  { t: '2026-06-27T00:00:14Z', kind: 'api_error', signature: 'rate_limit' },
];

describe('all-14-kind reconstruction symmetry (companion F002)', () => {
  const input: SegmentInput = {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 's',
    timecode: '2026-06-27T00:00:00Z',
    window: { since: 'session-start', from: 0, to: ALL_KINDS.length },
    branch: null,
    event_stream: ALL_KINDS,
  };
  const seg = serializeSegment(input, '/repo');

  it('exercises all 14 event kinds', () => {
    expect(new Set(seg.event_stream.map((e) => e.kind)).size).toBe(14);
  });

  it('every kind round-trips byte-faithfully through OTLP', () => {
    expect(otlpLogsToEvents(segmentToOtlpLogs(seg))).toEqual(seg.event_stream);
  });

  it('rollup recomputes from the all-kind reconstruction', () => {
    const recon = otlpLogsToEvents(segmentToOtlpLogs(seg));
    expect(computeRollup(recon)).toEqual(seg.rollup);
  });

  it('emitted logs pass OTLP conformance', () => {
    expect(conformLogs(segmentToOtlpLogs(seg))).toEqual({ ok: true });
  });
});
