import {
  commandSignatures,
  harnessSubcommand,
  observeKindFromCommand,
  shellSignature,
} from '../command-signature.js';
import { buildEventStream } from '../event-builder.js';
import type { Event, HarnessEvent } from '../events.js';
import type { ToolCall } from '../rollup.js';
import type { SegmentModelStat, SegmentSubagentInput, SegmentTokens } from '../segment.js';
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
 * Two sources (verified against live Copilot CLI, June 2026):
 *  - the per-session `events.jsonl` (`~/.copilot/session-state/<id>/events.jsonl`)
 *    carries `session.model_change` (model + reasoningEffort), `tool.execution_*`
 *    (tool names), and `subagent.completed` (subagent identity);
 *  - the process log (`~/.copilot/logs/process-*.log`) carries the authoritative
 *    `assistant_usage` telemetry blocks (the ONLY token source) — emitted as a
 *    multi-line pretty-printed `[Telemetry] cli.telemetry:` JSON object with tokens
 *    under `metrics`, model under `properties`, and `session_id` at the top level.
 *    `session.shutdown` is NOT live (fires only at session end) and is never read.
 *
 * PER-COMMAND ATTRIBUTION: a single interactive Copilot session can run MANY
 * harness commands (e.g. `harness boot` … `harness checks`), so the old "one
 * invocation = one command, window = whole file" assumption is false. The cursor's
 * window is a line-slice of `events.jsonl`; events-derived capabilities are read
 * from that slice, and process-log `assistant_usage` blocks are attributed to this
 * command only when their `interaction_id` appears in the windowed events
 * (granularity = Copilot interaction). When events carry no interaction ids at all
 * (older format / no events file) it falls back to whole-session token totals.
 *
 * Token mapping: `metrics.input_tokens_uncached` → `input`; `metrics.cache_read_tokens`
 * (else `input_tokens - input_tokens_uncached`) → `cache_read`; `metrics.cache_write_tokens`
 * → `cache_create`; `metrics.output_tokens + reasoning_tokens` → `output` (reasoning
 * folded in so `total = input+output+cache_create+cache_read` stays the invariant).
 * Subagent tokens are not cleanly correlatable → `null` (never guessed).
 * `files` are the `create`/`edit`/`apply_patch` tool target paths (F-07 / plan 052 T001
 * — so the artifact-semantics pass fires on copilot lanes); `compactions`/`thinking`
 * stay `null`.
 *
 * PRIVACY (AC-04): only counts + names + correlation ids (used internally for
 * windowing, never emitted) are read — tool `arguments` and message text are never
 * copied. Ports-only (P2): `env.home()`, no `node:*`.
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

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * A privacy-safe token-count ESTIMATE of a `tool_result` payload (FX003) — a
 * char/4 heuristic over its size, NEVER the content and NEVER a tokenizer. Only
 * the resulting number is kept.
 */
function estimateResultTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract target paths from an `apply_patch` payload (copilot's file-edit tool since
 * v1.x). The path lives in the patch HEADER lines, never an `arguments.path` field:
 *   `*** Add File: <path>`     → created  (add: true)
 *   `*** Update File: <path>`  → modified
 *   `*** Delete File: <path>`  → modified
 * ONLY the header paths are read (repo ids, relativized + confined at serialize time);
 * the `+`/`-` body lines carry free text and are never read (AC-04). Multiple files
 * per patch are supported.
 */
function parseApplyPatchPaths(patch: string): { path: string; add: boolean }[] {
  const out: { path: string; add: boolean }[] = [];
  for (const line of nonEmptyLines(patch)) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trim());
    if (m === null) continue;
    const p = m[2].trim();
    if (p.length > 0) out.push({ path: p, add: m[1] === 'Add' });
  }
  return out;
}

/** Word count of a user prompt (string or text blocks); null when empty/absent. Counts ONLY — text never retained (AC-04). */
function promptWords(content: unknown): number | null {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map((b) => (typeof b === 'string' ? b : (str(asObj(b).text) ?? ''))).join(' ');
  } else {
    return null;
  }
  const t = text.trim();
  return t === '' ? null : t.split(/\s+/).length;
}

/** Parse one JSONL line (whole-line JSON), tolerating malformed lines. */
function parseLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract every TOP-LEVEL JSON object from a process log — the telemetry payloads
 * are pretty-printed blocks delimited by a `{` … `}` at column 0 (nested braces are
 * always indented), interleaved with plain `[DEBUG]` text lines. A self-contained
 * single-line `{…}` (older format) is handled too. Malformed blocks are skipped.
 */
function extractJsonObjects(content: string): Record<string, unknown>[] {
  const objs: Record<string, unknown>[] = [];
  let buf: string[] | null = null;
  const flush = (lines: string[]): void => {
    try {
      objs.push(JSON.parse(lines.join('\n')) as Record<string, unknown>);
    } catch {
      // not a JSON object (e.g. a pretty-printed array / log noise) — skip
    }
  };
  for (const raw of content.split('\n')) {
    if (buf === null) {
      if (raw.startsWith('{')) {
        buf = [raw];
        if (raw.trimEnd().endsWith('}')) {
          flush(buf);
          buf = null;
        }
      }
    } else {
      buf.push(raw);
      if (raw.startsWith('}')) {
        flush(buf);
        buf = null;
      }
    }
  }
  return objs;
}

/** Locate the process log whose contents reference this session id. */
function findProcessLog(src: HarnessSource, home: string, sessionId: string): string | null {
  const dir = copilotLogsDir(home);
  for (const name of src.fs.readdir(dir)) {
    if (!name.startsWith('process-') || !name.endsWith('.log')) continue;
    const content = src.fs.readText(`${dir}/${name}`);
    if (content?.includes(sessionId)) return content;
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

/** Counts-only view of one `events.jsonl`, sliced to the command's window. */
interface EventsView {
  effort: string | null;
  tools: Record<string, number>;
  /** Files created in the window (from `create`/`write` tool `arguments.path`). */
  written: string[];
  /** Files modified in the window (from `edit`/`str_replace` tool `arguments.path`). */
  edited: string[];
  userPrompts: number[];
  subagents: SegmentSubagentInput[];
  /** Interaction ids active in THIS window — the token-attribution key. */
  windowInteractionIds: Set<string>;
  /** Did the WHOLE file carry any interaction id? (false ⇒ no windowing info). */
  anyInteractionId: boolean;
  // v2.0 timed event collectors (events.jsonl IS timestamped — unlike the Claude fixture).
  prompts: { t: string; words: number }[];
  toolCalls: ToolCall[];
  subagentEvts: { t: string; name: string }[];
  modelEvts: { t: string; model: string; effort?: string }[];
  commandObs: { cmd: string; t: string }[];
  /** harness command outcomes from the `success` flag (no envelope ⇒ no `checks`). */
  commandExits: { verb: string; exit: number; t: string }[];
  /** interactionId → turn_start / turn_end timestamps (paired into turn events post-loop). */
  turnStart: Map<string, string>;
  turnEnd: Map<string, string>;
  anyTs: boolean;
}

function readEvents(content: string, fromLine: number, toLine: number): EventsView {
  const lines = nonEmptyLines(content);
  const anyInteractionId = lines.some((l) => str(asObj(parseLine(l)?.data).interactionId) !== null);

  let effort: string | null = null;
  const toolNameByCall = new Map<string, string>(); // dedupe a tool execution by its call id
  // command line by call id, captured INDEPENDENTLY of toolName (they can land on
  // different events) — resolved to bash/shell post-loop via toolNameByCall.
  const commandByCall = new Map<string, { cmd: string; t: string | null }>();
  // File path by call id (F-07 / plan 052 T001): the copilot editor tools carry a
  // clean `arguments.path`; classified to written/edited post-loop via toolNameByCall.
  const pathByCall = new Map<string, string>();
  // apply_patch (copilot's file-edit tool since v1.x) carries its patch as a STRING
  // `arguments` payload — the target path(s) live in the *** Add/Update/Delete File:
  // headers, not `arguments.path`. Captured raw by call id, parsed post-loop.
  const patchByCall = new Map<string, string>();
  const successByCall = new Map<string, boolean>(); // execution_complete `success` → command_exit
  const completeAtByCall = new Map<string, string>(); // execution_complete ts → command_exit `t`
  // FX003: callId → its tool_result payload size (estimate), attached to the call post-loop.
  const resultTokensByCall = new Map<string, number>();
  const userPrompts: number[] = []; // word count of each user prompt in the window
  const subagents: SegmentSubagentInput[] = [];
  const windowInteractionIds = new Set<string>();

  const prompts: { t: string; words: number }[] = [];
  // FX001-A: the tool-call event is emitted at the FIRST event carrying the name,
  // but a shell call's `arguments.command` can land on a DIFFERENT event; so record
  // the callId here and resolve the signature post-loop (when commandByCall is complete).
  const toolCallsRaw: { name: string; t: string; callId: string }[] = [];
  const subagentEvts: { t: string; name: string }[] = [];
  const modelEvts: { t: string; model: string; effort?: string }[] = [];
  const turnStart = new Map<string, string>();
  const turnEnd = new Map<string, string>();
  let anyTs = false;

  for (const line of lines.slice(fromLine, toLine)) {
    const o = parseLine(line);
    if (o === null) continue;
    const data = asObj(o.data);
    const ts = str(o.timestamp) ?? str(o.ts) ?? str(o.time);
    if (ts !== null) anyTs = true;

    const iid = str(data.interactionId);
    if (iid !== null) windowInteractionIds.add(iid);

    if (o.type === 'session.model_change') {
      if (effort === null) effort = str(data.reasoningEffort);
      const m = str(data.newModel);
      if (ts !== null && m !== null) {
        const me: { t: string; model: string; effort?: string } = { t: ts, model: m };
        const e = str(data.reasoningEffort);
        if (e !== null) me.effort = e;
        modelEvts.push(me);
      }
    } else if (o.type === 'assistant.turn_start') {
      if (ts !== null && iid !== null) turnStart.set(iid, ts);
    } else if (o.type === 'assistant.turn_end') {
      if (ts !== null && iid !== null) turnEnd.set(iid, ts);
    } else if (o.type === 'tool.execution_start' || o.type === 'tool.execution_complete') {
      // The tool name moved from execution_complete → execution_start; read it from
      // whichever event carries it, deduped per execution so we never double-count.
      const callId = str(data.toolCallId);
      const toolName = str(data.toolName);
      if (callId !== null && toolName !== null && !toolNameByCall.has(callId)) {
        toolNameByCall.set(callId, toolName);
        // Emit the tool-call event at the FIRST event that carries the name —
        // whether execution_start OR execution_complete (the name moved between the
        // two across CLI versions) — so rollup.tools matches the v1 tools histogram
        // exactly even when the name is only on execution_complete (companion HIGH, AC-16).
        if (ts !== null) toolCallsRaw.push({ name: toolName, t: ts, callId });
      }
      // A shell tool's command line → captured by call id INDEPENDENTLY of
      // toolName: `arguments.command` and the (moved) `toolName` can land on
      // different events (execution_start vs _complete) across CLI versions, so
      // gating capture on the toolName in the SAME event would silently drop
      // tool-burst and `harness` events for a split execution
      // (companion MEDIUM — adjacent to the HIGH tool-count fix). Only the
      // `command` field is read; arguments otherwise carry free text (AC-04).
      // Resolved to bash/shell post-loop via toolNameByCall.
      if (callId !== null && !commandByCall.has(callId)) {
        const cmd = str(asObj(data.arguments).command);
        if (cmd !== null) commandByCall.set(callId, { cmd, t: ts });
      }
      // A file tool's target path → captured by call id, classified written/edited
      // post-loop via toolNameByCall (F-07 / plan 052 T001). Only the `path` field is
      // read (a repo id, relativized + confined at serialize time); never the file
      // body (`file_text`/`old_str`/`new_str`), which carries free text (AC-04).
      if (callId !== null && !pathByCall.has(callId)) {
        const p = str(asObj(data.arguments).path);
        if (p !== null) pathByCall.set(callId, p);
      }
      // apply_patch's `arguments` is the raw patch STRING (not an object), so the
      // `arguments.path` capture above misses it; record the patch body here and
      // extract its header paths post-loop. `str()` is non-null only for a string
      // arguments payload, so create/edit (object arguments) never land here.
      if (callId !== null && !patchByCall.has(callId)) {
        const patch = str(data.arguments);
        if (patch !== null) patchByCall.set(callId, patch);
      }
      // The execution's outcome (AC-19): Copilot reports a `success` boolean on
      // completion (it carries no result envelope, so `checks` isn't derivable —
      // command_exit only). Timestamp the exit at the completion event.
      if (o.type === 'tool.execution_complete' && callId !== null) {
        if (typeof data.success === 'boolean') successByCall.set(callId, data.success);
        if (ts !== null) completeAtByCall.set(callId, ts);
        // FX003: the completion carries the tool_result payload (`result.content`);
        // size it (count only, never the text) for the report's dumper signal.
        const resultContent = str(asObj(data.result).content);
        if (resultContent !== null) {
          resultTokensByCall.set(callId, estimateResultTokens(resultContent));
        }
      }
    } else if (o.type === 'subagent.completed') {
      const name = str(data.agentName) ?? str(data.agentDisplayName);
      subagents.push({
        type: null,
        agent_name: name,
        model: str(data.model),
        status: 'completed',
        tokens: null, // not cleanly correlatable — never guessed
        tool_uses: null,
      });
      if (ts !== null) subagentEvts.push({ t: ts, name: name ?? 'subagent' });
    } else if (o.type === 'user.message') {
      const w = promptWords(data.content);
      if (w !== null) {
        userPrompts.push(w);
        if (ts !== null) prompts.push({ t: ts, words: w });
      }
    }
  }

  const tools: Record<string, number> = {};
  for (const name of toolNameByCall.values()) tools[name] = (tools[name] ?? 0) + 1;

  // Resolve which captured commands belong to a shell execution — the toolName may
  // have arrived on a different event than `arguments.command` (companion MEDIUM).
  const commandObs: { cmd: string; t: string }[] = [];
  const commandExits: { verb: string; exit: number; t: string }[] = [];
  // FX001-A: callId → the shell call's non-harness signature (harness verbs stay
  // separate `harness` events, so a pure-harness command contributes no signature).
  const sigByCall = new Map<string, string>();
  for (const [callId, { cmd, t }] of commandByCall) {
    const tn = toolNameByCall.get(callId);
    if (tn !== 'bash' && tn !== 'shell') continue;
    if (t !== null) commandObs.push({ cmd, t });
    const sig = shellSignature(cmd);
    if (sig !== undefined) sigByCall.set(callId, sig);
    // command_exit (AC-19) — a harness subcommand's exit from the `success` flag.
    // Copilot has ONE success bool for the WHOLE shell execution, so it can be
    // attributed only to a LONE harness command: a compound — whether two harness
    // verbs (`harness checks && harness flow nav`, F004) OR a harness verb mixed
    // with a non-harness command (`npm test && harness checks`, F008) — shares one
    // success that may reflect a different command, so emit nothing.
    const success = successByCall.get(callId);
    const at = completeAtByCall.get(callId) ?? t;
    if (success !== undefined && at !== null) {
      const sigs = commandSignatures(cmd);
      const subs = sigs.map((sig) => harnessSubcommand(sig)).filter((s): s is string => s !== null);
      if (sigs.length === 1 && subs.length === 1) {
        commandExits.push({ verb: subs[0], exit: success ? 0 : 1, t: at });
      }
    }
  }
  // Attach the resolved signature to each shell tool call (order preserved).
  const toolCalls: ToolCall[] = toolCallsRaw.map(({ name, t, callId }) => {
    const call: ToolCall = { name, t };
    const sig = sigByCall.get(callId);
    if (sig !== undefined) call.signature = sig;
    const rt = resultTokensByCall.get(callId);
    if (rt !== undefined) call.result_tokens = rt;
    return call;
  });
  // Files touched (F-07 / plan 052 T001): classify each captured tool `path` by its
  // tool name — `create`/`write` create a file, `edit`/`str_replace` modify one;
  // `view` and every other tool are read-only and contribute nothing. This is the
  // copilot analogue of the claude adapter's `Write`/`Edit` extraction, so the
  // capture-time artifact-semantics pass has a changed-file set on copilot worker
  // lanes too (they emitted 0 `artifact` events before this — the root of F-07).
  const written: string[] = [];
  const edited: string[] = [];
  for (const [callId, p] of pathByCall) {
    const tn = toolNameByCall.get(callId);
    if (tn === 'create' || tn === 'write') written.push(p);
    else if (tn === 'edit' || tn === 'str_replace' || tn === 'str_replace_editor') edited.push(p);
  }
  // apply_patch: one patch can touch several files — classify each by its header op
  // (`Add` creates, `Update`/`Delete` modify), from the patch body captured above.
  for (const [callId, patch] of patchByCall) {
    if (toolNameByCall.get(callId) !== 'apply_patch') continue;
    for (const { path: p, add } of parseApplyPatchPaths(patch)) {
      if (add) written.push(p);
      else edited.push(p);
    }
  }
  return {
    effort,
    tools,
    written,
    edited,
    userPrompts,
    subagents,
    windowInteractionIds,
    anyInteractionId,
    prompts,
    toolCalls,
    subagentEvts,
    modelEvts,
    commandObs,
    commandExits,
    turnStart,
    turnEnd,
    anyTs,
  };
}

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

    // --- events.jsonl (windowed): effort + tools + subagents + the attribution key ---
    const eventsContent = ctx.fs.readText(copilotEventsPath(home, sessionId));
    const ev: EventsView =
      eventsContent !== null
        ? readEvents(eventsContent, ctx.window.from, ctx.window.to)
        : {
            effort: null,
            tools: {},
            written: [],
            edited: [],
            userPrompts: [],
            subagents: [],
            windowInteractionIds: new Set(),
            anyInteractionId: false,
            prompts: [],
            toolCalls: [],
            subagentEvts: [],
            modelEvts: [],
            commandObs: [],
            commandExits: [],
            turnStart: new Map(),
            turnEnd: new Map(),
            anyTs: false,
          };

    // --- process log: authoritative tokens + per-model, attributed to this window ---
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let usageCount = 0;
    let effort = ev.effort;
    const models: Record<string, SegmentModelStat> = {};
    // Per-interaction token totals → attached to that interaction's turn event so
    // Σ(turn tokens) == the v1 aggregate (AC-16, when interactions are present).
    const perIid = new Map<
      string,
      { in: number; out: number; cache_read: number; cache_create: number }
    >();
    const log = findProcessLog(ctx, home, sessionId);
    if (log !== null) {
      for (const obj of extractJsonObjects(log)) {
        if (obj.kind !== 'assistant_usage') continue;
        // A process log interleaves MULTIPLE sessions — filter every record by
        // session_id so another session's usage can't bleed in (companion F002).
        if (str(obj.session_id) !== sessionId) continue;

        const props = asObj(obj.properties);
        // Per-command attribution: when the events file gives us interaction ids,
        // only count blocks whose interaction is in THIS command's window; when it
        // gives none (older format / no events), fall back to whole-session totals.
        const iid = str(props.interaction_id) ?? str(obj.interaction_id);
        if (ev.anyInteractionId && (iid === null || !ev.windowInteractionIds.has(iid))) continue;

        // Tokens live under `metrics` (new) or at the top level (older format).
        const m = obj.metrics !== undefined ? asObj(obj.metrics) : obj;
        const uncached = num(m.input_tokens_uncached);
        const cr =
          m.cache_read_tokens !== undefined
            ? num(m.cache_read_tokens)
            : Math.max(num(m.input_tokens) - uncached, 0);
        const cw = num(m.cache_write_tokens);
        const out = num(m.output_tokens) + num(m.reasoning_tokens);
        usageCount += 1;
        input += uncached;
        cacheRead += cr;
        cacheCreate += cw;
        output += out;
        if (iid !== null) {
          const e = perIid.get(iid) ?? { in: 0, out: 0, cache_read: 0, cache_create: 0 };
          e.in += uncached;
          e.out += out;
          e.cache_read += cr;
          e.cache_create += cw;
          perIid.set(iid, e);
        }

        const model = str(props.model) ?? str(obj.model) ?? 'unknown';
        const stat = models[model] ?? { turns: 0, output_tokens: 0 };
        stat.turns += 1;
        stat.output_tokens += out;
        models[model] = stat;

        if (effort === null) effort = str(props.reasoning_effort);
      }
    }

    let tokens: SegmentTokens | null = null;
    if (usageCount > 0) {
      const total = input + output + cacheCreate + cacheRead;
      tokens = {
        input,
        output,
        cache_create: cacheCreate,
        cache_read: cacheRead,
        total,
        subagent_tokens: 0,
        grand_total: total,
      };
    }

    // --- v2.0 event stream: turn spans (tokens attributed per interaction) + ---
    // --- prompts / models / subagents / harness, plus tool-call bursts.       ---
    const lastModel =
      ev.modelEvts.length > 0
        ? ev.modelEvts[ev.modelEvts.length - 1].model
        : (Object.keys(models)[0] ?? undefined);
    const turnEvents: Event[] = [];
    for (const [iid, start] of ev.turnStart) {
      const end = ev.turnEnd.get(iid);
      const durS = end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000)) : 0;
      const turn: Event = { t: start, kind: 'turn', dur_s: durS };
      const tok = perIid.get(iid);
      if (tok !== undefined) {
        turn.in = tok.in;
        turn.out = tok.out;
        turn.cache_read = tok.cache_read;
        turn.cache_create = tok.cache_create;
      }
      if (lastModel !== undefined) turn.model = lastModel;
      turnEvents.push(turn);
    }
    const harnessEvents: Event[] = [];
    for (const { cmd, t } of ev.commandObs) {
      const observeKind = observeKindFromCommand(cmd);
      for (const sig of commandSignatures(cmd)) {
        const sub = harnessSubcommand(sig);
        if (sub === null) continue;
        const hev: HarnessEvent = { t, kind: 'harness', verb: sub };
        if (sub === 'observe' && observeKind !== null) hev.observe_kind = observeKind;
        harnessEvents.push(hev);
      }
    }
    const direct: Event[] = [
      ...ev.prompts.map((p): Event => ({ t: p.t, kind: 'prompt', words: p.words })),
      ...ev.modelEvts.map(
        (m): Event =>
          m.effort !== undefined
            ? { t: m.t, kind: 'model', model: m.model, effort: m.effort }
            : { t: m.t, kind: 'model', model: m.model },
      ),
      ...turnEvents,
      ...ev.subagentEvts.map(
        (s): Event => ({ t: s.t, kind: 'subagent', name: s.name, status: 'completed' }),
      ),
      ...harnessEvents,
      ...ev.commandExits.map(
        (c): Event => ({ t: c.t, kind: 'command_exit', verb: c.verb, exit: c.exit }),
      ),
    ];
    const event_stream = ev.anyTs ? buildEventStream({ direct, toolCalls: ev.toolCalls }) : null;

    return {
      harness_session_id: null,
      tokens,
      models: Object.keys(models).length > 0 ? models : null,
      effort,
      skills: null,
      tools: Object.keys(ev.tools).length > 0 ? ev.tools : null,
      user_prompts: ev.userPrompts.length > 0 ? ev.userPrompts : null,
      subagents: ev.subagents.length > 0 ? ev.subagents : null,
      files:
        ev.written.length > 0 || ev.edited.length > 0
          ? { written: ev.written, edited: ev.edited }
          : null,
      compactions: null,
      api_errors: null,
      local_commands: null,
      thinking: null,
      event_stream,
    };
  },
};
