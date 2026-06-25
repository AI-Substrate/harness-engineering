/**
 * Pure projections that shrink a raw telemetry capture into a privacy-safe,
 * adapter-faithful fixture (plan 037, Phase 2). No `node:*`, no I/O — the caller
 * (the `.harness/extensions/telemetry-fixtures` run() composition root) reads the
 * raw bytes via injected ports and feeds them here.
 *
 * Single source of truth for the copilot-cli process-log filter (T001/AC-03) and
 * the copilot-vscode row projection (T006/AC-04), so the privacy-critical shrink
 * is unit-tested in one place.
 */

/**
 * A copilot-cli `process-*.log` is a per-PROCESS verbose debug log: it interleaves
 * MANY sessions and embeds huge payloads, but the runtime adapter reads ONLY the
 * `assistant_usage` JSON objects, filtered by their inner `session_id`. So a fixture
 * must keep ONLY this session's `assistant_usage` records — tiny, and with no other
 * session's data.
 *
 * This replicates `copilot-adapter`'s `extractJsonObjects` scan (a JSON block runs
 * from a line starting `{` to a line starting `}`), keeps the matching objects, and
 * re-serializes each as a pretty block the adapter re-parses identically. Token
 * metrics survive the JSON round-trip verbatim.
 */
export function filterCopilotProcessLog(logContent: string, sessionId: string): string {
  const kept: string[] = [];
  let buf: string[] | null = null;
  const consider = (lines: string[]): void => {
    try {
      const obj = JSON.parse(lines.join('\n')) as Record<string, unknown>;
      if (obj.kind === 'assistant_usage' && obj.session_id === sessionId) {
        kept.push(JSON.stringify(obj, null, 2));
      }
    } catch {
      // not a JSON object (debug noise / pretty-printed array) — skip, as the adapter does
    }
  };
  for (const raw of logContent.split('\n')) {
    if (buf === null) {
      if (raw.startsWith('{')) {
        buf = [raw];
        if (raw.trimEnd().endsWith('}')) {
          consider(buf);
          buf = null;
        }
      }
    } else {
      buf.push(raw);
      if (raw.startsWith('}')) {
        consider(buf);
        buf = null;
      }
    }
  }
  return kept.length > 0 ? `${kept.join('\n')}\n` : '';
}

/**
 * Trim the way SQLite's `trim(x)` does — strip ONLY the ASCII space (0x20), NOT
 * tabs/newlines/Unicode whitespace (which JS `String.prototype.trim` also strips).
 * The adapter's `TURNS_SQL` uses bare `trim(...)`, so mirroring it space-only keeps
 * `words`/`has_response` bit-for-bit with the SQL on whitespace edge cases like a
 * `'\t'`-only message (companion F002) — the contract T008's round-trip relies on.
 */
function sqliteTrim(s: string): string {
  return s.replace(/^ +| +$/g, '');
}

/**
 * Count words the way the copilot-vscode adapter's `TURNS_SQL` does:
 * `length(trim) - length(replace(trim, ' ', '')) + 1` for a non-empty trimmed
 * string — i.e. (number of single-space chars) + 1 — and `0` when the trimmed
 * string is empty. This is deliberately NOT a smart word count: runs of spaces
 * each count, exactly as SQLite computes them, and the trim is SQLite's space-only
 * {@link sqliteTrim} (NOT JS `trim`). Mirroring the SQL bit-for-bit is what lets
 * T008 reconstruct a writable sqlite from the projected rows and read it back
 * through the adapter's real SQL to identical numbers.
 */
function sqlWordCount(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const trimmed = sqliteTrim(raw);
  if (trimmed === '') return 0;
  return trimmed.length - trimmed.replaceAll(' ', '').length + 1;
}

/** One copilot-vscode session row, projected to the structural columns only. */
interface ExtractedSessionRow {
  id: unknown;
  cwd: unknown;
  updated_at: unknown;
}

/** One copilot-vscode turn row, projected past the AC-23 privacy boundary. */
interface ExtractedTurnRow {
  session_id: unknown;
  turn_index: unknown;
  words: number;
  has_response: 0 | 1;
  timestamp: unknown;
}

/** The privacy-safe copilot-vscode fixture shape — no message text anywhere. */
export interface ExtractedCopilotVscodeRows {
  sessions: ExtractedSessionRow[];
  turns: ExtractedTurnRow[];
}

/**
 * Project the raw copilot-vscode `sessions` + `turns` rows (as read from the live
 * store) into a privacy-safe fixture shape that carries NO message text — the
 * copilot-vscode analogue of the AC-23 boundary the adapter enforces in SQL.
 *
 * The raw `turns` rows still hold `user_message` / `assistant_response`; this
 * computes `words` ({@link sqlWordCount}, mirroring `TURNS_SQL`) + a `has_response`
 * presence flag from them and then DROPS the text entirely. The structural columns
 * the runtime adapter consumes (`turn_index`, `words`, `has_response`, `timestamp`)
 * survive; the bodies do not. The `cwd` stays raw here — `scrubText` rebases machine
 * paths at the extension boundary (single-source scrub; this pure projection never
 * double-scrubs).
 */
export function projectCopilotVscodeRows(
  rawSessions: ReadonlyArray<Record<string, unknown>>,
  rawTurns: ReadonlyArray<Record<string, unknown>>,
): ExtractedCopilotVscodeRows {
  const sessions = rawSessions.map((s) => ({
    id: s.id,
    cwd: s.cwd,
    updated_at: s.updated_at,
  }));
  const turns = rawTurns.map((t) => {
    const resp = t.assistant_response;
    // Mirror TURNS_SQL's `assistant_response IS NULL OR trim(...) = ''` — SQLite
    // trim is space-only (sqliteTrim), so a `'\t'`-only response is has_response 1.
    const hasResponse = typeof resp === 'string' && sqliteTrim(resp) !== '' ? 1 : 0;
    return {
      session_id: t.session_id,
      turn_index: t.turn_index,
      words: sqlWordCount(t.user_message),
      has_response: hasResponse as 0 | 1,
      timestamp: t.timestamp ?? null,
    };
  });
  return { sessions, turns };
}

/** One cursor `cursorDiskKV` row, projected to the model/timing-only `value`. */
export interface CursorBubbleRow {
  key: unknown;
  value: string;
}

/**
 * Project Cursor IDE-store `cursorDiskKV` bubble rows to a privacy-safe fixture
 * shape — the cursor analogue of {@link projectCopilotVscodeRows}. A raw bubble
 * embeds full message `text`/`richText`, `gitDiffs`, `consoleLogs`, attached file
 * contents, tool args, and more; the runtime `cursorAdapter` reads ONLY `type`,
 * `createdAt`, and `modelInfo.modelName` (for the model/timing join). This re-
 * serializes each row's `value` to JUST those fields (dropping `modelInfo` entirely
 * when there's no model name), so the committed `raw.rows.json` carries no prose,
 * diffs, or secrets. Non-string / non-JSON values are skipped (never thrown on),
 * mirroring how the adapter ignores them.
 */
export function projectCursorBubbleRows(
  rawRows: ReadonlyArray<Record<string, unknown>>,
): CursorBubbleRow[] {
  const out: CursorBubbleRow[] = [];
  for (const row of rawRows) {
    if (typeof row.value !== 'string') continue;
    let bubble: Record<string, unknown>;
    try {
      bubble = JSON.parse(row.value) as Record<string, unknown>;
    } catch {
      continue; // debug noise / non-JSON — skip, as the adapter does
    }
    const safe: { type?: number; createdAt?: unknown; modelInfo?: { modelName: string } } = {};
    if (typeof bubble.type === 'number') safe.type = bubble.type;
    if (bubble.createdAt !== undefined && bubble.createdAt !== null)
      safe.createdAt = bubble.createdAt;
    const info = (bubble.modelInfo ?? {}) as Record<string, unknown>;
    if (typeof info.modelName === 'string' && info.modelName.length > 0) {
      safe.modelInfo = { modelName: info.modelName };
    }
    out.push({ key: row.key, value: JSON.stringify(safe) });
  }
  return out;
}

/** The placeholder swapped in for a redacted system-prompt body. */
export const SYSTEM_PROMPT_PLACEHOLDER = '<redacted: vendor system prompt>';

/**
 * Replace the body of a copilot-cli `system.message` event (the vendor's ~33KB
 * proprietary system prompt) with a short placeholder, keeping the event envelope
 * (type/id/timestamp/parentId/role). The runtime adapter never reads `system.message`
 * — it consumes `user.message`/`tool.execution_*`/`assistant.turn_*`/etc — so the
 * serialized segment is byte-identical; this only shrinks the fixture (~100KB → ~5KB)
 * and avoids republishing a proprietary prompt. User prompts stay verbatim.
 */
export function redactCopilotSystemMessage(eventsJsonl: string): string {
  return eventsJsonl
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return line; // not JSON — leave untouched
      }
      if (obj.type !== 'system.message') return line;
      const data = obj.data;
      if (data !== null && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        for (const k of ['content', 'text', 'message']) {
          if (typeof d[k] === 'string') d[k] = SYSTEM_PROMPT_PLACEHOLDER;
        }
      }
      return JSON.stringify(obj);
    })
    .join('\n');
}
