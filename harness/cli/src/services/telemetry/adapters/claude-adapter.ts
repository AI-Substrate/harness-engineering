import type {
  SegmentCompaction,
  SegmentModelStat,
  SegmentSubagent,
  SegmentTokens,
} from '../segment.js';
import type { HarnessAdapter, HarnessCapabilities, HarnessContext } from './harness-adapter.js';

/**
 * The Claude Code capability adapter (plan 034, Phase 2 · T003 — AC-02/04/12).
 * Turns a Claude Code session transcript (`~/.claude/projects/<mangled cwd>/
 * <session-id>.jsonl`) into counts-only {@link HarnessCapabilities}.
 *
 * Token math (verified): a `message.usage` is REPEATED across the JSONL lines of
 * one assistant message (one per content block) — so usage is **deduped by
 * `message.id`** and all four buckets summed (`input + output + cache_creation +
 * cache_read`). Subagent cost is NOT a sidechain — it returns INLINE in the
 * `Agent` tool_result as `<usage>subagent_tokens: N\ntool_uses: M</usage>`, so it
 * is counted once and added as `grand_total`. tool_uses are counted per LINE
 * (not deduped); skills come from `Skill` tool_use `input.skill`.
 *
 * PRIVACY (AC-04, adapter boundary): only allowlisted COUNTS and identifiers are
 * read — never a tool-arg string, message text, or file content. The serializer
 * is the second backstop; this adapter simply never copies free-form strings.
 *
 * Ports-only (P2): reads through injected `env`/`fs` only — `env.home()` for the
 * home dir (never `env.get('HOME')`), no `node:*`.
 */

/** The offset unit is the transcript's non-empty line count (M2 — used by both currentPosition and the slice). */
function nonEmptyLines(content: string): string[] {
  return content.split('\n').filter((l) => l.trim() !== '');
}

/**
 * `~/.claude/projects/<mangled repoRoot>/<sessionId>.jsonl` — the project-dir
 * mangle replaces every non-alphanumeric char with `-`, preserving the leading
 * dash (`/repo` → `-repo`; `/Users/x/proj.dir` → `-Users-x-proj-dir`).
 */
export function claudeTranscriptPath(home: string, repoRoot: string, sessionId: string): string {
  const mangled = repoRoot.replace(/[^A-Za-z0-9]/g, '-');
  return `${home}/.claude/projects/${mangled}/${sessionId}.jsonl`;
}

function resolveTranscript(ctx: HarnessContext): string | null {
  const home = ctx.env.home();
  const sessionId = ctx.env.get('CLAUDE_CODE_SESSION_ID');
  if (home === undefined || sessionId === undefined || sessionId.length === 0) return null;
  return ctx.fs.readText(claudeTranscriptPath(home, ctx.repoRoot, sessionId));
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function nullIfEmptyMap(map: Record<string, number>): Record<string, number> | null {
  return Object.keys(map).length > 0 ? map : null;
}

const nullCaps: HarnessCapabilities = {
  harness_session_id: null,
  tokens: null,
  models: null,
  effort: null,
  skills: null,
  tools: null,
  subagents: null,
  files: null,
  branch_changed: null,
  compactions: null,
  api_errors: null,
  local_commands: null,
  thinking: null,
};

export const claudeAdapter: HarnessAdapter = {
  harness: 'claude-code',
  handles: (harnessId) => harnessId === 'claude-code',

  currentPosition(src) {
    const home = src.env.home();
    const sessionId = src.env.get('CLAUDE_CODE_SESSION_ID');
    if (home === undefined || sessionId === undefined || sessionId.length === 0) return null;
    const content = src.fs.readText(claudeTranscriptPath(home, src.repoRoot, sessionId));
    if (content === null) return null;
    return nonEmptyLines(content).length;
  },

  extract(ctx) {
    const effort = ctx.env.get('CLAUDE_EFFORT') ?? null;
    const content = resolveTranscript(ctx);
    if (content === null) return { ...nullCaps, effort };

    const lines = nonEmptyLines(content).slice(ctx.window.from, ctx.window.to);
    if (lines.length === 0) return { ...nullCaps, effort };

    // Token accumulators (deduped by message.id) + per-model turns/output.
    const seenMessageIds = new Set<string>();
    let input = 0;
    let output = 0;
    let cacheCreate = 0;
    let cacheRead = 0;
    const models: Record<string, SegmentModelStat> = {};

    // Per-line capability accumulators (NOT deduped).
    const skills: Record<string, number> = {};
    const tools: Record<string, number> = {};
    const written: string[] = [];
    const edited: string[] = [];
    const compactions: SegmentCompaction[] = [];
    let thinkingBlocks = 0;

    // Subagent correlation: Agent tool_use id → its subagent_type, joined to the
    // matching tool_result's inline <usage> block.
    const agentTypeById = new Map<string, string | null>();
    const subagents: SegmentSubagent[] = [];

    for (const line of lines) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // tolerate a malformed line
      }

      if (obj.type === 'compaction') {
        const meta = obj.compactMetadata as Record<string, unknown> | undefined;
        if (meta) {
          compactions.push({
            trigger: typeof meta.trigger === 'string' ? meta.trigger : null,
            pre_tokens: typeof meta.preTokens === 'number' ? meta.preTokens : 0,
            post_tokens: typeof meta.postTokens === 'number' ? meta.postTokens : 0,
          });
        }
        continue;
      }

      const message = obj.message as Record<string, unknown> | undefined;
      if (message === undefined) continue;
      const blocks = Array.isArray(message.content)
        ? (message.content as Record<string, unknown>[])
        : [];

      if (obj.type === 'assistant') {
        const id = typeof message.id === 'string' ? message.id : '';
        const usage = message.usage as Record<string, unknown> | undefined;
        const model = typeof message.model === 'string' ? message.model : 'unknown';
        if (id !== '' && usage && !seenMessageIds.has(id)) {
          seenMessageIds.add(id);
          const out = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
          input += typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
          output += out;
          cacheCreate +=
            typeof usage.cache_creation_input_tokens === 'number'
              ? usage.cache_creation_input_tokens
              : 0;
          cacheRead +=
            typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
          const stat = models[model] ?? { turns: 0, output_tokens: 0 };
          stat.turns += 1;
          stat.output_tokens += out;
          models[model] = stat;
        }

        for (const block of blocks) {
          if (block.type === 'thinking') {
            thinkingBlocks += 1;
          } else if (block.type === 'tool_use') {
            const name = typeof block.name === 'string' ? block.name : 'unknown';
            increment(tools, name);
            const tInput = (block.input as Record<string, unknown> | undefined) ?? {};
            if (name === 'Skill' && typeof tInput.skill === 'string') {
              increment(skills, tInput.skill);
            } else if (name === 'Agent') {
              const id = typeof block.id === 'string' ? block.id : '';
              if (id !== '') {
                agentTypeById.set(
                  id,
                  typeof tInput.subagent_type === 'string' ? tInput.subagent_type : null,
                );
              }
            } else if (name === 'Edit' && typeof tInput.file_path === 'string') {
              edited.push(tInput.file_path);
            } else if (name === 'Write' && typeof tInput.file_path === 'string') {
              written.push(tInput.file_path);
            }
          }
        }
      } else if (obj.type === 'user') {
        for (const block of blocks) {
          if (block.type !== 'tool_result') continue;
          const refId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
          if (!agentTypeById.has(refId)) continue;
          const text = typeof block.content === 'string' ? block.content : '';
          const usageMatch = /<usage>([\s\S]*?)<\/usage>/.exec(text);
          let tokens: number | null = null;
          let toolUses: number | null = null;
          if (usageMatch) {
            const tok = /subagent_tokens:\s*(\d+)/.exec(usageMatch[1]);
            const tu = /tool_uses:\s*(\d+)/.exec(usageMatch[1]);
            tokens = tok ? Number.parseInt(tok[1], 10) : null;
            toolUses = tu ? Number.parseInt(tu[1], 10) : null;
          }
          subagents.push({
            type: agentTypeById.get(refId) ?? null,
            agent_name: null,
            model: null,
            status: null,
            tokens,
            tool_uses: toolUses,
          });
        }
      }
    }

    const subagentTokens = subagents.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
    let tokens: SegmentTokens | null = null;
    if (seenMessageIds.size > 0) {
      const total = input + output + cacheCreate + cacheRead;
      tokens = {
        input,
        output,
        cache_create: cacheCreate,
        cache_read: cacheRead,
        total,
        subagent_tokens: subagentTokens,
        grand_total: total + subagentTokens,
      };
    }

    return {
      harness_session_id: null,
      tokens,
      models: Object.keys(models).length > 0 ? models : null,
      effort,
      skills: nullIfEmptyMap(skills),
      tools: nullIfEmptyMap(tools),
      subagents: subagents.length > 0 ? subagents : null,
      files: written.length > 0 || edited.length > 0 ? { written, edited } : null,
      branch_changed: null,
      compactions: compactions.length > 0 ? compactions : null,
      api_errors: null,
      local_commands: null,
      thinking: thinkingBlocks > 0 ? { blocks: thinkingBlocks } : null,
    };
  },
};
