import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../../../src/adapters/db/fake-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  claudeAdapter,
  claudeTranscriptPath,
} from '../../../src/services/telemetry/adapters/claude-adapter.js';
import {
  copilotAdapter,
  copilotEventsPath,
  copilotLogsDir,
} from '../../../src/services/telemetry/adapters/copilot-adapter.js';
import {
  CURSOR_SESSION_ENV,
  CURSOR_TRANSCRIPTS_ENV,
  cursorAdapter,
  cursorTranscriptPath,
} from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type { HarnessSource } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import { registerOtlpGoldens } from './otlp-golden.js';

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
    harness_version: '0.0.0-fixture', // pinned synthetic version (decoupled from the live release)
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
  registerOtlpGoldens(seg, GOLDEN); // T005 — mint/assert the OTLP goldens beside the segment

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

// ── copilot-cli (T003 · plan 2.2 · AC-03) ───────────────────────────────────
// Drives the REAL scrubbed copilot-cli fixture (events.jsonl + the filtered
// process log) through `copilotAdapter` over a FULL-SESSION window, so the
// process-log `assistant_usage` token blocks correlate (the stored telemetry
// segment was windowed to the `doctor` command → tokens:null; full-session here
// → real token correlation, the heart of AC-03).
const CO_DIR = 'copilot-cli/2026-06-24-checks-run';
const CO_SID = 'b67cd3ce-e0ee-4048-831e-7f4591f20a60';
const CO_EVENTS = readFileSync(
  fileURLToPath(new URL(`./fixtures/real/${CO_DIR}/raw.events.jsonl`, import.meta.url)),
  'utf8',
);
const CO_LOG = readFileSync(
  fileURLToPath(new URL(`./fixtures/real/${CO_DIR}/raw.process.log`, import.meta.url)),
  'utf8',
);
const CO_GOLDEN = fileURLToPath(
  new URL(`./fixtures/real/${CO_DIR}/expected-segment.json`, import.meta.url),
);
const CO_INVARIANTS = fileURLToPath(
  new URL(`./fixtures/real/${CO_DIR}/invariants.json`, import.meta.url),
);
const CO_LINES = CO_EVENTS.split('\n').filter((l) => l.trim().length > 0).length;
const coWindow = { since: 'session-start', from: 0, to: CO_LINES } as const;

function copilotSegment() {
  const fs = new FakeFs(
    {
      [copilotEventsPath(HOME, CO_SID)]: CO_EVENTS,
      [`${copilotLogsDir(HOME)}/process-test.log`]: CO_LOG, // findProcessLog scans process-*.log
    },
    { [copilotLogsDir(HOME)]: ['process-test.log'] }, // so readdir() surfaces the log file
  );
  const env = new FakeEnv({ COPILOT_AGENT_SESSION_ID: CO_SID }, HOME);
  const caps = copilotAdapter.extract({
    env,
    fs,
    repoRoot: REPO,
    harness: 'copilot-cli',
    window: coWindow,
  });
  const input: SegmentInput = {
    command: 'flow',
    harness: 'copilot-cli',
    harness_version: '0.0.0-fixture', // pinned synthetic version (decoupled from the live release)
    harness_session_id: CO_SID,
    timecode: '2026-06-25T00:00:00Z',
    window: coWindow,
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

function coInvariantsOf(seg: ReturnType<typeof copilotSegment>) {
  return {
    token_grand_total: seg.tokens?.grand_total ?? null,
    token_total: seg.tokens?.total ?? null,
    token_output: seg.tokens?.output ?? null,
    models: Object.keys(seg.models ?? {}).sort(),
    user_prompts: seg.user_prompts ?? [],
    tools: seg.tools ?? {},
    event_count: seg.event_stream.length,
    event_stream_present: seg.event_stream.length > 0,
  };
}

describe('real copilot-cli fixture → segment (AC-03)', () => {
  const seg = copilotSegment();
  registerOtlpGoldens(seg, CO_GOLDEN); // T005

  if (process.env.REGEN_GOLDEN) {
    writeFileSync(CO_GOLDEN, `${JSON.stringify(seg, null, 2)}\n`);
    writeFileSync(CO_INVARIANTS, `${JSON.stringify(coInvariantsOf(seg), null, 2)}\n`);
  }

  it('matches the committed golden segment', () => {
    expect(seg).toEqual(JSON.parse(readFileSync(CO_GOLDEN, 'utf8')));
  });

  it('matches the committed (human-reviewed) invariants.json', () => {
    expect(coInvariantsOf(seg)).toEqual(JSON.parse(readFileSync(CO_INVARIANTS, 'utf8')));
  });

  it('correlates process-log tokens (AC-03): non-null tokens summed from assistant_usage', () => {
    // The filtered process log holds this session's assistant_usage blocks; over a
    // full-session window they correlate to non-null token totals.
    expect(seg.tokens).not.toBeNull();
    expect(seg.tokens?.grand_total ?? 0).toBeGreaterThan(0);
    expect(seg.event_stream.length).toBeGreaterThan(0);
  });
});

// ── cursor (T011 · plan 2.5 · AC-05/AC-10) ───────────────────────────────────
// Drives the REAL scrubbed cursor fixture through `cursorAdapter`: the verbatim
// transcript (FakeFs) + the projected `cursorDiskKV` bubbles (FakeDb) → the
// transcript↔bubble MODEL/TIMING join. Cursor's transcript is untimed, so every
// event is `t_precision:'anchored'` (NOT exact like claude); tokens stay null
// (Cursor keeps consumption server-side). The model (`composer-2.5`) comes only
// from the bubbles — the join is the heart of AC-05.
const CUR_DIR = 'cursor/2026-06-25-checks-walkthrough';
const CUR_CONV = '01aa25af-f038-4c50-b3ce-f23108ed50b7';
const CUR_TRANSCRIPT = readFileSync(
  fileURLToPath(new URL(`./fixtures/real/${CUR_DIR}/raw.jsonl`, import.meta.url)),
  'utf8',
);
// The projected bubble rows ({key, value}) — FakeDb returns them for the adapter's
// `SELECT value FROM cursorDiskKV WHERE key LIKE ?` (fixed mode: same rows per query).
const CUR_BUBBLES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL(`./fixtures/real/${CUR_DIR}/raw.rows.json`, import.meta.url)),
    'utf8',
  ),
) as { key: string; value: string }[];
const CUR_GOLDEN = fileURLToPath(
  new URL(`./fixtures/real/${CUR_DIR}/expected-segment.json`, import.meta.url),
);
const CUR_INVARIANTS = fileURLToPath(
  new URL(`./fixtures/real/${CUR_DIR}/invariants.json`, import.meta.url),
);
const CUR_TRANSCRIPTS_DIR = `${HOME}/.cursor/projects/repo/agent-transcripts`;
const CUR_LINES = CUR_TRANSCRIPT.split('\n').filter((l) => l.trim().length > 0).length;
const curWindow = { since: 'session-start', from: 0, to: CUR_LINES } as const;

function cursorSegment() {
  const fs = new FakeFs({
    [cursorTranscriptPath(CUR_TRANSCRIPTS_DIR, CUR_CONV)]: CUR_TRANSCRIPT,
  });
  const env = new FakeEnv(
    { [CURSOR_SESSION_ENV]: CUR_CONV, [CURSOR_TRANSCRIPTS_ENV]: CUR_TRANSCRIPTS_DIR },
    HOME,
  );
  const db = new FakeDb(CUR_BUBBLES); // every cursorDiskKV query → all bubble rows
  const caps = cursorAdapter.extract({
    env,
    fs,
    db,
    repoRoot: REPO,
    harness: 'cursor-agent',
    window: curWindow,
  });
  const input: SegmentInput = {
    command: 'flow',
    harness: 'cursor-agent',
    harness_version: '0.0.0-fixture', // pinned synthetic version (decoupled from the live release)
    harness_session_id: CUR_CONV,
    timecode: '2026-06-25T00:00:00Z',
    window: curWindow,
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

function curInvariantsOf(seg: ReturnType<typeof cursorSegment>) {
  return {
    tokens: seg.tokens, // null — Cursor keeps consumption server-side
    models: Object.keys(seg.models ?? {}).sort(),
    user_prompts: seg.user_prompts ?? [],
    tools: seg.tools ?? {},
    event_count: seg.event_stream.length,
    event_stream_present: seg.event_stream.length > 0,
    timestamps: 'anchored', // untimed transcript → bubble-anchored, NOT exact
  };
}

describe('real cursor fixture → segment via transcript↔bubble join (AC-05)', () => {
  const seg = cursorSegment();
  registerOtlpGoldens(seg, CUR_GOLDEN); // T005

  if (process.env.REGEN_GOLDEN) {
    writeFileSync(CUR_GOLDEN, `${JSON.stringify(seg, null, 2)}\n`);
    writeFileSync(CUR_INVARIANTS, `${JSON.stringify(curInvariantsOf(seg), null, 2)}\n`);
  }

  it('matches the committed golden segment', () => {
    expect(seg).toEqual(JSON.parse(readFileSync(CUR_GOLDEN, 'utf8')));
  });

  it('matches the committed (human-reviewed) invariants.json', () => {
    expect(curInvariantsOf(seg)).toEqual(JSON.parse(readFileSync(CUR_INVARIANTS, 'utf8')));
  });

  it('joins the bubble model onto the transcript turns (AC-05) — composer-2.5, tokens null', () => {
    // The model exists ONLY in the bubbles; a transcript-only read would miss it.
    expect(Object.keys(seg.models ?? {})).toContain('composer-2.5');
    expect(seg.tokens).toBeNull(); // never estimated
  });

  it('emits an ANCHORED timeline (untimed transcript + bubble timing), never exact', () => {
    expect(seg.event_stream.length).toBeGreaterThan(0);
    for (const e of seg.event_stream) {
      expect(e.t_precision).toBe('anchored');
      expect(Number.isNaN(Date.parse(e.t))).toBe(false);
    }
  });
});
