import { partitionCommands } from '../command-signature.js';
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
 * blocks, `tool_use` with name/input). Tokens/models are NOT in the transcript —
 * they live in a per-chat sqlite store — so those stay `null` for now; what the
 * transcript gives (user prompts, tool names, shell/harness commands, skills) is
 * extracted, sliced to the cursor's "since last command" window.
 *
 * Detection: `CURSOR_CONVERSATION_ID` (the session id) + `AGENT_TRANSCRIPTS` (the
 * transcript dir), both set by cursor-agent in its shell subprocesses. Ports-only
 * (P2): reads injected env/fs only — no `node:*`. PRIVACY (AC-04): only counts,
 * command signatures, and tool names — never prompt text or tool-arg strings.
 */

export const CURSOR_SESSION_ENV = 'CURSOR_CONVERSATION_ID';
export const CURSOR_TRANSCRIPTS_ENV = 'AGENT_TRANSCRIPTS';

export function cursorTranscriptPath(transcriptsDir: string, convId: string): string {
  return `${transcriptsDir}/${convId}/${convId}.jsonl`;
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
    return {
      harness_session_id: null,
      tokens: null, // in cursor's per-chat sqlite store, not the transcript
      models: null,
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
