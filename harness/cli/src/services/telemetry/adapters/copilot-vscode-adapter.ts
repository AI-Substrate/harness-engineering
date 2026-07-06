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
 * capture service calls ONCE at detection time (to name the buffer) and then
 * threads onto {@link HarnessSource.sessionId}. This adapter reads that threaded
 * id rather than re-querying the mutable cwd→session mapping, so every read in a
 * single capture keys off the SAME session — no cross-session drift when two VS
 * Code windows share a repo.
 *
 * PRIVACY (AC-23): the word count + a presence flag are computed AT THE SQL
 * BOUNDARY ({@link TURNS_SQL}) — `user_message` / `assistant_response` appear only
 * inside `length()`/`CASE`, so the message TEXT is never returned to this process,
 * let alone serialized. Only `turn_index`, `words`, `has_response`, `timestamp`
 * cross the DbPort.
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

/** One stored turn, AS PROJECTED BY SQL — structural columns only, never raw text. */
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

/**
 * The `turns` projection — the AC-23 PRIVACY BOUNDARY. The raw message columns
 * (`user_message` / `assistant_response`) appear ONLY inside `length()` / `CASE`,
 * so SQLite computes a word count + a presence flag server-side and the SELECT
 * RETURNS only structural columns (`turn_index`, `words`, `has_response`,
 * `timestamp`). The message TEXT therefore never enters the telemetry process —
 * a strictly stronger guarantee than "read into memory then dropped before
 * serialization". `words` is an approximate, space-delimited count: exactness is
 * irrelevant for a coarse measure, and computing it in SQL is precisely what
 * keeps the text out of the process.
 */
const TURNS_SQL = [
  'SELECT turn_index,',
  "  CASE WHEN user_message IS NULL OR trim(user_message) = '' THEN 0",
  "       ELSE length(trim(user_message)) - length(replace(trim(user_message), ' ', '')) + 1 END AS words,",
  "  CASE WHEN assistant_response IS NULL OR trim(assistant_response) = '' THEN 0 ELSE 1 END AS has_response,",
  '  timestamp',
  'FROM turns WHERE session_id = ? ORDER BY turn_index ASC',
].join(' ');

/**
 * Read the session's turns from the store, ordered by `turn_index`. The SQL
 * ({@link TURNS_SQL}) projects ONLY counts + a presence flag + timestamp — the
 * message TEXT is never returned to this process (AC-23). Empty when there's no
 * db, no candidate path with the session, or no turns.
 */
function readTurns(ctx: HarnessSource, sessionId: string): TurnRow[] {
  const db = ctx.db;
  if (db === undefined || sessionId.length === 0) return [];
  for (const dbPath of copilotVscodeStoreDbPaths(ctx.env)) {
    const rows = db.query(dbPath, TURNS_SQL, [sessionId]);
    if (rows.length === 0) continue;
    return rows.map((r) => ({
      turn_index: typeof r.turn_index === 'number' ? r.turn_index : 0,
      words: typeof r.words === 'number' ? r.words : 0,
      hasResponse: r.has_response === 1 || r.has_response === true,
      t: turnTime(r.timestamp),
    }));
  }
  return [];
}

/**
 * This capture's session id — read from the threaded {@link HarnessSource.sessionId}
 * (resolved ONCE by the capture core via {@link resolveCopilotVscodeSessionId}). The
 * adapter never re-queries the mutable cwd→latest-session mapping, so `currentPosition`
 * and `extract` always agree on the session (the buffer keyed on S is windowed from
 * turn-count(S) and carries events from S — never a cross-session mix). `null` when
 * the core threaded no id (→ an empty window / null caps).
 */
function sessionIdFor(src: HarnessSource): string | null {
  return src.sessionId !== undefined && src.sessionId.length > 0 ? src.sessionId : null;
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

    // FX001 exemption: the VS Code Copilot Chat store is TURNS-ONLY (user_message /
    // assistant_response / timestamp — see TURNS_SQL). It records no tool calls,
    // no shell `command`, and no skill invocations, so there is NO shell tool event
    // to carry a command `signature` (Facet A) and NO skill event to carry a digit
    // `arg` (Facet B). Nothing to keep here — the argv/skill surface simply does
    // not exist on this harness (honest ceiling, exactly as tokens/models are null).
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
