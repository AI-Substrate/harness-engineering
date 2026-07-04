import type { Segment } from './segment.js';
import {
  candidateRoots,
  fold,
  readSegments,
  type SessionEvidence,
  type SessionEvidenceDeps,
  type SessionEvidenceOpts,
} from './session-evidence.js';

/**
 * `getFleetEvidence` (plan 051 · T002) — the read-side FLEET join. Given a root
 * pij id (the flow-pair orchestrator), enumerate every child session by the
 * already-captured `captured_env` join keys, merge each into the existing
 * per-session {@link SessionEvidence} (REUSING {@link fold} — dossier F-05, "reuse,
 * don't reimplement"), and fold the lanes into one {@link FleetEvidence} with honest
 * three-dimension totals (workshop D2/D3).
 *
 * READ-ONLY + FAIL-SAFE, exactly like `getSessionEvidence`: never mutates the
 * buffer / refs, never throws (absent / partial / corrupt data resolves to an empty
 * lane, an explicit diff entry, or a `null` return).
 *
 * COST (D3): `cost_measured` is `true` iff a lane has ≥1 segment carrying non-null
 * `tokens`. Copilot lanes are `tokens: null` (dossier F-07) → `cost_measured: false`
 * and are **EXCLUDED** from `totals.cost` (never zero-filled) and counted in
 * `unmeasured_lanes`. Fleet cost is therefore an honest LOWER BOUND until copilot
 * token capture lands.
 *
 * TIME (D3): per-lane span is `[minT,maxT]` over the segments' `event_stream[].t`
 * ISO timestamps (the SAME source `fold` uses for `duration_s`) with `timecode` as a
 * bounding fallback — `window` is event-index and unusable (dossier F-08).
 * `totals.time.wall_clock_s` is the UNION of lane spans; `active_s` is their SUM;
 * parallelism = active/wall.
 *
 * ROSTER (D1): with a roster the scope is `roster` and MEMBERSHIP scopes to it —
 * `sessions` and all `totals` are built from the orchestrator lane plus only the
 * rostered children. The env-tree is reconciled against the roster as diffs:
 * `orphans` = rostered ids with no env-tree match, `unrostered` = env-tree children
 * absent from the roster (ids only — never in `sessions`/`totals`). Without a roster
 * the scope is `env-tree` (the superset — every child is a lane) and both diffs are
 * empty. The diff is itself an eval signal.
 *
 * PRIVACY (H-01): ids, counts, enums only — the counts-only posture carries through.
 */

/** The join keys the live capture writes into `captured_env` (from the pij spawn env). */
const PIJ_SESSION_ENV = 'PIJ_SESSION_ID';
const PIJ_PARENT_ENV = 'PIJ_PARENT_ID';
const PIJ_HARNESS_ENV = 'PIJ_HARNESS';

/** Per-lane token totals (the cost dimension). `{0,0}` on an unmeasured lane. */
export interface FleetLaneTokens {
  grand_total: number;
  output: number;
}

/** One session, one row in the fleet (workshop D2). */
export interface FleetLane {
  /** The child's own pij id (`captured_env.PIJ_SESSION_ID`) — the join key. */
  pij_id: string;
  /** Role from the roster when scoped (`coder`/`reviewer`/…), else `null`. */
  role: string | null;
  /** The pij harness label (`claude` | `copilot` | `codex` | `pi`), else the segment harness. */
  harness: string;
  /** First model name seen across the lane's segments, or `null` when none carried one. */
  model: string | null;
  /**
   * `false` ⇒ a `tokens: null` (copilot) lane (F-07) — NEVER zero-filled into
   * `totals.cost`; counted in `unmeasured_lanes` instead.
   */
  cost_measured: boolean;
  /** This lane's cost (fleet-layer — `SessionEvidence` carries no tokens). `{0,0}` when unmeasured. */
  tokens: FleetLaneTokens;
  /** The existing per-session evidence object, unchanged (D2 — reused via {@link fold}). */
  evidence: SessionEvidence;
}

/** Cost totals — a lower bound over MEASURED lanes, with unmeasured loudly counted (AC-02). */
export interface FleetCostTotals {
  grand_total: number;
  output: number;
  measured_lanes: number;
  unmeasured_lanes: number;
}

/** Time totals from OTLP/event timestamps (AC-03) — `null` when no lane had a span. */
export interface FleetTimeTotals {
  /** Union of lane spans in seconds (wall-clock coverage). */
  wall_clock_s: number | null;
  /** Sum of lane spans in seconds; parallelism = active/wall. */
  active_s: number | null;
}

export interface FleetTotals {
  cost: FleetCostTotals;
  time: FleetTimeTotals;
  /** Total segments merged across all lanes. */
  segments: number;
}

/** How the fleet membership was scoped. */
export type FleetScope = 'env-tree' | 'roster' | 'explicit';

/** The merged fleet evidence — N {@link SessionEvidence} joined into one unit (workshop D2). */
export interface FleetEvidence {
  /** The orchestrator (root pij id) this fleet was joined on. */
  root_pij_id: string;
  scope: FleetScope;
  /** Orchestrator lane first (when present), then children by descending cost. */
  sessions: FleetLane[];
  /** Rostered ids with no env-tree match (D1 diff); empty without a roster. */
  orphans: string[];
  /** Env-tree children not in the roster (D1 diff); empty without a roster. */
  unrostered: string[];
  totals: FleetTotals;
}

/** One roster member parsed from a flow-pair `run.json` (`role → {pijId}`). */
export interface FleetRosterMember {
  role: string;
  pij_id: string;
}

/** A parsed flow-pair roster — only members with a non-null `pijId` are carried. */
export interface FleetRoster {
  members: FleetRosterMember[];
}

/** Options for {@link getFleetEvidence}. */
export interface FleetEvidenceOpts extends SessionEvidenceOpts {
  /** Path to a flow-pair `run.json` whose `roster` scopes membership (D1); optional. */
  rosterPath?: string;
}

/**
 * Parse a flow-pair `run.json` body into a {@link FleetRoster}. Tolerant: a missing
 * `roster`, non-object entries, or a `pijId: null` (lazy/un-spawned member) are
 * skipped — never thrown. Returns `null` when the body has no usable roster.
 */
export function parseRoster(raw: string): FleetRoster | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const roster = (body as { roster?: unknown })?.roster;
  if (roster === null || typeof roster !== 'object') return null;
  const members: FleetRosterMember[] = [];
  for (const [role, entry] of Object.entries(roster as Record<string, unknown>)) {
    const pid = (entry as { pijId?: unknown } | null)?.pijId;
    if (typeof pid === 'string' && pid.length > 0) members.push({ role, pij_id: pid });
  }
  return { members };
}

/** The three join fields lifted from a segment's `captured_env`, or `null` when unjoinable. */
function joinKeys(
  seg: Segment,
): { sid: string; parent: string | null; harness: string | null } | null {
  const env = seg.captured_env;
  if (!env) return null;
  const sid = env[PIJ_SESSION_ENV];
  if (typeof sid !== 'string' || sid.length === 0) return null;
  const parent = env[PIJ_PARENT_ENV];
  const harness = env[PIJ_HARNESS_ENV];
  return {
    sid,
    parent: typeof parent === 'string' && parent.length > 0 ? parent : null,
    harness: typeof harness === 'string' && harness.length > 0 ? harness : null,
  };
}

/** Sum a lane's cost across its segments; `measured` is true iff any segment had non-null tokens. */
function laneTokens(segs: readonly Segment[]): { tokens: FleetLaneTokens; measured: boolean } {
  let grand = 0;
  let output = 0;
  let measured = false;
  for (const seg of segs) {
    if (seg.tokens != null) {
      measured = true;
      grand += seg.tokens.grand_total ?? 0;
      output += seg.tokens.output ?? 0;
    }
  }
  return { tokens: { grand_total: grand, output }, measured };
}

/**
 * The lane's wall span `[min,max]` in epoch ms from `event_stream[].t` (+ `timecode`
 * fallback), or `null` when it has no positive span (needs `max > min`; a single
 * timestamp is honestly no-span, never a fabricated 0-length interval used for time).
 */
function laneSpanMs(segs: readonly Segment[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const bump = (raw: string | undefined): void => {
    if (raw === undefined) return;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return;
    if (ms < min) min = ms;
    if (ms > max) max = ms;
  };
  for (const seg of segs) {
    for (const ev of seg.event_stream ?? []) bump(ev.t);
    bump(seg.timecode);
  }
  return max > min ? { min, max } : null;
}

/** First model name seen across a lane's segments (the `models` view), or `null`. */
function laneModel(segs: readonly Segment[]): string | null {
  for (const seg of segs) {
    const names = Object.keys(seg.models ?? {});
    if (names.length > 0) return names[0];
  }
  return null;
}

/** Total seconds covered by the UNION of `[min,max]` intervals (overlap counted once). */
function unionSeconds(intervals: ReadonlyArray<{ min: number; max: number }>): number {
  const sorted = [...intervals].sort((a, b) => a.min - b.min);
  let totalMs = 0;
  let curStart = sorted[0].min;
  let curEnd = sorted[0].max;
  for (let i = 1; i < sorted.length; i++) {
    const iv = sorted[i];
    if (iv.min <= curEnd) {
      if (iv.max > curEnd) curEnd = iv.max;
    } else {
      totalMs += curEnd - curStart;
      curStart = iv.min;
      curEnd = iv.max;
    }
  }
  totalMs += curEnd - curStart;
  return Math.round(totalMs / 1000);
}

/**
 * Build the {@link FleetEvidence} from an already-read segment list (pure). Returns
 * `null` when no segment joins to this root — so the caller can try the next
 * candidate buffer root. Exported for direct fixture-driven unit tests (no ports).
 */
export function buildFleetEvidence(
  rootPijId: string,
  segments: readonly Segment[],
  roster: FleetRoster | null,
): FleetEvidence | null {
  // Group joinable segments by pij session id — keep only the orchestrator lane
  // (sid == root) and its direct children (parent == root); depth-1 by contract.
  const groups = new Map<string, Segment[]>();
  const harnessOf = new Map<string, string | null>();
  for (const seg of segments) {
    const k = joinKeys(seg);
    if (k === null) continue;
    if (k.parent !== rootPijId && k.sid !== rootPijId) continue;
    let g = groups.get(k.sid);
    if (g === undefined) {
      g = [];
      groups.set(k.sid, g);
    }
    g.push(seg);
    if (k.harness !== null && !harnessOf.has(k.sid)) harnessOf.set(k.sid, k.harness);
  }
  if (groups.size === 0) return null;

  const roleOf = new Map<string, string>();
  for (const m of roster?.members ?? []) if (!roleOf.has(m.pij_id)) roleOf.set(m.pij_id, m.role);

  const buildLane = (sid: string, segs: Segment[]): FleetLane => {
    const { tokens, measured } = laneTokens(segs);
    const evidence = fold(sid, segs);
    return {
      pij_id: sid,
      role: roleOf.get(sid) ?? null,
      harness: harnessOf.get(sid) ?? evidence.harness,
      model: laneModel(segs),
      cost_measured: measured,
      tokens,
      evidence,
    };
  };

  const orchSegs = groups.get(rootPijId);
  const orchestrator = orchSegs ? buildLane(rootPijId, orchSegs) : null;
  const childLanes = [...groups.entries()]
    .filter(([sid]) => sid !== rootPijId)
    // With a roster, MEMBERSHIP scopes to it (AC-04 / workshop D1: "env tree =
    // superset, roster = run scope"): only rostered children become lanes and enter
    // `sessions`/`totals`. Env-tree children absent from the roster surface as
    // `unrostered` DIFFS only — never in `sessions`, never in the cost/time totals.
    // Without a roster the scope is `env-tree` and every child is a lane.
    .filter(([sid]) => roster === null || roleOf.has(sid))
    .map(([sid, segs]) => buildLane(sid, segs))
    // Highest-cost first, then pij id for a stable order (mirrors the spike output).
    .sort(
      (a, b) => b.tokens.grand_total - a.tokens.grand_total || a.pij_id.localeCompare(b.pij_id),
    );
  const sessions = orchestrator ? [orchestrator, ...childLanes] : childLanes;

  // Totals — cost over MEASURED lanes only (never zero-fill unmeasured); time from spans.
  let grand = 0;
  let output = 0;
  let measuredLanes = 0;
  let unmeasuredLanes = 0;
  let segCount = 0;
  const intervals: Array<{ min: number; max: number }> = [];
  let activeMs = 0;
  for (const lane of sessions) {
    segCount += lane.evidence.segments;
    if (lane.cost_measured) {
      grand += lane.tokens.grand_total;
      output += lane.tokens.output;
      measuredLanes += 1;
    } else {
      unmeasuredLanes += 1;
    }
    const span = laneSpanMs(groups.get(lane.pij_id) ?? []);
    if (span !== null) {
      intervals.push(span);
      activeMs += span.max - span.min;
    }
  }

  // D1 diffs — only meaningful with a roster; env-tree scope leaves both empty.
  const envTreeIds = new Set(groups.keys());
  const childIds = [...groups.keys()].filter((sid) => sid !== rootPijId);
  const orphans = roster
    ? roster.members.map((m) => m.pij_id).filter((id) => !envTreeIds.has(id))
    : [];
  const unrostered = roster ? childIds.filter((id) => !roleOf.has(id)).sort() : [];

  return {
    root_pij_id: rootPijId,
    scope: roster ? 'roster' : 'env-tree',
    sessions,
    orphans,
    unrostered,
    totals: {
      cost: {
        grand_total: grand,
        output,
        measured_lanes: measuredLanes,
        unmeasured_lanes: unmeasuredLanes,
      },
      time: {
        wall_clock_s: intervals.length > 0 ? unionSeconds(intervals) : null,
        active_s: intervals.length > 0 ? Math.round(activeMs / 1000) : null,
      },
      segments: segCount,
    },
  };
}

/**
 * Read + join + merge a fleet's telemetry into a {@link FleetEvidence}, or `null`
 * when no child joins to this root. Scans the worktree-safe candidate buffer roots
 * (worktree → orchestrator pij folder → cwd, via {@link candidateRoots}) and uses
 * the FIRST that yields ≥1 lane. Fail-safe: any unexpected error resolves to `null`.
 */
export async function getFleetEvidence(
  rootPijId: string,
  deps: SessionEvidenceDeps,
  opts?: FleetEvidenceOpts,
): Promise<FleetEvidence | null> {
  try {
    let roster: FleetRoster | null = null;
    if (opts?.rosterPath) {
      const raw = deps.fs.readText(opts.rosterPath);
      if (raw !== null) roster = parseRoster(raw);
    }
    for (const telDir of candidateRoots(rootPijId, deps, opts)) {
      const fleet = buildFleetEvidence(rootPijId, readSegments(deps.fs, telDir), roster);
      if (fleet !== null) return fleet;
    }
    return null;
  } catch {
    return null;
  }
}
