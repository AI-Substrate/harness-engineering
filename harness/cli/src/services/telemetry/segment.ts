import {
  isWithin,
  posixJoin,
  posixNormalize,
  posixRelative,
  toPosix,
} from '../shared/posix-path.js';
import type { Event, Rollup, TPrecision } from './events.js';
import { computeRollup } from './rollup.js';

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
export const SEGMENT_SCHEMA_VERSION = '2.1';

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

/**
 * The normalized counts-only segment. Every key is in {@link SEGMENT_FIELD_KEYS};
 * the always-present subset is {@link SEGMENT_REQUIRED_KEYS}.
 *
 * v2.0 leans on the event stream as the substrate: the **headline** fields
 * (identity + window + tokens/effort + `event_stream`/`rollup`) are always
 * present, while the **v1 compatibility view** (`models`/`skills`/`tools`/
 * `subagents`/`files`/… — all DERIVABLE from `event_stream`) is OMITTED when
 * empty to keep the record lean. `bash_commands`/`harness_commands` were dropped
 * entirely (v2): bash runs surface as `tools` events and harness verbs as
 * `harness` events in the timeline — the array duplicated the stream.
 */
export interface Segment {
  schema_version: string;
  /** The harness command that triggered capture (e.g. `flow`). */
  command: string;
  /** The detected innermost harness (`claude-code` | `copilot-cli` | `cursor` | …). */
  harness: string;
  /** The harness CLI version that PRODUCED this segment (e.g. `0.6.0`) — the OTLP `service.version`. */
  harness_version: string;
  /** Opaque correlation handle — NOT an individual identity (AC-11/13). */
  harness_session_id: string;
  timecode: string;
  window: SegmentWindow;
  branch: string | null;
  tokens: SegmentTokens | null;
  effort: string | null;
  /** v2.0 — the ordered timestamped event stream (the substrate; counts are derived). Always present. */
  event_stream: Event[];
  /** v2.0 — the derived measures view; a pure function of {@link event_stream}; null when the stream is empty. */
  rollup: Rollup | null;
  // --- v1 compatibility view: derivable from `event_stream`, each OMITTED when empty (budget) ---
  models?: Record<string, SegmentModelStat>;
  skills?: Record<string, number>;
  tools?: Record<string, number>;
  /** Word count of each user prompt in the window, in order (never the text). */
  user_prompts?: number[];
  subagents?: SegmentSubagent[];
  files?: SegmentFiles;
  plans_touched?: string[];
  events?: SegmentEvents;
  thinking?: SegmentThinking | null;
}

/**
 * The canonical allowlist — every POSSIBLE top-level key of a {@link Segment}.
 * `segment.schema.json`'s property set is kept key-set-EQUAL to this; a serialized
 * segment's keys are a SUBSET (the v1-compat view is omitted when empty). Adding a
 * key here without bumping {@link SEGMENT_SCHEMA_VERSION} trips the version-freeze test.
 */
export const SEGMENT_FIELD_KEYS = [
  'schema_version',
  'command',
  'harness',
  'harness_version',
  'harness_session_id',
  'timecode',
  'window',
  'branch',
  'tokens',
  'effort',
  'event_stream',
  'rollup',
  'models',
  'skills',
  'tools',
  'user_prompts',
  'subagents',
  'files',
  'plans_touched',
  'events',
  'thinking',
] as const;

/**
 * The always-present subset of {@link SEGMENT_FIELD_KEYS} — the schema's `required`
 * set. The headline identity/window/token fields plus the v2 `event_stream`/`rollup`
 * substrate are always emitted; everything else (the v1-compat view) is omitted when
 * empty, so it is optional in the schema. `segment-schema.test.ts` pins `required`
 * to this.
 */
export const SEGMENT_REQUIRED_KEYS = [
  'schema_version',
  'command',
  'harness',
  'harness_version',
  'harness_session_id',
  'timecode',
  'window',
  'branch',
  'tokens',
  'effort',
  'event_stream',
  'rollup',
] as const;

/** The loosely-typed capture input the serializer narrows into a clean {@link Segment}. */
export interface SegmentInput {
  command: string;
  harness: string;
  /** The producing harness CLI version (the composition root passes `readVersion()`). */
  harness_version?: string;
  harness_session_id: string;
  timecode: string;
  window: SegmentWindow;
  branch: string | null;
  tokens?: SegmentTokens | null;
  models?: Record<string, SegmentModelStat>;
  effort?: string | null;
  skills?: Record<string, number>;
  tools?: Record<string, number>;
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
function eventBase(e: { t: string; t_precision?: string }): {
  t: string;
  t_precision?: TPrecision;
} {
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
    case 'flow_log': {
      // ALLOWLIST: pick `op` + only the present structural fields — never spread,
      // so a free-form `details` value (manual description / custom value / comment
      // text) on the source event cannot reach the output (AC-03).
      const ev: Event = { ...base, kind: 'flow_log', op: e.op };
      if (typeof e.node === 'string') ev.node = e.node;
      if (typeof e.from === 'string') ev.from = e.from;
      if (typeof e.to === 'string') ev.to = e.to;
      if (typeof e.type === 'string') ev.type = e.type;
      if (typeof e.edge_op === 'string') ev.edge_op = e.edge_op;
      return ev;
    }
    case 'branch': {
      const ev: Event = { ...base, kind: 'branch', to: e.to };
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
      // Unknown kind — never pass fields through; keep the skeleton only. The
      // switch above is exhaustive over the closed `Event` union, so this is a
      // defensive floor for a future/foreign kind; cast back to `Event` since the
      // skeleton's `kind` is the widened union, not a single literal.
      return { ...base, kind: (e as { kind: Event['kind'] }).kind } as Event;
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

  // Headline fields — always present (identity + window + tokens/effort).
  const seg = {
    schema_version: SEGMENT_SCHEMA_VERSION,
    command: input.command,
    harness: input.harness,
    // Always present (required): defaults to 'unknown' if a caller omits it, so a
    // segment is never schema-invalid; the live composition root always supplies it.
    harness_version: input.harness_version ?? 'unknown',
    harness_session_id: input.harness_session_id,
    timecode: input.timecode,
    window: {
      since: input.window.since,
      from: input.window.from,
      to: input.window.to,
    },
    branch: input.branch,
    tokens: input.tokens ?? null,
    effort: input.effort ?? null,
  } as Segment;

  // v1 compatibility view — DERIVABLE from the event stream; each key is OMITTED
  // when empty (budget). Still an allowlist BY CONSTRUCTION: every value is picked
  // explicitly, the input is never spread.
  const models = input.models ?? {};
  if (Object.keys(models).length > 0) seg.models = models;
  const skills = input.skills ?? {};
  if (Object.keys(skills).length > 0) seg.skills = skills;
  const tools = input.tools ?? {};
  if (Object.keys(tools).length > 0) seg.tools = tools;
  const userPrompts = input.user_prompts ?? [];
  if (userPrompts.length > 0) seg.user_prompts = [...userPrompts];
  const subagents = groupSubagents(input.subagents ?? []);
  if (subagents.length > 0) seg.subagents = subagents;
  const written = (input.files?.written ?? []).map((p) => relativizePath(p, repoRoot));
  const edited = (input.files?.edited ?? []).map((p) => relativizePath(p, repoRoot));
  if (written.length > 0 || edited.length > 0) seg.files = { written, edited };
  const plans = dedupe(input.plans_touched ?? []);
  if (plans.length > 0) seg.plans_touched = plans;
  const compactions = (input.events?.compactions ?? []).map((c) => ({
    trigger: c.trigger ?? null,
    pre_tokens: c.pre_tokens,
    post_tokens: c.post_tokens,
  }));
  const apiErrors = input.events?.api_errors ?? 0;
  const localCommands = input.events?.local_commands ?? 0;
  if (compactions.length > 0 || apiErrors > 0 || localCommands > 0) {
    seg.events = { compactions, api_errors: apiErrors, local_commands: localCommands };
  }
  if (input.thinking != null) seg.thinking = input.thinking;

  // v2.0 substrate — always present (the event stream; the rollup it derives).
  seg.event_stream = eventStream;
  seg.rollup = eventStream.length > 0 ? computeRollup(eventStream) : null;
  return seg;
}
