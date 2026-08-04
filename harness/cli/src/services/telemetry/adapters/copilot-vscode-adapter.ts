import type { DbPort } from '../../../adapters/db/db-port.js';
import type { EnvPort } from '../../../adapters/env/env-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import { buildEventStream } from '../event-builder.js';
import type { Event } from '../events.js';
import type { SegmentFiles } from '../segment.js';
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
 * cross the DbPort. {@link SESSION_FILES_SQL} follows the same idiom: it selects
 * only `file_path` / `tool_name` / `first_seen_at` — no message column at all.
 *
 * FILE EVENTS ARE `null` — the same honest ceiling as tokens, with a named reason.
 * The store records file TOUCHES (`session_files`), not patch BODIES: the row is
 * first-seen-per-file (`UNIQUE(session_id, file_path)`, so repeat edits are
 * invisible) and the patch text exists nowhere readable (`assistant_response` is a
 * prose summary; the chat-session-resources spill holds only `read_file` output).
 * Line/byte deltas are therefore UNKNOWABLE, and a `file` event with `delta: 0`
 * would be a fabricated claim — so this adapter emits NO `file` events. The
 * {@link SegmentFiles} lists ARE emitted: authorship paths need no delta.
 *
 * Ports-only (P2): reads injected env/db/fs only — no `node:*`.
 */

/**
 * MODELS_JSON_RULING (plan 069, item 3) — `models` STAYS `null`; do not re-litigate.
 *
 * The rider asked whether `…/GitHub.copilot-chat/debug-logs/<session>/models.json`
 * could un-null `models` for this harness. It cannot, and the file is a trap:
 * inspected on two real sessions, it is the model **CATALOGUE** — 39 entries of
 * everything the picker COULD offer (`id`, `billing`, `capabilities`,
 * `model_picker_*`) — with no field naming what the session actually RAN on. Its
 * only selection-shaped flags, `is_chat_default` / `is_chat_fallback`, mark the
 * account's default (`gpt-5.3-codex` on both machines-under-test), not the user's
 * pick; a session where the user chose another model would be reported as the
 * default. The sibling `main.jsonl` carries a single `session_start` span and no
 * model field either.
 *
 * Stamping the default would therefore assert a model that may never have run —
 * precisely the fabricated outcome AC-4 forbids. An honest `null` beats a
 * plausible lie, so the ceiling stands until the store exposes a per-turn model.
 */

export const COPILOT_VSCODE_HARNESS = 'copilot-vscode';
/** The env marker the VS Code Copilot Chat extension sets (the only detection signal). */
export const COPILOT_VSCODE_AI_AGENT = 'github_copilot_vscode_agent';

/**
 * The VS Code user-data roots (`…/Code/User`) across platforms — the shared
 * parent of BOTH the Copilot Chat store (`globalStorage/…/session-store.db`) and
 * the per-workspace chat-editing state (`workspaceStorage/<hash>/…`). macOS +
 * Linux hang off `$HOME`; Windows off `%APPDATA%`. Forward slashes are fine for
 * Node's file APIs on every platform.
 */
export function copilotVscodeUserRoots(env: EnvPort | undefined): string[] {
  // No env (reconciliation) ⇒ no candidates — see `cursorStateDbPaths`.
  if (env === undefined) return [];
  const roots: string[] = [];
  const home = env.home();
  if (home !== undefined && home.length > 0) {
    roots.push(`${home}/Library/Application Support/Code/User`); // macOS
    roots.push(`${home}/.config/Code/User`); // Linux
  }
  const appdata = env.get('APPDATA');
  if (appdata !== undefined && appdata.length > 0) {
    roots.push(`${appdata}/Code/User`); // Windows
  }
  return roots;
}

/** The Copilot Chat store, relative to a {@link copilotVscodeUserRoots} entry. */
const STORE_DB_REL = 'globalStorage/github.copilot-chat/session-store.db';

/**
 * Candidate paths to the VS Code Copilot Chat store across platforms (first that
 * returns rows wins) — one per {@link copilotVscodeUserRoots} entry.
 */
export function copilotVscodeStoreDbPaths(env: EnvPort | undefined): string[] {
  return copilotVscodeUserRoots(env).map((root) => `${root}/${STORE_DB_REL}`);
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
 * One `session_files` row — a file the agent TOUCHED, as projected by SQL. The
 * store's `UNIQUE(session_id, file_path)` makes this FIRST-SEEN-per-file: a file
 * edited five times is one row, so these are touch SETS, never call counts.
 */
interface FileRow {
  path: string;
  tool: string | null;
  seenMs: number | null;
}

/**
 * The `session_files` projection — the same privacy idiom as {@link TURNS_SQL}:
 * only structural columns are selected (`file_path`, `tool_name`,
 * `first_seen_at`); no message-text column is named at all. `turn_index` is
 * DELIBERATELY not selected — it is NULL for every observed row, so the window is
 * derived from `first_seen_at` against the windowed turns' timestamps instead.
 */
const SESSION_FILES_SQL = [
  'SELECT file_path, tool_name, first_seen_at',
  'FROM session_files WHERE session_id = ?',
  'ORDER BY first_seen_at ASC, file_path ASC',
].join(' ');

/**
 * Tools whose `session_files` row means the agent AUTHORED the file. An explicit
 * ALLOWLIST, not a read-denylist, because the failure modes are asymmetric:
 * omitting a real write tool under-reports (a recoverable gap), while treating an
 * unknown tool as a write would claim authorship the store does not support — the
 * exact false claim this adapter refuses to make. So an unrecognised or NULL
 * `tool_name` is EXCLUDED from {@link SegmentFiles} while still being counted in
 * the `tools` histogram, where "the agent invoked this" is all that is asserted.
 *
 * Observed in a live store: `apply_patch` (write → included), `read_file` and
 * `list_dir` (reads → excluded; `list_dir` rows are DIRECTORIES, which alone
 * makes a "looked-at ⇒ authored" rule wrong). The remaining names are VS Code
 * Copilot Chat's other documented edit tools, declared ahead of observation —
 * inert until such a row appears, and unambiguously writes when it does.
 */
const WRITE_TOOLS = new Set([
  'apply_patch',
  'create_file',
  'insert_edit_into_file',
  'replace_string_in_file',
  'multi_replace_string_in_file',
]);

/** SHA-1 of the empty string — VS Code's marker for "this file did not exist". */
const EMPTY_CONTENT_SHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';

/**
 * Read this session's `session_files` rows, returning them WITH the user root
 * they were found under (the chat-editing state that resolves written-vs-edited
 * lives beside the store, so the two reads must agree on a platform). `null` when
 * there's no db or no candidate path yields rows — including OLDER STORES with no
 * `session_files` table at all, which the DbPort turns into `[]`, never a throw.
 */
function readSessionFiles(
  ctx: HarnessSource,
  sessionId: string,
): { rows: FileRow[]; userRoot: string } | null {
  const db = ctx.db;
  if (db === undefined || sessionId.length === 0) return null;
  for (const userRoot of copilotVscodeUserRoots(ctx.env)) {
    const rows = db.query(`${userRoot}/${STORE_DB_REL}`, SESSION_FILES_SQL, [sessionId]);
    if (rows.length === 0) continue;
    const mapped: FileRow[] = [];
    for (const r of rows) {
      if (typeof r.file_path !== 'string' || r.file_path.length === 0) continue;
      const seen = turnTime(r.first_seen_at);
      const seenMs = seen === null ? Number.NaN : Date.parse(seen);
      mapped.push({
        path: r.file_path,
        tool: typeof r.tool_name === 'string' && r.tool_name.length > 0 ? r.tool_name : null,
        seenMs: Number.isFinite(seenMs) ? seenMs : null,
      });
    }
    if (mapped.length > 0) return { rows: mapped, userRoot };
  }
  return null;
}

/**
 * A comparison key for one absolute path. The two sources disagree on FORM —
 * `session_files.file_path` is a raw absolute path, while the chat-editing state
 * records `file:///…` URIs — so both sides are folded to decoded, forward-slashed
 * text before matching. Only the KEY is normalized; the path a capability emits
 * is always the store's raw value (the serializer does the confining).
 */
function pathKey(raw: string): string {
  let s = raw;
  if (s.startsWith('file://')) {
    s = s.slice('file://'.length);
    try {
      s = decodeURIComponent(s);
    } catch {
      // a malformed escape → compare the undecoded form rather than drop the path
    }
  }
  s = s.replace(/\\/g, '/');
  // `file:///C:/x` decodes to `/C:/x`; the store writes `C:\x` → strip the slash
  if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
  return s;
}

/** How many `workspaceStorage` entries a single capture will probe (a cheap-sensor bound). */
const MAX_WORKSPACE_DIRS = 512;
/** Byte ceiling for one `state.json` read (bounded + no-follow, via the FsPort). */
const MAX_STATE_JSON_BYTES = 4 * 1024 * 1024;

/**
 * Paths this session CREATED, from VS Code's chat-editing state. The state file
 * lives at `workspaceStorage/<opaque-hash>/chatEditingSessions/<session-id>/state.json`
 * — the leaf IS the store's session id, but the workspace hash is opaque, so the
 * one available lookup is to scan `workspaceStorage` for the matching leaf.
 * `initialFileContents` is an array of `[fileUri, contentHash]` pairs recording
 * each file's PRE-EDIT content; when that hash is the empty-string SHA-1, the file
 * did not exist before the agent touched it ⇒ the agent WROTE it.
 *
 * Entirely best-effort and non-fatal: no fs, no `workspaceStorage`, no matching
 * leaf, an oversize file, or unparseable JSON all yield an EMPTY set, which
 * degrades every authored path to `edited` — never a throw, never a wrong claim.
 */
function readCreatedPaths(fs: FsPort, userRoot: string, sessionId: string): Set<string> {
  const created = new Set<string>();
  const workspaceStorage = `${userRoot}/workspaceStorage`;
  for (const entry of fs.readdir(workspaceStorage).slice(0, MAX_WORKSPACE_DIRS)) {
    const statePath = `${workspaceStorage}/${entry}/chatEditingSessions/${sessionId}/state.json`;
    const read = fs.readTextFileNoFollow(userRoot, statePath, MAX_STATE_JSON_BYTES);
    if (read.status !== 'ok') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.text);
    } catch {
      return created; // the leaf matched but is unreadable → no creation evidence
    }
    const initial = (parsed as { initialFileContents?: unknown } | null)?.initialFileContents;
    if (!Array.isArray(initial)) return created;
    for (const pair of initial) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
        continue;
      }
      if (isEmptyContentHash(pair[1])) created.add(pathKey(pair[0]));
    }
    return created; // the session's leaf is unique — stop at the first match
  }
  return created;
}

/**
 * Is `hash` the empty-string SHA-1? VS Code truncates it (`da39a3e` observed), so
 * a prefix relationship in EITHER direction counts, with a minimum length that
 * keeps a degenerate 1-char value from matching.
 */
function isEmptyContentHash(hash: string): boolean {
  const h = hash.toLowerCase();
  if (h.length < 7) return false;
  return EMPTY_CONTENT_SHA1.startsWith(h) || h.startsWith(EMPTY_CONTENT_SHA1);
}

/** A turn's timestamp as epoch ms, or null when it carries no usable time. */
function turnMs(t: string | null): number | null {
  if (t === null) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The first turn at-or-after `from` that CARRIES a usable timestamp, as epoch ms.
 *
 * Seeking PAST untimed turns is the whole point for the window's end boundary:
 * stopping at an untimed `turns[window.to]` would leave the boundary open, so this
 * window would swallow every later row AND the window that owns the next TIMED turn
 * would claim them again — double-counted authorship and premature tool counts.
 */
function firstTimedMs(turns: TurnRow[], from: number): number | null {
  for (let i = Math.max(from, 0); i < turns.length; i += 1) {
    const ms = turnMs(turns[i]?.t ?? null);
    if (ms !== null) return ms;
  }
  return null;
}

/**
 * Keep only the rows belonging to THIS window. `session_files.turn_index` is NULL
 * in practice, so a row is placed by `first_seen_at` against the windowed turns'
 * timestamps: `[first timed windowed turn, first TIMED turn at-or-after the window)`.
 * Without that, every capture in a session would re-claim the whole session's files.
 *
 * When the turns carry no timestamps at all there is no basis to place a row, so
 * only a window that starts at the session start (`claimUntimed`) claims files — a
 * later window claims nothing rather than repeating an earlier segment's report.
 * A row whose own `first_seen_at` is unusable is dropped for the same reason.
 */
function windowFileRows(
  rows: FileRow[],
  startMs: number | null,
  endMs: number | null,
  claimUntimed: boolean,
): FileRow[] {
  if (startMs === null) return claimUntimed ? rows : [];
  return rows.filter(
    (r) => r.seenMs !== null && r.seenMs >= startMs && (endMs === null || r.seenMs < endMs),
  );
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

/**
 * The `session_files` capabilities for this window: the `tools` histogram (every
 * touch-recording tool the agent invoked) and the {@link SegmentFiles} authorship
 * lists (WRITE tools only — see {@link WRITE_TOOLS}; `read_file` / `list_dir` are
 * excluded because authorship must mean wrote, not looked-at).
 *
 * The `state.json` lookup is skipped entirely unless a write row survives the
 * window, so a read-only window costs zero filesystem probes.
 */
function extractFileEvidence(
  ctx: HarnessContext,
  sessionId: string,
  turns: TurnRow[],
  windowTurns: TurnRow[],
): { tools: Record<string, number> | null; files: SegmentFiles | null } {
  const found = readSessionFiles(ctx, sessionId);
  if (found === null) return { tools: null, files: null };

  const startMs = firstTimedMs(windowTurns, 0);
  const nextMs = firstTimedMs(turns, ctx.window.to);
  const rows = windowFileRows(found.rows, startMs, nextMs, ctx.window.from === 0);
  if (rows.length === 0) return { tools: null, files: null };

  const tools: Record<string, number> = {};
  const writes: string[] = [];
  for (const row of rows) {
    // A NULL `tool_name` names no tool, so it can be neither counted nor classified.
    if (row.tool === null) continue;
    tools[row.tool] = (tools[row.tool] ?? 0) + 1;
    if (WRITE_TOOLS.has(row.tool)) writes.push(row.path);
  }

  if (writes.length === 0) {
    return { tools: Object.keys(tools).length > 0 ? tools : null, files: null };
  }
  const created = readCreatedPaths(ctx.fs, found.userRoot, sessionId);
  const written: string[] = [];
  const edited: string[] = [];
  for (const path of writes) {
    // No creation evidence ⇒ `edited`. The store proves the agent wrote the file,
    // not that it created it, and `edited` is the claim that is always true.
    (created.has(pathKey(path)) ? written : edited).push(path);
  }
  return { tools: Object.keys(tools).length > 0 ? tools : null, files: { written, edited } };
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

    const fileEvidence = extractFileEvidence(ctx, sessionId, turns, windowTurns);

    return {
      harness_session_id: null,
      tokens: null, // VS Code Copilot keeps token consumption server-side — never estimated
      models: null, // the store carries no model column (honest ceiling) — see MODELS_JSON_RULING
      effort: null,
      skills: null,
      // Per-FILE-FIRST-SEEN counts, NOT per-call: `UNIQUE(session_id, file_path)`
      // collapses every repeat touch of a file into one row, so this histogram is a
      // lower bound on invocations — real signal, with a named ceiling.
      tools: fileEvidence.tools,
      user_prompts: userPrompts.length > 0 ? userPrompts : null,
      subagents: null,
      files: fileEvidence.files,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
      event_stream, // NO `file` events — deltas are unknowable here (see the class doc)
    };
  },
};
