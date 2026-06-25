import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
} from '../../../src/services/telemetry/adapters/claude-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * T008 (plan 1.7 · AC-01) — drive the REAL scrubbed claude fixture through
 * `claudeAdapter.extract` → `serializeSegment` and pin a committed golden +
 * HAND-VERIFIED invariants. This exercises the timestamped `event_stream` /
 * `anchored` path that the synthetic (timestamp-less) fixtures never hit.
 *
 * Regenerate the golden with: `REGEN_GOLDEN=1 vitest run real-capture.e2e`.
 * Produces the `expected-segment.json` that the T007 byte-scan also covers.
 */

const REPO = '/home/dev/repo'; // matches the scrubbed fixture's rebased paths
const HOME = '/home/dev';
const SESSION = 'static-site';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/real/claude/2026-06-25-static-site/raw.jsonl', import.meta.url),
);
const GOLDEN = fileURLToPath(
  new URL('./fixtures/real/claude/2026-06-25-static-site/expected-segment.json', import.meta.url),
);
const TRANSCRIPT = readFileSync(FIXTURE, 'utf8');
const LINE_COUNT = TRANSCRIPT.split('\n').filter((l) => l.trim().length > 0).length;

function source(): HarnessSource {
  const fs = new FakeFs({ [claudeTranscriptPath(HOME, REPO, SESSION)]: TRANSCRIPT });
  const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION }, HOME);
  return { env, fs, repoRoot: REPO, harness: 'claude-code' };
}

const window = { since: 'session-start', from: 0, to: LINE_COUNT } as const;

function segment() {
  const caps = claudeAdapter.extract({ ...source(), window });
  const input: SegmentInput = {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: SESSION,
    timecode: '2026-06-25T00:00:00Z',
    window,
    branch: null,
    tokens: caps.tokens,
    models: caps.models ?? {},
    effort: caps.effort,
    skills: caps.skills ?? {},
    tools: caps.tools ?? {},
    user_prompts: caps.user_prompts ?? [],
    subagents: caps.subagents ?? [],
    files: caps.files ?? { written: [], edited: [] },
    plans_touched: [],
    events: {
      compactions: caps.compactions ?? [],
      api_errors: caps.api_errors ?? 0,
      local_commands: caps.local_commands ?? 0,
    },
    thinking: caps.thinking,
    event_stream: caps.event_stream ?? undefined,
  };
  return serializeSegment(input, REPO);
}

describe('real claude fixture → segment (AC-01)', () => {
  const seg = segment();

  if (process.env.REGEN_GOLDEN) {
    writeFileSync(GOLDEN, `${JSON.stringify(seg, null, 2)}\n`);
  }

  it('matches the committed golden segment', () => {
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(seg).toEqual(expected);
  });

  it('has a non-empty, EXACT-timestamped event_stream (the path synthetics never exercise)', () => {
    // The real claude transcript carries per-line timestamps, so the adapter emits
    // a populated event_stream (synthetic fixtures are timestamp-less → null stream).
    expect(seg.event_stream.length).toBe(HAND.eventCount);
    // Every event has a real ISO `t`; claude timestamps are EXACT, so NO event is
    // tagged `anchored` (`anchored` is for approximated stamps — cursor/synthetic).
    // (Corrects plan AC-01's `t_precision==='anchored'` assumption — see execution log.)
    for (const e of seg.event_stream) {
      expect(Number.isNaN(Date.parse(e.t))).toBe(false);
      expect(e.t_precision).toBeUndefined();
    }
    expect(seg.rollup).not.toBeNull();
  });

  it('pins hand-verified token + prompt invariants', () => {
    expect(seg.user_prompts).toEqual(HAND.userPrompts);
    expect(seg.tokens?.grand_total).toBe(HAND.grandTotal);
    expect(seg.tokens?.total).toBe(HAND.total);
    expect(seg.tokens?.subagent_tokens).toBe(0); // no subagents in this session
  });
});

// Hand-pinned invariant values — minted by the REGEN run, then VERIFIED by eye
// against the real session (see execution log T008).
const HAND = {
  userPrompts: [33, 3, 21, 7, 37, 24, 3], // 7 user-prompt events, word counts
  grandTotal: 1_019_867,
  total: 1_019_867,
  eventCount: 30,
};
