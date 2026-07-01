/**
 * Shared event-stream assembly for the per-harness adapters (plan 034 Phase 5).
 *
 * An adapter collects three raw inputs from its (timed) session source — already-
 * timed `direct` events, raw `toolCalls` to collapse into bursts, and `skillOpens`
 * to status-infer — and {@link buildEventStream} turns them into one ordered
 * {@link Event}[]. Keeps the burst rule + skill-status inference + sort in ONE
 * place so Claude / Copilot / Cursor don't each reimplement them. Pure (no I/O).
 */

import type { Event, TPrecision } from './events.js';
import {
  collapseToolBursts,
  inferSkillStatuses,
  parseIso,
  type SkillOpen,
  type ToolCall,
} from './rollup.js';

export interface RawEvents {
  /** Already-timed events (prompt, turn, subagent, compaction, harness, model, checks…). */
  direct: Event[];
  /** Raw per-call tool observations → collapsed into `tools` burst events. */
  toolCalls?: ToolCall[];
  /** Raw skill opens → `skill` events with an inferred status. */
  skillOpens?: SkillOpen[];
  /** Segment ends with the last skill still open ⇒ its status is `active` (else `completed`). */
  lastSkillActive?: boolean;
  /**
   * Honesty flag stamped on the generated tool/skill events — e.g. Cursor anchors
   * untimed transcript beats to a turn bubble's `createdAt`, so it passes `anchored`.
   * Omit for exact-timed sources (Claude/Copilot).
   */
  precision?: TPrecision;
}

/**
 * Assemble the ordered event stream: direct events + collapsed tool bursts +
 * status-inferred skill spans, sorted by timestamp (stable for equal `t`).
 */
export function buildEventStream(raw: RawEvents): Event[] {
  const events: Event[] = [...raw.direct];
  const p = raw.precision;

  for (const b of collapseToolBursts(raw.toolCalls ?? [])) {
    const e: Event = { t: b.t, kind: 'tools', name: b.name, count: b.count, span_s: b.span_s };
    if (b.signature !== undefined) e.signature = b.signature;
    if (b.result_tokens !== undefined) e.result_tokens = b.result_tokens;
    if (p !== undefined) e.t_precision = p;
    events.push(e);
  }

  const opens = raw.skillOpens ?? [];
  const statuses = inferSkillStatuses(opens, raw.lastSkillActive ?? false);
  opens.forEach((open, i) => {
    const e: Event = { t: open.t, kind: 'skill', name: open.name, status: statuses[i] };
    if (open.arg !== undefined) e.arg = open.arg;
    if (p !== undefined) e.t_precision = p;
    events.push(e);
  });

  return stableSortByT(events);
}

/** Sort by parsed `t` ascending, preserving input order for equal/unparseable timestamps. */
function stableSortByT(events: readonly Event[]): Event[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = parseIso(a.e.t);
      const tb = parseIso(b.e.t);
      if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return a.i - b.i;
      return ta - tb;
    })
    .map((x) => x.e);
}
