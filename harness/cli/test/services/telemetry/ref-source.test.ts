import { describe, expect, it } from 'vitest';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
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
