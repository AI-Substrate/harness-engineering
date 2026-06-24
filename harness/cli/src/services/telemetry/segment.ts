import type { Event, Rollup, TPrecision } from './events.js';
import { computeRollup } from './rollup.js';
import {
  isWithin,
  posixJoin,
  posixNormalize,
  posixRelative,
  toPosix,
} from '../shared/posix-path.js';

/**
 * The `segment` — the normalized, **counts-only** per-session telemetry record
 * (plan 034 Phase 1). This is the load-bearing cross-tool / cross-repo contract
 * consumed by the downstream eng-thrive scraper, mirrored by `segment.schema.json`
 * (kept key-set-equal by `segment-schema.test.ts`).
 *
 * PRIVACY (AC-04, Constitution P12): a segment carries ONLY allowlisted counts
 * and identifiers — never prompt/message text, file contents, or free-form
 * tool-arg strings, and file paths are repo-relative (never absolute `/Users/…`).
 * The guarantee is structural: {@link serializeSegment} is an allowlist BY
 * CONSTRUCTION — it picks each field explicitly and never spreads its input — so
 * a stray field handed in by an adapter or caller cannot reach the output.
 *
 * All capability fields are nullable; an unimplemented capability serializes
 * `null` / empty (never absent, never estimated).
 */

/**
 * The cross-tool schema version of the segment contract. Bump on a field-set change.
 * v2.0 (plan 034 Phase 5): promoted to an event stream — adds `events[]` + the
 * derived `rollup` (the v1 count fields remain as a compatibility view).
 */
export const SEGMENT_SCHEMA_VERSION = '2.0';

export interface SegmentTokens {
  input: number;
  output: number;
  cache_create: number;
  cache_read: number;
  total: number;
  subagent_tokens: number;
  grand_total: number;
}

export interface SegmentModelStat {
  turns: number;
  output_tokens: number;
}

/** A per-occurrence subagent record an adapter emits — grouped by the serializer. */
export interface SegmentSubagentInput {
  type?: string | null;
  agent_name?: string | null;
  model?: string | null;
  status?: string | null;
  tokens?: number | null;
  tool_uses?: number | null;
}

/**
 * A serialized subagent: identical occurrences collapsed to ONE entry with a
 * `count`, null/absent identity fields OMITTED (not carried as `null`), and
 * `tokens`/`tool_uses` summed across the group (omitted when none were known).
 * Keeps the segment compact instead of N near-empty objects.
 */
export interface SegmentSubagent {
  type?: string;
  agent_name?: string;
  model?: string;
  status?: string;
  count: number;
  tokens?: number;
  tool_uses?: number;
}

export interface SegmentWindow {
  /** `session-start` on the first capture of a session; `last-command` thereafter. */
  since: 'session-start' | 'last-command';
  /** Source-relative window bounds (byte/line offsets — counts, not content). */
  from: number;
  to: number;
}

export interface SegmentFiles {
  written: string[];
  edited: string[];
}

export interface SegmentCompaction {
  trigger: string | null;
  pre_tokens: number;
  post_tokens: number;
}

export interface SegmentEvents {
  compactions: SegmentCompaction[];
  api_errors: number;
  local_commands: number;
}

export interface SegmentThinking {
  blocks: number;
}

/** The normalized counts-only segment. Every top-level key is in {@link SEGMENT_FIELD_KEYS}. */
export interface Segment {
  schema_version: string;
  /** The harness command that triggered capture (e.g. `flow`). */
  command: string;
  /** The detected innermost harness (`claude-code` | `copilot-cli` | `cursor` | …). */
  harness: string;
  /** Opaque correlation handle — NOT an individual identity (AC-11/13). */
  harness_session_id: string;
  timecode: string;
  window: SegmentWindow;
  branch: string | null;
  branch_changed: boolean;
  tokens: SegmentTokens | null;
  models: Record<string, SegmentModelStat>;
  effort: string | null;
  skills: Record<string, number>;
  tools: Record<string, number>;
  /** Every bash command run in the window, sans params (e.g. `git status`); harness invocations excluded — see `harness_commands`. */
  bash_commands: string[];
  /** Every harness sub-command run in the window, sans params (e.g. `boot`, `flow nav`). */
  harness_commands: string[];
  /** Word count of each user prompt in the window, in order — how much / how often the user is steering (never the text). */
  user_prompts: number[];
  subagents: SegmentSubagent[];
  files: SegmentFiles;
  plans_touched: string[];
  events: SegmentEvents;
  thinking: SegmentThinking | null;
  /** v2.0 — the ordered timestamped event stream (the substrate; counts are derived). */
  event_stream: Event[];
  /** v2.0 — the derived measures view; a pure function of {@link event_stream}. */
  rollup: Rollup | null;
}

/**
 * The canonical allowlist — the EXACT top-level field set of a {@link Segment}.
 * `segment-schema.test.ts` asserts `segment.schema.json`'s property set equals
 * this (key-set equality, not subset), and T001 asserts a serialized segment's
 * keys equal this. Adding a field here without bumping {@link SEGMENT_SCHEMA_VERSION}
 * trips the version-freeze test.
 */
export const SEGMENT_FIELD_KEYS = [
  'schema_version',
  'command',
  'harness',
  'harness_session_id',
  'timecode',
  'window',
  'branch',
  'branch_changed',
  'tokens',
  'models',
  'effort',
  'skills',
  'tools',
  'bash_commands',
  'harness_commands',
  'user_prompts',
  'subagents',
  'files',
  'plans_touched',
  'events',
  'thinking',
  'event_stream',
  'rollup',
] as const;

/** The loosely-typed capture input the serializer narrows into a clean {@link Segment}. */
export interface SegmentInput {
  command: string;
  harness: string;
  harness_session_id: string;
  timecode: string;
  window: SegmentWindow;
  branch: string | null;
  branch_changed: boolean;
  tokens?: SegmentTokens | null;
  models?: Record<string, SegmentModelStat>;
  effort?: string | null;
  skills?: Record<string, number>;
  tools?: Record<string, number>;
  bash_commands?: string[];
  harness_commands?: string[];
  user_prompts?: number[];
  subagents?: SegmentSubagentInput[];
  files?: { written?: string[]; edited?: string[] };
  plans_touched?: string[];
  events?: Partial<SegmentEvents>;
  thinking?: SegmentThinking | null;
  /** v2.0 — the ordered event stream an adapter emits; serialized via the per-kind allowlist. */
  event_stream?: readonly Event[];
}

const ABSOLUTE_LOGICAL = /^([A-Za-z]:)?\//;

/**
 * Reduce a path to a privacy-safe, repo-relative form:
 * - inside the repo (absolute OR relative) → relative to `repoRoot` (e.g. `src/x.ts`);
 * - OUTSIDE the repo (absolute, OR a `..`-climbing relative path) → basename only
 *   — the directory (incl. any `/Users/…` or `../…`) is dropped, never leaked.
 *
 * A relative input is resolved against `repoRoot` BEFORE the containment check so
 * a `../outside/secret.txt` traversal can never pass through unchanged
 * (companion F001 — AC-04).
 */
function relativizePath(raw: string, repoRoot: string): string {
  const root = posixNormalize(toPosix(repoRoot));
  const p = toPosix(raw);
  const abs = ABSOLUTE_LOGICAL.test(p) ? posixNormalize(p) : posixNormalize(posixJoin(root, p));
  if (isWithin(root, abs)) {
    const rel = posixRelative(root, abs);
    return rel === '' ? '.' : rel;
  }
  return abs.split('/').pop() ?? '';
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Group per-occurrence subagent records into compact serialized entries: identical
 * identities (type/agent_name/model/status) collapse to one `{ …, count }`, null
 * identity fields are OMITTED (not carried as `null`), and tokens/tool_uses are
 * summed (omitted when no occurrence reported a number). First-occurrence order
 * is preserved.
 */
function groupSubagents(items: readonly SegmentSubagentInput[]): SegmentSubagent[] {
  const groups = new Map<string, SegmentSubagent>();
  for (const s of items) {
    const type = s.type ?? undefined;
    const agentName = s.agent_name ?? undefined;
    const model = s.model ?? undefined;
    const status = s.status ?? undefined;
    const key = JSON.stringify([type, agentName, model, status]);
    let g = groups.get(key);
    if (g === undefined) {
      g = { count: 0 };
      if (type !== undefined) g.type = type;
      if (agentName !== undefined) g.agent_name = agentName;
      if (model !== undefined) g.model = model;
      if (status !== undefined) g.status = status;
      groups.set(key, g);
    }
    g.count += 1;
    if (typeof s.tokens === 'number') g.tokens = (g.tokens ?? 0) + s.tokens;
    if (typeof s.tool_uses === 'number') g.tool_uses = (g.tool_uses ?? 0) + s.tool_uses;
  }
  return [...groups.values()];
}

const T_PRECISIONS: ReadonlySet<string> = new Set([
  'exact',
  'anchored',
  'interpolated',
  'interval',
]);

/** Carry `t` + (a valid) `t_precision` only — the shared base of every serialized event. */
function eventBase(e: { t: string; t_precision?: string }): { t: string; t_precision?: TPrecision } {
  const base: { t: string; t_precision?: TPrecision } = { t: e.t };
  if (e.t_precision !== undefined && T_PRECISIONS.has(e.t_precision)) {
    base.t_precision = e.t_precision as TPrecision;
  }
  return base;
}

/** Include a key only when its value is a finite number (omits `null`/`undefined`/`NaN`). */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Serialize ONE event into its allowlisted shape (AC-15). ALLOWLIST BY
 * CONSTRUCTION: each kind picks exactly its contract fields — the input is never
 * spread — so a planted secret / raw arg in a non-allowlisted field on any event
 * cannot reach the output. An unrecognized kind degrades to its `{ t, kind }`
 * skeleton rather than passing fields through.
 */
export function serializeEvent(e: Event): Event {
  const base = eventBase(e);
  switch (e.kind) {
    case 'prompt':
      return { ...base, kind: 'prompt', words: e.words };
    case 'turn': {
      const ev: Event = { ...base, kind: 'turn', dur_s: e.dur_s };
      const i = num(e.in);
      const o = num(e.out);
      const cr = num(e.cache_read);
      const cc = num(e.cache_create);
      if (i !== undefined) ev.in = i;
      if (o !== undefined) ev.out = o;
      if (cr !== undefined) ev.cache_read = cr;
      if (cc !== undefined) ev.cache_create = cc;
      if (typeof e.model === 'string') ev.model = e.model;
      return ev;
    }
    case 'tools':
      return { ...base, kind: 'tools', name: e.name, count: e.count, span_s: e.span_s };
    case 'skill': {
      const ev: Event = { ...base, kind: 'skill', name: e.name, status: e.status };
      const d = num(e.dur_s);
      if (d !== undefined) ev.dur_s = d;
      return ev;
    }
    case 'flow': {
      const ev: Event = { ...base, kind: 'flow', flow: e.flow, stage: e.stage, status: e.status };
      if (typeof e.from === 'string') ev.from = e.from;
      return ev;
    }
    case 'harness':
      return { ...base, kind: 'harness', verb: e.verb };
    case 'checks': {
      const ev: Event = { ...base, kind: 'checks', status: e.status };
      if (e.gates !== undefined) {
        const gates: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.gates)) gates[k] = String(v);
        ev.gates = gates;
      }
      return ev;
    }
    case 'command_exit': {
      const ev: Event = { ...base, kind: 'command_exit', verb: e.verb, exit: e.exit };
      if (typeof e.status === 'string') ev.status = e.status;
      return ev;
    }
    case 'subagent': {
      const ev: Event = { ...base, kind: 'subagent', name: e.name, status: e.status };
      const d = num(e.dur_s);
      if (d !== undefined) ev.dur_s = d;
      return ev;
    }
    case 'compaction':
      return { ...base, kind: 'compaction' };
    case 'model': {
      const ev: Event = { ...base, kind: 'model', model: e.model };
      if (typeof e.effort === 'string') ev.effort = e.effort;
      return ev;
    }
    case 'api_error': {
      const ev: Event = { ...base, kind: 'api_error' };
      if (typeof e.signature === 'string') ev.signature = e.signature;
      return ev;
    }
    default:
      // Unknown kind — never pass fields through; keep the skeleton only.
      return { ...base, kind: (e as { kind: Event['kind'] }).kind };
  }
}

/**
 * Serialize a capture input into a clean counts-only {@link Segment}. ALLOWLIST
 * BY CONSTRUCTION: every field is picked explicitly — the input is never spread —
 * so a planted secret / raw content in a non-allowlisted field cannot reach the
 * output. File paths are relativized; `plans_touched` is deduped.
 */
export function serializeSegment(input: SegmentInput, repoRoot: string): Segment {
  // v2.0: the event stream is the substrate; the rollup is DERIVED from the
  // serialized events (never taken from the caller) so it can never drift (AC-16).
  const eventStream = (input.event_stream ?? []).map(serializeEvent);
  return {
    schema_version: SEGMENT_SCHEMA_VERSION,
    command: input.command,
    harness: input.harness,
    harness_session_id: input.harness_session_id,
    timecode: input.timecode,
    window: {
      since: input.window.since,
      from: input.window.from,
      to: input.window.to,
    },
    branch: input.branch,
    branch_changed: input.branch_changed,
    tokens: input.tokens ?? null,
    models: input.models ?? {},
    effort: input.effort ?? null,
    skills: input.skills ?? {},
    tools: input.tools ?? {},
    bash_commands: [...(input.bash_commands ?? [])],
    harness_commands: [...(input.harness_commands ?? [])],
    user_prompts: [...(input.user_prompts ?? [])],
    subagents: groupSubagents(input.subagents ?? []),
    files: {
      written: (input.files?.written ?? []).map((p) => relativizePath(p, repoRoot)),
      edited: (input.files?.edited ?? []).map((p) => relativizePath(p, repoRoot)),
    },
    plans_touched: dedupe(input.plans_touched ?? []),
    events: {
      compactions: (input.events?.compactions ?? []).map((c) => ({
        trigger: c.trigger ?? null,
        pre_tokens: c.pre_tokens,
        post_tokens: c.post_tokens,
      })),
      api_errors: input.events?.api_errors ?? 0,
      local_commands: input.events?.local_commands ?? 0,
    },
    thinking: input.thinking ?? null,
    event_stream: eventStream,
    rollup: eventStream.length > 0 ? computeRollup(eventStream) : null,
  };
}
