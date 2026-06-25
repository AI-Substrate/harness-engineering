import { commandSignatures, harnessSubcommand } from '../command-signature.js';
import { buildEventStream } from '../event-builder.js';
import type { Event } from '../events.js';
import { outcomeEvents } from '../outcome-events.js';
import type { SkillOpen, ToolCall } from '../rollup.js';
import type {
  SegmentCompaction,
  SegmentModelStat,
  SegmentSubagentInput,
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

/** A tool_result's text payload — a raw string, or the joined `text` of its blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const t = (b as { text?: unknown })?.text;
        return typeof t === 'string' ? t : '';
      })
      .join('');
  }
  return '';
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

/** Word count of a text blob (whitespace-split); 0 when blank. */
function wordCount(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/**
 * Word count of a user turn that is a REAL prompt (string content or text blocks),
 * or `null` when it is a tool_result / empty (not a prompt). Counts ONLY — the
 * prompt text itself is never retained (AC-04).
 */
function userPromptWords(message: Record<string, unknown>): number | null {
  const content = message.content;
  if (typeof content === 'string') return content.trim() === '' ? null : wordCount(content);
  if (Array.isArray(content)) {
    const blocks = content as Record<string, unknown>[];
    if (blocks.some((b) => b?.type === 'tool_result')) return null; // a tool result, not a prompt
    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join(' ');
    return text.trim() === '' ? null : wordCount(text);
  }
  return null;
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
  compactions: null,
  api_errors: null,
  local_commands: null,
  thinking: null,
  event_stream: null,
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
    const content = resolveTranscript(ctx);
    // No source → pure all-null (M6 / companion F001: effort must NOT leak when
    // there is no windowed data, so it is read only after the source is present).
    if (content === null) return nullCaps;

    const lines = nonEmptyLines(content).slice(ctx.window.from, ctx.window.to);
    if (lines.length === 0) return nullCaps; // empty window → all-null

    const effort = ctx.env.get('CLAUDE_EFFORT') ?? null;

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
    const userPrompts: number[] = []; // word count of each real user prompt in the window
    const compactions: SegmentCompaction[] = [];
    let thinkingBlocks = 0;

    // Subagent correlation: Agent tool_use id → its subagent_type, joined to the
    // matching tool_result's inline <usage> block.
    const agentTypeById = new Map<string, string | null>();
    const subagents: SegmentSubagentInput[] = [];

    // Outcome correlation (AC-19): Bash tool_use ids whose command IS a harness
    // sub-command — ONLY their tool_results are parsed as outcome envelopes, so a
    // non-Bash result that happens to be envelope-shaped JSON (e.g. a `Read` of a
    // fixture) can't fabricate `checks`/`command_exit` events (companion F003).
    const harnessBashIds = new Set<string>();

    // v2.0 event-stream collectors — built ONLY when the transcript lines carry a
    // `timestamp` (real transcripts do; a timestamp-less source → event_stream null).
    const direct: Event[] = [];
    const toolCalls: ToolCall[] = [];
    const skillOpens: SkillOpen[] = [];
    const commandObs: { cmd: string; t: string }[] = [];
    let anyTs = false;
    let prevTsMs: number | null = null;
    let lastModel: string | null = null;

    for (const line of lines) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // tolerate a malformed line
      }

      const ts = typeof obj.timestamp === 'string' ? obj.timestamp : null;
      const tsMs = ts !== null ? Date.parse(ts) : null;
      // gap from the PREVIOUS timed line → this turn's dur_s; then advance the cursor.
      const gapMs = tsMs !== null && prevTsMs !== null ? tsMs - prevTsMs : null;
      if (tsMs !== null && !Number.isNaN(tsMs)) {
        anyTs = true;
        prevTsMs = tsMs;
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
        if (ts !== null) direct.push({ t: ts, kind: 'compaction' });
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
          const inThis = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
          const ccThis =
            typeof usage.cache_creation_input_tokens === 'number'
              ? usage.cache_creation_input_tokens
              : 0;
          const crThis =
            typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
          input += inThis;
          output += out;
          cacheCreate += ccThis;
          cacheRead += crThis;
          const stat = models[model] ?? { turns: 0, output_tokens: 0 };
          stat.turns += 1;
          stat.output_tokens += out;
          models[model] = stat;

          // v2.0 turn event (one per deduped assistant message). dur_s ≈ wall gap
          // from the previous timed line into this turn; a model switch emits a
          // `model` event just before the turn.
          if (ts !== null) {
            if (model !== lastModel) {
              direct.push({ t: ts, kind: 'model', model });
              lastModel = model;
            }
            const durS = gapMs !== null ? Math.max(0, Math.round(gapMs / 1000)) : 0;
            direct.push({
              t: ts,
              kind: 'turn',
              dur_s: durS,
              in: inThis,
              out,
              cache_read: crThis,
              cache_create: ccThis,
              model,
            });
          }
        }

        for (const block of blocks) {
          if (block.type === 'thinking') {
            thinkingBlocks += 1;
          } else if (block.type === 'tool_use') {
            const name = typeof block.name === 'string' ? block.name : 'unknown';
            increment(tools, name);
            if (ts !== null) toolCalls.push({ name, t: ts });
            const tInput = (block.input as Record<string, unknown> | undefined) ?? {};
            if (name === 'Skill' && typeof tInput.skill === 'string') {
              increment(skills, tInput.skill);
              if (ts !== null) skillOpens.push({ name: tInput.skill, t: ts });
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
            } else if (name === 'Bash' && typeof tInput.command === 'string') {
              if (ts !== null) commandObs.push({ cmd: tInput.command, t: ts });
              // Mark this Bash call as a harness invocation so ONLY its result is
              // parsed for outcome events (companion F003).
              const id = typeof block.id === 'string' ? block.id : '';
              if (
                id !== '' &&
                commandSignatures(tInput.command).some((sig) => harnessSubcommand(sig) !== null)
              ) {
                harnessBashIds.add(id);
              }
            }
          }
        }
      } else if (obj.type === 'user') {
        const words = userPromptWords(message);
        if (words !== null) {
          userPrompts.push(words);
          if (ts !== null) direct.push({ t: ts, kind: 'prompt', words });
        }
        for (const block of blocks) {
          if (block.type !== 'tool_result') continue;
          const refId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';

          // Outcome events (AC-19): a harness command's result envelope → `checks`
          // and `command_exit` — ONLY for a tool_result produced by a harness Bash
          // call (companion F003). Reads only codes/verdicts; non-envelope output
          // (rail mode, no `--json`) yields nothing.
          if (ts !== null && harnessBashIds.has(refId)) {
            for (const e of outcomeEvents(
              toolResultText(block.content),
              ts,
              block.is_error === true,
            )) {
              direct.push(e);
            }
          }

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
          if (ts !== null) {
            direct.push({
              t: ts,
              kind: 'subagent',
              name: agentTypeById.get(refId) ?? 'subagent',
              status: 'completed',
            });
          }
        }
      }
    }

    // Harness sub-command events (timestamped Bash `harness …` lines).
    for (const { cmd, t } of commandObs) {
      for (const sig of commandSignatures(cmd)) {
        const sub = harnessSubcommand(sig);
        if (sub !== null) direct.push({ t, kind: 'harness', verb: sub });
      }
    }

    // The window carries timestamps → assemble the ordered stream; else null (honest
    // "untimed source" — the rollup is then null too, never estimated).
    const event_stream = anyTs
      ? buildEventStream({ direct, toolCalls, skillOpens, lastSkillActive: false })
      : null;

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
      user_prompts: userPrompts.length > 0 ? userPrompts : null,
      subagents: subagents.length > 0 ? subagents : null,
      files: written.length > 0 || edited.length > 0 ? { written, edited } : null,
      compactions: compactions.length > 0 ? compactions : null,
      api_errors: null,
      local_commands: null,
      thinking: thinkingBlocks > 0 ? { blocks: thinkingBlocks } : null,
      event_stream,
    };
  },
};
