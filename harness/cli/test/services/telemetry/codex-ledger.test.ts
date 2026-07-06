import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  codexSessionsRoot,
  extractCodexLedger,
  findCodexRollout,
  readCodexLedger,
} from '../../../src/services/telemetry/codex-ledger.js';

/**
 * Plan 052 · T004 — the codex rollout-ledger reader (dossier F-02). Proven against a
 * SCRUBBED REAL fixture: the tail of the actual 051 validator rollout (…6fbb…), whose
 * last `token_count` event carries the debrief's recovered grand total of 1,368,083.
 * The event is `{type:'event_msg', payload:{type:'token_count', info:{...}}}` — the
 * nesting the real codex format uses.
 */

const HOME = '/home/dev';

function fixture(rel: string): string {
  return readFileSync(new URL(`./fixtures/lane-sources/${rel}`, import.meta.url), 'utf8');
}

const VALIDATOR = fixture('codex/validator-6fbb.rollout.jsonl');

describe('extractCodexLedger — real scrubbed rollout fixture (F-02)', () => {
  it('recovers the validator total: 1,368,083 tokens from the LAST token_count', () => {
    const led = extractCodexLedger(VALIDATOR);
    expect(led.measured).toBe(true);
    expect(led.token_buckets).toEqual({
      input: 1352237,
      output: 15846,
      cached: 1214208,
      reasoning: 8372,
      total: 1368083,
    });
    expect(led.context_window).toBe(258400);
  });

  it('takes the LAST token_count (the running total), not an earlier turn', () => {
    const early = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 5 } } },
    });
    const late = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 999 } } },
    });
    expect(extractCodexLedger(`${early}\n${late}`).token_buckets?.total).toBe(999);
  });
});

describe('extractCodexLedger — degrades to unmeasured, never throws (AC-02)', () => {
  it('empty / no token_count → unmeasured', () => {
    expect(extractCodexLedger('').measured).toBe(false);
    expect(extractCodexLedger('{"type":"session_meta"}\n').measured).toBe(false);
  });

  it('a token_count without total_tokens → unmeasured', () => {
    const line = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: {} } },
    });
    expect(extractCodexLedger(line).measured).toBe(false);
  });

  it('corrupt lines are skipped, not fatal', () => {
    expect(extractCodexLedger(`{bad\n${VALIDATOR}`).token_buckets?.total).toBe(1368083);
  });
});

describe('readCodexLedger + findCodexRollout — ports read + locator (F-04)', () => {
  const ROLLOUT_PATH = `${codexSessionsRoot(HOME)}/2026/07/04/rollout-2026-07-04T13-45-43-019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0.jsonl`;

  function fsWithRollout(): FakeFs {
    return new FakeFs(
      { [ROLLOUT_PATH]: VALIDATOR },
      {
        [`${codexSessionsRoot(HOME)}`]: ['2026'],
        [`${codexSessionsRoot(HOME)}/2026`]: ['07'],
        [`${codexSessionsRoot(HOME)}/2026/07`]: ['04'],
        [`${codexSessionsRoot(HOME)}/2026/07/04`]: [
          'rollout-2026-07-04T13-45-43-019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0.jsonl',
        ],
      },
    );
  }

  it('reads a rollout by its transcriptPath (the preferred join)', () => {
    expect(readCodexLedger(fsWithRollout(), ROLLOUT_PATH).token_buckets?.total).toBe(1368083);
  });

  it('locates the rollout by the harness session id in its filename (fallback)', () => {
    const found = findCodexRollout(fsWithRollout(), HOME, '019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0');
    expect(found).toBe(ROLLOUT_PATH);
    expect(readCodexLedger(fsWithRollout(), found).token_buckets?.total).toBe(1368083);
  });

  it('missing path / absent tree → unmeasured / null (never throws)', () => {
    expect(readCodexLedger(new FakeFs({}), null).measured).toBe(false);
    expect(findCodexRollout(new FakeFs({}), HOME, 'nope')).toBeNull();
    expect(findCodexRollout(new FakeFs({}), undefined, 'x')).toBeNull();
  });
});
