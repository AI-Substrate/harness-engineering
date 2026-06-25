import type { DbPort } from '../../../adapters/db/db-port.js';
import type { EnvPort } from '../../../adapters/env/env-port.js';
import { buildEventStream } from '../event-builder.js';
import type { Event } from '../events.js';
import type { HarnessAdapter, HarnessContext, HarnessSource } from './harness-adapter.js';

/**
 * The GitHub Copilot **Chat in VS Code** capability adapter (plan 034, Phase 6 —
 * Amendment A3 reworked). This is a DISTINCT surface from `copilot-cli`: the VS
 * Code Chat extension keeps its own SQLite store
 * (`globalStorage/github.copilot-chat/session-store.db`), NOT the CLI's
 * `~/.copilot/session-state` JSONL. Modeled on {@link cursorAdapter}: read the
 * store through the read-only {@link DbPort} and emit a TURN-ANCHORED timeline.
 *
 * TOKENS ARE `null` — the honest ceiling, exactly as Cursor. The store has NO
 * token columns (`turns(session_id, turn_index, user_message, assistant_response,
 * timestamp)`); VS Code Copilot keeps usage server-side, so we never estimate.
 *
 * DETECTION is unusual: the extension sets `AI_AGENT=github_copilot_vscode_agent`
 * but NO session-id env var (unlike `COPILOT_AGENT_SESSION_ID` / Cursor's
 * `CURSOR_CONVERSATION_ID`). The active session is resolved from the store BY CWD
 * (latest `updated_at`) — see {@link resolveCopilotVscodeSessionId}, which the
 * capture service calls at detection time (to name the buffer) and which this
 * adapter calls again to read the session's turns (mirroring how the Cursor
 * adapter independently re-reads its env session id).
 *
 * PRIVACY (AC-23): only `turns.timestamp` and the WORD COUNT of `user_message`
 * are read — the message TEXT (`user_message` / `assistant_response`) is never
 * read into the segment. `assistant_response` is consulted for PRESENCE only.
 *
 * Ports-only (P2): reads injected env/db only — no `node:*`.
 */

export const COPILOT_VSCODE_HARNESS = 'copilot-vscode';
/** The env marker the VS Code Copilot Chat extension sets (the only detection signal). */
export const COPILOT_VSCODE_AI_AGENT = 'github_copilot_vscode_agent';

/**
 * Candidate paths to the VS Code Copilot Chat store across platforms (first that
 * returns rows wins). macOS + Linux hang off `$HOME`; Windows off `%APPDATA%`.
 * Forward slashes are fine for Node's file APIs on every platform.
 */
export function copilotVscodeStoreDbPaths(env: EnvPort): string[] {
  const rel = 'Code/User/globalStorage/github.copilot-chat/session-store.db';
  const paths: string[] = [];
  const home = env.home();
  if (home !== undefined && home.length > 0) {
    paths.push(`${home}/Library/Application Support/${rel}`); // macOS
    paths.push(`${home}/.config/${rel}`); // Linux
  }
  const appdata = env.get('APPDATA');
  if (appdata !== undefined && appdata.length > 0) {
    paths.push(`${appdata}/${rel}`); // Windows
  }
  return paths;
}

/**
 * Resolve the active VS Code Copilot Chat session id from the store BY CWD — the
 * latest `updated_at` row whose `cwd` matches (two VS Code windows on the same
 * repo → the most recently touched session wins; the store holds ~1 row/repo).
 * `null` when there's no db, no candidate path with the table, or no matching
 * row (→ a clean no-op, AC-21). Best-effort by the {@link DbPort} contract: a
 * missing / locked / corrupt store yields `[]`, never a throw.
 */
export function resolveCopilotVscodeSessionId(
  db: DbPort,
  env: EnvPort,
  cwd: string,
): string | null {
  for (const dbPath of copilotVscodeStoreDbPaths(env)) {
    const rows = db.query(
      dbPath,
      'SELECT id FROM sessions WHERE cwd = ? ORDER BY updated_at DESC LIMIT 1',
      [cwd],
    );
    const id = rows[0]?.id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/** One stored turn — counts + timestamp only (the text fields are read for length, never kept). */
interface TurnRow {
  turn_index: number;
  words: number;
  hasResponse: boolean;
  t: string | null;
}

/** `turns.timestamp` → ISO string (epoch-ms number or an ISO string), or null. */
function turnTime(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw).toISOString();
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  return null;
}

/** Word count of a prompt — never the text itself (AC-23). */
function wordCount(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/**
 * Read the session's turns from the store, ordered by `turn_index`, projecting
 * ONLY counts + timestamps (the message TEXT is consulted for word count /
 * presence and immediately discarded — AC-23). Empty when there's no db, no
 * candidate path with the session, or no turns.
 */
function readTurns(ctx: HarnessSource, sessionId: string): TurnRow[] {
  const db = ctx.db;
  if (db === undefined || sessionId.length === 0) return [];
  for (const dbPath of copilotVscodeStoreDbPaths(ctx.env)) {
    const rows = db.query(
      dbPath,
      'SELECT turn_index, user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index ASC',
      [sessionId],
    );
    if (rows.length === 0) continue;
    return rows.map((r) => ({
      turn_index: typeof r.turn_index === 'number' ? r.turn_index : 0,
      words: wordCount(r.user_message),
      hasResponse: typeof r.assistant_response === 'string' && r.assistant_response.trim() !== '',
      t: turnTime(r.timestamp),
    }));
  }
  return [];
}

/** Resolve this session's id (db-derived, by cwd) — the adapter's own lookup, like Cursor's env read. */
function sessionIdFor(src: HarnessSource): string | null {
  return src.db === undefined ? null : resolveCopilotVscodeSessionId(src.db, src.env, src.repoRoot);
}

export const copilotVscodeAdapter: HarnessAdapter = {
  harness: COPILOT_VSCODE_HARNESS,
  handles: (harnessId) => harnessId === COPILOT_VSCODE_HARNESS,

  /**
   * The session's turn count — the extent the cursor windows over. Equals
   * `max(turn_index)+1` for Copilot's contiguous 0-based `turn_index`; using the
   * row count keeps it consistent with the windowed slice in {@link extract}.
   * `null` when the session/turns are unreadable (→ an empty window).
   */
  currentPosition(src) {
    const sessionId = sessionIdFor(src);
    if (sessionId === null) return null;
    const turns = readTurns(src, sessionId);
    return turns.length === 0 ? null : turns.length;
  },

  extract(ctx: HarnessContext) {
    const nullCaps = {
      harness_session_id: null,
      tokens: null,
      models: null,
      effort: null,
      skills: null,
      tools: null,
      user_prompts: null,
      subagents: null,
      files: null,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
      event_stream: null,
    };
    const sessionId = sessionIdFor(ctx);
    if (sessionId === null) return nullCaps;
    const turns = readTurns(ctx, sessionId);
    const windowTurns = turns.slice(ctx.window.from, ctx.window.to);
    if (windowTurns.length === 0) return nullCaps;

    const direct: Event[] = [];
    const userPrompts: number[] = [];
    let anyTs = false;

    for (const turn of windowTurns) {
      if (turn.words > 0) userPrompts.push(turn.words);
      if (turn.t === null) continue; // no timestamp → no timeline event (never fabricated)
      anyTs = true;
      if (turn.words > 0) {
        direct.push({ t: turn.t, t_precision: 'anchored', kind: 'prompt', words: turn.words });
      }
      if (turn.hasResponse) {
        // No token buckets → rollup.tokens stays null (Copilot keeps usage server-side).
        direct.push({ t: turn.t, t_precision: 'anchored', kind: 'turn', dur_s: 0 });
      }
    }

    const event_stream = anyTs ? buildEventStream({ direct, precision: 'anchored' }) : null;

    return {
      harness_session_id: null,
      tokens: null, // VS Code Copilot keeps token consumption server-side — never estimated
      models: null, // the store carries no model column (honest ceiling)
      effort: null,
      skills: null,
      tools: null,
      user_prompts: userPrompts.length > 0 ? userPrompts : null,
      subagents: null,
      files: null,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
      event_stream,
    };
  },
};
