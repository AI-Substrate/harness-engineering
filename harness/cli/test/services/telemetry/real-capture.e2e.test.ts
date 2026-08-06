import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import { conformLogs, conformMetrics } from '../../conformance/otlp-conformance.js';
import { expectCurrentSegmentMatchesLegacy, registerOtlpGoldens } from './otlp-golden.js';

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
 * Segment-2.4/OTLP-v0.1 goldens and invariants are frozen compatibility
 * evidence. Regeneration is deliberately disabled; current output is projected
 * only across the approved Segment-2.6/OTLP-v0.3 metadata delta.
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

  it('matches the frozen Segment-2.4 golden modulo approved 2.6 metadata and usage', () => {
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expectCurrentSegmentMatchesLegacy(seg, expected);
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

  it('FX001-A (real corpus) — a non-harness command surfaces its program+verb signature', () => {
    // The scrubbed claude capture runs real `git`/`gh` commands. MUTATION: dropping
    // the kept signature in claude-adapter (never setting call.signature) makes every
    // Bash tools event signature-less → `git commit` is no longer found → this fails.
    const bashSigs = seg.event_stream
      .filter((e): e is typeof e & { name: string; signature?: string } => e.kind === 'tools')
      .map((e) => e.signature)
      .filter((s): s is string => s !== undefined);
    expect(bashSigs).toContain('git commit');
    // P12: only program+verb ever survives — no signature carries a flag/path/quote.
    for (const s of bashSigs) expect(s).toMatch(/^[a-z0-9._-]+( [a-z0-9._-]+)?$/i);
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
    usage_observations: seg.event_stream
      .filter((event) => event.kind === 'usage')
      .map(({ t: _t, kind: _kind, ...observation }) => observation),
    event_count: seg.event_stream.length,
    event_stream_present: seg.event_stream.length > 0,
  };
}

describe('real copilot-cli fixture → segment (AC-03)', () => {
  const seg = copilotSegment();
  registerOtlpGoldens(seg, CO_GOLDEN); // T005

  it('matches the frozen Segment-2.4 golden modulo approved 2.6 metadata and usage', () => {
    expectCurrentSegmentMatchesLegacy(seg, JSON.parse(readFileSync(CO_GOLDEN, 'utf8')));
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

  it('FX001-A (real corpus) — a co-timed `harness …` stays a harness event; no bash signature (no double-count)', () => {
    // The scrubbed copilot-cli capture is a `harness doctor` run: it must emit a
    // `harness` event (verb `doctor`) and NO bash tools event may carry a signature
    // — attaching one would both leak the harness verb onto bash AND double-count it
    // against the HarnessEvent. MUTATION: returning `.harness[0]` from shellSignature
    // sets the bash burst's signature to `doctor` → the undefined check flips RED.
    expect(seg.event_stream.filter((e) => e.kind === 'harness')).toContainEqual(
      expect.objectContaining({ kind: 'harness', verb: 'doctor' }),
    );
    const bashSigs = seg.event_stream
      .filter((e): e is typeof e & { name: string; signature?: string } => e.kind === 'tools')
      .filter((e) => e.name === 'bash' || e.name === 'shell')
      .map((e) => e.signature);
    expect(bashSigs.every((s) => s === undefined)).toBe(true);
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

  it('matches the frozen Segment-2.4 golden modulo approved 2.6 metadata and usage', () => {
    expectCurrentSegmentMatchesLegacy(seg, JSON.parse(readFileSync(CUR_GOLDEN, 'utf8')));
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

// ── cursor · plan 066 (ApplyPatch file deltas, HEADLESS) ─────────────────────
// The corpus had no cursor EDITING session, so the ApplyPatch → `file` event path
// shipped without real-corpus drift cover. This instance closes that: a real
// headless `cursor-agent` conversation that built a small demo toolkit with 9
// `ApplyPatch` calls (6 `Add File:` → `written`, 3 `Update File:` → `edited`).
//
// Headless means NO IDE bubbles exist for the conversation, so there is no
// `raw.rows.json` and no FakeDb: the transcript is untimed AND unanchored, and the
// adapter stamps every file event with the capture wall-clock at
// `t_precision:'interval'` ("within this window") instead of fabricating a time or
// dropping the event. That `interval` branch is what this fixture guards.
//
// Unlike the four frozen Segment-2.4/OTLP-v0.1 instances above, this instance is
// minted at the CURRENT schema, so its goldens are compared EXACTLY (no
// compatibility projection). Re-mint after an intentional adapter change with:
//   REGEN_066_GOLDEN=1 npx vitest run test/services/telemetry/real-capture.e2e.test.ts
// then re-review the diff before committing (goldens are derived, never hand-edited).
const AP_DIR = 'cursor/2026-08-03-applypatch-textstat';
const AP_CONV = '1a501a09-236c-4378-9138-f196a8958aa9';
const AP_CAPTURED_AT = '2026-08-03T22:30:00.000Z'; // pinned synthetic capture wall-clock
const AP_FIXTURE_DIR = fileURLToPath(new URL(`./fixtures/real/${AP_DIR}`, import.meta.url));
const AP_TRANSCRIPT = readFileSync(join(AP_FIXTURE_DIR, 'raw.jsonl'), 'utf8');
const AP_TRANSCRIPTS_DIR = `${HOME}/.cursor/projects/home-dev-repo/agent-transcripts`;
const AP_LINES = AP_TRANSCRIPT.split('\n').filter((l) => l.trim().length > 0).length;
const apWindow = { since: 'session-start', from: 0, to: AP_LINES } as const;

function applyPatchSegment() {
  const fs = new FakeFs({
    [cursorTranscriptPath(AP_TRANSCRIPTS_DIR, AP_CONV)]: AP_TRANSCRIPT,
  });
  const env = new FakeEnv(
    { [CURSOR_SESSION_ENV]: AP_CONV, [CURSOR_TRANSCRIPTS_ENV]: AP_TRANSCRIPTS_DIR },
    HOME,
  );
  // NO `db`: a headless CLI conversation has no `cursorDiskKV` bubbles at all.
  const caps = cursorAdapter.extract({
    env,
    fs,
    repoRoot: REPO,
    harness: 'cursor-agent',
    window: apWindow,
    capturedAt: AP_CAPTURED_AT,
  });
  const input: SegmentInput = {
    command: 'flow',
    harness: 'cursor-agent',
    harness_version: '0.0.0-fixture', // pinned synthetic version (decoupled from the live release)
    harness_session_id: AP_CONV,
    timecode: '2026-08-03T22:30:00Z',
    window: apWindow,
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
function apInvariantsOf(seg: ReturnType<typeof applyPatchSegment>) {
  return {
    tokens: seg.tokens, // null — Cursor keeps consumption server-side
    models: Object.keys(seg.models ?? {}).sort(), // [] — headless: no bubbles, no model
    user_prompts: seg.user_prompts ?? [],
    tools: seg.tools ?? {},
    files: seg.files,
    file_deltas: seg.event_stream
      .filter((e) => e.kind === 'file')
      .map((e) => ({ path: e.path, change: e.change, ...e.delta })),
    event_count: seg.event_stream.length,
    event_stream_present: seg.event_stream.length > 0,
    timestamps: 'interval', // untimed transcript + NO bubble anchor → capture-window stamp
  };
}

const apSeg = applyPatchSegment();
const apLogs = segmentToOtlpLogs(apSeg);
const apMetrics = rollupToOtlpMetrics(apSeg);

if (process.env.REGEN_066_GOLDEN) {
  // This instance is NOT part of the frozen Segment-2.4 corpus, so its derived
  // goldens stay regenerable (see the header note); the frozen instances above are
  // untouched by this branch.
  writeFileSync(
    join(AP_FIXTURE_DIR, 'expected-segment.json'),
    `${JSON.stringify(apSeg, null, 2)}\n`,
  );
  writeFileSync(
    join(AP_FIXTURE_DIR, 'invariants.json'),
    `${JSON.stringify(apInvariantsOf(apSeg), null, 2)}\n`,
  );
  writeFileSync(join(AP_FIXTURE_DIR, 'expected-otlp-logs.jsonl'), `${JSON.stringify(apLogs)}\n`);
  writeFileSync(
    join(AP_FIXTURE_DIR, 'expected-otlp-metrics.jsonl'),
    `${JSON.stringify(apMetrics)}\n`,
  );
}

describe('real cursor ApplyPatch fixture → segment (plan 066)', () => {
  it('matches the committed expected-segment.json golden EXACTLY', () => {
    expect(apSeg).toEqual(
      JSON.parse(readFileSync(join(AP_FIXTURE_DIR, 'expected-segment.json'), 'utf8')),
    );
  });

  it('matches the committed (human-reviewed) invariants.json', () => {
    expect(apInvariantsOf(apSeg)).toEqual(
      JSON.parse(readFileSync(join(AP_FIXTURE_DIR, 'invariants.json'), 'utf8')),
    );
  });

  it('matches the committed OTLP logs/metrics goldens, and both conform to the OTLP protos', () => {
    expect(conformLogs(apLogs)).toEqual({ ok: true });
    expect(conformMetrics(apMetrics)).toEqual({ ok: true });
    expect(apLogs).toEqual(
      JSON.parse(readFileSync(join(AP_FIXTURE_DIR, 'expected-otlp-logs.jsonl'), 'utf8')),
    );
    expect(apMetrics).toEqual(
      JSON.parse(readFileSync(join(AP_FIXTURE_DIR, 'expected-otlp-metrics.jsonl'), 'utf8')),
    );
  });

  it('extracts 9 ApplyPatch file events — 6 written + 3 edits over 2 files (the plan-066 payload)', () => {
    // MUTATION: dropping the ApplyPatch branch in cursor-adapter (or narrowing the
    // event-stream gate back to `anyTs`) empties this list → RED.
    const files = apSeg.event_stream.filter((e) => e.kind === 'file');
    expect(files).toHaveLength(9);
    expect(files.filter((e) => e.change === 'written')).toHaveLength(6);
    expect(files.filter((e) => e.change === 'edited')).toHaveLength(3);
    // The path lists dedupe: 3 edit events land on only 2 distinct files.
    expect(apSeg.files).toEqual({
      written: [
        'demo/textstat/lib.mjs',
        'demo/textstat/lib.test.mjs',
        'demo/textstat/cli.mjs',
        'demo/textstat/fixtures/welcome.txt',
        'demo/textstat/fixtures/unicode.txt',
        'demo/textstat/README.md',
      ],
      edited: ['demo/textstat/lib.test.mjs', 'demo/textstat/cli.mjs'],
    });
    // Real per-file counts read off the real V4A patch bodies.
    expect(files[0]).toMatchObject({
      path: 'demo/textstat/lib.mjs',
      change: 'written',
      delta: { lines_added: 72, lines_removed: 0, bytes_added: 1809, bytes_removed: 0 },
    });
  });

  it('stamps INTERVAL precision at the capture wall-clock (headless: no bubble anchor)', () => {
    // The whole stream is file events — no bubbles means no prompt/turn/tools events.
    expect(apSeg.event_stream.length).toBeGreaterThan(0);
    for (const e of apSeg.event_stream) {
      expect(e.kind).toBe('file');
      expect(e.t_precision).toBe('interval');
      expect(e.t).toBe(AP_CAPTURED_AT);
    }
    // ...yet the untimed capabilities still land (counts don't need timestamps).
    expect(apSeg.tools.ApplyPatch).toBe(9);
    expect(apSeg.tokens).toBeNull(); // never estimated
    expect(apSeg.models).toBeUndefined(); // headless → no bubbles → no model, not a guess
  });

  it('confines every file path to repo-relative form — no absolute path survives', () => {
    // The raw transcript's patch headers are ABSOLUTE in-repo paths; confinement
    // happens at serialize time (AC-04).
    for (const e of apSeg.event_stream.filter((e) => e.kind === 'file')) {
      expect(e.path.startsWith('/')).toBe(false);
      expect(e.path).not.toBe('<external>');
    }
    for (const p of [...apSeg.files.written, ...apSeg.files.edited]) {
      expect(p.startsWith('/')).toBe(false);
    }
  });
});

// ── cursor · FX009 (Write/StrReplace OBJECT inputs) ──────────────────────────
// The corpus had no session in Cursor's `Write`/`StrReplace` vocabulary, which is
// exactly why the defect shipped: the adapter gated file extraction on
// `name === 'ApplyPatch' && typeof input === 'string'`, and an OBJECT input fails
// BOTH halves. The tools were still counted, zero `file` events were emitted, and
// downstream published a well-formed report crediting 100% of the agent's lines to
// a human — 410 committed lines → 0.0% agent, with no error and no gap marker.
//
// This instance is the reporting machine's OWN session, scrubbed. It is the only
// real evidence of this vocabulary anywhere in the corpus:
//   Shell 21 · StrReplace 8 · Read 7 · Write 6 · Grep 3 · Glob 2 · Await 2 —
// and ApplyPatch ZERO, so nothing here can pass through the old branch by accident.
//
// SCRUB CONSEQUENCE, stated rather than papered over: the source paths were
// lowercase drive-letter absolute (`c:\src\…`) and the scrub rebased them onto
// `/home/dev/repo`. The BACKSLASH separators survive, so this fixture does exercise
// Windows separator handling end to end — but drive-letter confinement is no longer
// carried here and is covered by a synthetic unit test (`cursor-file-events.test.ts`),
// which needs no real machine data.
//
// Headless with respect to THIS machine: the conversation's `cursorDiskKV` bubbles
// live on the reporter's box, so there is no `raw.rows.json` and no FakeDb — every
// event is interval-grade at the pinned capture wall-clock.
//
// Minted at the CURRENT schema, so its goldens compare EXACTLY. Re-mint after an
// intentional adapter change with:
//   REGEN_FX009_GOLDEN=1 npx vitest run test/services/telemetry/real-capture.e2e.test.ts
// then re-review the diff before committing (goldens are derived, never hand-edited).
const WR_DIR = 'cursor/2026-08-06-write-strreplace';
const WR_CONV = '71282df5-d151-4dce-82cc-17a1a3d31f93';
const WR_CAPTURED_AT = '2026-08-06T02:00:00.000Z'; // pinned synthetic capture wall-clock
const WR_FIXTURE_DIR = fileURLToPath(new URL(`./fixtures/real/${WR_DIR}`, import.meta.url));
const WR_TRANSCRIPT = readFileSync(join(WR_FIXTURE_DIR, 'raw.jsonl'), 'utf8');
const WR_TRANSCRIPTS_DIR = `${HOME}/.cursor/projects/home-dev-repo/agent-transcripts`;
const WR_LINES = WR_TRANSCRIPT.split('\n').filter((l) => l.trim().length > 0).length;
const wrWindow = { since: 'session-start', from: 0, to: WR_LINES } as const;

function writeStrReplaceSegment() {
  const fs = new FakeFs({
    [cursorTranscriptPath(WR_TRANSCRIPTS_DIR, WR_CONV)]: WR_TRANSCRIPT,
  });
  const env = new FakeEnv(
    { [CURSOR_SESSION_ENV]: WR_CONV, [CURSOR_TRANSCRIPTS_ENV]: WR_TRANSCRIPTS_DIR },
    HOME,
  );
  const caps = cursorAdapter.extract({
    env,
    fs,
    repoRoot: REPO,
    harness: 'cursor-agent',
    window: wrWindow,
    capturedAt: WR_CAPTURED_AT,
  });
  const input: SegmentInput = {
    command: 'flow',
    harness: 'cursor-agent',
    harness_version: '0.0.0-fixture', // pinned synthetic version (decoupled from the live release)
    harness_session_id: WR_CONV,
    timecode: '2026-08-06T02:00:00Z',
    window: wrWindow,
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
function wrInvariantsOf(seg: ReturnType<typeof writeStrReplaceSegment>) {
  return {
    tokens: seg.tokens, // null — Cursor keeps consumption server-side
    models: Object.keys(seg.models ?? {}).sort(), // [] — no bubbles on this machine
    user_prompts: seg.user_prompts ?? [],
    tools: seg.tools ?? {},
    files: seg.files,
    file_deltas: seg.event_stream
      .filter((e) => e.kind === 'file')
      .map((e) => ({ path: e.path, change: e.change, ...e.delta })),
    event_count: seg.event_stream.length,
    event_stream_present: seg.event_stream.length > 0,
    timestamps: 'interval', // untimed transcript + NO bubble anchor → capture-window stamp
  };
}

const wrSeg = writeStrReplaceSegment();
const wrLogs = segmentToOtlpLogs(wrSeg);
const wrMetrics = rollupToOtlpMetrics(wrSeg);

if (process.env.REGEN_FX009_GOLDEN) {
  writeFileSync(
    join(WR_FIXTURE_DIR, 'expected-segment.json'),
    `${JSON.stringify(wrSeg, null, 2)}\n`,
  );
  writeFileSync(
    join(WR_FIXTURE_DIR, 'invariants.json'),
    `${JSON.stringify(wrInvariantsOf(wrSeg), null, 2)}\n`,
  );
  writeFileSync(join(WR_FIXTURE_DIR, 'expected-otlp-logs.jsonl'), `${JSON.stringify(wrLogs)}\n`);
  writeFileSync(
    join(WR_FIXTURE_DIR, 'expected-otlp-metrics.jsonl'),
    `${JSON.stringify(wrMetrics)}\n`,
  );
}

describe('real cursor Write/StrReplace fixture → segment (FX009)', () => {
  it('matches the committed expected-segment.json golden EXACTLY', () => {
    expect(wrSeg).toEqual(
      JSON.parse(readFileSync(join(WR_FIXTURE_DIR, 'expected-segment.json'), 'utf8')),
    );
  });

  it('matches the committed (human-reviewed) invariants.json', () => {
    expect(wrInvariantsOf(wrSeg)).toEqual(
      JSON.parse(readFileSync(join(WR_FIXTURE_DIR, 'invariants.json'), 'utf8')),
    );
  });

  it('matches the committed OTLP logs/metrics goldens, and both conform to the OTLP protos', () => {
    expect(conformLogs(wrLogs)).toEqual({ ok: true });
    expect(conformMetrics(wrMetrics)).toEqual({ ok: true });
    expect(wrLogs).toEqual(
      JSON.parse(readFileSync(join(WR_FIXTURE_DIR, 'expected-otlp-logs.jsonl'), 'utf8')),
    );
    expect(wrMetrics).toEqual(
      JSON.parse(readFileSync(join(WR_FIXTURE_DIR, 'expected-otlp-metrics.jsonl'), 'utf8')),
    );
  });

  it('carries the Write/StrReplace vocabulary and ZERO ApplyPatch — the defect payload', () => {
    // The pre-fix adapter counted every one of these and emitted no file event at all.
    expect(wrSeg.tools).toEqual({
      Shell: 21,
      StrReplace: 8,
      Read: 7,
      Write: 6,
      Grep: 3,
      Glob: 2,
      Await: 2,
    });
    expect(wrSeg.tools.ApplyPatch).toBeUndefined(); // nothing here reaches the old branch
  });

  it('extracts a file event for EVERY Write and StrReplace call (14 = 6 written + 8 edited)', () => {
    // MUTATION: restoring the `name === 'ApplyPatch' && typeof input === 'string'`
    // gate empties this list → RED, and the segment publishes a confident zero.
    const files = wrSeg.event_stream.filter((e) => e.kind === 'file');
    expect(files).toHaveLength(14);
    expect(files.filter((e) => e.change === 'written')).toHaveLength(6);
    expect(files.filter((e) => e.change === 'edited')).toHaveLength(8);
    // Every event carries a measured delta — a file event with an all-zero delta
    // would be the silent zero wearing the fix's clothes.
    expect(files.filter((e) => e.delta.lines_added > 0 || e.delta.lines_removed > 0)).toHaveLength(
      14,
    );
  });

  it('keeps SAME-PATH churn as separate events (array push, never last-write-wins)', () => {
    // The specimen edits some files repeatedly. A keyed map (the claude adapter's
    // `Map.set`) would collapse those to one delta per path and permanently
    // under-count churn in this golden — the join sums per path downstream.
    const files = wrSeg.event_stream.filter((e) => e.kind === 'file');
    const distinct = new Set(files.map((e) => e.path));
    expect(files.length).toBeGreaterThan(distinct.size); // churn survives, provably
  });

  it('handles WINDOWS separators end to end — no backslash and no absolute path survives', () => {
    // The raw transcript's paths use `\` separators (the reporting machine is
    // Windows). Confinement normalizes them at serialize time; a miss would publish
    // an absolute machine path.
    expect(WR_TRANSCRIPT).toContain('\\\\'); // JSON-escaped `\` — the raw shape really is Windows
    for (const e of wrSeg.event_stream.filter((e) => e.kind === 'file')) {
      expect(e.path).not.toContain('\\');
      expect(e.path.startsWith('/')).toBe(false);
      expect(e.path).not.toBe('<external>');
    }
    for (const p of [...wrSeg.files.written, ...wrSeg.files.edited]) {
      expect(p).not.toContain('\\');
      expect(p.startsWith('/')).toBe(false);
    }
  });

  it('never carries file CONTENT — `contents`/`old_string`/`new_string` are full file text', () => {
    // The payloads this fixture feeds the adapter are whole files and edit pairs.
    // Only integer counts may survive them (AC-04).
    const serialized = JSON.stringify(wrSeg);
    for (const line of WR_TRANSCRIPT.split('\n').filter((l) => l.trim() !== '')) {
      const o = JSON.parse(line) as { message?: { content?: Record<string, unknown>[] } };
      for (const b of o.message?.content ?? []) {
        if (b.type !== 'tool_use') continue;
        const input = (b.input ?? {}) as Record<string, unknown>;
        for (const key of ['contents', 'content', 'old_string', 'new_string']) {
          const text = input[key];
          if (typeof text !== 'string' || text.trim().length < 24) continue;
          expect(serialized).not.toContain(text.trim().slice(0, 24));
        }
      }
    }
  });
});
