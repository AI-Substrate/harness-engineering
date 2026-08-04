import type { EnvPort } from '../../../adapters/env/env-port.js';
import {
  commandSignatures,
  harnessSubcommand,
  observeKindFromCommand,
  shellSignature,
  skillDigitArg,
} from '../command-signature.js';
import { buildEventStream } from '../event-builder.js';
import type { Event, HarnessEvent } from '../events.js';
import type { SkillOpen, ToolCall } from '../rollup.js';
import type { SegmentModelStat } from '../segment.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessContext,
  HarnessSource,
} from './harness-adapter.js';

/**
 * The Cursor (`cursor-agent`) capability adapter (plan 034 follow-on). Cursor
 * writes a Claude-shaped JSONL transcript per conversation at
 * `$AGENT_TRANSCRIPTS/<conv>/<conv>.jsonl` (role user/assistant, `message.content`
 * blocks, `tool_use` with name/input). The transcript carries NO tokens/models;
 * what it gives (user prompts, tool names, shell/harness commands, skills) is
 * extracted, sliced to the cursor's "since last command" window.
 *
 * MODEL attribution comes from a second source: Cursor's IDE store
 * (`globalStorage/state.vscdb` → `cursorDiskKV`), where each conversation's
 * message bubbles carry `modelInfo.modelName`. Joined on `CURSOR_CONVERSATION_ID`
 * (the conv/composer id is shared by the transcript and the bubbles) via the
 * read-only {@link DbPort}. The model name is attributed to the window's
 * assistant turns; `output_tokens` stays 0 because Cursor keeps per-request token
 * CONSUMPTION server-side only — it is absent from every local store (the on-disk
 * `tokenCount`/`usageData` fields are vestigial/zeroed). So `tokens` stays `null`:
 * we never estimate. Headless CLI-only sessions are absent from `cursorDiskKV`
 * (their bubbles live in a protobuf `store.db`), so they get no model — `null`,
 * not a guess.
 *
 * Detection: `CURSOR_CONVERSATION_ID` (the session id) + `AGENT_TRANSCRIPTS` (the
 * transcript dir), both set by cursor in its shell subprocesses. Ports-only (P2):
 * reads injected env/fs/db only — no `node:*`. PRIVACY (AC-04): only counts,
 * command signatures, tool names, and the model id — never prompt text or
 * tool-arg strings.
 */

export const CURSOR_SESSION_ENV = 'CURSOR_CONVERSATION_ID';
export const CURSOR_TRANSCRIPTS_ENV = 'AGENT_TRANSCRIPTS';

export function cursorTranscriptPath(transcriptsDir: string, convId: string): string {
  return `${transcriptsDir}/${convId}/${convId}.jsonl`;
}

/**
 * Candidate paths to Cursor's IDE state db across platforms (first that returns
 * rows wins). macOS + Linux hang off `$HOME`; Windows off `%APPDATA%`. Forward
 * slashes are fine for Node's file APIs on every platform.
 */
export function cursorStateDbPaths(env: EnvPort): string[] {
  const paths: string[] = [];
  const home = env.home();
  if (home !== undefined && home.length > 0) {
    paths.push(`${home}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`); // macOS
    paths.push(`${home}/.config/Cursor/User/globalStorage/state.vscdb`); // Linux
  }
  const appdata = env.get('APPDATA');
  if (appdata !== undefined && appdata.length > 0) {
    paths.push(`${appdata}/Cursor/User/globalStorage/state.vscdb`); // Windows
  }
  return paths;
}

/**
 * Histogram of model names used in a conversation, read from the IDE store's
 * `cursorDiskKV` bubbles (`bubbleId:<conv>:<bubble>` → JSON with
 * `modelInfo.modelName`). `{}` if no db, no rows, or no model field.
 */
function modelHistogram(ctx: HarnessContext, convId: string): Record<string, number> {
  const hist: Record<string, number> = {};
  const db = ctx.db;
  if (db === undefined) return hist;
  for (const dbPath of cursorStateDbPaths(ctx.env)) {
    const rows = db.query(dbPath, 'SELECT value FROM cursorDiskKV WHERE key LIKE ?', [
      `bubbleId:${convId}:%`,
    ]);
    if (rows.length === 0) continue;
    for (const row of rows) {
      const value = row.value;
      if (typeof value !== 'string') continue;
      let bubble: Record<string, unknown>;
      try {
        bubble = JSON.parse(value) as Record<string, unknown>;
      } catch {
        continue;
      }
      const info = (bubble.modelInfo ?? {}) as Record<string, unknown>;
      const name = info.modelName;
      if (typeof name === 'string' && name.length > 0) hist[name] = (hist[name] ?? 0) + 1;
    }
    break; // first candidate path with rows wins
  }
  return hist;
}

/**
 * Attribute the window's assistant turns to the conversation's dominant model
 * (Cursor sessions are single-model in practice; on a tie the most-used bubble
 * model wins). `output_tokens` is 0 — Cursor keeps consumption server-side, so we
 * report turns (real) without estimating tokens. `null` if no model or no turns.
 */
function buildModels(
  ctx: HarnessContext,
  convId: string,
  assistantTurns: number,
): Record<string, SegmentModelStat> | null {
  if (assistantTurns === 0) return null;
  const hist = modelHistogram(ctx, convId);
  let dominant: string | null = null;
  let best = 0;
  for (const [name, count] of Object.entries(hist)) {
    if (count > best) {
      best = count;
      dominant = name;
    }
  }
  if (dominant === null) return null;
  return { [dominant]: { turns: assistantTurns, output_tokens: 0 } };
}

function nonEmptyLines(content: string): string[] {
  return content.split('\n').filter((l) => l.trim() !== '');
}

/** Word count of a user prompt, stripping cursor's `<user_query>` wrapper. */
function wordCount(text: string): number {
  const t = text.replace(/<\/?user_query>/g, ' ').trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

function blocksOf(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : [];
}

function readTranscript(src: HarnessSource): string | null {
  const dir = src.env.get(CURSOR_TRANSCRIPTS_ENV);
  const convId = src.env.get(CURSOR_SESSION_ENV);
  if (dir === undefined || dir.length === 0 || convId === undefined || convId.length === 0) {
    return null;
  }
  return src.fs.readText(cursorTranscriptPath(dir, convId));
}

const nullCaps: HarnessCapabilities = {
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

function nullIfEmptyMap(map: Record<string, number>): Record<string, number> | null {
  return Object.keys(map).length > 0 ? map : null;
}

/** A bubble's `createdAt` → ISO string (epoch-ms number or an ISO string), or null. */
function bubbleTime(b: Record<string, unknown>): string | null {
  const c = b.createdAt;
  if (typeof c === 'number' && Number.isFinite(c)) return new Date(c).toISOString();
  if (typeof c === 'string' && c.trim() !== '') return c;
  return null;
}

/**
 * The conversation's TIMED turn timeline from the IDE-store bubbles (the only
 * timed Cursor source — the transcript carries no timestamps). Returns user-turn
 * times and assistant-turn times (+ model), each in conversation order (sorted by
 * `createdAt`). Empty when there's no db / no bubbles / no `createdAt`.
 */
function readBubbleTimeline(
  ctx: HarnessContext,
  convId: string,
): { users: string[]; asst: { t: string; model?: string }[] } {
  const empty = { users: [] as string[], asst: [] as { t: string; model?: string }[] };
  const db = ctx.db;
  if (db === undefined) return empty;
  for (const dbPath of cursorStateDbPaths(ctx.env)) {
    const rows = db.query(dbPath, 'SELECT value FROM cursorDiskKV WHERE key LIKE ?', [
      `bubbleId:${convId}:%`,
    ]);
    if (rows.length === 0) continue;
    const parsed: { ms: number; t: string; type: number; model?: string }[] = [];
    for (const row of rows) {
      if (typeof row.value !== 'string') continue;
      let b: Record<string, unknown>;
      try {
        b = JSON.parse(row.value) as Record<string, unknown>;
      } catch {
        continue;
      }
      const t = bubbleTime(b);
      if (t === null) continue;
      const ms = Date.parse(t);
      const info = (b.modelInfo ?? {}) as Record<string, unknown>;
      const model = typeof info.modelName === 'string' ? info.modelName : undefined;
      parsed.push({
        ms: Number.isNaN(ms) ? 0 : ms,
        t,
        type: typeof b.type === 'number' ? b.type : 0,
        model,
      });
    }
    if (parsed.length === 0) continue;
    parsed.sort((a, b) => a.ms - b.ms);
    return {
      users: parsed.filter((p) => p.type === 1).map((p) => p.t),
      asst: parsed.filter((p) => p.type === 2).map((p) => ({ t: p.t, model: p.model })),
    };
  }
  return empty;
}

/** Count user/assistant turns in a set of raw transcript lines (for global turn indexing). */
function countRole(lines: readonly string[], role: 'user' | 'assistant'): number {
  let n = 0;
  for (const line of lines) {
    try {
      if ((JSON.parse(line) as Record<string, unknown>).role === role) n += 1;
    } catch {
      // skip malformed
    }
  }
  return n;
}

export const cursorAdapter: HarnessAdapter = {
  harness: 'cursor-agent',
  handles: (harnessId) => harnessId === 'cursor-agent',

  currentPosition(src) {
    const content = readTranscript(src);
    return content === null ? null : nonEmptyLines(content).length;
  },

  extract(ctx: HarnessContext) {
    const content = readTranscript(ctx);
    if (content === null) return nullCaps;
    const allLines = nonEmptyLines(content);
    const windowLines = allLines.slice(ctx.window.from, ctx.window.to);
    if (windowLines.length === 0) return nullCaps;

    const convId = ctx.env.get(CURSOR_SESSION_ENV) ?? '';
    // The only timed Cursor source is the bubble store; the transcript is untimed.
    // Correlate windowed transcript turns to whole-conversation bubbles by order
    // → anchored timing (t_precision 'anchored'). tokens stay null (server-side).
    const timeline =
      convId.length > 0
        ? readBubbleTimeline(ctx, convId)
        : { users: [] as string[], asst: [] as { t: string; model?: string }[] };
    let userIdx = countRole(allLines.slice(0, ctx.window.from), 'user');
    let asstIdx = countRole(allLines.slice(0, ctx.window.from), 'assistant');

    const tools: Record<string, number> = {};
    const skills: Record<string, number> = {};
    const userPrompts: number[] = [];
    let assistantTurns = 0;

    const direct: Event[] = [];
    const toolCalls: ToolCall[] = [];
    const skillOpens: SkillOpen[] = [];
    const commandObs: { cmd: string; t: string }[] = [];
    let anyTs = false;

    for (const line of windowLines) {
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const message = (o.message ?? {}) as Record<string, unknown>;
      const blocks = blocksOf(message);

      if (o.role === 'user') {
        const text = blocks
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join(' ');
        if (text.trim() !== '') {
          const w = wordCount(text);
          userPrompts.push(w);
          const t = timeline.users[userIdx];
          if (t !== undefined) {
            direct.push({ t, t_precision: 'anchored', kind: 'prompt', words: w });
            anyTs = true;
          }
        }
        userIdx += 1;
      } else if (o.role === 'assistant') {
        assistantTurns += 1;
        const turnAt = timeline.asst[asstIdx];
        if (turnAt !== undefined) {
          anyTs = true;
          const turn: Event = { t: turnAt.t, t_precision: 'anchored', kind: 'turn', dur_s: 0 };
          if (turnAt.model !== undefined) turn.model = turnAt.model;
          direct.push(turn); // no token buckets → rollup.tokens stays null (never estimated)
        }
        const at = turnAt?.t;
        for (const b of blocks) {
          if (b.type !== 'tool_use') continue;
          const name = typeof b.name === 'string' ? b.name : 'unknown';
          tools[name] = (tools[name] ?? 0) + 1;
          const input = (b.input ?? {}) as Record<string, unknown>;
          // FX001-A: keep a shell call's non-harness command signature (keys its burst).
          let signature: string | undefined;
          if ((name === 'Shell' || name === 'Bash') && typeof input.command === 'string') {
            signature = shellSignature(input.command);
            if (at !== undefined) commandObs.push({ cmd: input.command, t: at });
          } else if (name === 'Skill' && typeof input.skill === 'string') {
            skills[input.skill] = (skills[input.skill] ?? 0) + 1;
            // FX001-B: only a LEADING pure-digit positional survives (P12).
            const arg = skillDigitArg(input.args);
            if (at !== undefined) {
              const open: SkillOpen = { name: input.skill, t: at };
              if (arg !== undefined) open.arg = arg;
              skillOpens.push(open);
            }
          }
          if (at !== undefined) {
            const call: ToolCall = { name, t: at };
            if (signature !== undefined) call.signature = signature;
            toolCalls.push(call);
          }
        }
        asstIdx += 1;
      }
    }

    for (const { cmd, t } of commandObs) {
      const observeKind = observeKindFromCommand(cmd);
      for (const sig of commandSignatures(cmd)) {
        const sub = harnessSubcommand(sig);
        if (sub === null) continue;
        const hev: HarnessEvent = { t, t_precision: 'anchored', kind: 'harness', verb: sub };
        if (sub === 'observe' && observeKind !== null) hev.observe_kind = observeKind;
        direct.push(hev);
      }
    }

    const event_stream = anyTs
      ? buildEventStream({
          direct,
          toolCalls,
          skillOpens,
          lastSkillActive: false,
          precision: 'anchored',
        })
      : null;

    return {
      // The conversation id IS this harness's session id (plan 068 item 6) — it was
      // already in hand for every transcript/bubble read below, and reporting `null`
      // while holding it made the adapter describe itself as less capable than it is.
      harness_session_id: convId.length > 0 ? convId : null,
      tokens: null, // Cursor keeps per-request token CONSUMPTION server-side only
      models: convId.length > 0 ? buildModels(ctx, convId, assistantTurns) : null,
      effort: null,
      skills: nullIfEmptyMap(skills),
      tools: nullIfEmptyMap(tools),
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
