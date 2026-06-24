import type { Event, FlowLogEvent } from './events.js';

/**
 * Project the flight plan's append-only `events[]` audit log into telemetry
 * `flow_log` events (plan 035 — flow replay). One event per log entry, carrying
 * only its STRUCTURAL shape — the source built-in `op` (its `kind`) plus the
 * ids/states in its `details` — stamped at the entry's real `fired_at`.
 *
 * PRIVACY (AC-03): only `details.{node,from,to,type,edge_op}` are read. The
 * free-form carriers (a manual event's top-level `description`, a custom event's
 * `value`/`name`, and comment text — which lives on the NODE, not the event) are
 * never touched, so a `flow event "<free text>"` can't leak.
 *
 * WINDOWING (AC-04): keyed by an ARRAY OFFSET, not a timestamp. `events[]` is
 * append-only, so "emit entries at index >= fromOffset" is exact and collision-
 * proof — unlike a `fired_at` watermark, which would drop or double-emit the
 * several entries one CLI call can stamp in the same millisecond. Returns the new
 * events + `nextOffset` (the full length) for the caller to persist.
 *
 * Pure + defensive: a non-array / missing log → no events, offset unchanged.
 */
export interface FlowLogResult {
  events: Event[];
  nextOffset: number;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function flowLogEvents(parsed: unknown, fromOffset: number): FlowLogResult {
  const log = (parsed as { events?: unknown } | null | undefined)?.events;
  if (!Array.isArray(log)) return { events: [], nextOffset: fromOffset };

  const start =
    Number.isFinite(fromOffset) && fromOffset > 0 ? Math.min(Math.floor(fromOffset), log.length) : 0;

  const events: Event[] = [];
  for (let i = start; i < log.length; i++) {
    const raw = (log[i] ?? {}) as { kind?: unknown; fired_at?: unknown; details?: unknown };
    const op = str(raw.kind);
    const t = str(raw.fired_at);
    if (op === undefined || t === undefined) continue; // malformed entry — skip, never throw

    const details = (raw.details ?? {}) as Record<string, unknown>;
    const ev: FlowLogEvent = { t, t_precision: 'anchored', kind: 'flow_log', op };
    const node = str(details.node);
    const from = str(details.from);
    const to = str(details.to);
    const type = str(details.type);
    const edgeOp = str(details.edge_op);
    if (node !== undefined) ev.node = node;
    if (from !== undefined) ev.from = from;
    if (to !== undefined) ev.to = to;
    if (type !== undefined) ev.type = type;
    if (edgeOp !== undefined) ev.edge_op = edgeOp;
    events.push(ev);
  }
  return { events, nextOffset: log.length };
}
