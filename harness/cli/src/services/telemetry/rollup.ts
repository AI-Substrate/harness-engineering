/**
 * The rollup engine (plan 034 Phase 5) — the activity / gap-classification core.
 *
 * The load-bearing idea (proven by the spike in `scratch/telem/poc/`): "is the
 * agent working?" is a TIMESTAMP question, not a token question. Every inter-event
 * gap is classified by what it ENDS at — a gap that ends at a human prompt is
 * HUMAN time (≤ cap) or IDLE (> cap, walked away); every other gap is AGENT time.
 *
 * Everything here is a PURE function of an ordered {@link Event}[] — no I/O, no
 * `node:*` imports (hexagonal: this is service logic). {@link computeRollup} is
 * recomputable by any downstream consumer.
 */

import type { Event, Rollup, SkillStatus } from './events.js';
import {
  completeUsageTokens,
  reduceUsageObservations,
  type UsageObservation,
} from './usage-observation.js';

/** A gap before a prompt longer than this = the human walked away (idle), not thinking. */
export const IDLE_CAP_S = 300;

/** Same-tool inter-call gap that still counts as one burst (§4.2). */
export const BURST_N_S = 30;

export type GapKind = 'agent' | 'human' | 'idle';

export interface RollupOptions {
  /** Human-vs-idle threshold on a gap before a prompt. Default {@link IDLE_CAP_S}. */
  idleCapS?: number;
}

/**
 * Parse an RFC3339 instant to epoch SECONDS. Returns `NaN` for an unparseable
 * value; callers treat a `NaN` gap as zero (no time attributed).
 */
export function parseIso(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NaN : ms / 1000;
}

/**
 * Classify a single inter-event gap. A gap that ends at a `prompt` is human
 * thinking/typing (≤ cap) or idle (> cap); agent-side gaps are NEVER capped — a
 * long tool/research run is real work, not idle (§4.1).
 */
export function classifyGap(gapS: number, endsAtPrompt: boolean, idleCapS = IDLE_CAP_S): GapKind {
  if (endsAtPrompt) return gapS <= idleCapS ? 'human' : 'idle';
  return 'agent';
}

/** A raw, per-call tool observation an adapter feeds the burst collapser. */
export interface ToolCall {
  name: string;
  t: string;
  /**
   * The privacy-safe command signature of a shell-family call (FX001) — used to
   * KEY bursts by `(name, signature)` so `bash:rg` and `bash:git` stay distinct.
   * Absent for non-shell tools (they collapse by name as before).
   */
  signature?: string;
  /**
   * Per-signature counts of the closed-allowlist control commands this ONE call
   * ran anywhere in its (possibly chained) command line — see
   * {@link import('./command-signature.js').controlSignatures}. Also part of the
   * burst KEY (below), so a `cd … && git push` call never merges into an adjacent
   * `cd … && git add` burst and lose its instant. Absent for non-control calls.
   */
  control?: Record<string, number>;
  /**
   * The size (a token-count ESTIMATE, never payload text) of THIS call's
   * `tool_result` payload (FX003). `collapseToolBursts` sums it across the burst.
   * Absent when the source carries no per-tool payload (honest omission).
   */
  result_tokens?: number;
}

/** A collapsed tool burst (the shape of a `tools` event's payload). */
export interface ToolBurst {
  t: string;
  name: string;
  count: number;
  span_s: number;
  /** Carried from the burst's calls (a burst is a single `(name, signature)`). */
  signature?: string;
  /**
   * Σ of the burst's calls' `control` counts (plan 069) — how many `git push` /
   * `git commit` invocations this burst carried. Part of the burst key, so every
   * call in the burst shares the same shape. Absent when none did.
   */
  control?: Record<string, number>;
  /**
   * Σ of the burst's calls' `result_tokens` (FX003) — the total this signature
   * dumped back over its `count` calls. Absent when NO call in the burst carried
   * a size (honest absence — never a fabricated 0).
   */
  result_tokens?: number;
}

/**
 * Collapse a maximal run of consecutive calls of the SAME tool (AND, for a
 * shell tool, the same {@link ToolCall.signature} AND the same {@link ToolCall.control}
 * shape) whose inter-call gap is
 * `< burstNs` into one burst (§4.2). A name OR signature OR control-shape change, or
 * a gap ≥
 * `burstNs`, starts a new burst — so a burst is always one `(name, signature,
 * control)` and the per-signature counts survive (`bash:rg ×54` vs `bash:git ×12` stay
 * distinct — FX001-2), while the by-name `rollup.tools` histogram is unchanged
 * (AC-16). `count` = calls collapsed; `span_s` = last − first; `t` = the burst's
 * first call. Input must be in time order.
 *
 * Keying on `control` too (plan 069) keeps a `cd … && git push` call out of an
 * adjacent `cd … && git add` burst: both have `signature:'cd'`, so without it the
 * push would inherit the earlier call's instant and blur the strict
 * `checks.t < push.t` discipline join.
 */
export function collapseToolBursts(calls: readonly ToolCall[], burstNs = BURST_N_S): ToolBurst[] {
  const bursts: ToolBurst[] = [];
  let cur: {
    t: string;
    name: string;
    signature?: string;
    control?: Record<string, number>;
    first: number;
    last: number;
    count: number;
    resultTokens?: number;
  } | null = null;
  for (const call of calls) {
    const at = parseIso(call.t);
    if (
      cur !== null &&
      call.name === cur.name &&
      call.signature === cur.signature &&
      controlKey(call.control) === controlKey(cur.control) &&
      Number.isFinite(at) &&
      Number.isFinite(cur.last) &&
      at - cur.last < burstNs
    ) {
      cur.last = at;
      cur.count += 1;
      if (call.control !== undefined) cur.control = addControl(cur.control, call.control);
      if (call.result_tokens !== undefined) {
        cur.resultTokens = (cur.resultTokens ?? 0) + call.result_tokens;
      }
      continue;
    }
    if (cur !== null) bursts.push(finishBurst(cur));
    cur = { t: call.t, name: call.name, signature: call.signature, first: at, last: at, count: 1 };
    if (call.control !== undefined) cur.control = { ...call.control };
    if (call.result_tokens !== undefined) cur.resultTokens = call.result_tokens;
  }
  if (cur !== null) bursts.push(finishBurst(cur));
  return bursts;
}

/** Stable identity of a control-count map — the burst-key comparison (order-insensitive). */
function controlKey(control: Record<string, number> | undefined): string {
  if (control === undefined) return '';
  return Object.entries(control)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

/** Sum two control-count maps (the burst accumulates its calls' counts). */
function addControl(
  acc: Record<string, number> | undefined,
  next: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...(acc ?? {}) };
  for (const [k, v] of Object.entries(next)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function finishBurst(b: {
  t: string;
  name: string;
  signature?: string;
  control?: Record<string, number>;
  first: number;
  last: number;
  count: number;
  resultTokens?: number;
}): ToolBurst {
  const span =
    Number.isFinite(b.last) && Number.isFinite(b.first) ? Math.round(b.last - b.first) : 0;
  const burst: ToolBurst = { t: b.t, name: b.name, count: b.count, span_s: span < 0 ? 0 : span };
  if (b.signature !== undefined) burst.signature = b.signature;
  if (b.control !== undefined) burst.control = b.control;
  if (b.resultTokens !== undefined) burst.result_tokens = b.resultTokens;
  return burst;
}

/** A raw skill open an adapter detected, in time order. */
export interface SkillOpen {
  name: string;
  t: string;
  /** The leading pure-digit positional of the invocation (FX001, Facet B), if any. */
  arg?: string;
}

/**
 * Infer each skill span's lifecycle status from observable transitions only
 * (§4.3 — no confidence scoring). For every open except the last: the SAME skill
 * opening next ⇒ this one was `abandoned` (restarted); a DIFFERENT skill opening
 * next ⇒ this one was `superseded`. The final open is `active` when the segment
 * ends with it still open (`lastOpenStillActive`), else `completed`.
 */
export function inferSkillStatuses(
  opens: readonly SkillOpen[],
  lastOpenStillActive = false,
): SkillStatus[] {
  return opens.map((open, i) => {
    if (i === opens.length - 1) return lastOpenStillActive ? 'active' : 'completed';
    return opens[i + 1].name === open.name ? 'abandoned' : 'superseded';
  });
}

/**
 * Derive the {@link Rollup} from an event stream. Pure: sorts by `t`, classifies
 * every gap into agent/human/idle, attributes gap-time to the active flow stage,
 * sums token buckets across turns (→ `null` when no turn carried any), counts
 * tool bursts + skill outcomes, and records the latest `checks` verdict + each
 * command's exit code. Recomputable by any consumer (AC-16/AC-17).
 */
export function computeRollup(events: readonly Event[], opts: RollupOptions = {}): Rollup {
  const idleCap = opts.idleCapS ?? IDLE_CAP_S;
  // `flow_log` events are PURE REPLAY MARKERS (plan 035) — they carry their own
  // real `fired_at`, which can predate the window (backfilled flight-plan history).
  // `artifact`, `mark`, `file`, and `usage` events likewise carry observation or
  // capture timestamps rather than work instants. Excluding them keeps gap/wall/
  // stage math anchored to the window's work events. They remain in event_stream;
  // usage is reduced separately below with kind-aware precedence.
  const ev = [...events]
    .filter(
      (e) =>
        e.kind !== 'flow_log' &&
        e.kind !== 'artifact' &&
        e.kind !== 'mark' &&
        e.kind !== 'file' &&
        e.kind !== 'usage',
    )
    .sort((a, b) => parseIso(a.t) - parseIso(b.t));

  let agent = 0;
  let human = 0;
  let idle = 0;
  let stage: string | null = null;
  const flowStageTime: Record<string, number> = {};

  for (let i = 0; i < ev.length; i++) {
    if (i > 0) {
      const gap = parseIso(ev[i].t) - parseIso(ev[i - 1].t);
      if (Number.isFinite(gap) && gap > 0) {
        const kind = classifyGap(gap, ev[i].kind === 'prompt', idleCap);
        if (kind === 'agent') agent += gap;
        else if (kind === 'human') human += gap;
        else idle += gap;
        // The gap belongs to the stage active as of the PREVIOUS event.
        if (stage !== null) flowStageTime[stage] = (flowStageTime[stage] ?? 0) + gap;
      }
    }
    const e = ev[i];
    if (e.kind === 'flow') stage = e.stage;
  }

  const wall = ev.length > 1 ? parseIso(ev[ev.length - 1].t) - parseIso(ev[0].t) : 0;
  const active = agent + human;

  // tokens — summed across turns; null when no turn carried any bucket.
  let hasTokens = false;
  const tokens = { in: 0, out: 0, cache_read: 0, cache_create: 0 };
  const tools: Record<string, number> = {};
  const skills: Record<string, { runs: number; abandoned: number; superseded: number }> = {};
  const exits: Record<string, number> = {};
  let checks: string | undefined;

  const usageObservations: UsageObservation[] = [];
  for (const event of events) {
    if (event.kind !== 'usage') continue;
    const observation: UsageObservation = {
      t: event.t,
      observation_kind: event.observation_kind,
    };
    if (event.in !== undefined) observation.input = event.in;
    if (event.out !== undefined) observation.output = event.out;
    if (event.cache_read !== undefined) observation.cache_read = event.cache_read;
    if (event.cache_create !== undefined) observation.cache_create = event.cache_create;
    if (event.nano_aiu !== undefined) observation.nano_aiu = event.nano_aiu;
    usageObservations.push(observation);
  }

  for (const e of ev) {
    if (e.kind === 'turn') {
      if (typeof e.in === 'number') {
        tokens.in += e.in;
        hasTokens = true;
      }
      if (typeof e.out === 'number') {
        tokens.out += e.out;
        hasTokens = true;
      }
      if (typeof e.cache_read === 'number') {
        tokens.cache_read += e.cache_read;
        hasTokens = true;
      }
      if (typeof e.cache_create === 'number') {
        tokens.cache_create += e.cache_create;
        hasTokens = true;
      }
    } else if (e.kind === 'tools') {
      tools[e.name] = (tools[e.name] ?? 0) + e.count;
    } else if (e.kind === 'skill') {
      skills[e.name] ??= { runs: 0, abandoned: 0, superseded: 0 };
      const s = skills[e.name];
      s.runs += 1;
      if (e.status === 'abandoned') s.abandoned += 1;
      else if (e.status === 'superseded') s.superseded += 1;
    } else if (e.kind === 'checks') {
      checks = e.status;
    } else if (e.kind === 'command_exit') {
      exits[e.verb] = e.exit;
    }
  }
  const usageObservation = reduceUsageObservations(usageObservations);
  if (usageObservation !== null) {
    const usage = completeUsageTokens(usageObservation);
    if (usage === null) {
      tokens.in = 0;
      tokens.out = 0;
      tokens.cache_read = 0;
      tokens.cache_create = 0;
      hasTokens = false;
    } else {
      tokens.in = usage.input;
      tokens.out = usage.output;
      tokens.cache_read = usage.cache_read;
      tokens.cache_create = usage.cache_create;
      hasTokens = true;
    }
  }

  return {
    activity: {
      wall_s: round(wall),
      agent_working_s: round(agent),
      human_s: round(human),
      idle_s: round(idle),
      working_ratio: active > 0 ? Number((agent / active).toFixed(2)) : 0,
    },
    flow_stage_time_s: mapValues(flowStageTime, round),
    skills,
    tokens: hasTokens ? tokens : null,
    tools,
    outcomes: checks === undefined ? { exits } : { checks, exits },
  };
}

function round(n: number): number {
  return Math.round(Number.isFinite(n) ? n : 0);
}

// ── Authorship aggregate (plan 056 · T007) ──────────────────────────────────

/** Per-file authorship totals, aggregated across a session's `file` events. */
/**
 * The named reason a row carries NO delta: the capture recorded THAT the path was
 * written/edited, but the harness exposes no per-file payload to measure it from
 * (e.g. a `files.written` path list with no `file` event behind it). It is a
 * missing CAPABILITY, not a measurement of zero — which is precisely why the delta
 * fields are `null` on such a row and never `0`.
 */
export const AUTHORSHIP_DELTA_UNAVAILABLE = 'no_per_file_delta_capture' as const;

export interface AuthorshipFile {
  path: string;
  /** The most recent change kind observed for the path. */
  change: 'written' | 'edited';
  /**
   * Measured line/byte churn — `null` when {@link delta_unavailable} is set. NEVER
   * 0 as a stand-in for "not captured": a zero is a measurement, a null is a gap.
   */
  lines_added: number | null;
  lines_removed: number | null;
  bytes_added: number | null;
  bytes_removed: number | null;
  /** How many `file` events (writes/edits) touched this path. `0` on a path-only row. */
  events: number;
  /**
   * Set ONLY on a path-only row, naming why no delta exists
   * ({@link AUTHORSHIP_DELTA_UNAVAILABLE}). ABSENT on every delta-backed row, so a
   * report with no path-only evidence is byte-identical to one built before this
   * field existed (plan 068 item 3).
   */
  delta_unavailable?: typeof AUTHORSHIP_DELTA_UNAVAILABLE;
}

/**
 * A path the capture OBSERVED being written/edited without a measurable delta —
 * a `files.written` / `files.edited` entry with no `file` event behind it.
 */
export interface ObservedPath {
  path: string;
  change: 'written' | 'edited';
}

/** The "which files did agents write, and how much" view — a pure fn of the stream. */
export interface Authorship {
  files: AuthorshipFile[];
  totals: {
    files: number;
    /** Sums over DELTA-BACKED rows only; a path-only row contributes nothing. */
    lines_added: number;
    lines_removed: number;
    bytes_added: number;
    bytes_removed: number;
    /**
     * How many rows carry no delta. OMITTED when none do, so the delta-backed
     * totals object is byte-identical to its pre-change shape.
     */
    files_delta_unavailable?: number;
  };
}

/**
 * Derive the {@link Authorship} aggregate from an event stream (plan 056) — a PURE
 * function of the `file` events, so any consumer can recompute it. Multiple
 * writes/edits of one path fold into a single per-path row (deltas summed; the
 * `change` reflects the latest event; `events` counts the touches). Preserves
 * first-seen path order.
 *
 * `observed` (plan 068 item 3) carries paths the capture recorded WITHOUT a
 * measurable delta. Each such path that has no `file` event becomes a row with
 * `null` deltas and a named {@link AuthorshipFile.delta_unavailable} reason — the
 * evidence is made visible without inventing a single number. With no `observed`
 * paths the output is byte-identical to the events-only aggregate.
 */
export function computeAuthorship(
  events: readonly Event[],
  observed: readonly ObservedPath[] = [],
): Authorship {
  const byPath = new Map<string, AuthorshipFile>();
  for (const e of events) {
    if (e.kind !== 'file') continue;
    let f = byPath.get(e.path);
    if (f === undefined) {
      f = {
        path: e.path,
        change: e.change,
        lines_added: 0,
        lines_removed: 0,
        bytes_added: 0,
        bytes_removed: 0,
        events: 0,
      };
      byPath.set(e.path, f);
    }
    f.change = e.change;
    f.lines_added = (f.lines_added ?? 0) + e.delta.lines_added;
    f.lines_removed = (f.lines_removed ?? 0) + e.delta.lines_removed;
    f.bytes_added = (f.bytes_added ?? 0) + e.delta.bytes_added;
    f.bytes_removed = (f.bytes_removed ?? 0) + e.delta.bytes_removed;
    f.events += 1;
  }
  // A path the capture SAW touched but could not measure becomes an explicit
  // delta-unavailable row — visible evidence with a named gap, never zeros. A path
  // that already has a `file` event keeps its measured row untouched.
  let unavailable = 0;
  for (const o of observed) {
    if (byPath.has(o.path)) continue;
    byPath.set(o.path, {
      path: o.path,
      change: o.change,
      lines_added: null,
      lines_removed: null,
      bytes_added: null,
      bytes_removed: null,
      events: 0,
      delta_unavailable: AUTHORSHIP_DELTA_UNAVAILABLE,
    });
    unavailable += 1;
  }
  const files = [...byPath.values()];
  const totals = {
    files: files.length,
    lines_added: 0,
    lines_removed: 0,
    bytes_added: 0,
    bytes_removed: 0,
    ...(unavailable > 0 ? { files_delta_unavailable: unavailable } : {}),
  };
  for (const f of files) {
    totals.lines_added += f.lines_added ?? 0;
    totals.lines_removed += f.lines_removed ?? 0;
    totals.bytes_added += f.bytes_added ?? 0;
    totals.bytes_removed += f.bytes_removed ?? 0;
  }
  return { files, totals };
}

function mapValues(obj: Record<string, number>, fn: (n: number) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}
