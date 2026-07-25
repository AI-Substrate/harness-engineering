import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  aicFromNano,
  copilotSessionEventsPath,
  extractCopilotLedger,
  extractCopilotUsageObservations,
  readCopilotLedger,
} from '../../../src/services/telemetry/copilot-ledger.js';
import {
  reduceUsageObservations,
  type UsageObservation,
} from '../../../src/services/telemetry/usage-observation.js';

/**
 * Plan 052 · T003 — the Copilot shutdown-ledger reader (dossier F-01). Proven
 * against SCRUBBED REAL fixtures: the actual 051 coder (34524328) + reviewer
 * (6daaffe6) `session.shutdown` events (counts/ids only — file paths stripped to
 * placeholders, event ids neutralized). The golden billing numbers are the ones the
 * 051 debrief recovered by hand: coder 1,742.9 AIC, reviewer 298.5 AIC.
 */

const HOME = '/home/dev';

function fixture(rel: string): string {
  return readFileSync(new URL(`./fixtures/lane-sources/${rel}`, import.meta.url), 'utf8');
}

const CODER = fixture('copilot/coder-34524328.events.jsonl');
const REVIEWER = fixture('copilot/reviewer-6daaffe6.events.jsonl');

describe('extractCopilotLedger — real scrubbed shutdown fixtures (F-01)', () => {
  it('recovers the coder lane: 1,742.9 AIC + token buckets (cache_write → cache_create)', () => {
    const led = extractCopilotLedger(CODER);
    expect(led.measured).toBe(true);
    expect(led.nano_aiu).toBe(1742858875000);
    expect(aicFromNano(led.nano_aiu)).toBeCloseTo(1742.858875, 6);
    expect(Number(aicFromNano(led.nano_aiu)?.toFixed(1))).toBe(1742.9);
    expect(led.token_buckets).toEqual({
      input: 16009,
      output: 139800,
      cache_read: 19952600,
      cache_create: 620359,
    });
    expect(led.api_duration_ms).toBe(1866852);
    expect(led.code_changes).toEqual({ files_modified: 12, lines_added: 1207, lines_removed: 23 });
  });

  it('recovers the reviewer lane: 298.5 AIC (a read-only peer with no live telemetry)', () => {
    const led = extractCopilotLedger(REVIEWER);
    expect(led.nano_aiu).toBe(298534500000);
    expect(Number(aicFromNano(led.nano_aiu)?.toFixed(1))).toBe(298.5);
    // reviewer shutdown carried no cache_write bucket → absent, never guessed zero.
    expect(led.token_buckets?.cache_create).toBeUndefined();
  });

  it('premium_requests is carried but is LEGACY, never billing (F-10)', () => {
    expect(extractCopilotLedger(CODER).premium_requests).toBe(60);
  });
});

describe('extractCopilotLedger — degrades to unmeasured, never throws (AC-02)', () => {
  it('empty / no-shutdown content → unmeasured', () => {
    expect(extractCopilotLedger('').measured).toBe(false);
    expect(extractCopilotLedger('{"type":"session.start"}\n').measured).toBe(false);
  });

  it('a shutdown without totalNanoAiu → unmeasured (no headline billing)', () => {
    const line = JSON.stringify({ type: 'session.shutdown', data: { tokenDetails: {} } });
    expect(extractCopilotLedger(line).measured).toBe(false);
    expect(extractCopilotLedger(line).nano_aiu).toBeNull();
  });

  it('corrupt JSON lines are skipped, not fatal', () => {
    const led = extractCopilotLedger(`{not json\n${CODER}`);
    expect(led.nano_aiu).toBe(1742858875000);
  });

  it('reads the LAST shutdown when several appear', () => {
    const first = JSON.stringify({ type: 'session.shutdown', data: { totalNanoAiu: 1 } });
    const second = JSON.stringify({ type: 'session.shutdown', data: { totalNanoAiu: 2 } });
    expect(extractCopilotLedger(`${first}\n${second}`).nano_aiu).toBe(2);
  });
});

describe('readCopilotLedger — ports read (F-01)', () => {
  it('reads the session events.jsonl by harness session id', () => {
    const sid = '34524328-5ab0-41c4-8cc9-62b03128930d';
    const fs = new FakeFs({ [copilotSessionEventsPath(HOME, sid)]: CODER });
    expect(readCopilotLedger(fs, HOME, sid).nano_aiu).toBe(1742858875000);
  });

  it('missing home / missing file → unmeasured (never throws)', () => {
    expect(readCopilotLedger(new FakeFs({}), undefined, 'x').measured).toBe(false);
    expect(readCopilotLedger(new FakeFs({}), HOME, 'absent').measured).toBe(false);
  });
});

function typedTokenDetails(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): Record<string, { tokenCount: number }> {
  return {
    input: { tokenCount: input },
    output: { tokenCount: output },
    cache_read: { tokenCount: cacheRead },
    cache_write: { tokenCount: cacheWrite },
  };
}

function usageJsonl(records: readonly Record<string, unknown>[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

describe('P063 T007 — typed Copilot usage parsing', () => {
  it('parses message output, cumulative checkpoint, partial compaction, and final shutdown distinctly', () => {
    const content = usageJsonl([
      {
        type: 'assistant.message',
        timestamp: '2026-07-20T10:00:01Z',
        data: {
          outputTokens: 11,
          content: 'PRIVATE_MESSAGE_TEXT',
          identity: 'person@example.test',
        },
      },
      {
        type: 'session.usage_checkpoint',
        timestamp: '2026-07-20T10:00:02Z',
        data: { totalNanoAiu: 200, tokenDetails: typedTokenDetails(20, 30, 4, 5) },
      },
      {
        type: 'session.compaction',
        timestamp: '2026-07-20T10:00:03Z',
        data: { tokenDetails: typedTokenDetails(6, 7, 8, 9), summary: 'PRIVATE_SUMMARY' },
      },
      {
        type: 'session.shutdown',
        timestamp: '2026-07-20T10:00:04Z',
        data: {
          totalNanoAiu: 500,
          tokenDetails: typedTokenDetails(40, 50, 60, 70),
          cwd: '/Users/private/repository',
        },
      },
    ]);

    expect(extractCopilotUsageObservations(content)).toEqual([
      {
        t: '2026-07-20T10:00:01Z',
        observation_kind: 'message_output',
        output: 11,
      },
      {
        t: '2026-07-20T10:00:02Z',
        observation_kind: 'cumulative_checkpoint',
        input: 20,
        output: 30,
        cache_read: 4,
        cache_create: 5,
        nano_aiu: 200,
      },
      {
        t: '2026-07-20T10:00:03Z',
        observation_kind: 'partial_compaction',
        input: 6,
        output: 7,
        cache_read: 8,
        cache_create: 9,
      },
      {
        t: '2026-07-20T10:00:04Z',
        observation_kind: 'final_shutdown',
        input: 40,
        output: 50,
        cache_read: 60,
        cache_create: 70,
        nano_aiu: 500,
      },
    ]);
  });

  it('skips malformed and unknown records without guessing zero or throwing', () => {
    const content = [
      '{not json',
      JSON.stringify(null),
      JSON.stringify([]),
      JSON.stringify(42),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: 'not-a-time',
        data: { tokenDetails: typedTokenDetails(1, 2, 3, 4) },
      }),
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-07-20T10:00:01Z',
        data: { outputTokens: '11' },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: '2026-07-20T10:00:02Z',
        data: { tokenDetails: { output: { tokenCount: -1 } } },
      }),
      JSON.stringify({
        type: 'session.unknown_usage',
        timestamp: '2026-07-20T10:00:03Z',
        data: { outputTokens: 999 },
      }),
    ].join('\n');

    expect(extractCopilotUsageObservations(content)).toEqual([]);
  });
});

describe('P063 T007 — kind-specific usage reduction', () => {
  it('aggregates message outputs only with message outputs', () => {
    const observations: UsageObservation[] = [
      { t: '2026-07-20T10:00:01Z', observation_kind: 'message_output', output: 10 },
      { t: '2026-07-20T10:00:02Z', observation_kind: 'message_output', output: 20 },
    ];

    expect(reduceUsageObservations(observations)).toEqual({
      t: '2026-07-20T10:00:02Z',
      observation_kind: 'message_output',
      output: 30,
    });
  });

  it('keeps distinct message records even when timestamp and counts are identical', () => {
    const observations: UsageObservation[] = [
      { t: '2026-07-20T10:00:01Z', observation_kind: 'message_output', output: 10 },
      { t: '2026-07-20T10:00:01Z', observation_kind: 'message_output', output: 10 },
    ];

    expect(reduceUsageObservations(observations)).toEqual({
      t: '2026-07-20T10:00:01Z',
      observation_kind: 'message_output',
      output: 20,
    });
  });

  it('selects the latest valid cumulative or partial observation instead of adding snapshots', () => {
    const checkpoints: UsageObservation[] = [
      {
        t: '2026-07-20T10:00:01Z',
        observation_kind: 'cumulative_checkpoint',
        input: 50,
        output: 60,
      },
      {
        t: '2026-07-20T10:00:02Z',
        observation_kind: 'cumulative_checkpoint',
        input: 70,
        output: 80,
      },
    ];
    const compactions: UsageObservation[] = [
      { t: '2026-07-20T10:00:03Z', observation_kind: 'partial_compaction', output: 7 },
      { t: '2026-07-20T10:00:04Z', observation_kind: 'partial_compaction', output: 9 },
    ];

    expect(reduceUsageObservations(checkpoints)).toEqual(checkpoints[1]);
    expect(reduceUsageObservations(compactions)).toEqual(compactions[1]);
  });

  it('makes a valid final authoritative and ignores an invalid final without adding unlike kinds', () => {
    const checkpoint: UsageObservation = {
      t: '2026-07-20T10:00:01Z',
      observation_kind: 'cumulative_checkpoint',
      input: 100,
      output: 200,
    };
    const final: UsageObservation = {
      t: '2026-07-20T10:00:02Z',
      observation_kind: 'final_shutdown',
      output: 7,
    };
    const invalidFinal = {
      t: '2026-07-20T10:00:03Z',
      observation_kind: 'final_shutdown',
      output: Number.NaN,
    } as UsageObservation;

    // The final is authoritative for the buckets it CARRIES (output), and stays the
    // reduction's kind. Finding 04 changed what happens to the buckets it does NOT
    // carry: `input` is no longer reported unavailable while the checkpoint plainly
    // measured it — it is recovered, tagged with the kind it really came from, and the
    // set is declared mixed so nothing claims to be one coherent snapshot.
    expect(reduceUsageObservations([checkpoint, final])).toEqual({
      t: final.t,
      observation_kind: 'final_shutdown',
      output: 7,
      input: 100,
      field_kinds: { input: 'cumulative_checkpoint', output: 'final_shutdown' },
    });
    // Still never ADDED: output is the final's 7, not 200 + 7.
    expect(reduceUsageObservations([checkpoint, final])?.output).toBe(7);
    expect(reduceUsageObservations([checkpoint, invalidFinal])).toEqual(checkpoint);
    expect(reduceUsageObservations([])).toBeNull();
  });
});
