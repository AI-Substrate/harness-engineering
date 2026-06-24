import type { EnvPort } from '../../../adapters/env/env-port.js';
import { partitionCommands } from '../command-signature.js';
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
  bash_commands: null,
  harness_commands: null,
  user_prompts: null,
  subagents: null,
  files: null,
  branch_changed: null,
  compactions: null,
  api_errors: null,
  local_commands: null,
  thinking: null,
};

function nullIfEmptyMap(map: Record<string, number>): Record<string, number> | null {
  return Object.keys(map).length > 0 ? map : null;
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
    const lines = nonEmptyLines(content).slice(ctx.window.from, ctx.window.to);
    if (lines.length === 0) return nullCaps;

    const tools: Record<string, number> = {};
    const skills: Record<string, number> = {};
    const rawCommands: string[] = [];
    const userPrompts: number[] = [];
    let assistantTurns = 0;

    for (const line of lines) {
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
        if (text.trim() !== '') userPrompts.push(wordCount(text));
      } else if (o.role === 'assistant') {
        assistantTurns += 1;
        for (const b of blocks) {
          if (b.type !== 'tool_use') continue;
          const name = typeof b.name === 'string' ? b.name : 'unknown';
          tools[name] = (tools[name] ?? 0) + 1;
          const input = (b.input ?? {}) as Record<string, unknown>;
          if ((name === 'Shell' || name === 'Bash') && typeof input.command === 'string') {
            rawCommands.push(input.command);
          } else if (name === 'Skill' && typeof input.skill === 'string') {
            skills[input.skill] = (skills[input.skill] ?? 0) + 1;
          }
        }
      }
    }

    const { bash, harness } = partitionCommands(rawCommands);
    const convId = ctx.env.get(CURSOR_SESSION_ENV) ?? '';
    return {
      harness_session_id: null,
      tokens: null, // Cursor keeps per-request token CONSUMPTION server-side only
      models: convId.length > 0 ? buildModels(ctx, convId, assistantTurns) : null,
      effort: null,
      skills: nullIfEmptyMap(skills),
      tools: nullIfEmptyMap(tools),
      bash_commands: bash.length > 0 ? bash : null,
      harness_commands: harness.length > 0 ? harness : null,
      user_prompts: userPrompts.length > 0 ? userPrompts : null,
      subagents: null,
      files: null,
      branch_changed: null,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
    };
  },
};
