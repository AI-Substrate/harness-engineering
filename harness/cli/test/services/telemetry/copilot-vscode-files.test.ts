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
 * Plan 066 Phase 2 — `copilot-vscode` file evidence from `session_files`.
 *
 * The store records file TOUCHES, not patch bodies, so this pins the HONEST
 * ceiling as much as the happy path: WRITE tools become authorship paths,
 * `read_file`/`list_dir` never do, the `tools` histogram is per-file-first-seen,
 * written-vs-edited comes from the chat-editing state's empty-content hash (and
 * degrades to `edited`, never to a throw, when that state is absent), and NO
 * `file` event is ever emitted because the deltas are unknowable.
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'vsc-sess';
const USER_ROOT = `${HOME}/Library/Application Support/Code/User`;
const WS_HASH = 'ab12cd34';
const STATE_JSON = `${USER_ROOT}/workspaceStorage/${WS_HASH}/chatEditingSessions/${SESSION}/state.json`;

const T0 = '2026-08-03T23:00:00.000Z';
const T1 = '2026-08-03T23:30:00.000Z';

const LIB = `${REPO}/demo/lib.mjs`;
const CLI = `${REPO}/demo/cli.mjs`;
const READ_ONLY = `${REPO}/demo/notes.md`;
const DIR_ROW = `${REPO}/demo`;

const TURNS: DbRow[] = [
  { turn_index: 0, words: 5, has_response: 1, timestamp: T0 },
  { turn_index: 1, words: 4, has_response: 1, timestamp: T1 },
];

/** Rows shaped exactly as the live store writes them: `turn_index` is always NULL. */
const FILES: DbRow[] = [
  { file_path: LIB, tool_name: 'apply_patch', turn_index: null, first_seen_at: T0 },
  { file_path: READ_ONLY, tool_name: 'read_file', turn_index: null, first_seen_at: T0 },
  { file_path: DIR_ROW, tool_name: 'list_dir', turn_index: null, first_seen_at: T0 },
  {
    file_path: CLI,
    tool_name: 'apply_patch',
    turn_index: null,
    first_seen_at: '2026-08-03T23:40:00.000Z',
  },
];

/** `initialFileContents` is an ARRAY of `[fileUri, contentHash]` pairs (live shape). */
function stateJson(pairs: [string, string][]): string {
  return JSON.stringify({ version: 1, initialFileContents: pairs, timeline: [] });
}

/** The empty-string SHA-1, TRUNCATED exactly as VS Code stores it. */
const EMPTY_HASH = 'da39a3e';

function db(files: DbRow[] = FILES, turns: DbRow[] = TURNS): FakeDb {
  return new FakeDb((sql) =>
    sql.includes('FROM turns') ? turns : sql.includes('FROM session_files') ? files : [],
  );
}

function ctx(over: Partial<HarnessContext> = {}): HarnessContext {
  return {
    env: new FakeEnv({}, HOME),
    fs: new FakeFs({}),
    db: db(),
    repoRoot: REPO,
    harness: 'copilot-vscode',
    sessionId: SESSION,
    window: { since: 'session-start', from: 0, to: 99 },
    ...over,
  };
}

/** A FakeFs whose `workspaceStorage` holds ONE workspace with this session's state. */
function fsWithState(body: string, wsHash = WS_HASH): FakeFs {
  const path = `${USER_ROOT}/workspaceStorage/${wsHash}/chatEditingSessions/${SESSION}/state.json`;
  return new FakeFs({ [path]: body }, { [`${USER_ROOT}/workspaceStorage`]: [wsHash] });
}

describe('copilotVscodeAdapter — session_files evidence (plan 066 Phase 2)', () => {
  it('classifies WRITE tools as authorship and EXCLUDES read/inspect tools', () => {
    const caps = copilotVscodeAdapter.extract(ctx());
    // read_file (a file) and list_dir (a DIRECTORY) never become authorship paths
    expect(caps.files).toEqual({ written: [], edited: [LIB, CLI] });
    expect(caps.files?.edited).not.toContain(READ_ONLY);
    expect(caps.files?.edited).not.toContain(DIR_ROW);
  });

  it('tools histogram counts every tool INCLUDING reads (per-file-first-seen)', () => {
    // A read is a real invocation — it just is not authorship. Exact counts, so a
    // mutation that drops reads from the histogram (or double-counts) fails here.
    expect(copilotVscodeAdapter.extract(ctx()).tools).toEqual({
      apply_patch: 2,
      read_file: 1,
      list_dir: 1,
    });
  });

  it('a read-only window yields a tools histogram but NO files (authorship ≠ looked-at)', () => {
    const readsOnly = [
      { file_path: READ_ONLY, tool_name: 'read_file', turn_index: null, first_seen_at: T0 },
      { file_path: DIR_ROW, tool_name: 'list_dir', turn_index: null, first_seen_at: T0 },
    ];
    const caps = copilotVscodeAdapter.extract(ctx({ db: db(readsOnly) }));
    expect(caps.tools).toEqual({ read_file: 1, list_dir: 1 });
    expect(caps.files ?? null).toBeNull();
  });

  it('an UNKNOWN tool is counted but never claimed as authorship (conservative)', () => {
    const rows = [
      { file_path: LIB, tool_name: 'some_future_tool', turn_index: null, first_seen_at: T0 },
    ];
    const caps = copilotVscodeAdapter.extract(ctx({ db: db(rows) }));
    expect(caps.tools).toEqual({ some_future_tool: 1 });
    expect(caps.files ?? null).toBeNull();
  });

  it('a NULL tool_name names no tool — neither counted nor classified', () => {
    const rows = [
      { file_path: LIB, tool_name: null, turn_index: null, first_seen_at: T0 },
      { file_path: CLI, tool_name: 'apply_patch', turn_index: null, first_seen_at: T0 },
    ];
    const caps = copilotVscodeAdapter.extract(ctx({ db: db(rows) }));
    expect(caps.tools).toEqual({ apply_patch: 1 });
    expect(caps.files).toEqual({ written: [], edited: [CLI] });
  });

  it('an OLDER store with no session_files table degrades to null caps, never a throw', () => {
    // The DbPort turns "no such table" into `[]` — the adapter must read that as
    // "no evidence", while the turn-anchored stream it already had keeps working.
    const caps = copilotVscodeAdapter.extract(ctx({ db: db([]) }));
    expect(caps.files ?? null).toBeNull();
    expect(caps.tools ?? null).toBeNull();
    expect(caps.user_prompts).toEqual([5, 4]); // the rest of the adapter is unaffected
  });

  it('no DbPort at all → null file caps (no fs probing either)', () => {
    const fs = fsWithState(stateJson([[`file://${LIB}`, EMPTY_HASH]]));
    const caps = copilotVscodeAdapter.extract(ctx({ db: undefined, fs }));
    expect(caps.files ?? null).toBeNull();
    expect(caps.tools ?? null).toBeNull();
  });

  describe('written vs edited — the chat-editing empty-content hash', () => {
    it('empty-content hash ⇒ written; a real prior hash ⇒ edited', () => {
      const fs = fsWithState(
        stateJson([
          [`file://${LIB}`, EMPTY_HASH],
          [`file://${CLI}`, '51ed966'], // existed before the agent touched it
        ]),
      );
      expect(copilotVscodeAdapter.extract(ctx({ fs })).files).toEqual({
        written: [LIB],
        edited: [CLI],
      });
    });

    it('the FULL empty SHA-1 counts too (VS Code truncates it; both must match)', () => {
      const full = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
      const fs = fsWithState(stateJson([[`file://${LIB}`, full]]));
      expect(copilotVscodeAdapter.extract(ctx({ fs })).files).toEqual({
        written: [LIB],
        edited: [CLI],
      });
    });

    it('a percent-encoded file:// URI still matches the store\u2019s raw path', () => {
      const spaced = `${REPO}/demo/my file.mjs`;
      const rows = [
        { file_path: spaced, tool_name: 'apply_patch', turn_index: null, first_seen_at: T0 },
      ];
      const fs = fsWithState(stateJson([[`file://${REPO}/demo/my%20file.mjs`, EMPTY_HASH]]));
      expect(copilotVscodeAdapter.extract(ctx({ db: db(rows), fs })).files).toEqual({
        written: [spaced],
        edited: [],
      });
    });

    it('MISSING state.json ⇒ everything edited (optional evidence, never a throw)', () => {
      expect(copilotVscodeAdapter.extract(ctx()).files).toEqual({
        written: [],
        edited: [LIB, CLI],
      });
    });

    it('UNPARSEABLE state.json ⇒ everything edited (never a throw)', () => {
      const fs = fsWithState('{ not json');
      expect(copilotVscodeAdapter.extract(ctx({ fs })).files).toEqual({
        written: [],
        edited: [LIB, CLI],
      });
    });

    it('another workspace\u2019s chat-editing state is never borrowed', () => {
      // Same workspace hash, DIFFERENT session leaf — the file must not be read.
      const other = `${USER_ROOT}/workspaceStorage/${WS_HASH}/chatEditingSessions/other-sess/state.json`;
      const fs = new FakeFs(
        { [other]: stateJson([[`file://${LIB}`, EMPTY_HASH]]) },
        { [`${USER_ROOT}/workspaceStorage`]: [WS_HASH] },
      );
      expect(copilotVscodeAdapter.extract(ctx({ fs })).files).toEqual({
        written: [],
        edited: [LIB, CLI],
      });
    });

    it('scans past non-matching workspaces to find the session\u2019s own state', () => {
      const fs = new FakeFs(
        { [STATE_JSON]: stateJson([[`file://${LIB}`, EMPTY_HASH]]) },
        { [`${USER_ROOT}/workspaceStorage`]: ['zz-empty', 'yy-empty', WS_HASH] },
      );
      expect(copilotVscodeAdapter.extract(ctx({ fs })).files).toEqual({
        written: [LIB],
        edited: [CLI],
      });
    });

    it('skips the state.json scan entirely when the window has no write rows', () => {
      const readsOnly = [
        { file_path: READ_ONLY, tool_name: 'read_file', turn_index: null, first_seen_at: T0 },
      ];
      const fs = fsWithState(stateJson([]));
      copilotVscodeAdapter.extract(ctx({ db: db(readsOnly), fs }));
      expect(fs.reads).toEqual([]); // no readdir, no probe — a read-only window is free
    });
  });

  describe('windowing — a segment never re-claims an earlier segment\u2019s files', () => {
    it('a later window claims only the rows first seen inside it', () => {
      // `turn_index` is NULL for every row, so placement is by `first_seen_at`
      // against the windowed turns: window [1,2) starts at T1 and is open-ended.
      const caps = copilotVscodeAdapter.extract(
        ctx({ window: { since: 'last-command', from: 1, to: 2 } }),
      );
      expect(caps.files).toEqual({ written: [], edited: [CLI] });
      expect(caps.tools).toEqual({ apply_patch: 1 });
    });

    it('a bounded window excludes rows first seen AFTER its last turn', () => {
      const caps = copilotVscodeAdapter.extract(
        ctx({ window: { since: 'session-start', from: 0, to: 1 } }),
      );
      // CLI was first seen at 23:40, after turn 1 (T1) opened the next window
      expect(caps.files).toEqual({ written: [], edited: [LIB] });
      expect(caps.tools).toEqual({ apply_patch: 1, read_file: 1, list_dir: 1 });
    });

    it('untimed turns: the session-start window claims files, a later window claims none', () => {
      const untimed: DbRow[] = [
        { turn_index: 0, words: 5, has_response: 1, timestamp: null },
        { turn_index: 1, words: 4, has_response: 1, timestamp: null },
      ];
      const first = copilotVscodeAdapter.extract(ctx({ db: db(FILES, untimed) }));
      expect(first.files).toEqual({ written: [], edited: [LIB, CLI] });
      const later = copilotVscodeAdapter.extract(
        ctx({ db: db(FILES, untimed), window: { since: 'last-command', from: 1, to: 2 } }),
      );
      expect(later.files ?? null).toBeNull();
      expect(later.tools ?? null).toBeNull();
    });

    it('MIXED timestamps: an untimed turn at the boundary must not open-end the window', () => {
      // Regression (review round 1, HIGH). Turns [T0, untimed, T1]: the end boundary
      // seeks the next TIMED turn (T1). Stopping at the untimed turns[1] would leave
      // window [0,1) open-ended, so it AND window [2,3) would both claim CLI.
      const mixed: DbRow[] = [
        { turn_index: 0, words: 5, has_response: 1, timestamp: T0 },
        { turn_index: 1, words: 3, has_response: 1, timestamp: null },
        { turn_index: 2, words: 4, has_response: 1, timestamp: T1 },
      ];
      const rows: DbRow[] = [
        { file_path: LIB, tool_name: 'apply_patch', turn_index: null, first_seen_at: T0 },
        { file_path: CLI, tool_name: 'apply_patch', turn_index: null, first_seen_at: T1 },
      ];
      const at = (from: number, to: number) =>
        copilotVscodeAdapter.extract(
          ctx({ db: db(rows, mixed), window: { since: 'last-command', from, to } }),
        );

      const first = at(0, 1);
      expect(first.files).toEqual({ written: [], edited: [LIB] });
      expect(first.tools).toEqual({ apply_patch: 1 });

      // the untimed turn alone has no basis to place a row — it claims nothing
      const middle = at(1, 2);
      expect(middle.files ?? null).toBeNull();
      expect(middle.tools ?? null).toBeNull();

      const last = at(2, 3);
      expect(last.files).toEqual({ written: [], edited: [CLI] });
      expect(last.tools).toEqual({ apply_patch: 1 });
    });
  });

  describe('the honest ceiling + the privacy idiom', () => {
    it('emits NO file events — deltas are unknowable, and zeros would be fabricated', () => {
      const stream = copilotVscodeAdapter.extract(ctx()).event_stream as Event[];
      expect(stream.some((e) => e.kind === 'file')).toBe(false);
      expect(stream.map((e) => e.kind)).toEqual(['prompt', 'turn', 'prompt', 'turn']);
    });

    it('the session_files SQL is session-scoped and names NO message column', () => {
      const f = db();
      copilotVscodeAdapter.extract(ctx({ db: f }));
      const call = f.calls.find((c) => c.sql.includes('FROM session_files'));
      expect(call?.params).toEqual([SESSION]); // rows scoped to THIS session only
      expect(call?.sql).toContain('session_id = ?');
      expect(call?.sql).not.toContain('user_message');
      expect(call?.sql).not.toContain('assistant_response');
    });

    it('paths pass through RAW and absolute — the serializer does the confining', () => {
      const outside = '/Users/x/secret/creds.env';
      const rows = [
        { file_path: outside, tool_name: 'apply_patch', turn_index: null, first_seen_at: T0 },
        { file_path: LIB, tool_name: 'apply_patch', turn_index: null, first_seen_at: T0 },
      ];
      const caps = copilotVscodeAdapter.extract(ctx({ db: db(rows) }));
      // raw + absolute at the adapter boundary (same contract as the cursor fix)
      expect(caps.files).toEqual({ written: [], edited: [outside, LIB] });

      const seg = serializeSegment(
        {
          command: 'doctor',
          harness: 'copilot-vscode',
          harness_session_id: SESSION,
          timecode: '2026-08-03T23:45:00Z',
          window: { since: 'session-start', from: 0, to: 99 },
          branch: null,
          branch_changed: false,
          tokens: null,
          files: caps.files ?? undefined,
        },
        REPO,
      );
      const json = JSON.stringify(seg);
      expect(json).not.toContain('/Users/x'); // the out-of-repo path never serializes
      expect(seg.files?.edited).toContain('demo/lib.mjs'); // in-repo path relativized
    });
  });
});
