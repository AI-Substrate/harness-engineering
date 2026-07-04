import type { GitReadPort } from '../../adapters/git/git-read-port.js';
import { extractCodexLedger, findCodexRollout } from './codex-ledger.js';
import { copilotSessionEventsPath, extractCopilotLedger } from './copilot-ledger.js';
import type { PijDescriptor, PijRegistry } from './pij-registry.js';
import { readPijRegistry } from './pij-registry.js';
import { type RefLane, readRefLanes } from './ref-source.js';
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

/**
 * Where a lane's cost/evidence was resolved from (plan 052 · T007), in precedence
 * order: `live` = the local temp buffer segments; `ref` = a synced
 * `refs/harness-telemetry/*` rollup (a flushed lane); `ledger` = a vendor
 * side-channel (copilot `session.shutdown` / codex rollout `token_count`) recovered
 * post-hoc via the pij registry join. A lane carries the FIRST source that resolves.
 */
export type FleetLaneSource = 'live' | 'ref' | 'ledger';

/**
 * Billing units carried per lane (plan 052 · T007 / dossier F-10) — the AUTHORITATIVE
 * cost unit, distinct from the raw token `grand_total`. `nano_aiu` is copilot's AIC
 * billing unit ×10⁹ (AIC = nano_aiu/1e9), an integer so the export stays counts-only
 * (Constitution P12); `token_buckets` is an open-keyed integer histogram (copilot:
 * input/output/cache_read/cache_create; codex: input/output/cached/reasoning/total).
 * Omitted on a lane with no recovered billing (a live claude lane carries its cost in
 * `tokens`; billing is for the side-channel-recovered lanes).
 */
export interface FleetLaneBilling {
  /** Copilot billing unit — nano-AIU (AIC ×1e9). AIC = nano_aiu/1e9. Integer, lossless. */
  nano_aiu?: number;
  /** Token buckets by name — integers (never a raw grand total surfaced as the unit, F-10). */
  token_buckets?: Record<string, number>;
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
   * `false` ⇒ a `tokens: null` (copilot) lane with no recovered ledger (F-07) —
   * NEVER zero-filled into `totals.cost`; counted in `unmeasured_lanes` instead. A
   * ledger-resolved lane IS measured (its billing is the recovered side-channel).
   */
  cost_measured: boolean;
  /** This lane's cost (fleet-layer — `SessionEvidence` carries no tokens). `{0,0}` when unmeasured. */
  tokens: FleetLaneTokens;
  /** Where this lane resolved from: `live` → `ref` → `ledger` (plan 052 · T007). */
  source: FleetLaneSource;
  /** Recovered billing units (AIC / token buckets); omitted when none (dossier F-10). */
  billing?: FleetLaneBilling;
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
  /**
   * Optional git READ port (plan 052 · T005). When present, `refs/harness-telemetry/*`
   * rollups are enumerated as a fleet source so a FLUSHED (pruned-from-temp) rostered
   * lane resolves `source:'ref'` instead of collapsing to an orphan (AC-06). Absent →
   * the ref tier is simply skipped (live → ledger), never an error.
   */
  gitRead?: GitReadPort;
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
      source: 'live',
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
 * A minimal {@link SessionEvidence} for a lane resolved from a side-channel LEDGER
 * (no live/ref segments): the canonical empty fold, restamped with the real harness
 * + harness session id. `segments: 0` and the standard `gaps` are the honest signal
 * that no event-stream semantics exist for this lane (Phase 2 will flag it
 * `semantics_measured:false`) — never a fabricated activity.
 */
function ledgerEvidence(
  pijId: string,
  harnessSessionId: string | null,
  harness: string,
): SessionEvidence {
  const ev = fold(pijId, []);
  ev.harness = harness;
  ev.harness_session_id = harnessSessionId;
  return ev;
}

/**
 * Build a LEDGER lane for a roster member with no live/ref telemetry, from its pij
 * descriptor's join keys (plan 052 · T007 — precedence tier 3). copilot → the
 * `session.shutdown` billing ledger (AIC + token buckets); codex → the rollout
 * `token_count` total (via `transcriptPath`, else the session-id locator).
 *
 * THREE honest outcomes (plan 052 · fix-001 — the honesty invariant): a malformed
 * side channel must degrade the lane, never make the member vanish.
 *   - **measured lane** — the side-channel FILE is present AND parses to a billing
 *     total (`cost_measured:true`, with `billing`).
 *   - **degraded lane** ({@link degradedLedgerLane}) — the FILE is present but its
 *     shape is malformed / unmeasured: the member stays a first-class lane
 *     (`source:'ledger'`, `cost_measured:false`, `{0,0}` tokens, no billing) so it is
 *     counted in `unmeasured_lanes`, never silently dropped.
 *   - **`null`** — the side channel is ABSENT (no descriptor side channel, no home, or
 *     no file at all): the caller keeps that member an honest orphan (AC-02).
 *
 * The present-vs-absent split is the raw `readText` result — `null` (missing file) is
 * absence; any string (even garbage) is presence — so a truncated/schema-drifted
 * ledger degrades instead of disappearing.
 */
export function buildLedgerLane(
  pijId: string,
  role: string | null,
  desc: PijDescriptor,
  deps: SessionEvidenceDeps,
): FleetLane | null {
  const home = deps.env.home();
  if (desc.harness === 'copilot' && desc.harness_session_id !== null) {
    if (!home) return null; // no home → the side channel is unlocatable → honest orphan
    const raw = deps.fs.readText(copilotSessionEventsPath(home, desc.harness_session_id));
    if (raw === null) return null; // no side-channel FILE → honest orphan
    const led = extractCopilotLedger(raw);
    if (!led.measured || led.nano_aiu === null) {
      return degradedLedgerLane(pijId, role, 'copilot', desc); // present but malformed → unmeasured lane
    }
    const b = led.token_buckets ?? { input: 0, output: 0, cache_read: 0, cache_create: 0 };
    const grand = b.input + b.output + b.cache_read + b.cache_create;
    return {
      pij_id: pijId,
      role,
      harness: 'copilot',
      model: desc.model,
      cost_measured: true,
      tokens: { grand_total: grand, output: b.output },
      source: 'ledger',
      billing: { nano_aiu: led.nano_aiu, token_buckets: { ...b } },
      evidence: ledgerEvidence(pijId, desc.harness_session_id, 'copilot'),
    };
  }
  if (desc.harness === 'codex') {
    const path =
      desc.transcript_path ?? findCodexRollout(deps.fs, home, desc.harness_session_id ?? '');
    if (!path) return null; // no resolvable rollout path → honest orphan
    const raw = deps.fs.readText(path);
    if (raw === null) return null; // path named but the FILE is absent → honest orphan
    const led = extractCodexLedger(raw);
    if (!led.measured || led.token_buckets === null) {
      return degradedLedgerLane(pijId, role, 'codex', desc); // present but malformed → unmeasured lane
    }
    const b = led.token_buckets;
    return {
      pij_id: pijId,
      role,
      harness: 'codex',
      model: desc.model,
      cost_measured: true,
      tokens: { grand_total: b.total, output: b.output },
      source: 'ledger',
      billing: {
        token_buckets: {
          input: b.input,
          output: b.output,
          cached: b.cached,
          reasoning: b.reasoning,
          total: b.total,
        },
      },
      evidence: ledgerEvidence(pijId, desc.harness_session_id, 'codex'),
    };
  }
  return null;
}

/**
 * A roster-scoped DEGRADED ledger lane (plan 052 · fix-001): the side-channel FILE
 * exists but its shape is malformed / unmeasured. The member stays a first-class lane
 * — `source:'ledger'`, `cost_measured:false`, zeroed tokens, NO billing, empty
 * evidence — so it is counted in `unmeasured_lanes` and never dropped from lane
 * accounting (the honesty invariant: a broken ledger degrades, it does not vanish).
 */
function degradedLedgerLane(
  pijId: string,
  role: string | null,
  harness: 'copilot' | 'codex',
  desc: PijDescriptor,
): FleetLane {
  return {
    pij_id: pijId,
    role,
    harness,
    model: desc.model,
    cost_measured: false,
    tokens: { grand_total: 0, output: 0 },
    source: 'ledger',
    evidence: ledgerEvidence(pijId, desc.harness_session_id, harness),
  };
}

/** An empty roster-scoped shell — used when the buffer yields no live lane at all. */
function emptyRosterFleet(rootPijId: string, roster: FleetRoster | null): FleetEvidence | null {
  if (roster === null) return null; // env-tree scope needs ≥1 live child
  return {
    root_pij_id: rootPijId,
    scope: 'roster',
    sessions: [],
    orphans: roster.members.map((m) => m.pij_id),
    unrostered: [],
    totals: {
      cost: { grand_total: 0, output: 0, measured_lanes: 0, unmeasured_lanes: 0 },
      time: { wall_clock_s: null, active_s: null },
      segments: 0,
    },
  };
}

/** Recompute cost + segment totals over the current lanes (time stays — ledger lanes have no span). */
function recomputeCostAndSegments(fleet: FleetEvidence): void {
  let grand = 0;
  let output = 0;
  let measured = 0;
  let unmeasured = 0;
  let segs = 0;
  for (const l of fleet.sessions) {
    segs += l.evidence.segments;
    if (l.cost_measured) {
      grand += l.tokens.grand_total;
      output += l.tokens.output;
      measured += 1;
    } else {
      unmeasured += 1;
    }
  }
  fleet.totals.cost = {
    grand_total: grand,
    output,
    measured_lanes: measured,
    unmeasured_lanes: unmeasured,
  };
  fleet.totals.segments = segs;
}

/** Build a REF lane for a rostered member whose flushed telemetry lives in a synced rollup. */
function buildRefLane(
  pijId: string,
  role: string | null,
  desc: PijDescriptor,
  ref: RefLane,
): FleetLane {
  return {
    pij_id: pijId,
    role,
    harness: desc.harness ?? 'unknown',
    model: desc.model,
    cost_measured: ref.measured,
    tokens: ref.tokens,
    source: 'ref',
    evidence: ledgerEvidence(pijId, desc.harness_session_id, desc.harness ?? 'unknown'),
  };
}

/**
 * Resolve each roster orphan (a rostered member with no LIVE lane) against the ref
 * source then the vendor ledger — precedence **ref → ledger** (plan 052 · T005/T007),
 * live having already won for any member in `sessions`. Resolved members are promoted
 * into `sessions` (source `ref`/`ledger`) and dropped from `orphans`; children are
 * re-sorted by descending cost with the orchestrator first. Cost/segment totals are
 * recomputed; time is untouched. Mutates `fleet` in place.
 */
function enrichOrphans(
  fleet: FleetEvidence,
  roster: FleetRoster,
  registry: PijRegistry,
  refLanes: Map<string, RefLane>,
  deps: SessionEvidenceDeps,
): void {
  const roleOf = new Map(roster.members.map((m) => [m.pij_id, m.role] as const));
  const resolved: FleetLane[] = [];
  const remaining: string[] = [];
  for (const pijId of fleet.orphans) {
    const desc = registry.by_pij.get(pijId);
    let lane: FleetLane | null = null;
    if (desc) {
      // Tier 2 — ref (a flushed lane), keyed by the descriptor's harness session id.
      const ref = desc.harness_session_id ? refLanes.get(desc.harness_session_id) : undefined;
      if (ref !== undefined) {
        lane = buildRefLane(pijId, roleOf.get(pijId) ?? null, desc, ref);
      } else {
        // Tier 3 — vendor ledger (copilot shutdown / codex rollout).
        lane = buildLedgerLane(pijId, roleOf.get(pijId) ?? null, desc, deps);
      }
    }
    if (lane !== null) resolved.push(lane);
    else remaining.push(pijId);
  }
  if (resolved.length === 0) return;

  const orch = fleet.sessions.find((l) => l.pij_id === fleet.root_pij_id) ?? null;
  const children = [
    ...fleet.sessions.filter((l) => l.pij_id !== fleet.root_pij_id),
    ...resolved,
  ].sort((a, b) => b.tokens.grand_total - a.tokens.grand_total || a.pij_id.localeCompare(b.pij_id));
  fleet.sessions = orch ? [orch, ...children] : children;
  fleet.orphans = remaining.sort();
  recomputeCostAndSegments(fleet);
}

/**
 * Read + join + merge a fleet's telemetry into a {@link FleetEvidence}, or `null`
 * when nothing resolves. Precedence per lane is **live → ref → ledger** (plan 052 ·
 * T007): the local temp buffer first (worktree-safe {@link candidateRoots}), then —
 * for rostered members still missing — their vendor side-channel LEDGER, joined via
 * the pij registry (copilot `session.shutdown` AIC, codex rollout `token_count`). So
 * a run whose workers have died still reports 4/4 lanes: the orchestrator live, the
 * workers from their shutdown/rollout ledgers. Fail-safe: any unexpected error
 * resolves to `null`.
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

    // Tier 1 — live temp buffer (the FIRST candidate root that yields a lane).
    let live: FleetEvidence | null = null;
    for (const telDir of candidateRoots(rootPijId, deps, opts)) {
      const built = buildFleetEvidence(rootPijId, readSegments(deps.fs, telDir), roster);
      if (built !== null) {
        live = built;
        break;
      }
    }

    const fleet = live ?? emptyRosterFleet(rootPijId, roster);
    if (fleet === null) return null; // no live lane and no roster to resolve

    // Tiers 2 + 3 — ref rollups then vendor ledgers for rostered orphans (env-tree
    // scope has no orphans, so its lanes are live-only). Both are read-only + fail-safe.
    if (roster !== null) {
      const registry = readPijRegistry(deps);
      const refLanes = opts?.gitRead ? readRefLanes(opts.gitRead) : new Map<string, RefLane>();
      if (registry.available || refLanes.size > 0) {
        enrichOrphans(fleet, roster, registry, refLanes, deps);
      }
    }

    return fleet.sessions.length > 0 ? fleet : null;
  } catch {
    return null;
  }
}
