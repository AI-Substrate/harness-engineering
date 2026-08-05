import {
  isWithin,
  posixJoin,
  posixNormalize,
  posixRelative,
  toPosix,
} from '../shared/posix-path.js';
import { CONTROL_SIGNATURES } from './command-signature.js';
import type { Event, Rollup, TPrecision, UsageEvent } from './events.js';
import { computeRollup } from './rollup.js';
import { normalizeUsageObservation, type UsageObservation } from './usage-observation.js';

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
 * v2.1: `harness_version` (the producing CLI version → OTLP `service.version`).
 * v2.2: `captured_env` (an allowlisted, secret-denylisted env-var snapshot).
 * v2.3 (plan 053): adds the `mark` event kind (a peer's counts-only
 * self-attestation) to the `event_stream` union — no new top-level segment field.
 * v2.4 (plan 056): adds the `file` event kind (per-file path + change-delta from
 * tool payloads) to the `event_stream` union — no new top-level segment field.
 * v2.5 (plan 060): adds optional product_commit (the product HEAD observed for
 * this activity window); old 2.4 records remain readable.
 * v2.6 (plan 069): adds the closed typed `usage` event kind to the stream union.
 * v2.7 (plan 070): adds optional {@link Segment.capture_mode} — the field that
 * lets a LATE, reconciled segment declare itself instead of being wire-identical
 * to an in-session capture. It is additive and optional, so every 2.4–2.6 record
 * stays readable; the version moves because the field SET moved, which is the
 * point: a consumer that has never heard of reconciliation sees a version it does
 * not know rather than a late segment it silently reads as live.
 */
export const SEGMENT_SCHEMA_VERSION = '2.7';

/** Exact Segment-2.6 pij environment vocabulary. The producer never glob-captures `PIJ_*`. */
export const CURRENT_CAPTURED_ENV_KEYS = [
  'PIJ_SESSION_ID',
  'PIJ_PARENT_ID',
  'PIJ_HARNESS',
  'PIJ_ROLE',
  'PIJ_ANNOUNCE_TO',
  'PIJ_SPAWN_ID',
  'PIJ_SPAWN_MODEL',
  'PIJ_SPAWN_EFFORT',
] as const;

/** Finite Segment-2.4 compatibility union; it does not widen the current producer. */
export const LEGACY_CAPTURED_ENV_KEYS = [
  ...CURRENT_CAPTURED_ENV_KEYS,
  'PIJ_ID',
  'PIJ_STATUS_KEY',
  'PIJ_PANE_ID',
] as const;

export const PIJ_EFFORT_VALUES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export const PIJ_HARNESS_VALUES = [
  'pi',
  'pij',
  'claude',
  'claude-code',
  'copilot',
  'copilot-cli',
  'copilot-vscode',
  'cursor',
  'cursor-agent',
  'minih',
] as const;
export const PIJ_ROLE_VALUES = [
  'coder',
  'reviewer',
  'orchestrator',
  'worker',
  'parent',
  'child',
  'planner',
  'researcher',
  'validator',
  'implementer',
  'lead',
  'peer',
  'context-owner',
] as const;

const PIJ_CURRENT_ID_VALUE = /^pij-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PIJ_SPAWN_ID_VALUE = /^spawn-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PIJ_STATUS_VALUE = /^status\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PIJ_PANE_VALUE = /^%[0-9]{1,10}$/;
const TELEMETRY_ATOM = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;
const TELEMETRY_COMMAND = /^[a-z][a-z0-9]*(?:[ -][a-z0-9][a-z0-9-]*){0,3}$/;
const TELEMETRY_SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const TELEMETRY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TELEMETRY_ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const TELEMETRY_RELATIVE_PATH =
  /^(?![A-Za-z]:[\\/])(?![\\/])(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+<>-]+(?:\/[A-Za-z0-9._@+<>-]+)*$/;

/** Shared defense-in-depth detector for every string admitted to published telemetry. */
export function isCredentialShaped(value: string): boolean {
  return [
    /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i,
    /(?:password|passwd|passphrase|credential|secret|token|api[_-]?key|access[_-]?key|session[_-]?token)\s*[:=]\s*\S+/i,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
    /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/,
    /\b(?:sk-(?:proj-)?|xox[baprs]-|glpat-|npm_|pypi-)[A-Za-z0-9_-]{20,}\b/i,
    /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/i,
    /\bAIza[A-Za-z0-9_-]{20,}\b/,
    /\bya29\.[A-Za-z0-9_-]{20,}\b/i,
    /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ].some((pattern) => pattern.test(value));
}

function isLowEntropyAtom(value: string, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength || !TELEMETRY_ATOM.test(value)) return false;
  return /[._:@+-]/.test(value) || value.length <= 32;
}

/** Conservative extension-value grammar: low-entropy identifier or confined relative path. */
export function isTelemetryExtensionString(value: string): boolean {
  if (isCredentialShaped(value) || value.length > 256) return false;
  if (!value.includes('/')) return isLowEntropyAtom(value, 64);
  return (
    TELEMETRY_RELATIVE_PATH.test(value) &&
    value.split('/').every((part) => isLowEntropyAtom(part, 64))
  );
}

export function isTelemetryHarness(value: string): boolean {
  return (
    !isCredentialShaped(value) &&
    ((PIJ_HARNESS_VALUES as readonly string[]).includes(value) ||
      value === 'codex' ||
      value === 'future-harness' ||
      /^acme-harness-[1-9]\d{0,7}$/.test(value))
  );
}

export function isTelemetryCommand(value: string): boolean {
  return (
    !isCredentialShaped(value) &&
    value.length <= 64 &&
    TELEMETRY_COMMAND.test(value) &&
    value.split(' ').every((part) => isLowEntropyAtom(part, 32))
  );
}

export function isTelemetryServiceVersion(value: string): boolean {
  return (
    !isCredentialShaped(value) &&
    (value === 'unknown' ||
      value === 'test' ||
      value === 'fixture' ||
      /^fixture-[a-z0-9][a-z0-9-]{0,31}$/.test(value) ||
      TELEMETRY_SEMVER.test(value))
  );
}

export function isTelemetrySessionId(value: string): boolean {
  return (
    value === '' ||
    (!isCredentialShaped(value) && (TELEMETRY_UUID.test(value) || isLowEntropyAtom(value, 128)))
  );
}

export function isTelemetryModel(value: string): boolean {
  if (isCredentialShaped(value) || value.length > 192) return false;
  const [model, effort, extra] = value.split(':');
  if (
    extra !== undefined ||
    (effort !== undefined && !(PIJ_EFFORT_VALUES as readonly string[]).includes(effort))
  ) {
    return false;
  }
  const parts = model.split('/');
  return parts.length <= 2 && parts.every((part) => isLowEntropyAtom(part, 96));
}

export function isTelemetrySignature(value: string): boolean {
  return (
    !isCredentialShaped(value) &&
    value.length <= 128 &&
    value.split(' ').length <= 4 &&
    value.split(' ').every((part) => isLowEntropyAtom(part, 48))
  );
}

export function isTelemetryRelativePath(value: string): boolean {
  return !isCredentialShaped(value) && value.length <= 1024 && TELEMETRY_RELATIVE_PATH.test(value);
}

export function isTelemetryTime(value: string): boolean {
  if (!TELEMETRY_ISO_TIME.test(value)) return false;
  const parsed = new Date(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === canonical;
}

/** Version-aware key and value grammar shared by capture, serializer, OTLP and strict reads. */
export function isCapturedEnvEntry(
  name: string,
  value: string,
  version: '2.4' | '2.5' | '2.6' | '2.7',
): boolean {
  const allowed =
    version === '2.4'
      ? (LEGACY_CAPTURED_ENV_KEYS as readonly string[])
      : (CURRENT_CAPTURED_ENV_KEYS as readonly string[]);
  if (!allowed.includes(name) || isCredentialShaped(value)) return false;
  switch (name) {
    case 'PIJ_SESSION_ID':
    case 'PIJ_PARENT_ID':
    case 'PIJ_ANNOUNCE_TO':
    case 'PIJ_ID':
      return PIJ_CURRENT_ID_VALUE.test(value);
    case 'PIJ_HARNESS':
      return (PIJ_HARNESS_VALUES as readonly string[]).includes(value);
    case 'PIJ_ROLE':
      return (PIJ_ROLE_VALUES as readonly string[]).includes(value);
    case 'PIJ_SPAWN_ID':
      return PIJ_SPAWN_ID_VALUE.test(value);
    case 'PIJ_SPAWN_MODEL':
      return value.includes('/') && isTelemetryModel(value);
    case 'PIJ_SPAWN_EFFORT':
      return (PIJ_EFFORT_VALUES as readonly string[]).includes(value);
    case 'PIJ_STATUS_KEY':
      return PIJ_STATUS_VALUE.test(value);
    case 'PIJ_PANE_ID':
      return PIJ_PANE_VALUE.test(value);
    default:
      return false;
  }
}

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
  /**
   * WHY `tokens` is null, when the harness could say precisely — a closed adapter
   * reason (finding 07). OMITTED when tokens resolved or the harness cannot say.
   * Diagnostic only: it never contributes a count.
   */
  token_unavailable_reason?: string;
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
  /**
   * v2.2 — an allowlisted snapshot of selected env vars at capture time
   * (name → value). Counts-only is relaxed HERE by design: the allowlist is a
   * narrow code constant and secret-shaped names are denylisted at capture, so a
   * value is never free-form prompt/content. Omitted when nothing matched.
   */
  captured_env?: Record<string, string>;
  /** v2.5 — lowercase full product Git OID observed during this activity window. */
  product_commit?: string;
  /**
   * v2.7 — HOW this segment was produced. OMITTED for the normal in-session
   * capture (the overwhelming majority), so every pre-2.7 record and every live
   * capture is byte-identical to before.
   *
   * `reconciled` marks a LATE segment: the window was recovered from an ORPHANED
   * lane by {@link ../capture-reconcile}, after the session that did the work had
   * already stopped running harness commands. It is the difference between "an
   * agent ran this command and we watched" and "nobody was watching, and we went
   * back for the evidence afterwards" — a distinction that must survive to every
   * consumer, because a reconciled segment's `timecode` is the RECOVERY time, its
   * event instants are interval-grade, and no live process ever observed it.
   *
   * A reconciled segment NEVER masquerades: it also carries the reserved
   * `telemetry reconcile` command, and every event it contributes is stamped
   * `t_precision: 'interval'` so it can never accrue active time it did not
   * measure.
   */
  capture_mode?: 'reconciled';
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
  'captured_env',
  'product_commit',
  'capture_mode',
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
  /** The adapter's closed reason for absent tokens (finding 07); omitted when none. */
  token_unavailable_reason?: string | null;
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
  /** v2.2 — allowlisted env snapshot (already glob-selected + denylist-filtered by the caller). */
  captured_env?: Record<string, string>;
  /** v2.0 — the ordered event stream an adapter emits; serialized via the per-kind allowlist. */
  event_stream?: readonly Event[];
  /** v2.5 — optional product HEAD; invalid values are omitted, never echoed. */
  product_commit?: string | null;
  /**
   * v2.7 — set to `reconciled` ONLY by the orphan-lane reconciler. Any other value
   * (including `live`) is dropped by the serializer, so the field cannot be used to
   * assert liveness — its ABSENCE is what means live, and absence cannot be forged.
   */
  capture_mode?: string | null;
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

/** The literal path a `file` event carries for an out-of-repo write (D2, plan 056). */
export const FILE_EXTERNAL = '<external>';

/**
 * Confine a `file` event's path (plan 056 · D2). Repo-relative form when inside
 * the repo (absolute OR relative resolved against `repoRoot` first); the literal
 * {@link FILE_EXTERNAL} sentinel when OUTSIDE — the out-of-repo directory (and its
 * basename) is NEVER leaked. Deliberately NOT {@link relativizePath}, which drops
 * an out-of-repo path to its basename and would leak the filename (finding 04).
 */
function confineFilePath(raw: string, repoRoot: string): string {
  const root = posixNormalize(toPosix(repoRoot));
  const p = toPosix(raw);
  const abs = ABSOLUTE_LOGICAL.test(p) ? posixNormalize(p) : posixNormalize(posixJoin(root, p));
  if (isWithin(root, abs)) {
    const rel = posixRelative(root, abs);
    return rel === '' ? '.' : rel;
  }
  return FILE_EXTERNAL;
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
 * Rebuild a `tools` event's control-signature counts from the CLOSED allowlist
 * (plan 069). Only keys in {@link CONTROL_SIGNATURES} with a positive integer count
 * survive, so an unknown/free-form key or a garbage count can never reach the wire
 * — the same allowlist-by-construction posture as the `artifact` counts. Returns
 * `undefined` when nothing survives (honest omission, never `{}`).
 */
function serializeControl(v: unknown): Record<string, number> | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!CONTROL_SIGNATURES.has(k)) continue;
    const n = num(raw);
    if (n !== undefined && Number.isInteger(n) && n > 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Serialize ONE event into its allowlisted shape (AC-15). ALLOWLIST BY
 * CONSTRUCTION: each kind picks exactly its contract fields — the input is never
 * spread — so a planted secret / raw arg in a non-allowlisted field on any event
 * cannot reach the output. An unrecognized kind degrades to its `{ t, kind }`
 * skeleton rather than passing fields through.
 */
export function serializeEvent(e: Event, repoRoot?: string): Event {
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
    case 'usage': {
      const candidate: UsageObservation = {
        t: e.t,
        observation_kind: e.observation_kind,
      };
      if (e.in !== undefined) candidate.input = e.in;
      if (e.out !== undefined) candidate.output = e.out;
      if (e.cache_read !== undefined) candidate.cache_read = e.cache_read;
      if (e.cache_create !== undefined) candidate.cache_create = e.cache_create;
      if (e.nano_aiu !== undefined) candidate.nano_aiu = e.nano_aiu;
      const observation = normalizeUsageObservation(candidate);
      if (observation === null) throw new Error('invalid usage observation');
      const ev: UsageEvent = {
        ...base,
        kind: 'usage',
        observation_kind: observation.observation_kind,
      };
      if (observation.input !== undefined) ev.in = observation.input;
      if (observation.output !== undefined) ev.out = observation.output;
      if (observation.cache_read !== undefined) ev.cache_read = observation.cache_read;
      if (observation.cache_create !== undefined) ev.cache_create = observation.cache_create;
      if (observation.nano_aiu !== undefined) ev.nano_aiu = observation.nano_aiu;
      return ev;
    }
    case 'tools': {
      const ev: Event = { ...base, kind: 'tools', name: e.name, count: e.count, span_s: e.span_s };
      if (typeof e.signature === 'string') ev.signature = e.signature;
      // plan 069: REBUILD the control map from the closed allowlist (never spread
      // the input) — an unknown key or a non-finite count can never survive.
      const control = serializeControl(e.control);
      if (control !== undefined) ev.control = control;
      if (typeof e.result_tokens === 'number') ev.result_tokens = e.result_tokens;
      return ev;
    }
    case 'skill': {
      const ev: Event = { ...base, kind: 'skill', name: e.name, status: e.status };
      const d = num(e.dur_s);
      if (d !== undefined) ev.dur_s = d;
      if (typeof e.arg === 'string') ev.arg = e.arg;
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
    case 'harness': {
      const ev: Event = { ...base, kind: 'harness', verb: e.verb };
      // observe_kind rides ONLY on the `observe` verb (plan 056); a fixed-enum
      // token, picked explicitly (never spread) so no free-form field can leak.
      // Gated on the verb at the boundary: a stray observe_kind on any other
      // verb is dropped, not serialized.
      if (e.verb === 'observe' && typeof e.observe_kind === 'string') {
        ev.observe_kind = e.observe_kind;
      }
      return ev;
    }
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
      // Re-validated on the way THROUGH, not merely at capture: this layer
      // rebuilds every field explicitly rather than spreading, and a fixed
      // vocabulary that is only checked once is a fixed vocabulary until the
      // next writer.
      if (typeof e.code === 'string' && /^E\d{3}$/.test(e.code)) ev.code = e.code;
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
    case 'artifact': {
      // ALLOWLIST: pick each field explicitly and REBUILD the counts/enums maps
      // (never spread the input) — the extractor already gated the enum VALUES to
      // a fixed vocabulary (`other` fallback), so no free-form artifact text can
      // reach the output (AC-05). Zero/non-finite counts are dropped so a garbage
      // artifact serializes with `{}` counts (AC-04).
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(e.counts)) {
        const n = num(v);
        if (n !== undefined) counts[k] = n;
      }
      const enums: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.enums)) enums[k] = String(v);
      const ev: Event = {
        ...base,
        kind: 'artifact',
        path: e.path,
        artifact_type: e.artifact_type,
        change: e.change,
        counts,
        enums,
        size: { lines: e.size.lines, bytes: e.size.bytes },
      };
      if (typeof e.plan_id === 'string' && e.plan_id.length > 0) ev.plan_id = e.plan_id;
      return ev;
    }
    case 'file': {
      // ALLOWLIST (plan 056): pick the path + change enum + REBUILD the delta map
      // (never spread) — the payload text was measured in the adapter and never
      // travels; the path is CONFINED here (repo-relative else `<external>`) so an
      // out-of-repo write leaks nothing (AC-03/AC-04). Without repoRoot the path
      // defaults to `<external>` (never a raw path — Fix 2 hardening). Non-finite
      // delta values degrade to 0 (a garbage delta serializes clean).
      const d = e.delta;
      const ev: Event = {
        ...base,
        kind: 'file',
        path: repoRoot !== undefined ? confineFilePath(e.path, repoRoot) : FILE_EXTERNAL,
        change: e.change,
        delta: {
          lines_added: num(d.lines_added) ?? 0,
          lines_removed: num(d.lines_removed) ?? 0,
          bytes_added: num(d.bytes_added) ?? 0,
          bytes_removed: num(d.bytes_removed) ?? 0,
        },
      };
      return ev;
    }
    case 'mark': {
      // ALLOWLIST (plan 053): pick the two shape-guarded slugs + REBUILD the counts
      // map (never spread) — `buildMarkEvent` already gated `mark_kind`/`verdict` to
      // the slug shape and the counts to non-negative integers, so no free text can
      // reach the output (AC-05). Zero/non-finite counts are dropped (artifact parity).
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(e.counts)) {
        const n = num(v);
        if (n !== undefined) counts[k] = n;
      }
      const ev: Event = { ...base, kind: 'mark', mark_kind: e.mark_kind, counts };
      if (typeof e.verdict === 'string') ev.verdict = e.verdict;
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
 * Every schema version this decoder has structural rules for, OLDEST FIRST. This is
 * the DECLARED closed set (the FX003 · R2 lesson: a closed vocabulary must be stated,
 * not accumulated by accident) and it is what makes `below_pin` distinguishable from
 * `unsupported_version` — without it, "a version I do not know" and "a version I know
 * and will not read" would be the same answer again, one layer up.
 *
 * Exported so the pin policy can be asserted against it rather than against a
 * hand-copied literal: a second list of versions would be a second source of truth.
 */
export const KNOWN_SCHEMA_VERSIONS: readonly string[] = [
  '1.1',
  '2.0',
  '2.1',
  '2.2',
  '2.3',
  '2.4',
  '2.5',
  '2.6',
  '2.7',
];

/**
 * The READ pin — the OLDEST `schema_version` this build will read, DERIVED from the
 * floor of {@link KNOWN_SCHEMA_VERSIONS} rather than written as a literal.
 *
 * It is deliberately a separate constant from {@link SEGMENT_SCHEMA_VERSION}: that one
 * says what we WRITE, this one says what we will READ, and collapsing them hides the
 * moment they differ.
 *
 * THE POLICY IS PERMISSIVE, AND THAT IS THE RULING (Jordan, reversing an earlier 2.7).
 * The pin was originally set high; no recorded rationale for reading narrowly was ever
 * found — the debate had only ever been about WHICH number, never about what pinning
 * BUYS. Set against nothing: 68 of 116 published sessions (59%, ~19.5k documents)
 * default-refused, a collision with the permanently-frozen Segment-2.4 capture corpus,
 * and a knowingly-widened divergence against the second reader. So the pin sits at the
 * floor and production refuses nothing it could have read.
 *
 * THE DIAL IS THE VALUABLE PART, NOT THE VALUE. Everything the pin work built stands:
 * the reason channel (`below_pin` / `unsupported_version` / `malformed` instead of a
 * bare `null`), a total decoder with no `catch → null`, the audited caller set, and
 * per-reason tallies. A pin at the floor means `below_pin` is unreachable in
 * PRODUCTION — it is NOT dead: the machinery can still name a below-pin refusal the
 * moment anyone raises the pin, and it is exercised through the knob to prove it.
 */
export const SEGMENT_SCHEMA_PIN: string = KNOWN_SCHEMA_VERSIONS[0] as string;

/**
 * WHY a record was not read. Three DIFFERENT facts that were one bare `null` before
 * this packet — and the reason they must never share a counter:
 *
 * - `below_pin` — a record at a version this build KNOWS and structurally could read,
 *   refused because the pin says read nothing older than {@link SEGMENT_SCHEMA_PIN}.
 *   The data is fine; the policy declined it. Recoverable by moving the pin. With the
 *   pin at the floor this is UNREACHABLE IN PRODUCTION and reachable only through the
 *   knob — kept, and kept exercised, so the machinery can name the refusal the day
 *   anyone raises the pin. A counter that stops firing is the vacuity, not the fix.
 * - `unsupported_version` — a version string outside the declared set above. NOT
 *   `below_pin`: a 2.8 record is ABOVE the pin, and calling it "below" would be this
 *   packet's own defect (a lookup reporting an absence it had not established).
 *   Garbage version strings land here too — both share "I have no rules for this".
 * - `malformed` — the record IS at the pin and failed structural validation, or it
 *   carried no readable version at all. The data is broken.
 *
 * A caller that folds these back together has undone the fix.
 */
export type SegmentRefusalReason = 'below_pin' | 'unsupported_version' | 'malformed';

/** A refused decode, carrying WHY plus the version it declared (null when unreadable). */
export interface SegmentDecodeRefused {
  ok: false;
  reason: SegmentRefusalReason;
  /** The record's declared `schema_version` when it had a string one, else `null`. */
  schema_version: string | null;
}

/** A decode that either yields a Segment or NAMES its refusal — never a bare `null`. */
export type SegmentDecodeResult = { ok: true; segment: Segment } | SegmentDecodeRefused;

/**
 * Refusal helper — one construction site, so no branch can invent a shape.
 */
function refuse(reason: SegmentRefusalReason, schemaVersion: string | null): SegmentDecodeRefused {
  return { ok: false, reason, schema_version: schemaVersion };
}

/**
 * The READ POLICY for one decode. Production NEVER passes this — it reads
 * {@link SEGMENT_SCHEMA_PIN}, which sits at the floor of the declared version set, so
 * production refuses nothing it could have read.
 *
 * THE KNOB'S HAZARD INVERTED WHEN THE PIN MOVED TO THE FLOOR, and the guard moved with
 * it. While the pin was high, the risk was a production caller quietly making the build
 * MORE PERMISSIVE than the stated policy. At the floor there is no permissiveness left
 * to steal; the live risk is the exact opposite — a production caller passing a HIGHER
 * pin and silently making the build STRICTER, refusing data the stated policy says we
 * read, with nothing in the output to say who decided that.
 *
 * The knob is kept for one reason and it is a real one: at the floor, `below_pin` is
 * unreachable in production, so this is the ONLY way to prove the reason channel can
 * still name a below-pin refusal — at the decoder AND out through a real caller's
 * envelope. Deleting it would leave `below_pin` a decoder-only artifact with its
 * surfacing untested, which is the vacuity this packet exists to kill.
 *
 * The mitigation is load-bearing and lives in
 * `test/services/telemetry/pin-knob-src-usage.test.ts`: it enumerates every `src/` site
 * that supplies a pin, holds them against a declared allowlist, and asserts none of
 * them ORIGINATES a value — so no production path can raise the effective pin.
 */
export interface SegmentDecodeOptions {
  /**
   * The OLDEST schema version to read; anything below it resolves `below_pin`.
   * A FLOOR, not an equality — which is what makes `below_pin` the honest name, and
   * what lets the default sit at the floor of the known set and refuse nothing.
   * Defaults to {@link SEGMENT_SCHEMA_PIN}.
   */
  pin?: string;
}

/**
 * Fail-closed decoder for loose on-disk Segment JSON, REPORTING why it refused.
 *
 * This is the reason-bearing form ({@link decodeSegment} is the narrowing wrapper).
 * It is total: every path returns an `ok` or a NAMED refusal, and it contains no
 * `catch → null`, because a reason channel that collapses on its own failure has
 * re-created the silence it replaced (packet ruling #1.2).
 */
export function decodeSegmentDetailed(
  value: unknown,
  options: SegmentDecodeOptions = {},
): SegmentDecodeResult {
  const pin = options.pin ?? SEGMENT_SCHEMA_PIN;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return refuse('malformed', null);
  const raw = value as Record<string, unknown>;
  if (typeof raw.schema_version !== 'string') return refuse('malformed', null);
  const declared = raw.schema_version;
  const declaredRank = KNOWN_SCHEMA_VERSIONS.indexOf(declared);
  // A version outside the DECLARED set is not "below" anything — a 2.8 record is ABOVE
  // the pin, and calling it below_pin would assert a relation this build cannot
  // establish. Garbage version strings land here too: both mean "I have no rules".
  if (declaredRank === -1) return refuse('unsupported_version', declared);
  const pinRank = KNOWN_SCHEMA_VERSIONS.indexOf(pin);
  // The pin, applied BEFORE structural validation: "record at 2.6, below the 2.7 pin,
  // not read" is a statement about the version alone, and re-validating a record we
  // have already declined would only let a structural failure relabel it `malformed`.
  if (declaredRank < pinRank) return refuse('below_pin', declared);
  const decoded = decodePinnedSegment(raw);
  return decoded === null ? refuse('malformed', declared) : { ok: true, segment: decoded };
}

/**
 * Narrowing wrapper kept for call sites that genuinely have nothing to say about a
 * refusal. Every caller in this repo is enumerated in the packet log; a NEW caller
 * should reach for {@link decodeSegmentDetailed} and only fall back here with a reason.
 */
export function decodeSegment(value: unknown, options: SegmentDecodeOptions = {}): Segment | null {
  const result = decodeSegmentDetailed(value, options);
  return result.ok ? result.segment : null;
}

/**
 * Structural validation for a record at or above the pin.
 *
 * The pre-2.7 branches below (`legacyVersion` 1.1, `intermediateVersion` 2.0–2.3, and
 * the 2.4/2.5/2.6 arms of `currentVersion`) are REACHED IN PRODUCTION now that the pin
 * sits at the floor — they are the read path for the four frozen real captures and for
 * 59% of published sessions, not conditionally-revivable legacy.
 */
function decodePinnedSegment(raw: Record<string, unknown>): Segment | null {
  const currentVersion =
    raw.schema_version === '2.4' ||
    raw.schema_version === '2.5' ||
    raw.schema_version === '2.6' ||
    raw.schema_version === '2.7';
  const intermediateVersion =
    raw.schema_version === '2.0' ||
    raw.schema_version === '2.1' ||
    raw.schema_version === '2.2' ||
    raw.schema_version === '2.3';
  const legacyVersion = raw.schema_version === '1.1';
  if (!currentVersion && !intermediateVersion && !legacyVersion) return null;
  if (legacyVersion) {
    const allowed = new Set([
      'schema_version',
      'command',
      'harness',
      'harness_session_id',
      'timecode',
      'window',
      'branch',
      'tokens',
      'skills',
      'tools',
      'harness_commands',
      'models',
    ]);
    if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
    if (
      typeof raw.command !== 'string' ||
      !isTelemetryCommand(raw.command) ||
      typeof raw.harness !== 'string' ||
      !isTelemetryHarness(raw.harness) ||
      typeof raw.harness_session_id !== 'string' ||
      !isTelemetrySessionId(raw.harness_session_id) ||
      typeof raw.timecode !== 'string' ||
      !isTelemetryTime(raw.timecode) ||
      (raw.branch !== null &&
        (typeof raw.branch !== 'string' || !isTelemetryRelativePath(raw.branch))) ||
      raw.window === null ||
      typeof raw.window !== 'object' ||
      Array.isArray(raw.window)
    ) {
      return null;
    }
    const window = raw.window as Record<string, unknown>;
    if (
      typeof window.since !== 'string' ||
      !isTelemetryExtensionString(window.since) ||
      !Number.isSafeInteger(window.from) ||
      (window.from as number) < 0 ||
      !Number.isSafeInteger(window.to) ||
      (window.to as number) < (window.from as number)
    ) {
      return null;
    }
    for (const field of ['skills', 'tools', 'harness_commands'] as const) {
      const counts = raw[field];
      if (counts === undefined) continue;
      if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null;
      for (const [key, count] of Object.entries(counts)) {
        if (
          !isTelemetryExtensionString(key) ||
          !Number.isSafeInteger(count) ||
          (count as number) < 0
        ) {
          return null;
        }
      }
    }
    if (raw.models !== undefined) {
      if (raw.models === null || typeof raw.models !== 'object' || Array.isArray(raw.models)) {
        return null;
      }
      for (const [model, stat] of Object.entries(raw.models)) {
        if (
          !isTelemetryModel(model) ||
          stat === null ||
          typeof stat !== 'object' ||
          Array.isArray(stat)
        ) {
          return null;
        }
        const values = stat as Record<string, unknown>;
        if (
          !Number.isSafeInteger(values.turns) ||
          (values.turns as number) < 0 ||
          !Number.isSafeInteger(values.output_tokens) ||
          (values.output_tokens as number) < 0
        ) {
          return null;
        }
      }
    }
  }
  if (intermediateVersion) {
    const allowed = new Set([
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
      'captured_env',
    ]);
    if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
    if (
      typeof raw.command !== 'string' ||
      !isTelemetryCommand(raw.command) ||
      typeof raw.harness !== 'string' ||
      !isTelemetryExtensionString(raw.harness) ||
      (raw.harness_version !== undefined &&
        (typeof raw.harness_version !== 'string' ||
          !isTelemetryServiceVersion(raw.harness_version))) ||
      (raw.schema_version !== '2.0' && raw.harness_version === undefined) ||
      typeof raw.harness_session_id !== 'string' ||
      !isTelemetrySessionId(raw.harness_session_id) ||
      typeof raw.timecode !== 'string' ||
      !isTelemetryTime(raw.timecode) ||
      (raw.branch !== null &&
        (typeof raw.branch !== 'string' || !isTelemetryRelativePath(raw.branch))) ||
      (raw.effort !== undefined &&
        raw.effort !== null &&
        (typeof raw.effort !== 'string' || !isTelemetryExtensionString(raw.effort))) ||
      !Array.isArray(raw.event_stream)
    ) {
      return null;
    }
    if (raw.window !== undefined) {
      if (raw.window === null || typeof raw.window !== 'object' || Array.isArray(raw.window)) {
        return null;
      }
      const window = raw.window as Record<string, unknown>;
      if (
        typeof window.since !== 'string' ||
        !isTelemetryExtensionString(window.since) ||
        !Number.isSafeInteger(window.from) ||
        (window.from as number) < 0 ||
        !Number.isSafeInteger(window.to) ||
        (window.to as number) < (window.from as number)
      ) {
        return null;
      }
    }
    for (const field of ['skills', 'tools'] as const) {
      const counts = raw[field];
      if (counts === undefined) continue;
      if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null;
      for (const [key, count] of Object.entries(counts)) {
        if (
          !isTelemetryExtensionString(key) ||
          !Number.isSafeInteger(count) ||
          (count as number) < 0
        ) {
          return null;
        }
      }
    }
    if (
      raw.user_prompts !== undefined &&
      (!Array.isArray(raw.user_prompts) ||
        raw.user_prompts.some((count) => !Number.isSafeInteger(count) || count < 0))
    ) {
      return null;
    }
    if (raw.captured_env !== undefined) {
      if (
        raw.captured_env === null ||
        typeof raw.captured_env !== 'object' ||
        Array.isArray(raw.captured_env)
      ) {
        return null;
      }
      for (const [key, entry] of Object.entries(raw.captured_env)) {
        if (typeof entry !== 'string' || !isCapturedEnvEntry(key, entry, '2.5')) return null;
      }
    }
    if (raw.models !== undefined) {
      if (raw.models === null || typeof raw.models !== 'object' || Array.isArray(raw.models)) {
        return null;
      }
      for (const [model, stat] of Object.entries(raw.models)) {
        if (
          !isTelemetryModel(model) ||
          stat === null ||
          typeof stat !== 'object' ||
          Array.isArray(stat)
        ) {
          return null;
        }
        const values = stat as Record<string, unknown>;
        if (
          !Number.isSafeInteger(values.turns) ||
          (values.turns as number) < 0 ||
          !Number.isSafeInteger(values.output_tokens) ||
          (values.output_tokens as number) < 0
        ) {
          return null;
        }
      }
    }
  }
  if (currentVersion) {
    const allowed = new Set<string>(SEGMENT_FIELD_KEYS);
    if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
    if (SEGMENT_REQUIRED_KEYS.some((key) => !(key in raw))) return null;
    if (
      typeof raw.command !== 'string' ||
      !isTelemetryCommand(raw.command) ||
      typeof raw.harness !== 'string' ||
      !isTelemetryHarness(raw.harness) ||
      typeof raw.harness_version !== 'string' ||
      !isTelemetryServiceVersion(raw.harness_version) ||
      typeof raw.harness_session_id !== 'string' ||
      !isTelemetrySessionId(raw.harness_session_id) ||
      typeof raw.timecode !== 'string' ||
      !isTelemetryTime(raw.timecode) ||
      (raw.branch !== null &&
        (typeof raw.branch !== 'string' || !isTelemetryRelativePath(raw.branch))) ||
      (raw.effort !== null &&
        (typeof raw.effort !== 'string' || !isTelemetryExtensionString(raw.effort)))
    ) {
      return null;
    }
    if (raw.window === null || typeof raw.window !== 'object' || Array.isArray(raw.window)) {
      return null;
    }
    const window = raw.window as Record<string, unknown>;
    if (
      typeof window.since !== 'string' ||
      !isTelemetryExtensionString(window.since) ||
      !Number.isSafeInteger(window.from) ||
      (window.from as number) < 0 ||
      !Number.isSafeInteger(window.to) ||
      (window.to as number) < (window.from as number)
    ) {
      return null;
    }
    if (raw.captured_env !== undefined) {
      if (
        raw.captured_env === null ||
        typeof raw.captured_env !== 'object' ||
        Array.isArray(raw.captured_env)
      ) {
        return null;
      }
      for (const [key, entry] of Object.entries(raw.captured_env)) {
        if (
          typeof entry !== 'string' ||
          !isCapturedEnvEntry(key, entry, raw.schema_version as '2.4' | '2.5' | '2.6' | '2.7')
        ) {
          return null;
        }
      }
    }
    if (
      raw.product_commit !== undefined &&
      (raw.schema_version === '2.4' ||
        typeof raw.product_commit !== 'string' ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(raw.product_commit))
    ) {
      return null;
    }
    // v2.7 — a reconciled marker on a pre-2.7 record is a forgery (the field did
    // not exist), and `reconciled` is the only value the vocabulary has.
    if (
      raw.capture_mode !== undefined &&
      (raw.schema_version !== '2.7' || raw.capture_mode !== 'reconciled')
    ) {
      return null;
    }
    if (raw.models !== undefined) {
      if (raw.models === null || typeof raw.models !== 'object' || Array.isArray(raw.models)) {
        return null;
      }
      for (const [model, stat] of Object.entries(raw.models)) {
        if (
          !isTelemetryModel(model) ||
          stat === null ||
          typeof stat !== 'object' ||
          Array.isArray(stat)
        ) {
          return null;
        }
        const values = stat as Record<string, unknown>;
        if (
          !Number.isSafeInteger(values.turns) ||
          (values.turns as number) < 0 ||
          !Number.isSafeInteger(values.output_tokens) ||
          (values.output_tokens as number) < 0
        ) {
          return null;
        }
      }
    }
  }

  let eventStream: Event[] | undefined;
  if (raw.event_stream !== undefined) {
    if (!Array.isArray(raw.event_stream)) return null;
    eventStream = [];
    for (const candidate of raw.event_stream) {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
        return null;
      const source = candidate as Record<string, unknown>;
      if (
        source.kind === 'file' &&
        (typeof source.path !== 'string' || !isTelemetryRelativePath(source.path))
      ) {
        return null;
      }
      let serialized: Event;
      try {
        serialized = serializeEvent(candidate as Event, '/');
      } catch {
        return null;
      }
      if (
        !isTelemetryTime(serialized.t) ||
        JSON.stringify(serialized) !== JSON.stringify(candidate)
      ) {
        return null;
      }
      eventStream.push(serialized);
    }
    if (
      raw.schema_version !== '2.6' &&
      raw.schema_version !== '2.7' &&
      eventStream.some((event) => event.kind === 'usage')
    ) {
      return null;
    }
  }

  if (raw.tokens !== null) {
    if (raw.tokens === undefined || typeof raw.tokens !== 'object' || Array.isArray(raw.tokens)) {
      return null;
    }
    const tokens = raw.tokens as Record<string, unknown>;
    const tokenKeys = [
      'input',
      'output',
      'cache_create',
      'cache_read',
      'total',
      'subagent_tokens',
      'grand_total',
    ] as const;
    if (
      Object.keys(tokens).length !== tokenKeys.length ||
      tokenKeys.some((key) => !Number.isSafeInteger(tokens[key]) || (tokens[key] as number) < 0)
    ) {
      return null;
    }
    const total =
      (tokens.input as number) +
      (tokens.output as number) +
      (tokens.cache_create as number) +
      (tokens.cache_read as number);
    if (
      tokens.total !== total ||
      tokens.grand_total !== total + (tokens.subagent_tokens as number)
    ) {
      return null;
    }
  }

  return {
    ...raw,
    ...(eventStream === undefined ? {} : { event_stream: eventStream }),
  } as unknown as Segment;
}

/**
 * Serialize a capture input into a clean counts-only {@link Segment}. ALLOWLIST
 * BY CONSTRUCTION: every field is picked explicitly — the input is never spread —
 * so a planted secret / raw content in a non-allowlisted field cannot reach the
 * output. File paths are relativized; `plans_touched` is deduped.
 */
export function serializeSegment(input: SegmentInput, repoRoot: string): Segment {
  const harnessVersion = input.harness_version ?? 'unknown';
  if (
    !isTelemetryCommand(input.command) ||
    !isTelemetryHarness(input.harness) ||
    !isTelemetryServiceVersion(harnessVersion) ||
    !isTelemetrySessionId(input.harness_session_id) ||
    !isTelemetryTime(input.timecode) ||
    (input.branch !== null && !isTelemetryRelativePath(input.branch))
  ) {
    throw new Error('invalid segment identity');
  }

  // v2.0: the event stream is the substrate; the rollup is DERIVED from the
  // serialized events (never taken from the caller) so it can never drift (AC-16).
  const eventStream = (input.event_stream ?? []).map((e) => serializeEvent(e, repoRoot));

  // Headline fields — always present (identity + window + tokens/effort).
  const seg = {
    schema_version: SEGMENT_SCHEMA_VERSION,
    command: input.command,
    harness: input.harness,
    // Always present (required): defaults to 'unknown' if a caller omits it, so a
    // segment is never schema-invalid; the live composition root always supplies it.
    harness_version: harnessVersion,
    harness_session_id: input.harness_session_id,
    timecode: input.timecode,
    window: {
      since: input.window.since,
      from: input.window.from,
      to: input.window.to,
    },
    branch: input.branch,
    tokens: input.tokens ?? null,
    ...(input.tokens == null &&
    typeof input.token_unavailable_reason === 'string' &&
    input.token_unavailable_reason.length > 0
      ? { token_unavailable_reason: input.token_unavailable_reason }
      : {}),
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
  // v2.5 — re-validate the exact finite current pij contract at the serializer
  // boundary. Capture is not trusted to have filtered it correctly.
  const capturedEnv = input.captured_env ?? {};
  const envKeys = Object.keys(capturedEnv)
    .filter((key) => isCapturedEnvEntry(key, capturedEnv[key], '2.5'))
    .sort();
  if (envKeys.length > 0) {
    const out: Record<string, string> = {};
    for (const key of envKeys) out[key] = capturedEnv[key];
    seg.captured_env = out;
  }
  const productCommit = input.product_commit?.toLowerCase();
  if (productCommit !== undefined && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(productCommit)) {
    seg.product_commit = productCommit;
  }
  // v2.7 — the ONE accepted value. A caller cannot stamp `live` (or anything else)
  // onto a segment: liveness is expressed by the field's ABSENCE, so the honest
  // default survives every path that forgets to set it.
  if (input.capture_mode === 'reconciled') seg.capture_mode = 'reconciled';

  // v2.0 substrate — always present (the event stream; the rollup it derives).
  seg.event_stream = eventStream;
  seg.rollup = eventStream.length > 0 ? computeRollup(eventStream) : null;
  return seg;
}
