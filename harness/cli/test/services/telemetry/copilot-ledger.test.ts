import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  aicFromNano,
  copilotSessionEventsPath,
  extractCopilotLedger,
  readCopilotLedger,
} from '../../../src/services/telemetry/copilot-ledger.js';

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
    // reviewer shutdown carried no cache_write bucket → 0 (never guessed).
    expect(led.token_buckets?.cache_create).toBe(0);
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
