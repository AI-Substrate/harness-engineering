/**
 * Telemetry event-stream types (plan 034 Phase 5 — segment schema v2.0).
 *
 * v1 shipped **counts per command window**; v2 makes the atom a **timestamped
 * event** and derives the counts from it. An EVENT is the substrate; the
 * {@link Rollup} (and the v1 count fields) are a derived view.
 *
 * PRIVACY (AC-15, Constitution P12): an event is `t + kind + name + numbers` —
 * NEVER prompt text, file contents, or free-form tool-arg strings. Prompts →
 * word counts only. The guarantee is structural: `serializeEvent` (segment.ts)
 * is an allowlist BY CONSTRUCTION — it picks each field per-kind explicitly and
 * never spreads its input — so a stray field handed in by an adapter cannot
 * reach the output.
 */

/** RFC3339 UTC instant, e.g. `2026-06-24T09:00:41Z`. */
export type Iso = string;

/**
 * Honesty flag for how an event's `t` was resolved (detail doc § timestamp
 * resolution). `exact` = a real source timestamp; `anchored` = pinned to a
 * nearby timed record (e.g. a Cursor bubble `createdAt`); `interpolated` =
 * spread between two anchors; `interval` = only bounded by the capture cadence.
 * Omitted ⇒ treat as `exact`.
 */
export type TPrecision = 'exact' | 'anchored' | 'interpolated' | 'interval';

/** Observable skill-span lifecycle (§4.3 — transitions only, no confidence scoring). */
export type SkillStatus = 'completed' | 'abandoned' | 'superseded' | 'active';

/** Coarse quality-gate verdict. */
export type ChecksStatus = 'ok' | 'degraded' | 'error';

export type EventKind =
  | 'prompt'
  | 'turn'
  | 'tools'
  | 'skill'
  | 'flow'
  | 'flow_log'
  | 'branch'
  | 'harness'
  | 'checks'
  | 'command_exit'
  | 'subagent'
  | 'compaction'
  | 'model'
  | 'api_error';

/** The closed set of event kinds — the serializer + schema are kept equal to this. */
export const EVENT_KINDS: readonly EventKind[] = [
  'prompt',
  'turn',
  'tools',
  'skill',
  'flow',
  'flow_log',
  'branch',
  'harness',
  'checks',
  'command_exit',
  'subagent',
  'compaction',
  'model',
  'api_error',
] as const;

interface EventBase {
  t: Iso;
  t_precision?: TPrecision;
}

/** A human steer. `words` = word count of the prompt — never the text. */
export interface PromptEvent extends EventBase {
  kind: 'prompt';
  words: number;
}

/** One agent generation — the work primitive. Tokens are an optional intensity layer. */
export interface TurnEvent extends EventBase {
  kind: 'turn';
  dur_s: number;
  in?: number;
  out?: number;
  cache_read?: number;
  cache_create?: number;
  model?: string;
}

/** A collapsed run of tool calls (the burst rule, §4.2). `name:"mixed"` = heterogeneous. */
export interface ToolsEvent extends EventBase {
  kind: 'tools';
  name: string;
  count: number;
  span_s: number;
}

/** A skill span with an inferred lifecycle status (§4.3). */
export interface SkillEvent extends EventBase {
  kind: 'skill';
  name: string;
  status: SkillStatus;
  dur_s?: number;
}

/** A flight-plan stage transition (read from `the-flow.json` nav, never from args). */
export interface FlowEvent extends EventBase {
  kind: 'flow';
  flow: string;
  stage: string;
  from?: string;
  status: string;
}

/**
 * A flight-plan mutation, projected from `the-flow.json`'s append-only `events[]`
 * audit log (plan 035 — flow replay). One per built-in log entry, carrying only
 * its STRUCTURAL shape (`op` + ids/states from the source event's `details`) at
 * its real `fired_at`. Free-form fields (manual `description`, custom `value`,
 * comment text) are never projected. PURE REPLAY MARKER: excluded from
 * {@link Rollup} gap/wall/stage math (its wall-clock `t` would otherwise re-sort
 * into the stream and mis-attribute time).
 */
export interface FlowLogEvent extends EventBase {
  kind: 'flow_log';
  /** The source built-in event kind: `cursor-moved | status-changed | node-created | node-updated | created`. */
  op: string;
  node?: string;
  /** Prior stage (cursor-moved) or prior status (status-changed). */
  from?: string;
  /** New stage (cursor-moved) or new status (status-changed). */
  to?: string;
  /** Node type (node-created). */
  type?: string;
  /** Edge-splice op (node-updated from an insert-node), when present. */
  edge_op?: string;
}

/** A git branch switch observed between captures (`to` = the new branch; `from` = prior). */
export interface BranchEvent extends EventBase {
  kind: 'branch';
  to: string;
  from?: string;
}

/** A harness sub-command (sans-params), e.g. `checks`, `flow nav`. */
export interface HarnessEvent extends EventBase {
  kind: 'harness';
  verb: string;
}

/** A quality-gate outcome (names + verdicts only). */
export interface ChecksEvent extends EventBase {
  kind: 'checks';
  status: ChecksStatus;
  gates?: Record<string, string>;
}

/** A command's exit code / disposition (codes only, never message bodies). */
export interface CommandExitEvent extends EventBase {
  kind: 'command_exit';
  verb: string;
  exit: number;
  status?: string;
}

/** A spawned sub-agent span. */
export interface SubagentEvent extends EventBase {
  kind: 'subagent';
  name: string;
  status: 'completed' | 'active';
  dur_s?: number;
}

/** Context compaction fired (presence only). */
export interface CompactionEvent extends EventBase {
  kind: 'compaction';
}

/** A model / effort switch. */
export interface ModelEvent extends EventBase {
  kind: 'model';
  model: string;
  effort?: string;
}

/** An API/tool error — a coarse class only, never a message body. */
export interface ApiErrorEvent extends EventBase {
  kind: 'api_error';
  signature?: string;
}

/** The ordered event stream's element type. */
export type Event =
  | PromptEvent
  | TurnEvent
  | ToolsEvent
  | SkillEvent
  | FlowEvent
  | FlowLogEvent
  | BranchEvent
  | HarnessEvent
  | ChecksEvent
  | CommandExitEvent
  | SubagentEvent
  | CompactionEvent
  | ModelEvent
  | ApiErrorEvent;

// ── Derived rollup (recomputable from `events[]`) ──────────────────────────

export interface RollupActivity {
  wall_s: number;
  agent_working_s: number;
  human_s: number;
  idle_s: number;
  /** `agent_working_s / (agent_working_s + human_s)` — idle EXCLUDED. */
  working_ratio: number;
}

export interface RollupSkill {
  runs: number;
  abandoned: number;
  superseded: number;
}

export interface RollupTokens {
  in: number;
  out: number;
  cache_read: number;
  cache_create: number;
}

export interface RollupOutcomes {
  checks?: string;
  /** verb → its (last-seen) exit code. */
  exits: Record<string, number>;
}

/** The derived measures view — a pure function of `events[]` (consumers may recompute). */
export interface Rollup {
  activity: RollupActivity;
  flow_stage_time_s: Record<string, number>;
  skills: Record<string, RollupSkill>;
  /** `null` when no turn carried token buckets (e.g. Cursor) — never zero-filled. */
  tokens: RollupTokens | null;
  tools: Record<string, number>;
  outcomes: RollupOutcomes;
}
