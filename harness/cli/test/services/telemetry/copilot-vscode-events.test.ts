import { describe, expect, it } from 'vitest';
import type { DbRow } from '../../../src/adapters/db/db-port.js';
import { FakeDb } from '../../../src/adapters/db/fake-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { copilotVscodeAdapter } from '../../../src/services/telemetry/adapters/copilot-vscode-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Phase 6 (Amendment A3 reworked) — the `copilot-vscode` adapter emits a v2 event
 * stream anchored to `turns.timestamp` from the VS Code Copilot Chat SQLite store,
 * read via the read-only DbPort (query-aware FakeDb: sessions then turns). Proves:
 * turn-grained anchored timeline; tokens/models null (never estimated — the honest
 * ceiling, as Cursor); `currentPosition` = turn count (the window extent); AC-23
 * privacy — only word-counts + timestamps are read, never the message TEXT.
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'vsc-sess';
const T0 = Date.UTC(2026, 5, 25, 9, 0, 0); // turn 0
const T1 = T0 + 45_000; // turn 1, +45s

// Planted secrets — the message TEXT must NEVER reach the serialized segment (AC-23).
const SECRET = 'sk-PLANTED-SECRET-7777';
const SECRET_PATH = '/Users/x/secret.env';

const SESSIONS: DbRow[] = [{ id: SESSION, cwd: REPO, branch: '036-x', updated_at: 2 }];
// The adapter's SQL projects `words` + `has_response` server-side; these fixture
// rows mimic that projection. The raw `user_message`/`assistant_response` columns
// carry PLANTED SECRETS that the adapter must NEVER consume (it reads only the
// projected `words`/`has_response`) — the read-side privacy proof (AC-23).
const TURNS: DbRow[] = [
  {
    turn_index: 0,
    words: 5,
    has_response: 1,
    timestamp: T0,
    user_message: `please build the adapter ${SECRET}`,
    assistant_response: `done — wrote ${SECRET_PATH}`,
  },
  {
    turn_index: 1,
    words: 4,
    has_response: 1,
    timestamp: T1,
    user_message: `now add the tests ${SECRET}`,
    assistant_response: SECRET_PATH,
  },
];

/** Query-aware store: `sessions` then `turns` return DIFFERENT rows (the two reads). */
function db(turns: DbRow[] = TURNS, sessions: DbRow[] = SESSIONS): FakeDb {
  return new FakeDb((sql) =>
    sql.includes('FROM sessions') ? sessions : sql.includes('FROM turns') ? turns : [],
  );
}

function ctx(over: Partial<HarnessContext> = {}): HarnessContext {
  return {
    env: new FakeEnv({}, HOME),
    fs: new FakeFs({}),
    db: db(),
    repoRoot: REPO,
    harness: 'copilot-vscode',
    window: { since: 'session-start', from: 0, to: 99 },
    ...over,
  };
}

function kinds(events: Event[], kind: Event['kind']): Event[] {
  return events.filter((e) => e.kind === kind);
}

describe('copilotVscodeAdapter — turn-anchored stream from session-store.db (Phase 6)', () => {
  it('currentPosition = the session turn count (the window extent)', () => {
    expect(copilotVscodeAdapter.currentPosition?.(ctx())).toBe(2);
  });

  const caps = copilotVscodeAdapter.extract(ctx());
  const stream = caps.event_stream as Event[];

  it('AC-22 — emits an anchored, time-ordered stream from turns.timestamp', () => {
    expect(stream).not.toBeNull();
    expect(stream.every((e) => e.t_precision === 'anchored')).toBe(true);
    const ts = stream.map((e) => Date.parse(e.t));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));

    const prompt = kinds(stream, 'prompt')[0] as Event & { words: number };
    expect(Date.parse(prompt.t)).toBe(T0);
    expect(prompt.words).toBe(5); // word COUNT only — the secret is one word, never the text
    const turn = kinds(stream, 'turn')[0] as Event & { in?: number };
    expect(Date.parse(turn.t)).toBe(T0);
    expect(turn.in).toBeUndefined(); // no tokens — VS Code Copilot keeps them server-side
  });

  it('AC-22 — tokens / models null (honest ceiling); user_prompts = word counts', () => {
    expect(caps.tokens ?? null).toBeNull();
    expect(caps.models ?? null).toBeNull();
    expect(caps.effort ?? null).toBeNull();
    expect(caps.user_prompts).toEqual([5, 4]);
  });

  it('AC-23 — privacy: message text + abs paths never serialize (rollup.tokens null too)', () => {
    const seg = serializeSegment(
      {
        command: 'doctor',
        harness: 'copilot-vscode',
        harness_session_id: SESSION,
        timecode: '2026-06-25T09:01:00Z',
        window: { since: 'session-start', from: 0, to: 99 },
        branch: null,
        branch_changed: false,
        tokens: null,
        event_stream: stream,
      },
      REPO,
    );
    expect(seg.rollup?.tokens).toBeNull();
    const json = JSON.stringify(seg);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('secret.env');
    expect(json).not.toContain('/Users/x');
  });

  it('windows by turn_index — a prior window only sees the new turns', () => {
    const caps2 = copilotVscodeAdapter.extract(
      ctx({ window: { since: 'last-command', from: 1, to: 2 } }),
    );
    const s2 = caps2.event_stream as Event[];
    expect(kinds(s2, 'prompt').map((e) => Date.parse(e.t))).toEqual([T1]);
    expect(caps2.user_prompts).toEqual([4]);
  });

  it('no turns → null caps (no fabricated timeline)', () => {
    const caps3 = copilotVscodeAdapter.extract(ctx({ db: db([]) }));
    expect(caps3.event_stream ?? null).toBeNull();
    expect(caps3.user_prompts ?? null).toBeNull();
  });

  it('issues TWO distinct reads — sessions then turns (query-aware store)', () => {
    const f = db();
    copilotVscodeAdapter.extract(ctx({ db: f }));
    expect(f.calls.some((c) => c.sql.includes('FROM sessions'))).toBe(true);
    expect(f.calls.some((c) => c.sql.includes('FROM turns'))).toBe(true);
  });

  it('AC-23 read-side — word count + presence are computed IN SQL; no raw text column is returned', () => {
    const f = db();
    copilotVscodeAdapter.extract(ctx({ db: f }));
    const turnsSql = f.calls.find((c) => c.sql.includes('FROM turns'))?.sql ?? '';
    // computed server-side → the message TEXT never crosses the DbPort
    expect(turnsSql).toContain('AS words');
    expect(turnsSql).toContain('AS has_response');
    // the SELECT list returns only structural columns: the raw text columns appear
    // ONLY inside length()/CASE, never as a bare projected column
    const selectList = turnsSql.slice(turnsSql.indexOf('SELECT'), turnsSql.indexOf('FROM'));
    expect(selectList).toContain('length(');
    expect(selectList).not.toMatch(/(?:SELECT|,)\s*user_message\s*(?:,|$)/);
    expect(selectList).not.toMatch(/(?:SELECT|,)\s*assistant_response\s*(?:,|$)/);
  });
});
