/**
 * `TelemetryReport` (plan 047 Phase 2) — roll up **1..N** saved `SessionExport`
 * files into one validatable, renderable report. Mirrored by `report.schema.json`.
 *
 * THE SUBSTRATE (workshop 002 + the two Phase-2 decisions in `execution.log.md`):
 * every dimension derives from the ONE lossless event stream a `SessionExport`
 * carries — `otlpLogsToEvents(export.signals.logs)` — never from per-segment
 * cumulative metrics (KF-02/KF-03). Counts are **EXACT** (event counts); time and
 * tokens are **ESTIMATES** with a declared method (`attribution`), never a ledger.
 *
 * Five dimensions, ONE row shape (`RollupEntry`) so the HTML renders them all with
 * one component:
 *  - `flow_stage`   — FlowEvent-PRIMARY (T1.4): nav-derived `flow` events bracket
 *                     the stage windows (`stage` = the `the-flow.json` nav node id),
 *                     with the `/the-flow` digit bracket as the FALLBACK and
 *                     `unlabeled` only when neither exists; active time + non-cache
 *                     tokens per window. A versioned semantic map (node id →
 *                     research/plan/implement/review/ship) adds `semantic_stage`,
 *                     and the per-window mechanism (flow/digit/unlabeled) counts +
 *                     map version ride in `provenance`.
 *  - `skill`        — `skill` event names (count = runs, == `computeRollup.skills[n].runs`).
 *  - `tool`         — `tools` event names (count = Σ burst counts, == `computeRollup.tools[n]`).
 *  - `bash_command` — shell-family `tools` events keyed by the captured command
 *                     SIGNATURE (`rg`, `git commit` — program+verb only, P12-safe)
 *                     when present (FX001), else the lowercased tool name
 *                     (`bash`/`shell`); EXCLUDES co-timed `harness …` invocations
 *                     to avoid double-count.
 *  - `harness_command` ⭐ — `harness` event verbs (`doctor`, `flow nav`) (D2).
 *
 * PURE SERVICE (P2): imports ports **type-only**, no `node:*` / git / clock. The
 * caller (`acts/telemetry.ts`) does the fs sweep, path sanitation, and injects
 * `generated_at` from its clock.
 */

import { otlpLogsToEvents } from './otlp/logs.js';
import type { PublishedDataCoverage } from './published-telemetry.js';
import {
  type Authorship,
  classifyGap,
  computeAuthorship,
  computeRollup,
  IDLE_CAP_S,
  type ObservedPath,
  parseIso,
} from './rollup.js';
import type { SessionExport } from './session-export.js';
import type { TokenEvidenceReason } from './token-evidence.js';
import { completeUsageTokens, reduceUsageEvents } from './usage-observation.js';

export const TELEMETRY_REPORT_SCHEMA_VERSION = 'harness.telemetry-report/v1' as const;

/** The five rollup lenses over the event stream. */
export type ReportDimension = 'flow_stage' | 'skill' | 'tool' | 'bash_command' | 'harness_command';

export const REPORT_DIMENSIONS: readonly ReportDimension[] = [
  'flow_stage',
  'skill',
  'tool',
  'bash_command',
  'harness_command',
] as const;

/** Row ordering key (`--sort`). */
export type ReportSortKey = 'tokens' | 'time' | 'count';

/**
 * Per-dimension token attribution (FX002) — `input` and `output` kept SEPARATE,
 * both NON-CACHE. `input` = fresh (non-cached) turn input; `output` = generated
 * tokens. `cache_read`/`cache_create` are NEVER attributed per-dimension — they
 * are the cost of the CONVERSATION re-reading its own context, surfaced at the
 * session level only ({@link ReportTotals.cache}, labelled "context re-reads").
 */
export interface RollupTokens {
  input: number;
  output: number;
}

/** One row — identical across every dimension so the HTML renders them uniformly. */
export interface RollupEntry {
  /** `'rg'` | `'harness nav'` | `'the-flow'` | `'Read'` | `'08'`. */
  key: string;
  /** EXACT (event/segment count). */
  count: number;
  /**
   * ESTIMATE — active (idle-excluded) time. Present ONLY for the lenses that own
   * a window: `skill` (this-call → next-skill-call span) and `flow_stage`
   * (between consecutive `/the-flow` calls). OMITTED for the command lenses
   * (`tool`/`bash_command`/`harness_command`) — the capture carries no honest
   * per-call duration (FX002 Note), so a command row shows NO time at all.
   */
  time_s?: number;
  /** ESTIMATE — non-cache `{ input, output }` (FX002). */
  tokens: RollupTokens;
  /**
   * The `flow_stage` lens ONLY (T1.4/D3): the versioned semantic-map projection of
   * `key` (a nav node id / digit) onto `research|plan|implement|review|ship`.
   * OMITTED when the label has no mapping (a bare digit, `unlabeled`) — an honest
   * absence, never a guessed stage. The map version is in
   * {@link ReportProvenance.flow_stage_map_version}.
   */
  semantic_stage?: string;
}

export interface Rollup {
  dimension: ReportDimension;
  /** Sorted desc (default `input + output`; `--sort` overrides). */
  entries: RollupEntry[];
  /** `time_s` present only for the time-bearing lenses (skill / flow_stage). */
  total: { count: number; time_s?: number; tokens: RollupTokens };
  /** Rows dropped past a `--top` cap — surfaced, never silent. */
  truncated?: number;
}

export interface ReportScope {
  session_count: number;
  /** `true` ⇒ one-session report (the only N=1-vs-N>1 shape difference). */
  single: boolean;
  /** `harness_session_id`s rolled up (capped list ⇒ see `provenance.session_count`). */
  session_ids: string[];
}

/** What narrowed this report. An empty/absent field = that facet unfiltered. */
export interface ReportFilter {
  harness?: string[];
  model?: string[];
  branch?: string[];
  /**
   * Applied by {@link buildReportFromInputs} when inputs carry repository identity.
   * Echo-only in {@link buildReport}'s legacy SessionExport branch, whose v1
   * contract has no repository facet.
   */
  repo?: string[];
  date_from?: string;
  date_to?: string;
}

/** Session-level context re-reads (FX002) — cache is NEVER attributed per-dimension. */
export interface SessionCache {
  /** `cache_read` — the model re-reading its whole context each turn. */
  read: number;
  /** `cache_create` — context written to the cache. */
  create: number;
}

export interface ReportTotals {
  /** ACTIVE time (agent + human, idle excluded) — never wall-span (FX002-5). */
  time_s: number;
  /** Non-cache `{ input, output }` (FX002). */
  tokens: RollupTokens;
  /** Context re-reads (cache), session-level ONLY — labelled, never per-dimension. */
  cache: SessionCache;
  sessions: number;
  /**
   * Friction proxies (plan 056, workshop D6): non-zero `command_exit` + `api_error`
   * counts across the cohort — the denominator of the observe→friction conversion.
   * Optional: a report deserialized from before this field is honestly absent.
   */
  friction?: { command_errors: number; api_errors: number };
  /** `harness observe` invocations across the cohort (the conversion numerator). */
  observe_events?: number;
  /**
   * Retro-drain aggregates (plan 056): summed `observations` + `disp_*` counts from
   * `retro` artifact events. Zero when no 1.2 records exist yet (T0). Counts-only.
   */
  retro?: { observations: number; dispositions: Record<string, number> };
}

/**
 * How to read the numbers — so a reader never mistakes an estimate for a ledger.
 * `note`/`bash_command_key` declare the D1 substrate reality in-band.
 */
export interface ReportAttribution {
  tokens: string;
  time: string;
  exact: string[];
  bash_command_key: string;
  notes: string[];
}

/** Rendered at the BOTTOM of the HTML — exactly what the numbers are made of. */
export interface ReportFieldCoverage {
  available: number;
  unavailable: number;
  excluded: number;
}

export interface ReportInputCoverage {
  accepted_sessions: number;
  event_substrate_sessions: number;
  kinds: { full: number; partial: number; identity_only: number };
  fields: { events: ReportFieldCoverage; measurements: ReportFieldCoverage };
  repositories: Array<{ key: string; identity: string; sessions: number }>;
  gaps: string[];
}

export interface EvidenceMeasure {
  state: 'measured' | 'unavailable';
  value: number | null;
  contributors: number;
}

export interface TelemetryReportInput {
  /** Explicit provenance: repository filtering applies only to `bundle`. */
  origin: 'legacy' | 'bundle';
  kind: 'full' | 'partial' | 'identity-only';
  repositoryKey: string;
  repository: string;
  sessionId: string;
  sessionExport: SessionExport | null;
  coverage: PublishedDataCoverage;
  gaps: string[];
}

export interface ReportProvenance {
  date_range: { from: string; to: string };
  repos: string[];
  branches: string[];
  harnesses: string[];
  models: string[];
  /** Authoritative N (`scope.session_ids` may be capped). */
  session_count: number;
  source_paths: string[];
  generated_at: string;
  /** The pinned semantic stage-map version applied to the `flow_stage` lens (T1.4). */
  flow_stage_map_version: string;
  /** Per-window labeling mechanism counts for the `flow_stage` lens (T1.4). */
  flow_stage_mechanism: FlowStageMechanism;
  /** Sessions with real token data vs a declared token gap (T1.6 / AC-04). */
  token_coverage: TokenCoverage;
  /**
   * Events excluded from active-time accrual because their `t_precision` is
   * `interval` — a capture-window stamp, not a work instant (plan 066 file
   * events). They still count everywhere non-temporal. Surfaced so the exclusion
   * is VISIBLE rather than a silently shorter clock (plan 068 item 2).
   */
  interval_events: number;
  /** Present only for bundle-derived full/partial/identity inputs. */
  input_coverage?: ReportInputCoverage;
}

export interface TelemetryReport {
  schema_version: typeof TELEMETRY_REPORT_SCHEMA_VERSION;
  scope: ReportScope;
  filter: ReportFilter;
  totals: ReportTotals;
  rollups: {
    flow_stage: Rollup;
    skill: Rollup;
    tool: Rollup;
    /** EXCLUDES `harness …` invocations (D1). */
    bash_command: Rollup;
    /** ⭐ the prominent, dedicated dimension (D2). */
    harness_command: Rollup;
  };
  attribution: ReportAttribution;
  provenance: ReportProvenance;
  /**
   * SINGLE-session reports ONLY (plan 048 Phase 2): the ordered, closed-allowlist
   * control-marker stream ({@link TimelineMarker}). Absent on cohort/aggregate
   * reports — the insights layer's discipline panel + subagent section degrade
   * honestly when it is missing.
   */
  control_timeline?: TimelineMarker[];
  /**
   * The "which files did agents write, and how much" surface (plan 056): per-file
   * write/edit deltas aggregated from the `file` events across every included
   * session. Absent when no session carried a `file` event (older captures).
   */
  authorship?: Authorship;
  /** Present only for bundle-derived evidence; measured zero requires a contributor. */
  evidence_totals?: { events: EvidenceMeasure; measurements: EvidenceMeasure };
}

export interface BuildReportOptions {
  /** Facets to narrow by; `repo` applies to tagged bundle inputs and is echo-only for legacy exports. */
  filter?: ReportFilter;
  /** Row ordering per rollup. Default `'tokens'`. */
  sort?: ReportSortKey;
  /** Cap rows per rollup (records `rollup.truncated`; never silent). */
  top?: number;
  /** The input paths swept to build this (already repo-relative / home-stripped by the caller). */
  sourcePaths?: string[];
  /** ISO instant from the caller's clock (P2: the service never reads a clock). */
  generatedAt?: string;
  /** Cap for `scope.session_ids` (provenance keeps the authoritative count). Default 200. */
  sessionIdCap?: number;
}

// ── Event-stream helpers ────────────────────────────────────────────────────

/** A shell-family tool (its lowercased name) — the bash_command source (D1). */
function shellKey(name: string): string | null {
  const n = name.toLowerCase();
  return n === 'bash' || n === 'sh' || n === 'shell' ? n : null;
}

/** The skill whose consecutive calls bracket the report-time flow_stage lens (FX002-4). */
const THE_FLOW_SKILL = 'the-flow';
/** Stage label for a `/the-flow` call with no leading-digit arg (FX001 Facet B absent). */
const UNLABELED_STAGE = 'unlabeled';

/**
 * The versioned semantic stage map (T1.4 / WS001 D3). The `flow_stage` lens labels
 * a window with the RAW nav node id (`research`, `phase-5`, `review-2`, …); this
 * map projects that id onto the five canonical stages so cross-plan economics
 * aggregate. Owned by the REPORT layer (not capture — capture stays dumb) and
 * VERSIONED: the version rides in `provenance.flow_stage_map_version` so a
 * re-mapping is a visible, comparable change, never a silent re-label. Unmapped
 * ids (a bare digit, `unlabeled`) return `null` — an honest gap, never a guess.
 */
export const FLOW_STAGE_MAP_VERSION = 'flow-stage-map/v1' as const;

/** The five canonical semantic stages a nav node id maps onto (T1.4). */
export type SemanticStage = 'research' | 'plan' | 'implement' | 'review' | 'ship';

/**
 * Project a raw flow-stage label (a `the-flow.json` nav node id) onto a
 * {@link SemanticStage}, or `null` when it maps to nothing (honest — a digit
 * bracket or `unlabeled` has no semantic stage). Pattern rules (v1): `research`→
 * research; `plan`/`workshop*`→plan; `phase-*`/`implement*`→implement;
 * `review*`→review; `ship`→ship.
 */
export function semanticStage(label: string): SemanticStage | null {
  const s = label.toLowerCase();
  if (s === 'research') return 'research';
  if (s === 'plan' || s.startsWith('workshop')) return 'plan';
  if (s === 'ship') return 'ship';
  if (s.startsWith('phase-') || s.startsWith('phase') || s.startsWith('implement')) {
    return 'implement';
  }
  if (s.startsWith('review')) return 'review';
  return null;
}

/**
 * Which mechanism labeled each `flow_stage` window (T1.4, addendum 2). Historical
 * months carry ~zero FlowEvents, so the lens MUST declare per-window provenance:
 * `flow` = a nav-derived `flow` event (PRIMARY); `digit` = a `/the-flow <n>`
 * bracket (FALLBACK); `unlabeled` = a `/the-flow` call with neither. Recorded in
 * `provenance.flow_stage_mechanism` so a reader knows how much of the stage
 * economics rests on the authoritative nav source vs the weaker digit proxy.
 */
export interface FlowStageMechanism {
  flow: number;
  digit: number;
  unlabeled: number;
  /**
   * Windows labeled by a `cursor-moved` `flow_log` transition mark (plan 057
   * T003, AC-01): stage(event) = latest transition at-or-before the event's `t`
   * — a point LOOKUP over marks merged with the in-stream `flow` anchors. The
   * lookup never re-sorts `flow_log` into gap/wall math (the rollup exclusion —
   * events.ts clock-distortion guard — is preserved); it is also retroactive:
   * pre-057 refs whose flight-plan history carries cursor-moves gain per-stage
   * attribution with no recapture.
   */
  flow_log: number;
}

/**
 * How many swept sessions carried real token data vs none (T1.6 / AC-04). A
 * v2.0-era thin shard (turns with no usage attrs) is `unmeasured` — DECLARED here
 * so a swept month never presents a token gap as a fabricated zero. `measured` +
 * `unmeasured` == the report's session_count.
 */
export interface TokenCoverage {
  measured: number;
  unmeasured: number;
  partial: number;
  unavailable: number;
  reasons: Partial<Record<TokenEvidenceReason, number>>;
  causes: { unknown: number };
}

/**
 * The CLOSED allowlist of event kinds that may surface as a {@link TimelineMarker}
 * (plan 048 Phase 2, Q2). The `control_timeline` is the ONLY ordered evidence the
 * insights layer's discipline panel (sequence joins) and subagent section consume;
 * it is a P12-safe **control** stream — deliberately NOT a general event dump. Only
 * kinds whose one discriminant field is already an allowlisted, non-sensitive
 * marker (a verb / a status / a fixed agent slug / a branch / a command SIGNATURE —
 * never args, paths, or content) are admitted. Adding any other kind (e.g.
 * `prompt`) would turn the timeline into a replayable event log — forbidden.
 */
export const TIMELINE_KINDS = ['harness', 'checks', 'subagent', 'branch', 'bash'] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * One ordered control marker (plan 048 Phase 2). `key` is the SINGLE P12-safe
 * discriminant per kind: `harness`→verb, `checks`→status, `subagent`→name,
 * `branch`→to (new branch), `bash`→a git push/commit SIGNATURE (program+verb
 * only, FX001). Ordered ascending by `t`. Emitted ONLY into single-session reports
 * ({@link ReportScope.single}) — a cohort/aggregate report never carries one, so
 * the insights layer degrades the panel/subagent sections honestly when it is
 * absent.
 */
export interface TimelineMarker {
  kind: TimelineKind;
  key: string;
  t: string;
}

/**
 * The git command SIGNATURES that become a `bash` timeline marker — the ONLY
 * non-harness commands the discipline panel needs (a real `push` signal for
 * checks-before-push; `commit` for retro cadence). Kept tiny + explicit so the
 * timeline never widens into a general shell log.
 */
const TIMELINE_BASH_SIGNATURES = new Set(['git push', 'git commit']);

/**
 * Project one session's ordered event stream onto the closed-allowlist
 * {@link TimelineMarker} sequence. Every branch reads exactly one already-captured,
 * P12-safe field; a kind not in {@link TIMELINE_KINDS} (prompt/turn/tools[non-git]/
 * skill/flow/…) produces NOTHING. `events` is expected pre-sorted ascending by `t`
 * (as {@link viewOf} returns), so the output inherits that order.
 */
function buildControlTimeline(events: SessionView['events']): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  for (const e of events) {
    if (e.kind === 'harness') out.push({ kind: 'harness', key: e.verb, t: e.t });
    else if (e.kind === 'checks') out.push({ kind: 'checks', key: e.status, t: e.t });
    else if (e.kind === 'subagent') out.push({ kind: 'subagent', key: e.name, t: e.t });
    else if (e.kind === 'branch') out.push({ kind: 'branch', key: e.to, t: e.t });
    else if (
      e.kind === 'tools' &&
      e.signature !== undefined &&
      TIMELINE_BASH_SIGNATURES.has(e.signature)
    ) {
      out.push({ kind: 'bash', key: e.signature, t: e.t });
    }
  }
  return out;
}

/** A turn's NON-cache input (fresh) — never `cache_read`/`cache_create` (FX002). 0 for non-turns. */
function turnInput(e: { kind: string; in?: number }): number {
  return e.kind === 'turn' ? (e.in ?? 0) : 0;
}
/** A turn's generated output. 0 for non-turns. */
function turnOutput(e: { kind: string; out?: number }): number {
  return e.kind === 'turn' ? (e.out ?? 0) : 0;
}

/** A per-session, time-ordered view of the stream with the derived rollup (flow_log excluded). */
interface SessionView {
  export: SessionExport;
  /** Sorted asc by `t`, `flow_log` markers removed (replay-only — KF gap math). */
  events: ReturnType<typeof otlpLogsToEvents>;
  rollup: ReturnType<typeof computeRollup>;
  /**
   * The `cursor-moved` stage-transition marks extracted BEFORE the `flow_log`
   * filter (plan 057 T003) — `{t, to}` sorted asc. Consumed only by the
   * flow_stage lens's last-transition LOOKUP; never re-enters the event stream.
   */
  cursorMarks: readonly { t: string; to: string }[];
}

function viewOf(exp: SessionExport): SessionView {
  const all = otlpLogsToEvents(exp.signals.logs);
  const cursorMarks = all
    .filter(
      (e): e is Extract<(typeof all)[number], { kind: 'flow_log' }> =>
        e.kind === 'flow_log' && e.op === 'cursor-moved',
    )
    .filter((e) => typeof e.to === 'string' && e.to.length > 0)
    .map((e) => ({ t: e.t, to: e.to as string }))
    .sort((a, b) => parseIso(a.t) - parseIso(b.t));
  const events = all
    .filter((e) => e.kind !== 'flow_log')
    .sort((a, b) => parseIso(a.t) - parseIso(b.t));
  return { export: exp, events, rollup: computeRollup(events), cursorMarks };
}

// ── Accumulator (mutable per-dimension row map, folded across sessions) ──────

interface Cell {
  count: number;
  time_s: number;
  input: number;
  output: number;
}

class DimAcc {
  private readonly cells = new Map<string, Cell>();

  cell(key: string): Cell {
    let c = this.cells.get(key);
    if (c === undefined) {
      c = { count: 0, time_s: 0, input: 0, output: 0 };
      this.cells.set(key, c);
    }
    return c;
  }

  addCount(key: string, n: number): void {
    if (n > 0) this.cell(key).count += n;
  }

  addTime(key: string, s: number): void {
    if (s > 0) this.cell(key).time_s += s;
  }

  addTokens(key: string, input: number, output: number): void {
    const c = this.cell(key);
    c.input += input;
    c.output += output;
  }

  /**
   * Snapshot to a finished, sorted, optionally-truncated `Rollup`. `withTime`
   * gates the `time_s` field: the command lenses (`tool`/`bash_command`/
   * `harness_command`) pass `false` so no time appears on any command row (FX002 —
   * the capture has no honest per-call duration); `skill`/`flow_stage` pass `true`.
   */
  /**
   * Snapshot to a finished, sorted, optionally-truncated `Rollup`. `withTime`
   * gates the `time_s` field: the command lenses (`tool`/`bash_command`/
   * `harness_command`) pass `false` so no time appears on any command row (FX002 —
   * the capture has no honest per-call duration); `skill`/`flow_stage` pass `true`.
   * `semanticOf` (flow_stage only) projects each key onto a semantic stage (T1.4).
   */
  finish(
    dimension: ReportDimension,
    sort: ReportSortKey,
    withTime: boolean,
    top?: number,
    semanticOf?: (key: string) => string | null,
  ): Rollup {
    const entries: RollupEntry[] = [...this.cells.entries()]
      .filter(([key]) => key.length > 0)
      .map(([key, c]) => {
        const entry: RollupEntry = {
          key,
          count: Math.round(c.count),
          tokens: { input: Math.round(c.input), output: Math.round(c.output) },
        };
        if (withTime) entry.time_s = Math.round(c.time_s);
        if (semanticOf !== undefined) {
          const sem = semanticOf(key);
          if (sem !== null) entry.semantic_stage = sem;
        }
        return entry;
      });
    sortEntries(entries, sort);

    const total = entries.reduce(
      (acc, e) => {
        acc.count += e.count;
        acc.time_s += e.time_s ?? 0;
        acc.tokens.input += e.tokens.input;
        acc.tokens.output += e.tokens.output;
        return acc;
      },
      { count: 0, time_s: 0, tokens: { input: 0, output: 0 } },
    );

    const rollupTotal: Rollup['total'] = {
      count: total.count,
      tokens: total.tokens,
    };
    if (withTime) rollupTotal.time_s = total.time_s;

    const rollup: Rollup = { dimension, entries, total: rollupTotal };
    if (top !== undefined && top >= 0 && entries.length > top) {
      rollup.truncated = entries.length - top;
      rollup.entries = entries.slice(0, top);
    }
    return rollup;
  }
}

/** Sort rows desc by the chosen measure; stable key-asc tiebreak (deterministic output). */
function sortEntries(entries: RollupEntry[], sort: ReportSortKey): void {
  const measure = (e: RollupEntry): number =>
    sort === 'time'
      ? (e.time_s ?? 0)
      : sort === 'count'
        ? e.count
        : e.tokens.input + e.tokens.output;
  entries.sort((a, b) => {
    const d = measure(b) - measure(a);
    return d !== 0 ? d : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// ── Per-session dimension folding ───────────────────────────────────────────

interface Accs {
  flow_stage: DimAcc;
  skill: DimAcc;
  tool: DimAcc;
  bash_command: DimAcc;
  harness_command: DimAcc;
}

/**
 * Fold ONE session's events into the shared accumulators (FX002 attribution).
 * Cross-session aggregation is just calling this per session (re-aggregate from
 * Logs, never sum cumulative metrics — KF-03). Three report-time lenses over one
 * idle-classified timeline:
 *  - **command** (`tool`/`bash_command`/`harness_command`): count + `{input,output}`,
 *    NO time. `output` = even share of the LAUNCHING turn's out; `input` = share of
 *    the FOLLOWING turn's non-cache in (byte-weighted by FX003 `result_tokens` when
 *    present, else even).
 *  - **skill**: count + active time (this call → next skill call) + non-cache in/out.
 *  - **flow_stage** (T1.4): FlowEvent-PRIMARY — nav-derived `flow` events bracket
 *    the stage windows (`stage` = node id); the `/the-flow` digit bracket is the
 *    FALLBACK (only when no `flow` event exists); `unlabeled` only when neither.
 *    Returns the per-window mechanism counts so provenance can declare them.
 * Cache (`cache_read`/`cache_create`) is NEVER attributed per-dimension — it is
 * returned for the session-level total only.
 */
function foldSession(
  view: SessionView,
  acc: Accs,
): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  active: number;
  mechanism: FlowStageMechanism;
  tokenMeasured: boolean;
  /** Events excluded from active-time accrual because they carry no exact instant. */
  intervalEvents: number;
} {
  const ev = view.events;
  const n = ev.length;

  // Idle-classified gap AFTER each event (FX002-5). A big gap ENDING at a user
  // `prompt` is the human away (idle) → contributes ZERO; agent gaps + brief human
  // gaps (≤ IDLE_CAP_S) stay. `gapAfter[i]` = the ACTIVE seconds between event i and
  // i+1, so Σ = the session's active time (agent+human, idle excluded).
  //
  // `t_precision: 'interval'` events (plan 066 file events) are NOT instants: they
  // carry the CAPTURE wall-clock for work that happened somewhere in the preceding
  // window. Treating one as an instant silently accrues a whole span into active
  // time — a number the capture never measured. So active time is accrued between
  // consecutive ANCHORED events only; an interval event is skipped over, never
  // used as a gap boundary. It still counts everywhere non-temporal (its file
  // delta, its authorship row, its coverage). With no interval events the anchored
  // sequence IS the event sequence, so this is byte-identical to the exact-timed
  // behaviour (plan 068 item 2).
  const gapAfter: number[] = new Array(n).fill(0);
  const anchored: number[] = [];
  for (let i = 0; i < n; i++) if (ev[i].t_precision !== 'interval') anchored.push(i);
  for (let k = 0; k < anchored.length - 1; k++) {
    const i = anchored[k];
    const j = anchored[k + 1];
    const g = parseIso(ev[j].t) - parseIso(ev[i].t);
    if (!Number.isFinite(g) || g <= 0) continue;
    const kind = classifyGap(g, ev[j].kind === 'prompt', IDLE_CAP_S);
    gapAfter[i] = kind === 'idle' ? 0 : g;
  }
  // Active seconds in the index window [a, b) — i.e. time [t_a, t_b), idle already
  // excluded. gapAfter[b-1] connects event b-1 to the boundary event b (= t_b), so
  // it is inside the window; the sum runs i = a .. b-1.
  const activeBetween = (a: number, b: number): number => {
    let s = 0;
    for (let i = a; i < b && i < n; i++) s += gapAfter[i];
    return s;
  };

  // Which shell tools events are FULLY consumed by a co-timed harness call (D1
  // no-double-count): match each harness event's `t` to a shell tools event at the
  // same `t`, greedily. `bashNet[i]` = the bash-count shell event i contributes
  // AFTER excluding harness invocations.
  const harnessAtT = new Map<string, number>();
  for (const e of ev) if (e.kind === 'harness') harnessAtT.set(e.t, (harnessAtT.get(e.t) ?? 0) + 1);
  const bashNet: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const e = ev[i];
    if (e.kind !== 'tools') continue;
    const sk = shellKey(e.name);
    if (sk === null) continue;
    const coincident = harnessAtT.get(e.t) ?? 0;
    const excluded = Math.min(e.count, coincident);
    if (excluded > 0) harnessAtT.set(e.t, coincident - excluded);
    bashNet[i] = e.count - excluded;
  }

  // ── Command counts (NO time — the capture has no honest per-call duration) ──
  for (let i = 0; i < n; i++) {
    const e = ev[i];
    if (e.kind === 'tools') {
      acc.tool.addCount(e.name, e.count);
      const sk = shellKey(e.name);
      if (sk !== null && bashNet[i] > 0) {
        // FX001-5: key by the captured command signature when present, else the tool name.
        acc.bash_command.addCount(e.signature ?? sk, bashNet[i]);
      }
    } else if (e.kind === 'harness') {
      acc.harness_command.addCount(e.verb, 1);
    }
  }

  // Session token totals prefer the authoritative typed observation stream.
  // Legacy turn fields remain the fallback for predecessor segments.
  const turnIdx: number[] = [];
  for (let i = 0; i < n; i++) if (ev[i].kind === 'turn') turnIdx.push(i);
  const usageObservation = reduceUsageEvents(ev);
  const typedUsage = completeUsageTokens(usageObservation);
  let sessionIn = typedUsage?.input ?? usageObservation?.input ?? 0;
  let sessionOut = typedUsage?.output ?? usageObservation?.output ?? 0;
  let sessionCr = typedUsage?.cache_read ?? usageObservation?.cache_read ?? 0;
  let sessionCc = typedUsage?.cache_create ?? usageObservation?.cache_create ?? 0;
  let tokenMeasured = typedUsage !== null;
  if (usageObservation === null) {
    for (const ti of turnIdx) {
      const t = ev[ti] as { in?: number; out?: number; cache_read?: number; cache_create?: number };
      if (
        typeof t.in === 'number' ||
        typeof t.out === 'number' ||
        typeof t.cache_read === 'number' ||
        typeof t.cache_create === 'number'
      ) {
        tokenMeasured = true;
      }
      sessionIn += t.in ?? 0;
      sessionOut += t.out ?? 0;
      sessionCr += t.cache_read ?? 0;
      sessionCc += t.cache_create ?? 0;
    }
  }

  // ── Command tokens: launching-out (even) + following-in (byte-weighted) ──
  for (let k = 0; k < turnIdx.length; k++) {
    const ti = turnIdx[k];
    const output = turnOutput(ev[ti]);
    const nextTi = k + 1 < turnIdx.length ? turnIdx[k + 1] : n;
    // INPUT = the FOLLOWING turn's non-cache in (the result these tools dumped back).
    const input = k + 1 < turnIdx.length ? turnInput(ev[nextTi]) : 0;
    if (output === 0 && input === 0) continue;

    const from = parseIso(ev[ti].t);
    const to = k + 1 < turnIdx.length ? parseIso(ev[nextTi].t) : Number.POSITIVE_INFINITY;
    const inWindow = (i: number): boolean => {
      const t = parseIso(ev[i].t);
      return Number.isFinite(t) ? t >= from && t < to : i > ti && i < nextTi;
    };

    const tool = new WeightMap();
    const bash = new WeightMap();
    const harness = new WeightMap();
    for (let i = 0; i < n; i++) {
      if (i === ti || !inWindow(i)) continue;
      const e = ev[i];
      if (e.kind === 'tools') {
        tool.add(e.name, e.result_tokens);
        const sk = shellKey(e.name);
        if (sk !== null && bashNet[i] > 0) bash.add(e.signature ?? sk, e.result_tokens);
      } else if (e.kind === 'harness') {
        harness.add(e.verb, undefined);
      }
    }
    splitCommand(acc.tool, tool, input, output);
    splitCommand(acc.bash_command, bash, input, output);
    splitCommand(acc.harness_command, harness, input, output);
  }

  // ── Skill lens: this call → next skill call (idle-excluded) ──
  const skillIdx: number[] = [];
  for (let i = 0; i < n; i++) if (ev[i].kind === 'skill') skillIdx.push(i);
  for (let j = 0; j < skillIdx.length; j++) {
    const si = skillIdx[j];
    const name = (ev[si] as { name: string }).name;
    const end = j + 1 < skillIdx.length ? skillIdx[j + 1] : n;
    acc.skill.addCount(name, 1);
    acc.skill.addTime(name, activeBetween(si, end));
    const tok = windowTurnTokens(ev, si, end);
    acc.skill.addTokens(name, tok.input, tok.output);
  }

  // ── flow_stage lens (T1.4 + 057 T003): marks-LOOKUP richest, FlowEvent-PRIMARY,
  // digit FALLBACK, unlabeled last ──
  // When `cursor-moved` flow_log transition marks exist (plan 057), the stage
  // timeline is the merge of those marks with the in-stream `flow` anchors, and
  // stage(event) = latest transition at-or-before the event's `t` (a point
  // lookup — marks never re-enter gap/wall math, preserving the rollup's
  // flow_log exclusion). Otherwise behavior is byte-identical to T1.4:
  // FlowEvent-PRIMARY brackets, `/the-flow` digit FALLBACK, `unlabeled` last.
  const mechanism: FlowStageMechanism = { flow: 0, digit: 0, unlabeled: 0, flow_log: 0 };
  const flowEvtIdx: number[] = [];
  for (let i = 0; i < n; i++) if (ev[i].kind === 'flow') flowEvtIdx.push(i);

  if (view.cursorMarks.length > 0) {
    // 057 T003 — merged last-transition lookup. Contiguous same-stage runs of
    // events become windows; each window's mechanism is the SOURCE of the mark
    // that started it (`flow_log` = cursor-moved, `flow` = in-stream anchor);
    // events before the first mark form an honest `unlabeled` window.
    type Mark = { tm: number; stage: string; src: 'flow' | 'flow_log' };
    const marks: Mark[] = view.cursorMarks.map((m) => ({
      tm: parseIso(m.t),
      stage: m.to,
      src: 'flow_log' as const,
    }));
    for (const i of flowEvtIdx) {
      const e = ev[i] as { t: string; stage?: string };
      if (e.stage !== undefined && e.stage.length > 0) {
        marks.push({ tm: parseIso(e.t), stage: e.stage, src: 'flow' });
      }
    }
    marks.sort((a, b) => a.tm - b.tm);

    let p = -1; // last consumed mark
    let runStart = 0;
    let runLabel: string | null = null;
    let runSrc: 'flow' | 'flow_log' | null = null;
    const flushRun = (endIdx: number): void => {
      if (endIdx <= runStart) return;
      const label = runLabel ?? UNLABELED_STAGE;
      acc.flow_stage.addCount(label, 1);
      acc.flow_stage.addTime(label, activeBetween(runStart, endIdx));
      const tok = windowTurnTokens(ev, runStart, endIdx);
      acc.flow_stage.addTokens(label, tok.input, tok.output);
      if (runSrc === 'flow') mechanism.flow += 1;
      else if (runSrc === 'flow_log') mechanism.flow_log += 1;
      else mechanism.unlabeled += 1;
    };
    for (let i = 0; i < n; i++) {
      const et = parseIso(ev[i].t);
      let advanced = false;
      while (p + 1 < marks.length && marks[p + 1].tm <= et) {
        p += 1;
        advanced = true;
      }
      if (advanced && marks[p].stage !== runLabel) {
        flushRun(i);
        runStart = i;
        runLabel = marks[p].stage;
        runSrc = marks[p].src;
      }
    }
    flushRun(n);
  } else if (flowEvtIdx.length > 0) {
    // PRIMARY: bracket by consecutive flow events; label = the nav stage id.
    for (let m = 0; m < flowEvtIdx.length; m++) {
      const bi = flowEvtIdx[m];
      const stage = (ev[bi] as { stage?: string }).stage;
      const label = stage !== undefined && stage.length > 0 ? stage : UNLABELED_STAGE;
      const end = m + 1 < flowEvtIdx.length ? flowEvtIdx[m + 1] : n;
      acc.flow_stage.addCount(label, 1);
      acc.flow_stage.addTime(label, activeBetween(bi, end));
      const tok = windowTurnTokens(ev, bi, end);
      acc.flow_stage.addTokens(label, tok.input, tok.output);
      mechanism.flow += 1;
    }
  } else {
    // FALLBACK: consecutive `/the-flow` skill brackets (leading-digit arg = label).
    const flowIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = ev[i];
      if (e.kind === 'skill' && e.name === THE_FLOW_SKILL) flowIdx.push(i);
    }
    for (let m = 0; m < flowIdx.length; m++) {
      const bi = flowIdx[m];
      const arg = (ev[bi] as { arg?: string }).arg;
      const labeled = arg !== undefined && arg.length > 0;
      const label = labeled ? arg : UNLABELED_STAGE;
      const end = m + 1 < flowIdx.length ? flowIdx[m + 1] : n;
      acc.flow_stage.addCount(label, 1);
      acc.flow_stage.addTime(label, activeBetween(bi, end));
      const tok = windowTurnTokens(ev, bi, end);
      acc.flow_stage.addTokens(label, tok.input, tok.output);
      if (labeled) mechanism.digit += 1;
      else mechanism.unlabeled += 1;
    }
  }

  return {
    input: sessionIn,
    output: sessionOut,
    cacheRead: sessionCr,
    cacheCreate: sessionCc,
    active: activeBetween(0, n),
    intervalEvents: n - anchored.length,
    mechanism,
    tokenMeasured,
  };
}

/**
 * Per-key result-size weights for one command window (FX002/FX003). Every distinct
 * key is present (so it gets an output share); `hasRt` records whether ANY call in
 * the window carried a `result_tokens` size (⇒ byte-weight the input-split).
 */
class WeightMap {
  readonly rt = new Map<string, number>();
  hasRt = false;
  add(key: string, resultTokens: number | undefined): void {
    if (!this.rt.has(key)) this.rt.set(key, 0);
    if (resultTokens !== undefined) {
      this.rt.set(key, (this.rt.get(key) ?? 0) + resultTokens);
      this.hasRt = true;
    }
  }
}

/**
 * Attribute one turn's command tokens: `output` even-split across the distinct
 * keys; `input` byte-weighted by `result_tokens` when the window carried any real
 * dump size (FX003), else even-split (declared estimate for old/size-less data).
 */
function splitCommand(acc: DimAcc, w: WeightMap, input: number, output: number): void {
  const keys = [...w.rt.keys()];
  if (keys.length === 0) return;
  const shareOut = output / keys.length;
  const totalRt = [...w.rt.values()].reduce((a, b) => a + b, 0);
  const weighted = w.hasRt && totalRt > 0;
  for (const key of keys) {
    const shareIn = weighted ? input * ((w.rt.get(key) ?? 0) / totalRt) : input / keys.length;
    acc.addTokens(key, shareIn, shareOut);
  }
}

/** Σ non-cache `{ input, output }` of the turns in the index window [a, b). */
function windowTurnTokens(
  ev: SessionView['events'],
  a: number,
  b: number,
): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (let i = a; i < b && i < ev.length; i++) {
    if (ev[i].kind === 'turn') {
      input += turnInput(ev[i]);
      output += turnOutput(ev[i]);
    }
  }
  return { input, output };
}

// ── Filtering ───────────────────────────────────────────────────────────────

/** Legacy SessionExport facets; `repo` is echo-only here because v1 exports carry no repo identity. */
export function matchesFilter(exp: SessionExport, filter: ReportFilter | undefined): boolean {
  if (filter === undefined) return true;
  const id = exp.identity;
  if (filter.harness && filter.harness.length > 0 && !filter.harness.includes(id.harness)) {
    return false;
  }
  if (
    filter.model &&
    filter.model.length > 0 &&
    !id.models.some((m) => filter.model?.includes(m))
  ) {
    return false;
  }
  if (filter.branch && filter.branch.length > 0) {
    if (id.branch === null || !filter.branch.includes(id.branch)) return false;
  }
  // Date-range: keep a session whose [first,last] window overlaps [from,to].
  if (filter.date_from !== undefined) {
    const last = exp.summary.last_timecode ?? exp.summary.first_timecode;
    if (last !== null && parseIso(last) < parseIso(filter.date_from)) return false;
  }
  if (filter.date_to !== undefined) {
    const first = exp.summary.first_timecode ?? exp.summary.last_timecode;
    if (first !== null && parseIso(first) > parseIso(filter.date_to)) return false;
  }
  return true;
}

// ── The builder ─────────────────────────────────────────────────────────────

function uniquePush(list: string[], value: string | null | undefined): void {
  if (value !== null && value !== undefined && value.length > 0 && !list.includes(value)) {
    list.push(value);
  }
}

/**
 * Roll up 1..N legacy `SessionExport`s into one `TelemetryReport`. Applies every
 * available facet and echoes `repo` without filtering because this input contract
 * has no repository identity; folds every matching session's event
 * stream into the five dimensions, and estimates time/tokens with the declared
 * attribution. Deterministic and pure.
 */
export function buildReport(
  exports: SessionExport[],
  opts: BuildReportOptions = {},
): TelemetryReport {
  const filter = opts.filter ?? {};
  const sort: ReportSortKey = opts.sort ?? 'tokens';
  const included = exports.filter((e) => matchesFilter(e, filter));

  const acc: Accs = {
    flow_stage: new DimAcc(),
    skill: new DimAcc(),
    tool: new DimAcc(),
    bash_command: new DimAcc(),
    harness_command: new DimAcc(),
  };

  let totalIn = 0;
  let totalOut = 0;
  let totalCacheR = 0;
  let totalCacheC = 0;
  let totalActive = 0;
  const mechanism: FlowStageMechanism = { flow: 0, digit: 0, unlabeled: 0, flow_log: 0 };
  const tokenCoverage: TokenCoverage = {
    measured: 0,
    partial: 0,
    unavailable: 0,
    unmeasured: 0,
    reasons: {},
    causes: { unknown: 0 },
  };
  const sessionIds: string[] = [];
  const branches: string[] = [];
  const harnesses: string[] = [];
  const models: string[] = [];
  let from: string | null = null;
  let to: string | null = null;
  let controlTimeline: TimelineMarker[] | undefined;
  // plan 056: the file events across every included session → one authorship view.
  const fileEventsAll: SessionView['events'] = [];
  // plan 068 item 3: paths the capture recorded WITHOUT a measurable delta, so the
  // authorship surface can show them with a named gap rather than drop them.
  const observedPaths: ObservedPath[] = [];
  // Plan 056 (workshop D6) — friction proxies + retro-drain aggregates. Counted
  // straight off the ordered event stream (P12-safe: codes/verbs/closed counts only).
  let commandErrors = 0;
  let apiErrors = 0;
  let observeEvents = 0;
  let retroObservations = 0;
  // Plan 068 item 2 — how many events were excluded from active-time accrual for
  // carrying an interval, not an instant. Visible, never silent.
  let intervalEvents = 0;
  const retroDispositions: Record<string, number> = {};

  for (const exp of included) {
    const view = viewOf(exp);
    const sums = foldSession(view, acc);
    for (const e of view.events) {
      if (e.kind === 'command_exit') {
        if (e.exit !== 0) commandErrors += 1;
      } else if (e.kind === 'api_error') {
        apiErrors += 1;
      } else if (e.kind === 'harness' && e.verb === 'observe') {
        observeEvents += 1;
      } else if (e.kind === 'artifact' && e.artifact_type === 'retro') {
        retroObservations += e.counts.observations ?? 0;
        for (const [k, v] of Object.entries(e.counts)) {
          if (k.startsWith('disp_')) retroDispositions[k] = (retroDispositions[k] ?? 0) + (v ?? 0);
        }
      }
    }
    totalIn += sums.input;
    totalOut += sums.output;
    totalCacheR += sums.cacheRead;
    totalCacheC += sums.cacheCreate;
    totalActive += sums.active;
    mechanism.flow += sums.mechanism.flow;
    mechanism.digit += sums.mechanism.digit;
    mechanism.unlabeled += sums.mechanism.unlabeled;
    mechanism.flow_log += sums.mechanism.flow_log;
    intervalEvents += sums.intervalEvents;
    const coverage = exp.summary.token_evidence?.coverage;
    if (coverage === 'measured' || (coverage === undefined && sums.tokenMeasured)) {
      tokenCoverage.measured += 1;
    } else if (coverage === 'partial') {
      tokenCoverage.partial += 1;
      tokenCoverage.unmeasured += 1;
    } else {
      tokenCoverage.unavailable += 1;
      tokenCoverage.unmeasured += 1;
    }
    const evidenceReason = exp.summary.token_evidence?.reason;
    if (evidenceReason !== null && evidenceReason !== undefined) {
      tokenCoverage.reasons[evidenceReason] = (tokenCoverage.reasons[evidenceReason] ?? 0) + 1;
    }
    if (exp.summary.token_evidence !== undefined) tokenCoverage.causes.unknown += 1;
    sessionIds.push(exp.identity.harness_session_id);
    uniquePush(branches, exp.identity.branch);
    uniquePush(harnesses, exp.identity.harness);
    for (const m of exp.identity.models) uniquePush(models, m);
    const f = exp.summary.first_timecode;
    const l = exp.summary.last_timecode;
    if (f !== null && (from === null || f < from)) from = f;
    if (l !== null && (to === null || l > to)) to = l;
    // The ordered control timeline is a SINGLE-session artifact (scope.single):
    // build it only for a one-session report, from that session's ordered stream.
    if (included.length === 1) controlTimeline = buildControlTimeline(view.events);
    // plan 056: collect this session's file events for the cohort authorship view.
    for (const e of view.events) if (e.kind === 'file') fileEventsAll.push(e);
    // plan 068 item 3: and the path-only evidence beside them.
    for (const path of exp.summary.files_observed?.written ?? []) {
      observedPaths.push({ path, change: 'written' });
    }
    for (const path of exp.summary.files_observed?.edited ?? []) {
      observedPaths.push({ path, change: 'edited' });
    }
  }

  const idCap = opts.sessionIdCap ?? 200;

  // Echo only the facets that were actually provided (empty arrays omitted).
  const echoedFilter: ReportFilter = {};
  if (filter.harness && filter.harness.length > 0) echoedFilter.harness = [...filter.harness];
  if (filter.model && filter.model.length > 0) echoedFilter.model = [...filter.model];
  if (filter.branch && filter.branch.length > 0) echoedFilter.branch = [...filter.branch];
  if (filter.repo && filter.repo.length > 0) echoedFilter.repo = [...filter.repo];
  if (filter.date_from !== undefined) echoedFilter.date_from = filter.date_from;
  if (filter.date_to !== undefined) echoedFilter.date_to = filter.date_to;

  return {
    schema_version: TELEMETRY_REPORT_SCHEMA_VERSION,
    scope: {
      session_count: included.length,
      single: included.length === 1,
      session_ids: sessionIds.slice(0, idCap),
    },
    filter: echoedFilter,
    totals: {
      time_s: Math.round(totalActive),
      tokens: { input: Math.round(totalIn), output: Math.round(totalOut) },
      cache: { read: Math.round(totalCacheR), create: Math.round(totalCacheC) },
      sessions: included.length,
      friction: { command_errors: commandErrors, api_errors: apiErrors },
      observe_events: observeEvents,
      retro: { observations: retroObservations, dispositions: retroDispositions },
    },
    rollups: {
      // Time-bearing lenses (skill / flow_stage) emit `time_s`; the command lenses
      // (tool / bash_command / harness_command) do NOT — no honest per-call duration.
      // flow_stage rows also carry the versioned semantic_stage projection (T1.4).
      flow_stage: acc.flow_stage.finish('flow_stage', sort, true, opts.top, semanticStage),
      skill: acc.skill.finish('skill', sort, true, opts.top),
      tool: acc.tool.finish('tool', sort, false, opts.top),
      bash_command: acc.bash_command.finish('bash_command', sort, false, opts.top),
      harness_command: acc.harness_command.finish('harness_command', sort, false, opts.top),
    },
    attribution: {
      tokens:
        'non-cache-input+output; command input byte-weighted by result_tokens when present, else even-split',
      time: 'per-lens: commands=none; skill=this-call→next-skill-call; flow_stage=between-consecutive-flow-events (FlowEvent-primary; /the-flow digit brackets fall back); idle excluded',
      exact: ['count'],
      bash_command_key: 'shell-command-signature-or-tool-name',
      notes: [
        // FX002: per-dimension tokens are non-cache {input, output}, SEPARATE.
        'Per-dimension tokens are non-cache {input, output}: output = even share of the launching turn\u2019s output; input = share of the following turn\u2019s non-cache input (the result dumped back), byte-weighted by the tool result_tokens when captured (FX003), else even-split.',
        'cache_read / cache_create are the conversation re-reading its own context ("context re-reads") \u2014 counted at the SESSION level only (totals.cache), NEVER attributed to any command/skill/stage row.',
        'Commands (tool / bash_command / harness_command) carry NO time \u2014 the capture has no honest per-call duration. Skills span this-call\u2192next-skill-call; flow_stage is FlowEvent-primary (nav node id = stage), spanning between consecutive flow events, with the /the-flow digit bracket as the fallback and `unlabeled` only when neither exists; both exclude idle. totals.time_s is active time (agent+human), never wall-span.',
        // D1 + FX001-5: bash_command keys by the captured signature when present.
        'bash_command keys by the captured command signature (program+verb, e.g. rg / git commit) when available, else the shell-tool name (bash/shell); only the signature — never full argv — is stored (P12).',
        'harness_command counts in-stream harness verbs; bash_command excludes co-timed harness invocations to avoid double-count.',
        // T1.4/D3: flow_stage semantic projection + per-window mechanism provenance.
        `flow_stage rows carry a semantic_stage (${FLOW_STAGE_MAP_VERSION}: nav node id \u2192 research/plan/implement/review/ship; unmapped labels omit it); provenance.flow_stage_mechanism counts how many windows each mechanism (flow/digit/unlabeled) labeled.`,
      ],
    },
    provenance: {
      date_range: { from: from ?? '', to: to ?? '' },
      repos: echoedFilter.repo ?? [],
      branches,
      harnesses,
      models,
      session_count: included.length,
      source_paths: opts.sourcePaths ?? [],
      generated_at: opts.generatedAt ?? '',
      flow_stage_map_version: FLOW_STAGE_MAP_VERSION,
      flow_stage_mechanism: mechanism,
      token_coverage: tokenCoverage,
      interval_events: intervalEvents,
    },
    ...(controlTimeline !== undefined ? { control_timeline: controlTimeline } : {}),
    ...(fileEventsAll.length > 0 || observedPaths.length > 0
      ? { authorship: computeAuthorship(fileEventsAll, observedPaths) }
      : {}),
  };
}

export interface BuildReportFromInputsOptions extends BuildReportOptions {
  selectionGaps?: Array<{
    repositoryKey: string;
    repository: string;
    sessionId: string;
    reason: string;
  }>;
}

/**
 * Mixed-input additive adapter. Repository filters apply before every calculation
 * only to explicit `bundle` origins; `legacy` origins have no repository identity
 * and remain included with the repo facet echoed. Full inputs still use the
 * established builder; weaker bundle inputs
 * contribute only explicit evidence/coverage and never receive a synthetic
 * SessionExport or fabricated numeric/event value.
 */
export function buildReportFromInputs(
  inputs: TelemetryReportInput[],
  opts: BuildReportFromInputsOptions = {},
): TelemetryReport {
  const filter = opts.filter ?? {};
  const requestedUnknownFacets = [
    ...(filter.harness?.length ? ['harness'] : []),
    ...(filter.model?.length ? ['model'] : []),
    ...(filter.branch?.length ? ['branch'] : []),
    ...(filter.date_from !== undefined || filter.date_to !== undefined ? ['date'] : []),
  ];
  const decisions = inputs.map((input) => {
    const repoMatch =
      input.origin === 'legacy' ||
      !filter.repo?.length ||
      filter.repo.includes(input.repositoryKey) ||
      filter.repo.includes(input.repository);
    if (!repoMatch) return { input, include: false, reason: 'filter_excluded' } as const;
    if (input.kind !== 'full' || input.sessionExport === null) {
      return requestedUnknownFacets.length === 0
        ? ({ input, include: true } as const)
        : ({
            input,
            include: false,
            reason: `filter_evidence_unavailable:${requestedUnknownFacets.join(',')}`,
          } as const);
    }
    return matchesFilter(input.sessionExport, filter)
      ? ({ input, include: true } as const)
      : ({ input, include: false, reason: 'filter_excluded' } as const);
  });
  const included = decisions
    .filter((decision) => decision.include)
    .map((decision) => decision.input);
  const excluded = decisions.filter((decision) => !decision.include);
  const fullExports = included.flatMap((input) =>
    input.kind === 'full' && input.sessionExport !== null ? [input.sessionExport] : [],
  );
  const report = buildReport(fullExports, opts);
  const finalCohortOwnsControlTimeline =
    included.length === 1 &&
    included[0].kind === 'full' &&
    included[0].sessionExport !== null &&
    fullExports.length === 1 &&
    fullExports[0] === included[0].sessionExport;
  if (!finalCohortOwnsControlTimeline) delete report.control_timeline;
  const selectionGaps = (opts.selectionGaps ?? []).filter(
    (gap) =>
      !filter.repo?.length ||
      filter.repo.includes(gap.repositoryKey) ||
      filter.repo.includes(gap.repository),
  );
  const repositoryCounts = new Map<string, { identity: string; sessions: number }>();
  for (const input of included) {
    if (input.origin === 'legacy') continue;
    const prior = repositoryCounts.get(input.repositoryKey) ?? {
      identity: input.repository,
      sessions: 0,
    };
    prior.sessions += 1;
    repositoryCounts.set(input.repositoryKey, prior);
  }
  for (const gap of selectionGaps) {
    if (!repositoryCounts.has(gap.repositoryKey)) {
      repositoryCounts.set(gap.repositoryKey, { identity: gap.repository, sessions: 0 });
    }
  }
  const eventsAvailable = included.filter((input) => input.coverage.events.count !== null);
  const measurementsAvailable = included.filter(
    (input) => input.coverage.measurements.count !== null,
  );
  const gaps = [
    ...selectionGaps.map((gap) => `${gap.repositoryKey}:${gap.sessionId}:${gap.reason}`),
    ...included.flatMap((input) =>
      input.gaps.map(
        (gap) =>
          `${input.origin === 'bundle' ? input.repositoryKey : 'legacy'}:${input.sessionId}:${gap}`,
      ),
    ),
    ...excluded.map(
      (decision) =>
        `${decision.input.origin === 'bundle' ? decision.input.repositoryKey : 'legacy'}:${decision.input.sessionId}:${decision.reason}`,
    ),
  ].sort();
  const coverage: ReportInputCoverage = {
    accepted_sessions: included.length,
    event_substrate_sessions: eventsAvailable.length,
    kinds: {
      full: included.filter((input) => input.kind === 'full').length,
      partial: included.filter((input) => input.kind === 'partial').length,
      identity_only: included.filter((input) => input.kind === 'identity-only').length,
    },
    fields: {
      events: {
        available: eventsAvailable.length,
        unavailable: included.length - eventsAvailable.length,
        excluded: excluded.length,
      },
      measurements: {
        available: measurementsAvailable.length,
        unavailable: included.length - measurementsAvailable.length,
        excluded: excluded.length,
      },
    },
    repositories: [...repositoryCounts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, identity: value.identity, sessions: value.sessions })),
    gaps,
  };
  const measure = (
    available: TelemetryReportInput[],
    read: (input: TelemetryReportInput) => number | null,
  ): EvidenceMeasure =>
    available.length === 0
      ? { state: 'unavailable', value: null, contributors: 0 }
      : {
          state: 'measured',
          value: available.reduce((sum, input) => sum + (read(input) ?? 0), 0),
          contributors: available.length,
        };

  report.scope = {
    session_count: included.length,
    single: included.length === 1,
    session_ids: included.map((input) => input.sessionId).slice(0, opts.sessionIdCap ?? 200),
  };
  report.provenance.session_count = included.length;
  report.provenance.repos = [
    ...new Set([
      ...included.flatMap((input) => (input.origin === 'bundle' ? [input.repository] : [])),
      ...selectionGaps.map((gap) => gap.repository),
    ]),
  ];
  report.provenance.input_coverage = coverage;
  report.evidence_totals = {
    events: measure(eventsAvailable, (input) => input.coverage.events.count),
    measurements: measure(measurementsAvailable, (input) => input.coverage.measurements.count),
  };
  return report;
}
