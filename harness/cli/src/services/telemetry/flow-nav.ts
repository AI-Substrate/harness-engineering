/**
 * Flow-stage event derivation (plan 034 Phase 5, T5.6 — AC-18, detail doc §4.4).
 *
 * A `flow` event records WHICH flight-plan stage the session is at, read from the
 * `the-flow.json` `nav` at capture time — NEVER from the command's args (a
 * `harness flow nav <target>` drops the target as a param, so args are unreliable;
 * the nav is the source of truth). One command window sits at exactly one stage,
 * so capture emits ONE flow event anchored to the window start; {@link computeRollup}
 * then attributes the window's gap-time to that stage (`flow_stage_time_s`).
 *
 * Pure (no I/O): the caller reads the file via the `FsPort` and hands the parsed
 * object in. Defensive by construction — any shape it doesn't recognise → `null`
 * (no fabricated stage).
 */

import type { FlowEvent } from './events.js';

/** The slice of a flight-plan JSON this derivation reads (everything optional/unknown). */
interface RawFlightPlan {
  provenance?: { agent?: unknown } | null;
  nav?: { now?: unknown } | null;
  nodes?: unknown;
}

interface RawNode {
  id?: unknown;
  status?: unknown;
}

/**
 * Build the command-level `flow` event from a parsed flight-plan (`the-flow.json`).
 *
 * - `flow`  = `provenance.agent` (e.g. `the-flow` / `harness-loop`)
 * - `stage` = `nav.now`
 * - `status`= the lifecycle of the node `nav.now` points at, narrowed to the flow
 *   vocabulary `done | blocked | in_progress` (any other node status ⇒ `in_progress`)
 * - `t_precision` = `anchored` — pinned to the window start, not an observed instant
 *
 * Returns `null` when the plan carries no agent or no `nav.now` (nothing honest to
 * emit). `from` is intentionally omitted: a single capture observes the current
 * position, not the transition that reached it.
 */
export function flowEventFromFlightPlan(parsed: unknown, t: string): FlowEvent | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const fp = parsed as RawFlightPlan;

  const stage = typeof fp.nav?.now === 'string' && fp.nav.now.length > 0 ? fp.nav.now : null;
  if (stage === null) return null;

  const flow =
    typeof fp.provenance?.agent === 'string' && fp.provenance.agent.length > 0
      ? fp.provenance.agent
      : null;
  if (flow === null) return null;

  let status = 'in_progress';
  if (Array.isArray(fp.nodes)) {
    const node = (fp.nodes as RawNode[]).find((n) => typeof n?.id === 'string' && n.id === stage);
    const ns = typeof node?.status === 'string' ? node.status : undefined;
    if (ns === 'done' || ns === 'blocked') status = ns;
  }

  return { t, t_precision: 'anchored', kind: 'flow', flow, stage, status };
}
