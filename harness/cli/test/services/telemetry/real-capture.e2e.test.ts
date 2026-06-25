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
 * committed `invariants.json`. This exercises the timestamped (EXACT) `event_stream`
 * path that the synthetic (timestamp-less) fixtures never hit. (Claude carries real
 * per-line timestamps → exact events, NOT `t_precision==='anchored'`; `anchored` is
 * for approximated stamps — cursor/flow. Corrects plan AC-01's original wording.)
 *
 * The per-instance `invariants.json` is the SELF-DESCRIBING source of truth
 * (companion F002): REGEN mints it from the segment, a human reviews it, the test
 * asserts the live segment matches it — no values duplicated as test constants.
 *
 * Regenerate with: `REGEN_GOLDEN=1 vitest run real-capture.e2e` (writes both the
 * golden and invariants.json that the T007 byte-scan also covers).
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
const INVARIANTS = fileURLToPath(
  new URL('./fixtures/real/claude/2026-06-25-static-site/invariants.json', import.meta.url),
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

/** The self-describing invariants block — minted from the segment, human-reviewed, committed. */
function invariantsOf(seg: ReturnType<typeof segment>) {
  return {
    token_grand_total: seg.tokens?.grand_total ?? null,
    token_total: seg.tokens?.total ?? null,
    subagent_tokens: seg.tokens?.subagent_tokens ?? null,
    user_prompts: seg.user_prompts ?? [],
    prompt_count: (seg.user_prompts ?? []).length,
    event_count: seg.event_stream.length,
    event_stream_present: seg.event_stream.length > 0,
    timestamps: 'exact', // claude carries real per-line timestamps (no t_precision)
  };
}

describe('real claude fixture → segment (AC-01)', () => {
  const seg = segment();

  if (process.env.REGEN_GOLDEN) {
    writeFileSync(GOLDEN, `${JSON.stringify(seg, null, 2)}\n`);
    writeFileSync(INVARIANTS, `${JSON.stringify(invariantsOf(seg), null, 2)}\n`);
  }

  it('matches the committed golden segment', () => {
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(seg).toEqual(expected);
  });

  it('matches the committed (human-reviewed) invariants.json', () => {
    const pinned = JSON.parse(readFileSync(INVARIANTS, 'utf8'));
    expect(invariantsOf(seg)).toEqual(pinned);
  });

  it('has a non-empty, EXACT-timestamped event_stream (the path synthetics never exercise)', () => {
    // The real claude transcript carries per-line timestamps, so the adapter emits
    // a populated event_stream (synthetic fixtures are timestamp-less → null stream).
    expect(seg.event_stream.length).toBeGreaterThan(0);
    // Every event has a real ISO `t`; claude timestamps are EXACT, so NO event is
    // tagged `anchored` (`anchored` is for approximated stamps — cursor/synthetic).
    for (const e of seg.event_stream) {
      expect(Number.isNaN(Date.parse(e.t))).toBe(false);
      expect(e.t_precision).toBeUndefined();
    }
    expect(seg.rollup).not.toBeNull();
  });
});
