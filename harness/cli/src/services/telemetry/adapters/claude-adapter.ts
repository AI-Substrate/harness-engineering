import {
  commandSignatures,
  controlSignatures,
  harnessSubcommand,
  observeKindFromCommand,
  shellSignature,
  skillDigitArg,
} from '../command-signature.js';
import { buildEventStream } from '../event-builder.js';
import type { Event, FileEvent, HarnessEvent } from '../events.js';
import { computeFileDelta, writtenDelta } from '../file-delta.js';
import { outcomeEvents } from '../outcome-events.js';
import type { SkillOpen, ToolCall } from '../rollup.js';
import type {
  SegmentCompaction,
  SegmentModelStat,
  SegmentSubagentInput,
  SegmentTokens,
} from '../segment.js';
import type { HarnessAdapter, HarnessCapabilities, HarnessSource } from './harness-adapter.js';

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
 * A privacy-safe token-count ESTIMATE of a `tool_result` payload (FX003) — a
 * char/4 heuristic over its size, NEVER the content and NEVER a tokenizer (per
 * memory: tiktoken mis-counts for Claude, and this is a proxy, not a billing
 * figure). Only the resulting number is ever kept.
 */
function estimateResultTokens(text: string): number {
  return Math.ceil(text.length / 4);
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

export type ClaudeTranscriptUnavailableReason =
  | 'zero'
  | 'multiple'
  | 'unresolved'
  | 'traversal'
  | 'symlink'
  | 'non-file'
  | 'oversize'
  | 'malformed'
  | 'ambiguity';

export type ClaudeTranscriptResolution =
  | { status: 'found'; path: string; content: string }
  | { status: 'unavailable'; reason: ClaudeTranscriptUnavailableReason };

const MAX_CLAUDE_TRANSCRIPT_BYTES = 128 * 1024 * 1024;
const MAX_CLAUDE_PROJECT_CANDIDATES = 33;
const claudeResolutionCache = new WeakMap<
  NonNullable<HarnessSource['standardClaude']>,
  ClaudeTranscriptResolution
>();

function unavailable(reason: ClaudeTranscriptUnavailableReason): ClaudeTranscriptResolution {
  return { status: 'unavailable', reason };
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function hasTraversal(path: string): boolean {
  return path.includes('\0') || path.split(/[\\/]/).some((part) => part === '..');
}

function candidatePath(configRoot: string, projectRoot: string, sessionId: string): string {
  const projectKey = projectRoot.replace(/[^A-Za-z0-9]/g, '-');
  return `${configRoot.replace(/[\\/]+$/, '')}/projects/${projectKey}/${sessionId}.jsonl`;
}

function locationFor(src: HarnessSource): NonNullable<HarnessSource['standardClaude']> | null {
  if (src.standardClaude !== undefined) return src.standardClaude;
  const selectedRoot = src.env.get('CLAUDE_CONFIG_DIR');
  const home = src.env.home();
  const configRoot =
    selectedRoot !== undefined && selectedRoot.length > 0
      ? selectedRoot
      : home !== undefined
        ? `${home}/.claude`
        : null;
  return configRoot === null ? null : { configRoot, projectRoots: [src.repoRoot] };
}

function locateAt(
  src: HarnessSource,
  location: NonNullable<HarnessSource['standardClaude']>,
): ClaudeTranscriptResolution {
  const sessionId =
    src.sessionId !== undefined && src.sessionId.length > 0
      ? src.sessionId
      : src.env.get('CLAUDE_CODE_SESSION_ID');
  if (sessionId === undefined || sessionId.length === 0 || location.projectRoots.length === 0) {
    return unavailable('unresolved');
  }
  if (
    sessionId === '.' ||
    sessionId === '..' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId) ||
    !isAbsolutePath(location.configRoot) ||
    hasTraversal(location.configRoot)
  ) {
    return unavailable('traversal');
  }

  const distinctRoots = [...new Set(location.projectRoots)];
  if (distinctRoots.length > MAX_CLAUDE_PROJECT_CANDIDATES) {
    return unavailable('ambiguity');
  }
  // Distinct roots can mangle to the SAME candidate path (`/repo/wt-a_x` and
  // `/repo/wt-a-x` both become `-repo-wt-a-x`). That names one transcript, byte for
  // byte, whichever root produced it — so it is one candidate, not an ambiguity
  // (finding 10). Genuine ambiguity is two DIFFERENT paths that both exist, which the
  // `matches.length > 1` check below still catches.
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const root of distinctRoots) {
    if (!isAbsolutePath(root) || hasTraversal(root)) return unavailable('traversal');
    const path = candidatePath(location.configRoot, root, sessionId);
    if (seen.has(path)) continue;
    seen.add(path);
    candidates.push(path);
  }

  const matches: string[] = [];
  const rejected = new Set<ClaudeTranscriptUnavailableReason>();
  for (const path of candidates) {
    const probe = src.fs.probeRegularFileNoFollow(
      location.configRoot,
      path,
      MAX_CLAUDE_TRANSCRIPT_BYTES,
    );
    if (probe.status === 'ok') {
      matches.push(path);
    } else if (probe.reason !== 'missing') {
      rejected.add(probe.reason === 'io-error' ? 'unresolved' : probe.reason);
    }
  }

  if (rejected.size > 0) {
    if (rejected.size === 1 && matches.length === 0) {
      return unavailable([...rejected][0] as ClaudeTranscriptUnavailableReason);
    }
    return unavailable('ambiguity');
  }
  if (matches.length === 0) return unavailable('zero');
  if (matches.length > 1) return unavailable('multiple');

  const path = matches[0] as string;
  const read = src.fs.readTextFileNoFollow(location.configRoot, path, MAX_CLAUDE_TRANSCRIPT_BYTES);
  if (read.status === 'unavailable') {
    if (read.reason === 'missing' || read.reason === 'io-error') return unavailable('unresolved');
    return unavailable(read.reason);
  }
  const lines = nonEmptyLines(read.text);
  const hasJsonObject = lines.some((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  });
  return hasJsonObject ? { status: 'found', path, content: read.text } : unavailable('malformed');
}

/** Resolve one transcript from explicit bounded candidates only. */
export function locateClaudeTranscript(src: HarnessSource): ClaudeTranscriptResolution {
  const location = locationFor(src);
  return location === null ? unavailable('unresolved') : locateAt(src, location);
}

function resolveClaudeTranscript(src: HarnessSource): ClaudeTranscriptResolution {
  const location = locationFor(src);
  if (location === null) return unavailable('unresolved');
  if (src.standardClaude === undefined) return locateAt(src, location);
  const cached = claudeResolutionCache.get(src.standardClaude);
  if (cached !== undefined) return cached;
  const resolution = locateAt(src, location);
  claudeResolutionCache.set(src.standardClaude, resolution);
  return resolution;
}

/** `nullCaps` plus the closed reason the locator already computed (finding 07). */
function blindCaps(reason: ClaudeTranscriptUnavailableReason | null): HarnessCapabilities {
  return reason === null ? nullCaps : { ...nullCaps, token_unavailable_reason: reason };
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
    const resolution = resolveClaudeTranscript(src);
    return resolution.status === 'found' ? nonEmptyLines(resolution.content).length : null;
  },

  /** The resolved transcript file — the source whose extent `currentPosition` counts. */
  sourcePath(src) {
    const resolution = resolveClaudeTranscript(src);
    return resolution.status === 'found' ? resolution.path : null;
  },

  extract(ctx) {
    const resolution = resolveClaudeTranscript(ctx);
    const content = resolution.status === 'found' ? resolution.content : null;
    // No source → pure all-null (M6 / companion F001: effort must NOT leak when
    // there is no windowed data, so it is read only after the source is present),
    // but carry WHY so the loss is diagnosable (finding 07).
    if (content === null) {
      return blindCaps(resolution.status === 'unavailable' ? resolution.reason : null);
    }

    const lines = nonEmptyLines(content).slice(ctx.window.from, ctx.window.to);
    if (lines.length === 0) return nullCaps; // empty window → all-null (a real read)

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
    // v2.4 (plan 056): one `file` event per path (last-write-wins in the window),
    // carrying a change-delta computed from the tool payload (D5 — never a read).
    const fileEvents = new Map<string, FileEvent>();
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
    // FX003: tool_use id → its ToolCall, so the correlated tool_result's payload
    // size can be back-filled onto the call once the result line arrives.
    const callById = new Map<string, ToolCall>();
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
            const tInput = (block.input as Record<string, unknown> | undefined) ?? {};
            // FX001-A: a shell tool's non-harness command signature (kept, not
            // discarded) → keys its burst; harness verbs stay separate below.
            let signature: string | undefined;
            let control: Record<string, number> | undefined;
            if (name === 'Skill' && typeof tInput.skill === 'string') {
              increment(skills, tInput.skill);
              // FX001-B: only a LEADING pure-digit positional survives (P12).
              const arg = skillDigitArg(tInput.args);
              if (ts !== null) {
                const open: SkillOpen = { name: tInput.skill, t: ts };
                if (arg !== undefined) open.arg = arg;
                skillOpens.push(open);
              }
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
              // plan 056: delta from the Edit payload (old→new), never a file read.
              if (ts !== null) {
                const oldStr = typeof tInput.old_string === 'string' ? tInput.old_string : '';
                const newStr = typeof tInput.new_string === 'string' ? tInput.new_string : '';
                fileEvents.set(tInput.file_path, {
                  t: ts,
                  kind: 'file',
                  path: tInput.file_path,
                  change: 'edited',
                  delta: computeFileDelta(oldStr, newStr),
                });
              }
            } else if (name === 'Write' && typeof tInput.file_path === 'string') {
              written.push(tInput.file_path);
              // plan 056: a Write is the whole file added (removed 0).
              if (ts !== null) {
                const body = typeof tInput.content === 'string' ? tInput.content : '';
                fileEvents.set(tInput.file_path, {
                  t: ts,
                  kind: 'file',
                  path: tInput.file_path,
                  change: 'written',
                  delta: writtenDelta(body),
                });
              }
            } else if (name === 'Bash' && typeof tInput.command === 'string') {
              signature = shellSignature(tInput.command);
              // plan 069: the git push/commit the chain HEAD signature drops.
              control = controlSignatures(tInput.command);
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
            if (ts !== null) {
              const call: ToolCall = { name, t: ts };
              if (signature !== undefined) call.signature = signature;
              if (control !== undefined) call.control = control;
              toolCalls.push(call);
              // FX003: register by tool_use id so the correlated tool_result can
              // back-fill its payload size onto this call.
              const callId = typeof block.id === 'string' ? block.id : '';
              if (callId !== '') callById.set(callId, call);
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

          // FX003: size the correlated tool_result payload (a count-only estimate,
          // never the text) and attach it to the launching call, so the report's
          // command lens can byte-weight the input-split by the real dump size.
          const sizedCall = callById.get(refId);
          if (sizedCall !== undefined) {
            sizedCall.result_tokens = estimateResultTokens(toolResultText(block.content));
          }

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
      const observeKind = observeKindFromCommand(cmd);
      for (const sig of commandSignatures(cmd)) {
        const sub = harnessSubcommand(sig);
        if (sub === null) continue;
        const hev: HarnessEvent = { t, kind: 'harness', verb: sub };
        if (sub === 'observe' && observeKind !== null) hev.observe_kind = observeKind;
        direct.push(hev);
      }
    }

    // plan 056: append the deduped per-file write/edit events (capture-time `t`,
    // excluded from rollup math — like artifact/mark).
    for (const fe of fileEvents.values()) direct.push(fe);

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
