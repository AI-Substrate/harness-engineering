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
  | 'api_error'
  | 'artifact';

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
  'artifact',
] as const;

/**
 * The closed vocabulary of flow/SDD artifact types an extractor can stamp
 * (plan 050). Fixed set — the serializer + schema enumerate it, so a novel type
 * can never appear on the wire.
 */
export type ArtifactType =
  | 'review'
  | 'plan'
  | 'workshop'
  | 'dossier'
  | 'tasks'
  | 'execution-log'
  | 'backpressure'
  | 'validation'
  | 'ship-report'
  | 'flight-plan';

/**
 * The CLOSED union of `counts` keys any extractor may emit — the schema mirror of
 * this (segment.schema.json `event_stream.items.counts`) is `additionalProperties:
 * false`, so a rogue extractor key is both a compile error (via
 * {@link ArtifactEvent.counts}) AND a schema-validation failure. An extractor
 * cannot invent a numeric channel outside this set. Keep this equal to the schema.
 */
export const ARTIFACT_COUNT_KEYS = [
  'absent',
  'blocked',
  'buildable',
  'checks_green',
  'checks_total',
  'chores',
  'chores_done',
  'chores_skipped',
  'chores_todo',
  'comments',
  'cs',
  'decisions',
  'deferred',
  'deviations',
  'done',
  'entries',
  'events',
  'exists',
  'findings',
  'findings_critical',
  'findings_high',
  'findings_low',
  'findings_med',
  'fixes',
  'gaps',
  'gate_fail',
  'gate_na',
  'gate_pass',
  'high',
  'in_progress',
  'nodes',
  'open',
  'phases',
  'pr_opened',
  're_reviews',
  'resolved',
  'sections',
  'skipped',
  'todo',
  'workshop_opps',
  'workshops',
] as const;
export type ArtifactCountKey = (typeof ARTIFACT_COUNT_KEYS)[number];

/**
 * The CLOSED union of `enums` keys any extractor may emit. Each key's VALUE is
 * itself gated to a fixed vocabulary (with an `other` fallback) at extraction
 * time and, additively, by the schema's per-key `enum` list — so neither the key
 * NOR the value can carry free text (privacy contract, AC-05).
 */
export const ARTIFACT_ENUM_KEYS = [
  'verdict',
  'mode',
  'status',
  'target_proof',
  'current_proof',
  'certainty',
  'pr_state',
] as const;
export type ArtifactEnumKey = (typeof ARTIFACT_ENUM_KEYS)[number];

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
  /**
   * The privacy-safe command signature of a SHELL-family tool burst (FX001) —
   * `commandSignatures()`'s program+verb only (`rg`, `git commit`), allowlisted
   * BY CONSTRUCTION (no flags/paths/values/quotes). Present only when the burst
   * is a shell tool AND the signature resolves to a non-harness command (harness
   * verbs stay separate `harness` events); absent for non-shell tools.
   */
  signature?: string;
  /**
   * The total size (a token-count ESTIMATE, never payload text) of the
   * `tool_result` payload(s) this burst dumped back, summed across its `count`
   * calls (FX003). A privacy-safe number by construction — the size of what a
   * call returned, which lands as the *next* turn's input; the report's command
   * lens uses it to byte-weight the input-split (a 200k-dumping `cat` vs a 3-line
   * `git status`). Absent when the source has no per-tool payload (e.g.
   * copilot-vscode, turns-only) — an honest omission, never a fabricated 0.
   */
  result_tokens?: number;
}

/** A skill span with an inferred lifecycle status (§4.3). */
export interface SkillEvent extends EventBase {
  kind: 'skill';
  name: string;
  status: SkillStatus;
  dur_s?: number;
  /**
   * A skill invocation's LEADING PURE-DIGIT positional (FX001, Facet B) — e.g.
   * `/the-flow 08` → `08`. Captured ONLY when the first whitespace-delimited
   * token after the skill name matches `^\d+$`; a non-digit or quoted first token
   * (`the-flow specify`, `"x"`) and any later token are NEVER stored (P12/AC-15).
   * A bare integer is a fixed-shape, non-sensitive stage/step number. Orthogonal
   * to flow-stage mapping (stages come from `the-flow.json` nav — {@link FlowEvent}).
   */
  arg?: string;
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

/**
 * A counts-only semantic snapshot of a flow/SDD artifact (plan 050), emitted
 * from the capture window when the artifact is in `files.written/edited`. Files
 * change over time; each change re-emits an updated snapshot → a semantic time
 * series per artifact, at ZERO agent burden.
 *
 * PRIVACY (AC-05, Constitution P12): the payload is `counts` (integers) + `enums`
 * (fixed-vocabulary tokens with an `other` fallback — the EXTRACTOR is the value
 * allowlist gate, same posture as `checks.gates`) + a repo-relative `path` + a
 * `size`. There is NO free-text field by construction; finding/fix/decision prose
 * can never travel. A `t` stamped at CAPTURE TIME (the "save time"), so — like
 * {@link FlowLogEvent} — it is EXCLUDED from {@link Rollup} gap/wall/stage math.
 */
export interface ArtifactEvent extends EventBase {
  kind: 'artifact';
  /** Repo-relative path of the artifact (out-of-repo paths are skipped, never emitted). */
  path: string;
  artifact_type: ArtifactType;
  /** The `docs/plans/<id>/` this artifact belongs to; omitted when the path carries none. */
  plan_id?: string;
  /** Which capture set the path came from. */
  change: 'written' | 'edited';
  /** Numeric elements (fixes, phases, gate rows, …). Keys are the CLOSED {@link ArtifactCountKey} set; zero-valued keys are omitted. */
  counts: Partial<Record<ArtifactCountKey, number>>;
  /** Fixed-vocabulary verdicts/statuses/modes; keys are the CLOSED {@link ArtifactEnumKey} set, values gated by the extractor. */
  enums: Partial<Record<ArtifactEnumKey, string>>;
  /** Artifact bulk — lines + UTF-8 bytes (the "workshop length" / "research length" measure). */
  size: { lines: number; bytes: number };
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
  | ApiErrorEvent
  | ArtifactEvent;

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
