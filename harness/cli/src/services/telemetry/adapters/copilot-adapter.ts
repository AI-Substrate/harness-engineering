import type { SegmentModelStat, SegmentSubagent, SegmentTokens } from '../segment.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessContext,
  HarnessSource,
} from './harness-adapter.js';

/**
 * The Copilot CLI capability adapter (plan 034, Phase 2 · T006 — AC-03/04/12).
 * Turns a Copilot session's native artifacts into counts-only
 * {@link HarnessCapabilities}.
 *
 * Two sources (verified): the per-session `events.jsonl`
 * (`~/.copilot/session-state/<id>/events.jsonl`) carries `session.model_change`
 * (model + reasoningEffort) and `tool.execution_*` (tool names); the process log
 * (`~/.copilot/logs/process-*.log`) carries the LIVE `assistant_usage` telemetry
 * events that are the ONLY authoritative token source — `session.shutdown` is
 * NOT live (it fires only at session end) and is never read. Each Copilot
 * invocation is its own session, so the source is naturally pre-segmented per
 * command — the window is the whole file (M1); cursor slicing does not apply.
 *
 * Token mapping: `input_tokens_uncached` → `input`; `input_tokens -
 * input_tokens_uncached` → `cache_read`; `output_tokens + reasoning_tokens` →
 * `output` (reasoning folded in so `total = input+output+cache_create+cache_read`
 * stays the invariant; Copilot reports no cache-creation bucket → `cache_create`
 * is 0). Subagent tokens are NOT cleanly correlatable from the log → `null`
 * (never a guessed number). `files`/`compactions`/`thinking` are `null` this
 * phase (codeChanges live only in the non-live `session.shutdown`; tool-arg
 * parsing is avoided for AC-04).
 *
 * PRIVACY (AC-04): only counts + names are read — tool `arguments` (which carry
 * free-form strings) are never copied. Ports-only (P2): `env.home()`, no `node:*`.
 */

export function copilotEventsPath(home: string, sessionId: string): string {
  return `${home}/.copilot/session-state/${sessionId}/events.jsonl`;
}

export function copilotLogsDir(home: string): string {
  return `${home}/.copilot/logs`;
}

function nonEmptyLines(content: string): string[] {
  return content.split('\n').filter((l) => l.trim() !== '');
}

/** Parse the trailing JSON object on a log/event line (prefix is plain text, no braces). */
function parseTrailingJson(line: string): Record<string, unknown> | null {
  const start = line.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(line.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Locate the process log whose contents reference this session id. */
function findProcessLog(src: HarnessSource, home: string, sessionId: string): string | null {
  const dir = copilotLogsDir(home);
  for (const name of src.fs.readdir(dir)) {
    if (!name.startsWith('process-') || !name.endsWith('.log')) continue;
    const content = src.fs.readText(`${dir}/${name}`);
    if (content !== null && content.includes(sessionId)) return content;
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
  branch_changed: null,
  compactions: null,
  api_errors: null,
  local_commands: null,
  thinking: null,
};

export const copilotAdapter: HarnessAdapter = {
  harness: 'copilot-cli',
  handles: (harnessId) => harnessId === 'copilot-cli',

  currentPosition(src) {
    const home = src.env.home();
    const sessionId = src.env.get('COPILOT_AGENT_SESSION_ID');
    if (home === undefined || sessionId === undefined || sessionId.length === 0) return null;
    const content = src.fs.readText(copilotEventsPath(home, sessionId));
    if (content === null) return null;
    return nonEmptyLines(content).length;
  },

  extract(ctx: HarnessContext) {
    const home = ctx.env.home();
    const sessionId = ctx.env.get('COPILOT_AGENT_SESSION_ID');
    if (home === undefined || sessionId === undefined || sessionId.length === 0) return nullCaps;

    // --- events.jsonl: effort + tool histogram (no token authority) ---
    let effort: string | null = null;
    const tools: Record<string, number> = {};
    const eventsContent = ctx.fs.readText(copilotEventsPath(home, sessionId));
    if (eventsContent !== null) {
      for (const line of nonEmptyLines(eventsContent)) {
        const obj = parseTrailingJson(line);
        if (obj === null) continue;
        const data = (obj.data as Record<string, unknown> | undefined) ?? {};
        if (obj.type === 'session.model_change' && effort === null) {
          effort = str(data.reasoningEffort);
        } else if (obj.type === 'tool.execution_complete') {
          const toolName = str(data.toolName);
          if (toolName !== null) tools[toolName] = (tools[toolName] ?? 0) + 1;
        }
      }
    }

    // --- process log: authoritative tokens + per-model + subagents ---
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let usageCount = 0;
    const models: Record<string, SegmentModelStat> = {};
    const subagents: SegmentSubagent[] = [];
    const log = findProcessLog(ctx, home, sessionId);
    if (log !== null) {
      for (const line of nonEmptyLines(log)) {
        if (!line.includes('assistant_usage') && !line.includes('subagent_completed')) continue;
        const obj = parseTrailingJson(line);
        if (obj === null) continue;
        if (obj.kind === 'assistant_usage') {
          usageCount += 1;
          const uncached = num(obj.input_tokens_uncached);
          const totalInput = num(obj.input_tokens);
          const out = num(obj.output_tokens) + num(obj.reasoning_tokens);
          input += uncached;
          cacheRead += Math.max(totalInput - uncached, 0);
          output += out;
          const model = str(obj.model) ?? 'unknown';
          const stat = models[model] ?? { turns: 0, output_tokens: 0 };
          stat.turns += 1;
          stat.output_tokens += out;
          models[model] = stat;
        } else if (obj.kind === 'subagent_completed') {
          subagents.push({
            type: null,
            agent_name: str(obj.agent_name),
            model: str(obj.model),
            status: 'completed',
            tokens: null, // not cleanly correlatable from the log — never guessed
            tool_uses: null,
          });
        }
      }
    }

    let tokens: SegmentTokens | null = null;
    if (usageCount > 0) {
      const total = input + output + cacheRead;
      tokens = {
        input,
        output,
        cache_create: 0,
        cache_read: cacheRead,
        total,
        subagent_tokens: 0,
        grand_total: total,
      };
    }

    return {
      harness_session_id: null,
      tokens,
      models: Object.keys(models).length > 0 ? models : null,
      effort,
      skills: null,
      tools: Object.keys(tools).length > 0 ? tools : null,
      subagents: subagents.length > 0 ? subagents : null,
      files: null,
      branch_changed: null,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
    };
  },
};
