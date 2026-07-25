import type { GitReadPort } from '../../adapters/git/git-read-port.js';
import { extractCodexLedger, findCodexRollout } from './codex-ledger.js';
import { copilotSessionEventsPath, extractCopilotLedger } from './copilot-ledger.js';
import type { ArtifactEvent, MarkEvent } from './events.js';
import type { PijDescriptor, PijRegistry } from './pij-registry.js';
import { readPijRegistry } from './pij-registry.js';
import { type RefLane, readRefLanes } from './ref-source.js';
import type { Segment } from './segment.js';
import {
  candidateRoots,
  durableSegments,
  fold,
  readBufferedSegments,
  type SessionEvidence,
  type SessionEvidenceDeps,
  type SessionEvidenceOpts,
  turnBuckets,
} from './session-evidence.js';
import { type TokenEvidence, transcriptEvidenceReason } from './token-evidence.js';
import {
  completeUsageTokens,
  mergeTokenEvidence,
  reduceUsageEvents,
  tokenEvidenceFromLegacyTokens,
  tokenEvidenceFromObservation,
} from './usage-observation.js';

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

/** Review findings by severity (the quality signal), summed over a lane's review artifacts. */
export interface FleetSemanticFindings {
  critical: number;
  high: number;
  med: number;
  low: number;
}

/**
 * The SEMANTIC (quality/process) rollup for ONE lane (plan 052 · T009) — aggregated
 * from the lane's `artifact` events (plan 050 counts/enums) + its segments'
 * `rollup.flow_stage_time_s`. It answers "what did the process DO", distinct from the
 * cost/time dimensions.
 *
 * HONESTY INVARIANT (AC-07, hard requirement): a lane with NO semantic capture is
 * `semantics_measured:false` and carries NONE of the dimension fields — NEVER a `0`.
 * A blind lane is thus DISTINGUISHABLE from a lane that measured zero findings (which
 * IS `semantics_measured:true` with `findings:{critical:0,…}`). Each dimension is
 * present on a MEASURED lane only when that ARTIFACT TYPE was captured: a lane that
 * captured a plan + workshop but no review has `plan_phases`/`workshop_decisions` but
 * NO `findings` — the review was blind, and the rollup says so by OMISSION, not `0`.
 * Counts/enums only (Constitution P12) — no prose from artifacts travels.
 */
export interface FleetLaneSemantics {
  /**
   * `false` ⇒ this lane emitted no `artifact` events and no flow-stage timing (a blind
   * lane — e.g. a side-channel-only ledger lane, or a worker whose harness never
   * captured artifact semantics, dossier F-07). When `false`, every dimension below is
   * ABSENT — never zero-filled.
   */
  semantics_measured: boolean;
  /** How many `artifact` events the lane carried (the measured evidence; `0` on a blind lane). */
  artifact_events: number;
  /** Review findings by severity — present iff ≥1 `review` artifact was captured (may sum to 0). */
  findings?: FleetSemanticFindings;
  /** The ordered, consecutive-deduped review verdict path (fix-cycle signal); present iff ≥1 verdict was captured. */
  verdicts?: string[];
  /** `FIX_REQUIRED → APPROVE(_WITH_NOTES)` transitions in {@link verdicts}; present iff ≥1 verdict was captured. */
  fix_cycles?: number;
  /** Plan phase count (latest plan snapshot); present iff ≥1 `plan` artifact was captured. */
  plan_phases?: number;
  /** Plan complexity score CS-n (latest plan snapshot); `null` when the plan carried none. */
  plan_cs?: number | null;
  /** Workshop decisions (summed over the latest snapshot per workshop path); present iff ≥1 `workshop` artifact. */
  workshop_decisions?: number;
  /** Flight-plan total node count (latest `the-flow.json` snapshot); present iff ≥1 `flight-plan` artifact. */
  nodes?: number;
  /** Flight-plan nodes in `done` status (latest snapshot). */
  nodes_done?: number;
  /** Flight-plan chores done (latest snapshot). */
  chores_done?: number;
  /** Flight-plan chores still todo (latest snapshot). */
  chores_todo?: number;
  /** Per-flow-stage seconds, summed from each segment's `rollup.flow_stage_time_s`; present iff non-empty. */
  flow_stage_time_s?: Record<string, number>;
  /** Peer self-attestation markers (plan 053) — present iff ≥1 `mark` event was captured on the lane. */
  mark?: FleetLaneMark;
}

/**
 * A lane's PEER SELF-ATTESTATION rollup (plan 053) — aggregated from its `mark`
 * events (`harness telemetry mark`). This is the channel that puts a read-only
 * reviewer's verdict on ITS OWN lane: a reviewer runs no harness command and may
 * write no file, so absent a mark its lane is blind. Counts/enums only (P12) — the
 * slugs are shape-guarded, no prose travels.
 */
export interface FleetLaneMark {
  /** How many `mark` events the lane carried. */
  marks: number;
  /** Distinct mark category slugs (`mark_kind`), sorted (e.g. `["review"]`). */
  kinds: string[];
  /** The ordered, consecutive-deduped mark verdict slugs; present iff ≥1 mark carried a verdict. */
  verdicts?: string[];
  /** Findings summed across marks carrying finding counts; present iff ≥1 mark carried any. */
  findings?: FleetSemanticFindings;
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
  token_evidence: TokenEvidence;
  /** Where this lane resolved from: `live` → `ref` → `ledger` (plan 052 · T007). */
  source: FleetLaneSource;
  /** Recovered billing units (AIC / token buckets); omitted when none (dossier F-10). */
  billing?: FleetLaneBilling;
  /** The existing per-session evidence object, unchanged (D2 — reused via {@link fold}). */
  evidence: SessionEvidence;
  /** The lane's SEMANTIC (quality/process) rollup (plan 052 · T009); blind lanes flag `semantics_measured:false`. */
  semantics: FleetLaneSemantics;
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

/**
 * The FLEET-level SEMANTIC rollup (plan 052 · T009) — the process/quality shape of the
 * whole run, aggregated across its MEASURED lanes. `measured_lanes`/`blind_lanes` are
 * the honest COVERAGE flags: a consumer reads them FIRST to know how much of the fleet
 * the semantics actually cover (a fleet whose quality work ran in blind lanes reports
 * high `blind_lanes` and omits the dimensions those lanes carried). Each aggregate
 * dimension is present only when ≥1 measured lane carried it — so a fleet with no
 * captured review has NO `findings`/`verdicts` (never `0`), the same OMISSION-not-zero
 * contract as a lane. Counts/enums only (P12).
 */
export interface FleetSemantics {
  /** Lanes with `semantics_measured:true`. */
  measured_lanes: number;
  /** Lanes with `semantics_measured:false` (a blind lane — no artifact/flow-stage capture). */
  blind_lanes: number;
  /** Fleet review findings by severity (summed over measured lanes); present iff any lane captured a review. */
  findings?: FleetSemanticFindings;
  /** Concatenated review verdict paths across measured lanes (orchestrator lane first); present iff any verdict captured. */
  verdicts?: string[];
  /** Total `FIX_REQUIRED → APPROVE` fix cycles across measured lanes; present iff any verdict captured. */
  fix_cycles?: number;
  /** Plan phase count (max across measured lanes — a fleet shares one plan); present iff any plan captured. */
  plan_phases?: number;
  /**
   * Plan complexity score CS-n (max non-null across measured lanes — a fleet shares one plan,
   * so this is the observed value, not a sum); `null` when that plan carried no CS. Travels with
   * {@link plan_phases}: present iff any plan captured.
   */
  plan_cs?: number | null;
  /** Workshop decisions (summed over measured lanes); present iff any workshop captured. */
  workshop_decisions?: number;
  /** Flight-plan node count (max across measured lanes); present iff any flight-plan captured. */
  nodes?: number;
  /** Flight-plan nodes done (max across measured lanes). */
  nodes_done?: number;
  /** Flight-plan chores done (max across measured lanes). */
  chores_done?: number;
  /** Flight-plan chores todo (max across measured lanes). */
  chores_todo?: number;
  /** Per-flow-stage seconds, summed across measured lanes; present iff non-empty. */
  flow_stage_time_s?: Record<string, number>;
}

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
  /** The fleet-level semantic rollup with honest per-lane coverage flags (plan 052 · T009). */
  semantics: FleetSemantics;
}

/**
 * One roster member parsed from a flow-pair `run.json` (`role → {pijId, …}`). Beyond
 * the pij id + role, the member carries the **persisted join keys** flow-pair records
 * at spawn (`harnessSessionId`, `harness`, `transcriptPath`, `model`) — a
 * descriptor-independent fallback so the vendor-ledger join survives `pij close`
 * deleting the peer's `~/.pij/<id>.json` descriptor (SUGG-001).
 */
export interface FleetRosterMember {
  role: string;
  pij_id: string;
  /** `claude | copilot | codex | pi` from run.json, or null when the entry carried none. */
  harness: string | null;
  /** The inner harness session id persisted in run.json — the ledger join key that outlives teardown. */
  harness_session_id: string | null;
  /** The codex rollout transcript path if run.json carried one (used to locate the rollout). */
  transcript_path: string | null;
  /** The member's model label from run.json, or null. */
  model: string | null;
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
    const e = entry as Record<string, unknown> | null;
    const pid = e?.pijId;
    if (typeof pid !== 'string' || pid.length === 0) continue;
    members.push({
      role,
      pij_id: pid,
      harness: rosterStr(e?.harness),
      harness_session_id: rosterStr(e?.harnessSessionId),
      transcript_path: rosterStr(e?.transcriptPath),
      model: rosterStr(e?.model),
    });
  }
  return { members };
}

/** A non-empty string, else null — for lifting optional join keys out of a run.json entry. */
function rosterStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Synthesize a {@link PijDescriptor} from a roster member's persisted run.json join
 * keys (SUGG-001) — the fallback used when `pij close` has already deleted the peer's
 * `~/.pij/<id>.json`, so the vendor ledger still joins after teardown. `null` when the
 * member carries no `harnessSessionId` (nothing to join on).
 */
function rosterDescriptor(m: FleetRosterMember): PijDescriptor | null {
  if (m.harness_session_id === null) return null;
  return {
    pij_id: m.pij_id,
    harness: m.harness,
    harness_session_id: m.harness_session_id,
    transcript_path: m.transcript_path,
    spawned_by: null,
    model: m.model,
  };
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

/** Resolve typed usage once per lane; legacy segment totals are fallback-only. */
function laneTokens(
  segs: readonly Segment[],
  refRecovered?: ReadonlySet<Segment>,
): {
  tokens: FleetLaneTokens;
  measured: boolean;
  token_evidence: TokenEvidence;
} {
  // `?? []` matches this file's own convention two functions later: a pre-v2.0 buffered
  // segment has no `event_stream`, and one stale file used to throw here, be swallowed
  // by `getFleetEvidence`'s catch, and null the ENTIRE fleet read (finding 08).
  const observation = reduceUsageEvents(segs.flatMap((seg) => seg.event_stream ?? []));
  if (observation !== null) {
    const usage = completeUsageTokens(observation);
    return {
      tokens:
        usage === null
          ? { grand_total: 0, output: observation.output ?? 0 }
          : { grand_total: usage.total, output: usage.output },
      measured: usage !== null,
      token_evidence: tokenEvidenceFromObservation(observation, 'live'),
    };
  }

  let grand = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  let measured = false;
  let missing = false;
  for (const seg of segs) {
    // A REF-RECOVERED segment carries its buckets on the turn events, not in a scalar
    // `tokens` projection (the OTLP round trip drops it) — the same fallback the session
    // reader applies, but gated on PROVENANCE. Without it a post-prune fleet lane counted
    // every recovered segment as missing and reported the unflushed delta alone, so the
    // durable union tier 1 had just built could not state its own total (finding 02 ·
    // R3-01). A LIVE segment with null tokens is a different animal wearing the same
    // clothes — a genuinely unmeasured lane, never turn-summed into a false total (AC-02).
    const buckets = seg.tokens ?? (refRecovered?.has(seg) === true ? turnBuckets(seg) : null);
    if (buckets === null) {
      missing = true;
      continue;
    }
    measured = true;
    grand +=
      seg.tokens?.grand_total ??
      buckets.input + buckets.output + buckets.cache_read + buckets.cache_create;
    input += buckets.input;
    output += buckets.output;
    cacheRead += buckets.cache_read;
    cacheCreate += buckets.cache_create;
  }
  const tokenEvidence = tokenEvidenceFromLegacyTokens(
    measured ? { input, output, cache_read: cacheRead, cache_create: cacheCreate } : null,
    'live',
  );
  if (measured && missing) {
    tokenEvidence.coverage = 'partial';
    tokenEvidence.reason = 'source_unavailable';
  }
  if (tokenEvidence.coverage === 'unavailable') {
    const declared = segs
      .map((seg) => transcriptEvidenceReason(seg.token_unavailable_reason))
      .find((reason) => reason !== null);
    if (declared != null) tokenEvidence.reason = declared;
  }
  return {
    tokens: { grand_total: grand, output },
    measured: measured && !missing,
    token_evidence: tokenEvidence,
  };
}

function applyTokenEvidence(lane: FleetLane, tokenEvidence: TokenEvidence): void {
  lane.token_evidence = tokenEvidence;
  const fields = tokenEvidence.fields;
  const complete = tokenEvidence.coverage === 'measured';
  const ledgerTotal = lane.billing?.token_buckets?.total;
  const preserveLedgerTotal = !complete && typeof ledgerTotal === 'number';
  lane.cost_measured = complete || preserveLedgerTotal;
  lane.tokens = complete
    ? {
        grand_total:
          (fields.input.value ?? 0) +
          (fields.output.value ?? 0) +
          (fields.cache_read.value ?? 0) +
          (fields.cache_create.value ?? 0),
        output: fields.output.value ?? 0,
      }
    : preserveLedgerTotal
      ? { grand_total: ledgerTotal, output: lane.tokens.output }
      : { grand_total: 0, output: fields.output.value ?? 0 };
  if (tokenEvidence.source !== null) lane.source = tokenEvidence.source;
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

// ── semantic rollup (plan 052 · T009) ────────────────────────────────────────

/** The blind (unmeasured) lane semantics shell — a lane with NO artifact/flow-stage capture. */
function blindLaneSemantics(): FleetLaneSemantics {
  return { semantics_measured: false, artifact_events: 0 };
}

/** Compare two artifact events by their ISO `t` (older first); NaN sorts last. */
function byArtifactTime(a: ArtifactEvent, b: ArtifactEvent): number {
  const ta = Date.parse(a.t);
  const tb = Date.parse(b.t);
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? 0 : 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

/**
 * The LATEST snapshot per artifact `path` (a re-saved file emits a time series; the
 * final state is its truth). De-dupes so re-saves don't multiply a file's counts.
 */
function latestByPath(events: readonly ArtifactEvent[]): ArtifactEvent[] {
  const byPath = new Map<string, ArtifactEvent>();
  for (const e of [...events].sort(byArtifactTime)) byPath.set(e.path, e);
  return [...byPath.values()];
}

/** Collapse consecutive-duplicate tokens (a verdict path `[FIX,FIX,APPROVE]` → `[FIX,APPROVE]`). */
function dedupeConsecutive(seq: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of seq) if (out[out.length - 1] !== v) out.push(v);
  return out;
}

/** Count `FIX_REQUIRED → APPROVE(_WITH_NOTES)` adjacencies in a deduped verdict path. */
function countFixCycles(seq: readonly string[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    if (
      seq[i - 1] === 'FIX_REQUIRED' &&
      (seq[i] === 'APPROVE' || seq[i] === 'APPROVE_WITH_NOTES')
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Build a lane's {@link FleetLaneSemantics} from its RAW segments (plan 052 · T009).
 * Reads the `artifact` events (plan 050 counts/enums) + `rollup.flow_stage_time_s`;
 * a lane with neither is `semantics_measured:false` (blind — no dimension fields, never
 * zeros). Each dimension is emitted only when its artifact TYPE was captured, so a
 * lane's OMISSIONS are the honest map of what it couldn't see (the review that ran in
 * another lane). Pure; counts/enums only.
 */
function laneSemantics(segs: readonly Segment[]): FleetLaneSemantics {
  const artifacts: ArtifactEvent[] = [];
  const marks: MarkEvent[] = [];
  const flowStage: Record<string, number> = {};
  for (const seg of segs) {
    for (const ev of seg.event_stream ?? []) {
      if (ev.kind === 'artifact') artifacts.push(ev);
      else if (ev.kind === 'mark') marks.push(ev);
    }
    const fst = seg.rollup?.flow_stage_time_s;
    if (fst) for (const [k, v] of Object.entries(fst)) flowStage[k] = (flowStage[k] ?? 0) + v;
  }
  const hasFlowStage = Object.keys(flowStage).length > 0;
  // plan 053: a MARK-ONLY lane (a read-only reviewer that ran no harness command
  // and wrote no file) must NOT be dropped as blind — its mark IS its measured
  // semantic evidence. So the blind-guard now also checks for marks.
  if (artifacts.length === 0 && !hasFlowStage && marks.length === 0) return blindLaneSemantics();

  const sem: FleetLaneSemantics = {
    semantics_measured: true,
    artifact_events: artifacts.length,
  };

  // findings — latest review snapshot per path, summed (a measured review may be 0/0/0/0).
  const reviews = latestByPath(artifacts.filter((e) => e.artifact_type === 'review'));
  if (reviews.length > 0) {
    const f: FleetSemanticFindings = { critical: 0, high: 0, med: 0, low: 0 };
    for (const e of reviews) {
      f.critical += e.counts.findings_critical ?? 0;
      f.high += e.counts.findings_high ?? 0;
      f.med += e.counts.findings_med ?? 0;
      f.low += e.counts.findings_low ?? 0;
    }
    sem.findings = f;
  }

  // verdict path + fix cycles — ALL review verdicts in time order (transitions matter,
  // so this is NOT path-deduped: a review re-saved FIX_REQUIRED→APPROVE is the signal).
  const verdicts = dedupeConsecutive(
    [...artifacts]
      .filter((e) => e.artifact_type === 'review' && e.enums.verdict !== undefined)
      .sort(byArtifactTime)
      .map((e) => e.enums.verdict as string),
  );
  if (verdicts.length > 0) {
    sem.verdicts = verdicts;
    sem.fix_cycles = countFixCycles(verdicts);
  }

  // plan — latest plan snapshot (phases + CS).
  const plans = latestByPath(artifacts.filter((e) => e.artifact_type === 'plan'));
  if (plans.length > 0) {
    const p = plans[plans.length - 1];
    sem.plan_phases = p.counts.phases ?? 0;
    sem.plan_cs = p.counts.cs ?? null;
  }

  // workshop decisions — latest snapshot per workshop path, summed.
  const workshops = latestByPath(artifacts.filter((e) => e.artifact_type === 'workshop'));
  if (workshops.length > 0) {
    sem.workshop_decisions = workshops.reduce((n, e) => n + (e.counts.decisions ?? 0), 0);
  }

  // flight-plan node/chore rollup — latest the-flow.json snapshot.
  const flightPlans = latestByPath(artifacts.filter((e) => e.artifact_type === 'flight-plan'));
  if (flightPlans.length > 0) {
    const fp = flightPlans[flightPlans.length - 1];
    sem.nodes = fp.counts.nodes ?? 0;
    sem.nodes_done = fp.counts.done ?? 0;
    sem.chores_done = fp.counts.chores_done ?? 0;
    sem.chores_todo = fp.counts.chores_todo ?? 0;
  }

  if (hasFlowStage) sem.flow_stage_time_s = flowStage;
  if (marks.length > 0) sem.mark = laneMark(marks);
  return sem;
}

/** Compare two mark events by their ISO `t` (older first); NaN sorts last. */
function byMarkTime(a: MarkEvent, b: MarkEvent): number {
  const ta = Date.parse(a.t);
  const tb = Date.parse(b.t);
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? 0 : 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

/**
 * Aggregate a lane's `mark` events into its {@link FleetLaneMark} (plan 053). Sums
 * finding buckets (additive), collects the ordered verdict path (consecutive-deduped,
 * transitions matter), and lists the distinct mark kinds. Counts/enums only.
 */
function laneMark(marks: readonly MarkEvent[]): FleetLaneMark {
  const kinds = [...new Set(marks.map((m) => m.mark_kind))].sort();
  const m: FleetLaneMark = { marks: marks.length, kinds };

  const verdicts = dedupeConsecutive(
    [...marks]
      .filter((e) => e.verdict !== undefined)
      .sort(byMarkTime)
      .map((e) => e.verdict as string),
  );
  if (verdicts.length > 0) m.verdicts = verdicts;

  let hasFindings = false;
  const f: FleetSemanticFindings = { critical: 0, high: 0, med: 0, low: 0 };
  for (const e of marks) {
    if (
      e.counts.findings_critical !== undefined ||
      e.counts.findings_high !== undefined ||
      e.counts.findings_med !== undefined ||
      e.counts.findings_low !== undefined
    ) {
      hasFindings = true;
    }
    f.critical += e.counts.findings_critical ?? 0;
    f.high += e.counts.findings_high ?? 0;
    f.med += e.counts.findings_med ?? 0;
    f.low += e.counts.findings_low ?? 0;
  }
  if (hasFindings) m.findings = f;

  return m;
}

/**
 * Aggregate the lanes' semantics into the FLEET-level {@link FleetSemantics} (plan 052
 * · T009). `measured_lanes`/`blind_lanes` are the coverage truth; each aggregate
 * dimension is emitted only when ≥1 measured lane carried it (OMISSION-not-zero). Sums
 * ADDITIVE event dimensions (findings, fix_cycles, workshop decisions) and takes the
 * MAX of STRUCTURAL ones (plan phases, flight-plan nodes/chores — a fleet shares one
 * plan/flight-plan, so summing would double-count a re-observed artifact).
 */
function fleetSemantics(lanes: readonly FleetLane[]): FleetSemantics {
  let measured = 0;
  let blind = 0;
  const findings: FleetSemanticFindings = { critical: 0, high: 0, med: 0, low: 0 };
  let hasFindings = false;
  const verdicts: string[] = [];
  let fixCycles = 0;
  let hasVerdict = false;
  let planPhases = 0;
  let planCs: number | null = null;
  let hasPlan = false;
  let workshopDecisions = 0;
  let hasWorkshop = false;
  let nodes = 0;
  let nodesDone = 0;
  let choresDone = 0;
  let choresTodo = 0;
  let hasFlow = false;
  const flowStage: Record<string, number> = {};

  for (const lane of lanes) {
    const s = lane.semantics;
    if (!s.semantics_measured) {
      blind += 1;
      continue;
    }
    measured += 1;
    if (s.findings) {
      hasFindings = true;
      findings.critical += s.findings.critical;
      findings.high += s.findings.high;
      findings.med += s.findings.med;
      findings.low += s.findings.low;
    }
    if (s.verdicts) {
      hasVerdict = true;
      verdicts.push(...s.verdicts);
      fixCycles += s.fix_cycles ?? 0;
    }
    if (s.plan_phases !== undefined) {
      hasPlan = true;
      planPhases = Math.max(planPhases, s.plan_phases);
      // plan_cs travels with plan_phases; take the max non-null (a fleet shares one plan,
      // so this is that plan's CS — null stays null until a measured lane carries a CS).
      if (s.plan_cs !== undefined && s.plan_cs !== null) {
        planCs = planCs === null ? s.plan_cs : Math.max(planCs, s.plan_cs);
      }
    }
    if (s.workshop_decisions !== undefined) {
      hasWorkshop = true;
      workshopDecisions += s.workshop_decisions;
    }
    if (s.nodes !== undefined) {
      hasFlow = true;
      nodes = Math.max(nodes, s.nodes);
      nodesDone = Math.max(nodesDone, s.nodes_done ?? 0);
      choresDone = Math.max(choresDone, s.chores_done ?? 0);
      choresTodo = Math.max(choresTodo, s.chores_todo ?? 0);
    }
    if (s.flow_stage_time_s) {
      for (const [k, v] of Object.entries(s.flow_stage_time_s)) {
        flowStage[k] = (flowStage[k] ?? 0) + v;
      }
    }
  }

  const out: FleetSemantics = { measured_lanes: measured, blind_lanes: blind };
  if (hasFindings) out.findings = findings;
  if (hasVerdict) {
    out.verdicts = verdicts;
    out.fix_cycles = fixCycles;
  }
  if (hasPlan) {
    out.plan_phases = planPhases;
    out.plan_cs = planCs;
  }
  if (hasWorkshop) out.workshop_decisions = workshopDecisions;
  if (hasFlow) {
    out.nodes = nodes;
    out.nodes_done = nodesDone;
    out.chores_done = choresDone;
    out.chores_todo = choresTodo;
  }
  if (Object.keys(flowStage).length > 0) out.flow_stage_time_s = flowStage;
  return out;
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
 *
 * `refRecovered` names which of `segments` came from the committed ref (see
 * {@link DurableSegments.refRecovered}); omitting it reads every segment as live.
 */
export function buildFleetEvidence(
  rootPijId: string,
  segments: readonly Segment[],
  roster: FleetRoster | null,
  refRecovered?: ReadonlySet<Segment>,
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
    const { tokens, measured, token_evidence } = laneTokens(segs, refRecovered);
    const evidence = fold(sid, segs);
    return {
      pij_id: sid,
      role: roleOf.get(sid) ?? null,
      harness: harnessOf.get(sid) ?? evidence.harness,
      model: laneModel(segs),
      cost_measured: measured,
      tokens,
      token_evidence,
      source: 'live',
      evidence,
      semantics: laneSemantics(segs),
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
    semantics: fleetSemantics(sessions),
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
      return degradedLedgerLane(pijId, role, 'copilot', desc);
    }
    if (led.token_buckets === null) {
      const lane = degradedLedgerLane(pijId, role, 'copilot', desc);
      lane.billing = { nano_aiu: led.nano_aiu };
      return lane;
    }
    const b = led.token_buckets;
    const grand = (b.input ?? 0) + (b.output ?? 0) + (b.cache_read ?? 0) + (b.cache_create ?? 0);
    return {
      pij_id: pijId,
      role,
      harness: 'copilot',
      model: desc.model,
      cost_measured: true,
      tokens: { grand_total: grand, output: b.output ?? 0 },
      token_evidence: tokenEvidenceFromObservation(
        {
          t: '1970-01-01T00:00:00.000Z',
          observation_kind: 'final_shutdown',
          ...(b.input === undefined ? {} : { input: b.input }),
          ...(b.output === undefined ? {} : { output: b.output }),
          ...(b.cache_read === undefined ? {} : { cache_read: b.cache_read }),
          ...(b.cache_create === undefined ? {} : { cache_create: b.cache_create }),
          nano_aiu: led.nano_aiu,
        },
        'ledger',
      ),
      source: 'ledger',
      billing: { nano_aiu: led.nano_aiu, token_buckets: { ...b } },
      evidence: ledgerEvidence(pijId, desc.harness_session_id, 'copilot'),
      semantics: blindLaneSemantics(),
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
    const hasBuckets =
      b.input !== null || b.output !== null || b.cached !== null || b.reasoning !== null;
    const observation = {
      t: '1970-01-01T00:00:00.000Z',
      observation_kind: 'final_shutdown' as const,
      ...(b.input === null ? {} : { input: Math.max(b.input - (b.cached ?? 0), 0) }),
      ...(b.output === null ? {} : { output: b.output }),
      ...(b.cached === null ? {} : { cache_read: b.cached }),
      // NO synthesized `cache_create` (finding 09): codex reports input/cached/output/
      // reasoning and has no cache-write concept, so the bucket is ABSENT, not zero.
      // The lane is honestly `partial` rather than `measured` on an invented number.
    };
    const codexEvidence = tokenEvidenceFromObservation(hasBuckets ? observation : null, 'ledger');
    if (codexEvidence.coverage === 'partial' && codexEvidence.reason === 'partial_observation') {
      codexEvidence.reason = 'vendor_field_absent';
    }
    return {
      pij_id: pijId,
      role,
      harness: 'codex',
      model: desc.model,
      cost_measured: true,
      tokens: { grand_total: b.total, output: b.output ?? 0 },
      token_evidence: codexEvidence,
      source: 'ledger',
      billing: {
        token_buckets: {
          ...(b.input === null ? {} : { input: b.input }),
          ...(b.output === null ? {} : { output: b.output }),
          ...(b.cached === null ? {} : { cached: b.cached }),
          ...(b.reasoning === null ? {} : { reasoning: b.reasoning }),
          total: b.total,
        },
      },
      evidence: ledgerEvidence(pijId, desc.harness_session_id, 'codex'),
      semantics: blindLaneSemantics(),
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
    token_evidence: tokenEvidenceFromObservation(null, 'ledger'),
    source: 'ledger',
    evidence: ledgerEvidence(pijId, desc.harness_session_id, harness),
    semantics: blindLaneSemantics(),
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
    semantics: { measured_lanes: 0, blind_lanes: 0 },
  };
}

/** Recompute cost/segment totals AND the fleet semantics over the current lanes (time stays — ledger lanes have no span). */
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
  // Lanes changed (orphans promoted to ref/ledger lanes) → re-aggregate the semantic
  // coverage so `blind_lanes` reflects every newly-added (semantics-blind) side channel.
  fleet.semantics = fleetSemantics(fleet.sessions);
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
    token_evidence: ref.token_evidence,
    source: 'ref',
    evidence: ledgerEvidence(pijId, desc.harness_session_id, desc.harness ?? 'unknown'),
    // The ref reader (T005) recovers COST only, not the artifact event stream, so a
    // ref-resolved lane is semantically blind until ref-side artifact extraction lands
    // (documented follow-on) — never zero-filled.
    semantics: blindLaneSemantics(),
  };
}

/**
 * Resolve each roster orphan (a rostered member with no LIVE lane) against the ref
 * source then the vendor ledger — precedence **ref → ledger** (plan 052 · T005/T007),
 * live having already won for any member in `sessions`. Resolved members are promoted
 * into `sessions` (source `ref`/`ledger`) and dropped from `orphans`; children are
 * re-sorted by descending cost with the orchestrator first. Cost/segment totals are
 * recomputed; time is untouched. Mutates `fleet` in place.
 *
 * `liveUnionComplete` reports whether tier 1's durable union succeeded — see the ref
 * candidate's redundancy rule in the merge loop below (R3-01).
 */
function enrichOrphans(
  fleet: FleetEvidence,
  roster: FleetRoster,
  registry: PijRegistry,
  refLanes: Map<string, RefLane>,
  deps: SessionEvidenceDeps,
  liveUnionComplete: boolean,
): void {
  const roleOf = new Map(roster.members.map((m) => [m.pij_id, m.role] as const));
  const memberOf = new Map(roster.members.map((m) => [m.pij_id, m] as const));
  const resolved: FleetLane[] = [];
  const remaining: string[] = [];
  for (const pijId of fleet.orphans) {
    // Prefer the LIVE pij descriptor; fall back to the roster's persisted run.json join
    // keys when `pij close` has deleted `~/.pij/<id>.json` (SUGG-001) — a
    // descriptor-independent join so a torn-down fleet still resolves its ledgers. The
    // live/bound descriptor always wins when present, so this is byte-inert pre-teardown.
    const member = memberOf.get(pijId);
    const desc = registry.by_pij.get(pijId) ?? (member ? rosterDescriptor(member) : null);
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
  if (resolved.length > 0) {
    const orch = fleet.sessions.find((lane) => lane.pij_id === fleet.root_pij_id) ?? null;
    const children = [
      ...fleet.sessions.filter((lane) => lane.pij_id !== fleet.root_pij_id),
      ...resolved,
    ].sort(
      (a, b) => b.tokens.grand_total - a.tokens.grand_total || a.pij_id.localeCompare(b.pij_id),
    );
    fleet.sessions = orch ? [orch, ...children] : children;
    fleet.orphans = remaining.sort();
  }

  for (const lane of fleet.sessions) {
    const member = memberOf.get(lane.pij_id);
    const desc = registry.by_pij.get(lane.pij_id) ?? (member ? rosterDescriptor(member) : null);
    if (desc === null) continue;
    const candidates: TokenEvidence[] = [lane.token_evidence];
    const ref = desc.harness_session_id ? refLanes.get(desc.harness_session_id) : undefined;
    // A LIVE lane whose tier-1 durable union succeeded already CONTAINS this ref's
    // segments — `durableSegments` unions the ref-recovered flushed half with the
    // buffer's unflushed delta — so the same-session ref candidate is redundant by
    // construction, and for a still-running session it is a strict PREFIX. Stamped
    // `session_total` (scope 3) that prefix outranked the fuller union (scope 2) and
    // the lane silently reported the flushed half as the whole session (R3-01). The
    // ref still stands alone for ref-RESOLVED lanes (plan 052 · AC-06), and still
    // participates whenever the union could not be completed.
    const refRedundant = liveUnionComplete && lane.source === 'live';
    if (ref !== undefined && !refRedundant) candidates.push(ref.token_evidence);
    const ledger =
      lane.source === 'ledger' ? null : buildLedgerLane(lane.pij_id, lane.role, desc, deps);
    if (ledger !== null) {
      candidates.push(ledger.token_evidence);
      if (lane.billing === undefined && ledger.billing !== undefined) lane.billing = ledger.billing;
    }
    applyTokenEvidence(lane, mergeTokenEvidence(candidates));
  }
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
    /** Did the durable union behind the live lanes complete? (R3-01, read below.) */
    let liveUnionComplete = false;
    for (const telDir of candidateRoots(rootPijId, deps, opts)) {
      // Undo any mid-session prune first: a live lane whose buffer was flushed holds
      // only the delta since the last commit, and reporting that as the lane total is
      // the same silent under-report the session reader had (finding 02).
      const buffered = readBufferedSegments(deps.fs, telDir);
      const { segments, flushedUnreachable, refRecovered } = durableSegments(buffered, telDir, {
        fs: deps.fs,
        ...(opts?.gitRead ? { gitRead: opts.gitRead } : {}),
      });
      const built = buildFleetEvidence(rootPijId, segments, roster, new Set(refRecovered));
      if (built !== null) {
        if (flushedUnreachable) {
          for (const lane of built.sessions) {
            if (lane.token_evidence.coverage === 'unavailable') continue;
            lane.token_evidence.coverage = 'partial';
            lane.token_evidence.reason = 'flushed_segments_unreadable';
          }
        }
        liveUnionComplete = !flushedUnreachable;
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
      // Also enrich when the registry is unavailable (every peer torn down → `~/.pij`
      // emptied) but the roster still carries run.json join keys — the SUGG-001 fallback,
      // the ONLY join left once `pij close` has deleted the descriptors.
      const rosterHasJoinKeys = roster.members.some((m) => m.harness_session_id !== null);
      if (registry.available || refLanes.size > 0 || rosterHasJoinKeys) {
        enrichOrphans(fleet, roster, registry, refLanes, deps, liveUnionComplete);
      }
    }

    return fleet.sessions.length > 0 ? fleet : null;
  } catch {
    return null;
  }
}
