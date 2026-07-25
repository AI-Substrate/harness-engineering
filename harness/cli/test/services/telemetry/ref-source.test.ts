import { describe, expect, it } from 'vitest';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { schemaIdentityForSegmentVersion } from '../../../src/services/telemetry/otlp/types.js';
import { readRefLanes } from '../../../src/services/telemetry/ref-source.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 052 · T005 — the fleet ref source (dossier F-03). A flushed lane's telemetry
 * lives only in a `refs/harness-telemetry/<date>/<session>` rollup; this reader
 * decodes each ref's token total (via the OTLP logs round-trip) keyed by the harness
 * session id (the ref's last path segment), so the fleet join can restore it.
 */

const REPO = '/repo';

function turnSegment(sid: string, grand: number, output: number): SegmentInput {
  return {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: sid,
    timecode: '2026-07-04T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: {
      input: grand - output,
      output,
      cache_create: 0,
      cache_read: 0,
      total: grand,
      subagent_tokens: 0,
      grand_total: grand,
    },
    event_stream: [
      {
        t: '2026-07-04T00:00:00Z',
        kind: 'turn',
        dur_s: 0,
        in: grand - output,
        out: output,
        model: 'claude-opus-4.8',
      },
    ],
  };
}

/** A rolled ref tree: `session.logs.jsonl` (one OTLP LogsData per line) + a manifest. */
function rolledRef(sid: string, grand: number, output: number) {
  const seg = serializeSegment(turnSegment(sid, grand, output), REPO);
  const logs = JSON.stringify(segmentToOtlpLogs(seg));
  return [
    { name: 'session.logs.jsonl', content: `${logs}\n` },
    { name: 'manifest.json', content: '{"format":"harness-telemetry-rollup/v1","session":"x"}' },
  ];
}

function rolledUsageRef(sid: string) {
  const events = [
    { t: '2026-07-04T00:00:01Z', kind: 'usage', observation_kind: 'message_output', out: 5 },
    {
      t: '2026-07-04T00:00:02Z',
      kind: 'usage',
      observation_kind: 'cumulative_checkpoint',
      in: 10,
      out: 20,
      cache_read: 30,
      cache_create: 40,
    },
    {
      t: '2026-07-04T00:00:03Z',
      kind: 'usage',
      observation_kind: 'final_shutdown',
      in: 11,
      out: 22,
      cache_read: 33,
      cache_create: 44,
    },
  ] as const;
  const lines = events.map((event, index) => {
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'copilot-cli',
        harness_session_id: sid,
        timecode: event.t,
        window: { since: 'session-start', from: index, to: index + 1 },
        branch: null,
        tokens: null,
        event_stream: [event],
      },
      REPO,
    );
    return JSON.stringify(segmentToOtlpLogs(segment));
  });
  return [{ name: 'session.logs.jsonl', content: `${lines.join('\n')}\n` }];
}

function rolledFinalUsageRef(
  sid: string,
  t: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreate: number,
) {
  const segment = serializeSegment(
    {
      command: 'flow',
      harness: 'copilot-cli',
      harness_session_id: sid,
      timecode: t,
      window: { since: 'session-start', from: 0, to: 1 },
      branch: null,
      tokens: null,
      event_stream: [
        {
          t,
          kind: 'usage',
          observation_kind: 'final_shutdown',
          in: input,
          out: output,
          cache_read: cacheRead,
          cache_create: cacheCreate,
        },
      ],
    },
    REPO,
  );
  return [
    { name: 'session.logs.jsonl', content: `${JSON.stringify(segmentToOtlpLogs(segment))}\n` },
  ];
}

describe('readRefLanes — decode ref rollups keyed by harness session id (F-03)', () => {
  it('recovers a session token total from its rolled ref', () => {
    const sid = '15eaa924-56f3-4427-9abc-000000000000';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/04/${sid}`]: rolledRef(sid, 900, 100),
    });
    const lanes = readRefLanes(git);
    const lane = lanes.get(sid);
    expect(lane?.measured).toBe(true);
    expect(lane?.tokens.grand_total).toBe(900);
    expect(lane?.tokens.output).toBe(100);
    expect(lane?.segments).toBe(1);
  });

  it('folds multiple date-sharded refs for one session (tokens summed)', () => {
    const sid = 'sess-multi';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/03/${sid}`]: rolledRef(sid, 500, 50),
      [`refs/harness-telemetry/2026/07/04/${sid}`]: rolledRef(sid, 400, 40),
    });
    expect(readRefLanes(git).get(sid)?.tokens.grand_total).toBe(900);
  });

  it('recovers one authoritative final total from typed usage after sync and prune', () => {
    const sid = 'typed-ref-session';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/04/${sid}`]: rolledUsageRef(sid),
    });

    expect(readRefLanes(git).get(sid)).toMatchObject({
      measured: true,
      tokens: { grand_total: 110, output: 22 },
      segments: 3,
    });
    expect(readRefLanes(git).get(sid)?.token_evidence).toMatchObject({
      coverage: 'measured',
      source: 'ref',
      fields: { output: { value: 22, source: 'ref', coverage: 'measured' } },
    });
  });

  it('selects the chronologically latest final across reverse-ordered date refs', () => {
    const sid = 'typed-ref-reversed';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/05/${sid}`]: rolledFinalUsageRef(
        sid,
        '2026-07-05T00:00:00Z',
        11,
        22,
        33,
        44,
      ),
      [`refs/harness-telemetry/2026/07/04/${sid}`]: rolledFinalUsageRef(
        sid,
        '2026-07-04T00:00:00Z',
        1,
        2,
        3,
        4,
      ),
    });

    expect(readRefLanes(git).get(sid)?.tokens).toEqual({ grand_total: 110, output: 22 });
  });

  it('does not trust typed usage carried by a predecessor wire identity', () => {
    const sid = 'typed-ref-predecessor';
    const blob = rolledFinalUsageRef(sid, '2026-07-05T00:00:00Z', 11, 22, 33, 44)[0];
    const logs = JSON.parse(blob.content) as ReturnType<typeof segmentToOtlpLogs>;
    const identity = schemaIdentityForSegmentVersion('2.5');
    const version = logs.resourceLogs[0].resource?.attributes.find(
      (attribute) => attribute.key === 'harness.schema_version',
    );
    if (version === undefined) throw new Error('missing schema version');
    version.value = { stringValue: '2.5' };
    logs.resourceLogs[0].schemaUrl = identity.schemaUrl;
    logs.resourceLogs[0].scopeLogs[0].schemaUrl = identity.schemaUrl;
    if (logs.resourceLogs[0].scopeLogs[0].scope === undefined) throw new Error('missing scope');
    logs.resourceLogs[0].scopeLogs[0].scope.version = identity.scopeVersion;
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/05/${sid}`]: [
        { name: 'session.logs.jsonl', content: `${JSON.stringify(logs)}\n` },
      ],
    });

    expect(readRefLanes(git).get(sid)?.measured).toBe(false);
  });

  it('does not fall back to legacy turns when newer typed evidence is partial', () => {
    const sid = 'typed-ref-partial';
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'copilot-cli',
        harness_session_id: sid,
        timecode: '2026-07-05T00:00:00Z',
        window: { since: 'session-start', from: 0, to: 2 },
        branch: null,
        tokens: null,
        event_stream: [
          { t: '2026-07-05T00:00:00Z', kind: 'turn', dur_s: 1, in: 900, out: 99 },
          {
            t: '2026-07-05T00:00:01Z',
            kind: 'usage',
            observation_kind: 'final_shutdown',
            out: 22,
          },
        ],
      },
      REPO,
    );
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/05/${sid}`]: [
        {
          name: 'session.logs.jsonl',
          content: `${JSON.stringify(segmentToOtlpLogs(segment))}\n`,
        },
      ],
    });

    expect(readRefLanes(git).get(sid)).toMatchObject({
      measured: false,
      tokens: { grand_total: 0, output: 22 },
    });
  });

  it('skips malformed loose segment event streams without throwing', () => {
    const sid = 'malformed-loose-ref';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/05/${sid}`]: [
        {
          name: '0.json',
          content: JSON.stringify({ schema_version: '2.6', event_stream: {} }),
        },
        {
          name: '1.json',
          content: JSON.stringify({
            schema_version: '2.6',
            event_stream: [{ t: '2026-07-05T00:00:00Z', kind: 'usage', out: 1 }],
          }),
        },
        {
          name: '2.json',
          content: JSON.stringify({
            schema_version: '2.6',
            tokens: null,
            event_stream: [
              {
                t: 'not-a-time',
                kind: 'usage',
                observation_kind: 'final_shutdown',
                in: 1,
                out: 2,
                cache_read: 3,
                cache_create: 4,
              },
            ],
          }),
        },
      ],
    });

    expect(() => readRefLanes(git)).not.toThrow();
    expect(readRefLanes(git).get(sid)).toMatchObject({ measured: false, segments: 0 });
  });

  it('rejects typed usage in a loose predecessor segment', () => {
    const sid = 'predecessor-loose-ref';
    const segment = serializeSegment(
      {
        command: 'flow',
        harness: 'copilot-cli',
        harness_session_id: sid,
        timecode: '2026-07-05T00:00:00Z',
        window: { since: 'session-start', from: 0, to: 1 },
        branch: null,
        tokens: null,
        event_stream: [
          {
            t: '2026-07-05T00:00:00Z',
            kind: 'usage',
            observation_kind: 'final_shutdown',
            in: 11,
            out: 22,
            cache_read: 33,
            cache_create: 44,
          },
        ],
      },
      REPO,
    );
    segment.schema_version = '2.5';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/05/${sid}`]: [
        { name: '0.json', content: JSON.stringify(segment) },
      ],
    });

    expect(readRefLanes(git).get(sid)).toMatchObject({ measured: false, segments: 0 });
  });
  it('no refs → empty map (never throws)', () => {
    expect(readRefLanes(new FakeGitRead({})).size).toBe(0);
  });

  it('a corrupt logs blob is skipped, not fatal', () => {
    const sid = 'sess-bad';
    const git = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/04/${sid}`]: [
        { name: 'session.logs.jsonl', content: '{not json\n' },
      ],
    });
    const lane = readRefLanes(git).get(sid);
    expect(lane?.measured).toBe(false);
    expect(lane?.tokens.grand_total).toBe(0);
  });
});
