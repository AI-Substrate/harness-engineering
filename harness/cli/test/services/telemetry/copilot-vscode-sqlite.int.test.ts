import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { NodeDb } from '../../../src/adapters/db/node-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import {
  copilotVscodeAdapter,
  copilotVscodeStoreDbPaths,
  resolveCopilotVscodeSessionId,
} from '../../../src/services/telemetry/adapters/copilot-vscode-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import { registerOtlpGoldens } from './otlp-golden.js';

/**
 * T008 (plan 2.4 · AC-04 · Finding 05) — the copilot-vscode SQL ROUND-TRIP.
 *
 * The committed `raw.rows.json` fixture is privacy-projected: it carries only the
 * structural turn columns (`turn_index`/`words`/`has_response`/`timestamp`), never
 * message text. To prove the runtime adapter's ACTUAL SQL works against a REAL
 * SQLite engine, this test RECONSTRUCTS a throwaway store from those rows:
 *
 *   1. Build a WRITABLE `node:sqlite` db (the `NodeDb` port is read-only) at the
 *      exact path the adapter resolves (`copilotVscodeStoreDbPaths`), synthesising
 *      a `user_message` of N space-joined tokens for a turn whose projected count
 *      is N — so the adapter's `TURNS_SQL` (`spaces+1`) recomputes the SAME N.
 *   2. Read it back through the real read-only `NodeDb` via the adapter's real
 *      `resolveCopilotVscodeSessionId` (cwd→session) + `TURNS_SQL` (turn projection).
 *   3. `serializeSegment` → a committed golden.
 *
 * The round-trip is sound BECAUSE the synthesis is the inverse of the SQL word
 * count: `projectCopilotVscodeRows` (capture) and `TURNS_SQL` (runtime) share the
 * `spaces+1` formula, so `fixture.words === extracted.words` is a real cross-check,
 * not a tautology — a drift in either side would break the deep-equal below.
 *
 * Tests MAY use `node:*` directly (the throwaway-db build) — only the SERVICES
 * stay ports-only (P2). Regenerate the golden with:
 *   `REGEN_GOLDEN=1 vitest run copilot-vscode-sqlite.int`
 */

const require = createRequire(import.meta.url);
const REPO = '/home/dev/repo'; // the scrubbed fixture's rebased cwd
const HOME = mkdtempSync(join(tmpdir(), 'vscode-rt-'));

const DIR = 'copilot-vscode/2026-06-25-real';
const RAW = fileURLToPath(new URL(`./fixtures/real/${DIR}/raw.rows.json`, import.meta.url));
const GOLDEN = fileURLToPath(
  new URL(`./fixtures/real/${DIR}/expected-segment.json`, import.meta.url),
);

interface ExtractedRows {
  sessions: Array<{ id: string; cwd: string; updated_at: unknown }>;
  turns: Array<{
    session_id: string;
    turn_index: number;
    words: number;
    has_response: 0 | 1;
    timestamp: unknown;
  }>;
}
const rows = JSON.parse(readFileSync(RAW, 'utf8')) as ExtractedRows;

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

/**
 * Reconstruct a throwaway store from the projected rows. The adapter resolves the
 * db path from `copilotVscodeStoreDbPaths(env)[0]` (the macOS slot, present whenever
 * HOME is set — platform-independent), so we seed exactly there. A turn with `words:N`
 * gets a `user_message` of N space-joined tokens (N−1 spaces) so `TURNS_SQL` recovers N.
 */
function seedStore(env: FakeEnv): string {
  const dbPath = copilotVscodeStoreDbPaths(env)[0];
  if (dbPath === undefined) throw new Error('no candidate store path');
  mkdirSync(dirname(dbPath), { recursive: true });
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (
      p: string,
    ) => {
      exec(s: string): void;
      prepare(s: string): { run(...a: unknown[]): void };
      close(): void;
    };
  };
  const db = new DatabaseSync(dbPath); // writable — the NodeDb port is read-only
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, updated_at TEXT)');
  db.exec(
    'CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT)',
  );
  const si = db.prepare('INSERT INTO sessions (id, cwd, updated_at) VALUES (?, ?, ?)');
  for (const s of rows.sessions) si.run(s.id, s.cwd, String(s.updated_at));
  const ti = db.prepare(
    'INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)',
  );
  for (const t of rows.turns) {
    const userMsg = t.words > 0 ? Array(t.words).fill('w').join(' ') : '';
    const assistant = t.has_response === 1 ? 'x' : null;
    ti.run(t.session_id, t.turn_index, userMsg, assistant, t.timestamp as string);
  }
  db.close();
  return dbPath;
}

function buildSegment() {
  const env = new FakeEnv({}, HOME);
  seedStore(env);
  const db = new NodeDb();
  // Resolve the session by cwd through the adapter's REAL SQL (read-only NodeDb).
  const sessionId = resolveCopilotVscodeSessionId(db, env, REPO);
  const ctx: HarnessContext = {
    env,
    db,
    repoRoot: REPO,
    harness: 'copilot-vscode',
    sessionId: sessionId ?? undefined,
    window: { since: 'session-start', from: 0, to: rows.turns.length },
  };
  const caps = copilotVscodeAdapter.extract(ctx);
  const input: SegmentInput = {
    command: 'flow',
    harness: 'copilot-vscode',
    harness_version: '0.0.0-fixture', // pinned synthetic version (decoupled from the live release)
    harness_session_id: sessionId,
    timecode: '2026-06-25T00:00:00Z',
    window: ctx.window,
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
  return { seg: serializeSegment(input, REPO), sessionId };
}

describe('real copilot-vscode fixture → segment via SQL round-trip (AC-04)', () => {
  const { seg, sessionId } = buildSegment();
  registerOtlpGoldens(seg, GOLDEN); // T005 — mint/assert the OTLP goldens beside the segment

  if (process.env.REGEN_GOLDEN) {
    writeFileSync(GOLDEN, `${JSON.stringify(seg, null, 2)}\n`);
  }

  it('resolves the fixture session id by cwd through the real adapter SQL', () => {
    expect(sessionId).toBe(rows.sessions[0]?.id);
  });

  it('matches the committed golden segment', () => {
    expect(seg).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('round-trips the projected word counts back through real TURNS_SQL', () => {
    // The adapter pushes turn.words for each non-empty prompt. The synthesis →
    // real SQL → user_prompts loop must reproduce the fixture's words verbatim.
    const fixtureWords = rows.turns.filter((t) => t.words > 0).map((t) => t.words);
    expect(seg.user_prompts).toEqual(fixtureWords);
  });

  it('keeps tokens null (VS Code Copilot keeps usage server-side) + anchored timeline', () => {
    expect(seg.tokens).toBeNull();
    expect(seg.event_stream.length).toBeGreaterThan(0);
    // The store's timestamps are untimed-precision → every event is `anchored`.
    for (const e of seg.event_stream) {
      expect(e.t_precision).toBe('anchored');
      expect(Number.isNaN(Date.parse(e.t))).toBe(false);
    }
  });
});
