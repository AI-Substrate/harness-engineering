import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, type Event } from '../../../../src/services/telemetry/events.js';
import {
  LOG_EVENT_DEFINITIONS,
  otlpLogsToEvents,
  reconstructSegmentFromOtlpLogs,
  segmentToOtlpLogs,
  validateLogRecordContract,
} from '../../../../src/services/telemetry/otlp/logs.js';
import {
  HARNESS_SCHEMA_URL,
  LEGACY_HARNESS_SCHEMA_URL,
  LEGACY_OTLP_SCOPE_VERSION,
  OTLP_SCOPE_VERSION,
  SEV_ERROR,
  SEV_INFO,
  SEV_WARN,
  schemaIdentityForSegmentVersion,
  severityText,
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

  it('keeps immutable Segment-2.4 fixtures on the v0.1/scope-2.4 wire', () => {
    const rl = logs.resourceLogs[0];
    expect(rl.schemaUrl).toBe(LEGACY_HARNESS_SCHEMA_URL);
    expect(rl.scopeLogs[0].schemaUrl).toBe(LEGACY_HARNESS_SCHEMA_URL);
    expect(rl.scopeLogs[0].scope?.version).toBe(LEGACY_OTLP_SCOPE_VERSION);
  });

  it('keeps the current OTLP scope version in lockstep with the producer schema version', () => {
    expect(HARNESS_SCHEMA_URL).toContain('/v0.3.0');
    expect(OTLP_SCOPE_VERSION).toBe(SEGMENT_SCHEMA_VERSION);
    expect(OTLP_SCOPE_VERSION).toBe('2.6');
  });
});

/**
 * Companion finding F002 (run …ab81): the real-fixture round-trips only exercise
 * the event kinds those sessions happened to contain. This drives ALL 18 kinds
 * (with their optional fields + a `t_precision` + `checks.gates` + artifact
 * `counts`/`enums` kvlists) through serializeSegment → OTLP → reconstruct, so
 * encode/decode symmetry is proven for every kind, not just the ones a fixture
 * sampled.
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
  {
    t: '2026-06-27T00:00:15Z',
    t_precision: 'anchored',
    kind: 'artifact',
    path: 'docs/plans/050-x/reviews/p1-review.md',
    artifact_type: 'review',
    plan_id: '050-x',
    change: 'edited',
    counts: { fixes: 3, findings_high: 1 },
    enums: { verdict: 'APPROVE' },
    size: { lines: 42, bytes: 1234 },
  },
  {
    t: '2026-06-27T00:00:16Z',
    kind: 'file',
    path: 'src/x.ts',
    change: 'edited',
    delta: { lines_added: 2, lines_removed: 1, bytes_added: 20, bytes_removed: 10 },
  },
  {
    t: '2026-06-27T00:00:17Z',
    kind: 'mark',
    mark_kind: 'review',
    counts: { findings: 1 },
    verdict: 'pass',
  },
  {
    t: '2026-06-27T00:00:18Z',
    kind: 'usage',
    observation_kind: 'cumulative_checkpoint',
    in: 101,
    out: 202,
    cache_read: 303,
    cache_create: 404,
    nano_aiu: 505,
  } as unknown as Event,
];

describe('Segment-2.6 product provenance reconstruction', () => {
  const productCommit = 'a'.repeat(40);
  const current = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'product-provenance',
      timecode: '2026-07-16T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      product_commit: productCommit,
      event_stream: [],
    },
    '/repo',
  );

  it('round-trips the exact OID even when the event list is empty', () => {
    const logs = segmentToOtlpLogs(current);
    expect(logs.resourceLogs[0].schemaUrl).toBe(HARNESS_SCHEMA_URL);
    expect(reconstructSegmentFromOtlpLogs(logs)).toMatchObject({
      ok: true,
      segment: {
        schema_version: '2.6',
        product_commit: productCommit,
        event_stream: [],
      },
    });
  });

  it('rejects a product attribute on a pre-2.6/v0.1 record', () => {
    const legacy = segmentToOtlpLogs(loadGolden(FIXTURES[0]));
    legacy.resourceLogs[0].resource?.attributes.push({
      key: 'harness.product.commit',
      value: { stringValue: productCommit },
    });
    expect(reconstructSegmentFromOtlpLogs(legacy)).toMatchObject({ ok: false });
  });

  it('rejects an invalid OID/version/schema identity pairing', () => {
    const logs = segmentToOtlpLogs(current);
    const attr = logs.resourceLogs[0].resource?.attributes.find(
      (entry) => entry.key === 'harness.product.commit',
    );
    if (attr) attr.value = { stringValue: 'not-an-oid' };
    expect(reconstructSegmentFromOtlpLogs(logs)).toMatchObject({ ok: false });
  });

  it.each([
    ['service.version fixture grammar', 'service.version', 'release-candidate'],
    ['closed harness vocabulary', 'harness.harness', 'shell'],
    ['command verb grammar', 'harness.command', 'q'.repeat(64)],
    ['session identifier grammar', 'harness.session_id', `AIza${'a'.repeat(35)}`],
  ])('rejects unsafe reconstructed %s before returning a Segment', (_name, key, unsafe) => {
    const logs = segmentToOtlpLogs(current);
    const attr = logs.resourceLogs[0].resource?.attributes.find((entry) => entry.key === key);
    if (attr === undefined) throw new Error(`missing ${key}`);
    attr.value = { stringValue: unsafe };
    expect(reconstructSegmentFromOtlpLogs(logs)).toMatchObject({ ok: false });
  });

  it('rejects a malformed current env entry during OTLP reconstruction', () => {
    const logs = segmentToOtlpLogs(current);
    logs.resourceLogs[0].resource?.attributes.push({
      key: 'harness.env',
      value: {
        kvlistValue: {
          values: [
            {
              key: 'PIJ_SESSION_ID',
              value: { stringValue: `sk_live_${'a'.repeat(32)}` },
            },
          ],
        },
      },
    });
    expect(reconstructSegmentFromOtlpLogs(logs)).toMatchObject({ ok: false });
  });
});

describe('all-kind reconstruction symmetry and producer-owned Logs contract', () => {
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

  const usageRecord = (logs: ReturnType<typeof segmentToOtlpLogs>) => {
    const record = logs.resourceLogs[0].scopeLogs[0].logRecords.find((candidate) =>
      candidate.attributes?.some(
        (attribute) =>
          attribute.key === 'harness.event.kind' && attribute.value.stringValue === 'usage',
      ),
    );
    if (record === undefined) throw new Error('missing usage record');
    return record;
  };

  it('rejects malformed usage records before logs-only reconstruction', () => {
    const missingKind = segmentToOtlpLogs(seg);
    const missingRecord = usageRecord(missingKind);
    missingRecord.attributes = missingRecord.attributes?.filter(
      (attribute) => attribute.key !== 'harness.usage.observation_kind',
    );
    expect(reconstructSegmentFromOtlpLogs(missingKind)).toMatchObject({ ok: false });

    const unknownKind = segmentToOtlpLogs(seg);
    const kindAttribute = usageRecord(unknownKind).attributes?.find(
      (attribute) => attribute.key === 'harness.usage.observation_kind',
    );
    if (kindAttribute === undefined) throw new Error('missing observation kind');
    kindAttribute.value = { stringValue: 'unknown' };
    expect(reconstructSegmentFromOtlpLogs(unknownKind)).toMatchObject({ ok: false });

    const bucketless = segmentToOtlpLogs(seg);
    const bucketKeys = new Set([
      'gen_ai.usage.input_tokens',
      'gen_ai.usage.output_tokens',
      'harness.usage.cache_read',
      'harness.usage.cache_create',
      'harness.usage.nano_aiu',
    ]);
    const bucketlessRecord = usageRecord(bucketless);
    bucketlessRecord.attributes = bucketlessRecord.attributes?.filter(
      (attribute) => !bucketKeys.has(attribute.key),
    );
    expect(reconstructSegmentFromOtlpLogs(bucketless)).toMatchObject({ ok: false });

    const malformedBucket = segmentToOtlpLogs(seg);
    const bucketAttribute = usageRecord(malformedBucket).attributes?.find(
      (attribute) => attribute.key === 'gen_ai.usage.output_tokens',
    );
    if (bucketAttribute === undefined) throw new Error('missing usage bucket');
    bucketAttribute.value = { stringValue: 'not-an-integer' };
    expect(reconstructSegmentFromOtlpLogs(malformedBucket)).toMatchObject({ ok: false });
  });

  it('the producer-owned definition table is complete and unique for EVENT_KINDS', () => {
    expect(LOG_EVENT_DEFINITIONS.map((definition) => definition.kind).sort()).toEqual(
      [...EVENT_KINDS].sort(),
    );
    expect(new Set(LOG_EVENT_DEFINITIONS.map((definition) => definition.kind)).size).toBe(
      LOG_EVENT_DEFINITIONS.length,
    );
    const byKind = new Map(
      LOG_EVENT_DEFINITIONS.map((definition) => [definition.kind, definition]),
    );
    expect(
      byKind.get('prompt')?.attributes.find((attribute) => attribute.key === 'harness.prompt.words')
        ?.required,
    ).toBe(true);
    expect(
      byKind
        .get('api_error')
        ?.attributes.find((attribute) => attribute.key === 'harness.api_error.signature')?.required,
    ).toBe(false);
    expect(
      byKind.get('flow')?.attributes.find((attribute) => attribute.key === 'harness.flow.status')
        ?.values,
    ).toContain('active');
  });

  it('exercises every event kind', () => {
    expect(new Set(seg.event_stream.map((e) => e.kind))).toEqual(new Set(EVENT_KINDS));
  });

  it('every kind round-trips byte-faithfully through OTLP', () => {
    expect(otlpLogsToEvents(segmentToOtlpLogs(seg))).toEqual(seg.event_stream);
  });

  it('the shared record validator rejects observed time and envelope/event mismatch directly', () => {
    for (const record of segmentToOtlpLogs(seg).resourceLogs[0].scopeLogs[0].logRecords) {
      expect(validateLogRecordContract(record)).toBe(true);
      expect(validateLogRecordContract({ ...record, timeUnixNano: '1' })).toBe(false);
      expect(
        validateLogRecordContract({
          ...record,
          observedTimeUnixNano: record.timeUnixNano,
        }),
      ).toBe(false);
    }
  });

  it('rollup recomputes from the all-kind reconstruction', () => {
    const recon = otlpLogsToEvents(segmentToOtlpLogs(seg));
    expect(computeRollup(recon)).toEqual(seg.rollup);
  });

  it('emitted logs pass OTLP conformance', () => {
    expect(conformLogs(segmentToOtlpLogs(seg))).toEqual({ ok: true });
  });
});

function recordForSeverity(event: Event) {
  const segment = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'severity-contract',
      timecode: event.t,
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: [event],
    },
    '/repo',
  );
  const record = segmentToOtlpLogs(segment).resourceLogs[0].scopeLogs[0].logRecords[0];
  if (record === undefined) throw new Error('missing severity fixture record');
  return structuredClone(record);
}

function withSeverity(record: ReturnType<typeof recordForSeverity>, severity: number) {
  return { ...record, severityNumber: severity, severityText: severityText(severity) };
}

describe('repair RED 3 — exact dependent and fixed Logs severity', () => {
  it.each([
    ['ok', SEV_INFO],
    ['degraded', SEV_WARN],
    ['error', SEV_ERROR],
  ] as const)('binds checks %s to its exact producer severity', (status, expected) => {
    const record = recordForSeverity({
      t: '2026-07-18T00:00:00Z',
      kind: 'checks',
      status,
      gates: { tests: 'ok' },
    });
    expect(record.severityNumber).toBe(expected);
    expect(validateLogRecordContract(record)).toBe(true);
    for (const contradictory of [SEV_INFO, SEV_WARN, SEV_ERROR].filter(
      (severity) => severity !== expected,
    )) {
      expect(validateLogRecordContract(withSeverity(record, contradictory))).toBe(false);
    }
  });

  it.each([
    [0, SEV_INFO],
    [1, SEV_ERROR],
    [255, SEV_ERROR],
  ] as const)('binds command exit %s to its exact producer severity', (exit, expected) => {
    const record = recordForSeverity({
      t: '2026-07-18T00:00:01Z',
      kind: 'command_exit',
      verb: 'checks',
      exit,
      status: exit === 0 ? 'ok' : 'error',
    });
    expect(record.severityNumber).toBe(expected);
    expect(validateLogRecordContract(record)).toBe(true);
    const contradictory = expected === SEV_INFO ? SEV_ERROR : SEV_INFO;
    expect(validateLogRecordContract(withSeverity(record, contradictory))).toBe(false);
  });

  it('keeps every fixed-severity family exact', () => {
    for (const event of ALL_KINDS.filter(
      (candidate) => candidate.kind !== 'checks' && candidate.kind !== 'command_exit',
    )) {
      const record = recordForSeverity(event);
      const expected = event.kind === 'api_error' ? SEV_ERROR : SEV_INFO;
      expect(record.severityNumber, event.kind).toBe(expected);
      expect(validateLogRecordContract(record), event.kind).toBe(true);
      const contradictory = expected === SEV_INFO ? SEV_ERROR : SEV_INFO;
      expect(
        validateLogRecordContract(withSeverity(record, contradictory)),
        `${event.kind} contradictory severity`,
      ).toBe(false);
    }
  });

  it('rejects numeric/text mismatch independently', () => {
    const record = recordForSeverity({
      t: '2026-07-18T00:00:02Z',
      kind: 'checks',
      status: 'ok',
    });
    expect(
      validateLogRecordContract({
        ...record,
        severityNumber: SEV_ERROR,
        severityText: severityText(SEV_INFO),
      }),
    ).toBe(false);
    expect(validateLogRecordContract({ ...record, severityText: severityText(SEV_ERROR) })).toBe(
      false,
    );
  });

  it('rejects missing or wrong dependent attributes and accepts encoder/reconstruction output', () => {
    const logs = segmentToOtlpLogs(
      serializeSegment(
        {
          command: 'flow',
          harness: 'claude-code',
          harness_session_id: 'severity-roundtrip',
          timecode: '2026-07-18T00:00:03Z',
          window: { since: 'session-start', from: 0, to: 2 },
          branch: 'main',
          event_stream: [
            { t: '2026-07-18T00:00:03Z', kind: 'checks', status: 'degraded' },
            {
              t: '2026-07-18T00:00:04Z',
              kind: 'command_exit',
              verb: 'checks',
              exit: 1,
            },
          ],
        },
        '/repo',
      ),
    );
    for (const record of logs.resourceLogs[0].scopeLogs[0].logRecords) {
      expect(validateLogRecordContract(record)).toBe(true);
    }
    expect(reconstructSegmentFromOtlpLogs(logs).ok).toBe(true);

    for (const index of [0, 1]) {
      const record = structuredClone(logs.resourceLogs[0].scopeLogs[0].logRecords[index]);
      if (record === undefined) throw new Error('missing dependent fixture record');
      const dependentKey = index === 0 ? 'harness.checks.status' : 'harness.command.exit';
      record.attributes = record.attributes.filter((attribute) => attribute.key !== dependentKey);
      expect(validateLogRecordContract(record)).toBe(false);
    }
  });
});

describe('P063 T008 — typed usage OTLP reconstruction', () => {
  const usageEvents = [
    {
      t: '2026-07-20T12:00:01Z',
      kind: 'usage',
      observation_kind: 'message_output',
      out: 17,
    },
    {
      t: '2026-07-20T12:00:02Z',
      kind: 'usage',
      observation_kind: 'final_shutdown',
      in: 20,
      out: 30,
      cache_read: 40,
      cache_create: 50,
      nano_aiu: 60,
    },
  ] as unknown as Event[];
  const segment = serializeSegment(
    {
      command: 'capture',
      harness: 'copilot-cli',
      harness_session_id: 'typed-usage-roundtrip',
      timecode: '2026-07-20T12:00:03Z',
      window: { since: 'session-start', from: 0, to: usageEvents.length },
      branch: null,
      event_stream: usageEvents,
    },
    '/repo',
  );

  it('preserves observation kind and every present numeric bucket byte-semantically', () => {
    const logs = segmentToOtlpLogs(segment);
    expect(otlpLogsToEvents(logs)).toEqual(segment.event_stream);
    expect(reconstructSegmentFromOtlpLogs(logs)).toMatchObject({
      ok: true,
      segment: { event_stream: segment.event_stream },
    });
  });

  it('keeps absent optional buckets absent after encode/decode', () => {
    const reconstructed = otlpLogsToEvents(segmentToOtlpLogs(segment));
    expect(reconstructed[0]).toEqual({
      t: '2026-07-20T12:00:01Z',
      kind: 'usage',
      observation_kind: 'message_output',
      out: 17,
    });
  });

  it('emits a conformant closed Logs envelope for typed usage', () => {
    expect(conformLogs(segmentToOtlpLogs(segment))).toEqual({ ok: true });
  });

  it('rejects typed usage under the Segment-2.5 wire identity', () => {
    const logs = segmentToOtlpLogs(segment);
    const identity = schemaIdentityForSegmentVersion('2.5');
    const schemaVersion = logs.resourceLogs[0].resource?.attributes.find(
      (attribute) => attribute.key === 'harness.schema_version',
    );
    if (schemaVersion === undefined) throw new Error('missing schema version');
    schemaVersion.value = { stringValue: '2.5' };
    logs.resourceLogs[0].schemaUrl = identity.schemaUrl;
    logs.resourceLogs[0].scopeLogs[0].schemaUrl = identity.schemaUrl;
    if (logs.resourceLogs[0].scopeLogs[0].scope === undefined) throw new Error('missing scope');
    logs.resourceLogs[0].scopeLogs[0].scope.version = identity.scopeVersion;

    expect(reconstructSegmentFromOtlpLogs(logs)).toMatchObject({ ok: false });
  });
});
