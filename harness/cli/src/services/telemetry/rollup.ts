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
}

/** A collapsed tool burst (the shape of a `tools` event's payload). */
export interface ToolBurst {
  t: string;
  name: string;
  count: number;
  span_s: number;
}

/**
 * Collapse a maximal run of consecutive calls of the SAME tool whose inter-call
 * gap is `< burstNs` into one burst (§4.2). A name change OR a gap ≥ `burstNs`
 * starts a new burst — so a burst is always a single tool name and the per-tool
 * counts survive (`rollup.tools` then equals the v1 `tools` histogram — AC-16; a
 * lossy `"mixed"` bucket would break that). `count` = calls collapsed; `span_s` =
 * last − first; `t` = the burst's first call. Input must be in time order.
 */
export function collapseToolBursts(calls: readonly ToolCall[], burstNs = BURST_N_S): ToolBurst[] {
  const bursts: ToolBurst[] = [];
  let cur: { t: string; name: string; first: number; last: number; count: number } | null = null;
  for (const call of calls) {
    const at = parseIso(call.t);
    if (
      cur !== null &&
      call.name === cur.name &&
      Number.isFinite(at) &&
      Number.isFinite(cur.last) &&
      at - cur.last < burstNs
    ) {
      cur.last = at;
      cur.count += 1;
      continue;
    }
    if (cur !== null) bursts.push(finishBurst(cur));
    cur = { t: call.t, name: call.name, first: at, last: at, count: 1 };
  }
  if (cur !== null) bursts.push(finishBurst(cur));
  return bursts;
}

function finishBurst(b: {
  t: string;
  name: string;
  first: number;
  last: number;
  count: number;
}): ToolBurst {
  const span = Number.isFinite(b.last) && Number.isFinite(b.first) ? Math.round(b.last - b.first) : 0;
  return { t: b.t, name: b.name, count: b.count, span_s: span < 0 ? 0 : span };
}

/** A raw skill open an adapter detected, in time order. */
export interface SkillOpen {
  name: string;
  t: string;
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
  const ev = [...events].sort((a, b) => parseIso(a.t) - parseIso(b.t));

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

  const wall =
    ev.length > 1 ? parseIso(ev[ev.length - 1].t) - parseIso(ev[0].t) : 0;
  const active = agent + human;

  // tokens — summed across turns; null when no turn carried any bucket.
  let hasTokens = false;
  const tokens = { in: 0, out: 0, cache_read: 0, cache_create: 0 };
  const tools: Record<string, number> = {};
  const skills: Record<string, { runs: number; abandoned: number; superseded: number }> = {};
  const exits: Record<string, number> = {};
  let checks: string | undefined;

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
      const s = (skills[e.name] ??= { runs: 0, abandoned: 0, superseded: 0 });
      s.runs += 1;
      if (e.status === 'abandoned') s.abandoned += 1;
      else if (e.status === 'superseded') s.superseded += 1;
    } else if (e.kind === 'checks') {
      checks = e.status;
    } else if (e.kind === 'command_exit') {
      exits[e.verb] = e.exit;
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

function mapValues(obj: Record<string, number>, fn: (n: number) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}
