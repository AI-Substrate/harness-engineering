/**
 * `insights.ts` (plan 048 Phase 2) — the **insights layer** (WS001 D1, layer 3).
 *
 * CONTRACT (D1, enforce — never reinterpret): compute practice-analytics over
 * `1..N` **saved {@link TelemetryReport} JSONs** (layer-2 outputs) and NOTHING
 * else — never re-reads shards/exports, never fetches telemetry, never joins
 * external data (DORA/git = layer-3 extension points, later). An LLM never
 * computes a number here; the narrator slot (Phase 2.5) is prose-only.
 *
 * GRAIN-ROBUST (Q1): the layer's full power needs **single-session** reports
 * (`scope.single`). Sections that need per-session grain (active/wall ratio,
 * outliers, per-work-unit table, discipline panel) compute from the single-session
 * inputs; fed an aggregate-only report they render a visible `available:false`
 * caveat — honest, never fabricated. The work-unit key is the **branch**
 * (`provenance.branches[0]` when exactly one, else the visible `unassigned` row).
 *
 * EPISTEMICS (2.1, STRUCTURAL): every {@link InsightRow} is built through
 * {@link makeRow}, which REFUSES (throws) a row missing `n` or `caveat` — an
 * insight the layer cannot caveat does not exist. Cohort-aggregate rows below
 * {@link N_THRESHOLD} are folded into a visible `other (n<T)` row (never silently
 * truncated).
 *
 * PURE SERVICE (P2): imports ports/`node:*`/clock NOWHERE. The caller
 * (`acts/telemetry.ts`) reads the files, injects `generated_at`, and writes output.
 */

import type {
  FlowStageMechanism,
  Rollup,
  TelemetryReport,
  TimelineMarker,
  TokenCoverage,
} from './report.js';
import { parseIso } from './rollup.js';

export const INSIGHTS_SCHEMA_VERSION = 'harness.telemetry-insights/v1' as const;

/**
 * The sample floor for a cohort-aggregate claim (2.1). A row backed by fewer than
 * this many observations does not stand on its own — it folds into a visible
 * `other (n<T)` aggregate (WS001 epistemic contract; the D6 small-n leakage guard,
 * even though this layer is already identity-free). `5` is the smallest n at which
 * a mean is not dominated by a single point; documented + carried in provenance so
 * a re-tuning is a visible, comparable change.
 */
export const N_THRESHOLD = 5;

/** The canonical semantic-stage order (mirrors the report's stage map). */
const SEMANTIC_ORDER = ['research', 'plan', 'implement', 'review', 'ship'] as const;

/** The loop verbs the discipline panel sequence-joins over (grounded in the CLI). */
const OBSERVE_VERB = 'observe';
/** Harvest/drain = `harness record retro` (observe.ts drains via `record`). */
const DRAIN_VERB = 'record';
/** Backpressure survey = the `boot` stage. */
const BACKPRESSURE_VERB = 'boot';
/** The gate — a `checks` harness verb OR a `checks` verdict marker both signal it ran. */
const CHECKS_VERB = 'checks';
/** The real push signal — a `git push` bash SIGNATURE marker (never a harness verb). */
const PUSH_KEY = 'git push';

// ── The insight row + section shapes ────────────────────────────────────────

/**
 * One insight row — the epistemic atom (2.1). `values` carries the actual numbers
 * the HTML renders (so "every number originates from insights.json"); the rest is
 * the mandatory epistemic envelope. `null` in `values` = an honestly UNMEASURED
 * quantity (e.g. subagent tokens), rendered as such — never a fabricated `0`.
 */
export interface InsightRow {
  claim: string;
  measures_used: string[];
  n: number;
  interval?: string;
  caveat: string;
  values: Record<string, number | string | null>;
}

/** A visible note that low-n rows were folded/omitted (silent truncation forbidden). */
export interface SectionSuppression {
  rows: number;
  reason: string;
}

/**
 * Era/mechanism coverage for a section whose signal depends on a marker CLASS that
 * only exists in some eras (D-B). Evidence-based, never date-guessed: it counts, over
 * the single-session inputs, how many sessions lack the marker class a row needs — so
 * an all-zero row (e.g. `checks-before-push: 0/0`) can be rendered as UNMEASURABLE for
 * those sessions rather than as a confident zero. Surfaced in section provenance.
 */
export interface SectionCoverage {
  /** Single-session reports whose per-session evidence was evaluated. */
  sessions: number;
  /**
   * Sessions with bash calls but NO bash-signature markers in their control timeline
   * (pre-FX001 era: `git push`/`git commit` signatures were not captured) — so the
   * push/checks-before-push signal is unmeasurable for them, not a true zero.
   */
  push_signatures_unavailable: number;
  /**
   * Sessions with no FlowEvent-/digit-labeled stage windows (e.g. pre-1.2-fix FlowEvent
   * starvation) — so stage economics is unmeasurable for them, not an empty result.
   */
  stage_labels_unavailable: number;
  /** Human declaration distinguishing an unmeasurable era gap from a genuine zero. */
  note: string;
}

/** One report section — a named generator's output; renders uniformly. */
export interface InsightSection {
  id: string;
  title: string;
  /** `false` ⇒ the grain (per-session) this section needs was not supplied. */
  available: boolean;
  rows: InsightRow[];
  /** Present iff rows were folded below {@link N_THRESHOLD}. */
  suppressed?: SectionSuppression;
  /** Era/mechanism coverage (D-B): declares which sessions a marker class is absent for. */
  coverage?: SectionCoverage;
  /** Footnotes: non-additivity, the `unavailable` reason, the keying rule, etc. */
  note?: string;
  /** Alternate row orderings by key (e.g. bash: `by_count` / `by_sent`). */
  orderings?: Record<string, string[]>;
}

/** Where the numbers came from + the declared, un-fixed gaps (2.4). */
export interface InsightsProvenance {
  input_reports: { name: string; session_count: number; single: boolean }[];
  /** Inputs that failed to load — a partial run records the omission here (2.4). */
  skipped_inputs: { path: string; reason: string }[];
  single_session_reports: number;
  aggregate_reports: number;
  /** Pass-through of each input's pinned flow-stage map version (deduped). */
  flow_stage_map_versions: string[];
  keying_rule: string;
  n_threshold: number;
  /** Aggregated token coverage across inputs (measured vs a declared token gap). */
  token_coverage: TokenCoverage;
  /** Declared, document-don't-fix caveats (H-05 copilot tail-capture skew, etc.). */
  caveats: string[];
  generated_at: string;
}

export interface InsightsDocument {
  schema_version: typeof INSIGHTS_SCHEMA_VERSION;
  /** The seven WS001 sections, in order. */
  sections: InsightSection[];
  /** The v1-committed ritual-marker discipline panel. */
  discipline: InsightSection;
  provenance: InsightsProvenance;
}

/** One loaded input: the report + the (sanitized) name it was read under. */
export interface InsightInput {
  name: string;
  report: TelemetryReport;
}

export interface BuildInsightsOptions {
  /** Inputs that could not be loaded (the act records them; provenance surfaces them). */
  skipped?: { path: string; reason: string }[];
  /** ISO instant from the caller's clock (P2 — the service never reads a clock). */
  generatedAt?: string;
}

// ── 2.1 — structural epistemics ─────────────────────────────────────────────

/**
 * The ONLY {@link InsightRow} constructor. STRUCTURAL refusal (2.1): a row missing
 * `n` (a finite number) or a non-empty `caveat` cannot be built — so it can never
 * reach `insights.json` or the HTML. This is the mechanism, not a convention.
 */
export function makeRow(input: {
  claim: string;
  measures_used: string[];
  n: number;
  interval?: string;
  caveat: string;
  values: Record<string, number | string | null>;
}): InsightRow {
  if (typeof input.n !== 'number' || !Number.isFinite(input.n)) {
    throw new Error(`insight row "${input.claim}" cannot render: missing n (epistemics contract)`);
  }
  if (typeof input.caveat !== 'string' || input.caveat.trim().length === 0) {
    throw new Error(
      `insight row "${input.claim}" cannot render: missing caveat (epistemics contract)`,
    );
  }
  const row: InsightRow = {
    claim: input.claim,
    measures_used: input.measures_used,
    n: input.n,
    caveat: input.caveat,
    values: input.values,
  };
  if (input.interval !== undefined) row.interval = input.interval;
  return row;
}

/**
 * Fold cohort-aggregate rows below `threshold` into ONE visible `other (n<T)` row
 * (2.1). Never a silent drop: the tail's numeric `values` are summed so totals
 * stay honest, and {@link SectionSuppression} records how many rows were folded.
 */
function suppressLowN(
  rows: InsightRow[],
  threshold: number,
): { rendered: InsightRow[]; suppressed?: SectionSuppression } {
  const above = rows.filter((r) => r.n >= threshold);
  const below = rows.filter((r) => r.n < threshold);
  if (below.length === 0) return { rendered: above };

  const summed: Record<string, number> = {};
  for (const r of below) {
    for (const [k, v] of Object.entries(r.values)) {
      if (typeof v === 'number') summed[k] = (summed[k] ?? 0) + v;
    }
  }
  const nTotal = below.reduce((a, r) => a + r.n, 0);
  const other = makeRow({
    claim: `other (${below.length} row(s) each below n=${threshold})`,
    measures_used: ['aggregated tail'],
    n: nTotal,
    caveat: `Folded ${below.length} row(s) each with n<${threshold} — individually below the sample floor, shown as an aggregate so totals stay honest (no silent truncation).`,
    values: { ...summed, folded_rows: below.length },
  });
  return {
    rendered: [...above, other],
    suppressed: { rows: below.length, reason: `n<${threshold}` },
  };
}

// ── Unit derivation (a single-session report → one work-observation) ─────────

interface Unit {
  name: string;
  sessionId: string;
  /** `provenance.branches[0]` when exactly one, else `unassigned` (Q1 keying rule). */
  branch: string;
  active_s: number;
  /** Calendar span of the report's date range, or `null` when unparseable / zero. */
  wall_s: number | null;
  sent: number;
  received: number;
  flowStage: Rollup;
  skill: Rollup;
  bash: Rollup;
  timeline: TimelineMarker[];
  hasTimeline: boolean;
  tokenMeasured: boolean;
  /** Total bash-command calls (D-B: bash activity present but no signature markers ⇒ pre-era). */
  bashCalls: number;
  /** This session's stage-labelling mechanism counts (D-B: 0 flow+digit ⇒ stages unavailable). */
  mechanism: FlowStageMechanism;
}

export const UNASSIGNED = 'unassigned';

function branchOf(report: TelemetryReport): string {
  const b = report.provenance.branches;
  return b.length === 1 ? b[0] : UNASSIGNED;
}

function wallSecondsOf(report: TelemetryReport): number | null {
  const { from, to } = report.provenance.date_range;
  if (from.length === 0 || to.length === 0) return null;
  const span = parseIso(to) - parseIso(from);
  return Number.isFinite(span) && span > 0 ? span : null;
}

function unitOf(input: InsightInput): Unit {
  const r = input.report;
  return {
    name: input.name,
    sessionId: r.scope.session_ids[0] ?? '(unknown)',
    branch: branchOf(r),
    active_s: r.totals.time_s,
    wall_s: wallSecondsOf(r),
    sent: r.totals.tokens.input,
    received: r.totals.tokens.output,
    flowStage: r.rollups.flow_stage,
    skill: r.rollups.skill,
    bash: r.rollups.bash_command,
    timeline: r.control_timeline ?? [],
    hasTimeline: r.control_timeline !== undefined,
    tokenMeasured: r.provenance.token_coverage.measured > 0,
    bashCalls: r.rollups.bash_command.total.count,
    mechanism: r.provenance.flow_stage_mechanism,
  };
}

/**
 * D-B era/mechanism coverage: over the single-session units, count how many lack a
 * marker CLASS a downstream row depends on — EVIDENCE-BASED, never date-guessed.
 *
 * - `push_signatures_unavailable`: sessions that ran bash commands yet whose control
 *   timeline carries NO `bash` (`git push`/`git commit`) signature marker — i.e. a
 *   pre-FX001 shard, where the push signal was never captured. A `checks-before-push:
 *   0/0` over such sessions is UNMEASURABLE, not a confident zero.
 * - `stage_labels_unavailable`: sessions with zero FlowEvent-/digit-labeled stage
 *   windows (`flow + digit === 0`) — e.g. pre-1.2-fix FlowEvent starvation — so stage
 *   economics is unmeasurable for them, not simply empty.
 *
 * Returns `undefined` when there are no single-session units to evaluate (the section
 * degrades via `available:false` instead).
 */
function coverageDeclaration(units: Unit[]): SectionCoverage | undefined {
  if (units.length === 0) return undefined;
  const pushUnavailable = units.filter(
    (u) => u.bashCalls > 0 && !u.timeline.some((m) => m.kind === 'bash'),
  ).length;
  const stageUnavailable = units.filter((u) => u.mechanism.flow + u.mechanism.digit === 0).length;
  const note =
    `Push signatures unavailable for ${pushUnavailable}/${units.length} session(s) ` +
    `(bash calls present but no git push/commit signature markers — pre-FX001 era); ` +
    `stage labels unavailable for ${stageUnavailable}/${units.length} session(s) ` +
    `(no FlowEvent/digit-labeled windows). An unavailable marker class reads as UNMEASURABLE, distinct from a true zero.`;
  return {
    sessions: units.length,
    push_signatures_unavailable: pushUnavailable,
    stage_labels_unavailable: stageUnavailable,
    note,
  };
}

// ── Rollup aggregation across reports ───────────────────────────────────────

interface AggCell {
  count: number;
  time_s: number;
  input: number;
  output: number;
  semantic?: string;
}

/** Sum one dimension's entries across every input report → key → totals. */
function aggregateDimension(
  reports: InsightInput[],
  pick: (r: TelemetryReport) => Rollup,
  keyOf: (entry: Rollup['entries'][number]) => string | null,
): Map<string, AggCell> {
  const acc = new Map<string, AggCell>();
  for (const { report } of reports) {
    for (const e of pick(report).entries) {
      const key = keyOf(e);
      if (key === null) continue;
      let cell = acc.get(key);
      if (cell === undefined) {
        cell = { count: 0, time_s: 0, input: 0, output: 0 };
        acc.set(key, cell);
      }
      cell.count += e.count;
      cell.time_s += e.time_s ?? 0;
      cell.input += e.tokens.input;
      cell.output += e.tokens.output;
      if (e.semantic_stage !== undefined) cell.semantic = e.semantic_stage;
    }
  }
  return acc;
}

// ── §1 Stage economics ──────────────────────────────────────────────────────

function stageMechanismCaveat(reports: InsightInput[]): string {
  let flow = 0;
  let digit = 0;
  let unlabeled = 0;
  const versions = new Set<string>();
  for (const { report } of reports) {
    flow += report.provenance.flow_stage_mechanism.flow;
    digit += report.provenance.flow_stage_mechanism.digit;
    unlabeled += report.provenance.flow_stage_mechanism.unlabeled;
    versions.add(report.provenance.flow_stage_map_version);
  }
  return `Active time is an idle-excluded ESTIMATE; stages are FlowEvent-primary (${flow} flow / ${digit} digit-fallback / ${unlabeled} unlabeled windows), mapped by ${[...versions].join(', ')}.`;
}

function stageEconomics(reports: InsightInput[], units: Unit[]): InsightSection {
  const byStage = aggregateDimension(
    reports,
    (r) => r.rollups.flow_stage,
    (e) => e.semantic_stage ?? null,
  );
  const caveat = stageMechanismCaveat(reports);
  const workUnits = new Set(units.map((u) => u.branch)).size;
  const rows: InsightRow[] = [];
  for (const stage of SEMANTIC_ORDER) {
    const cell = byStage.get(stage);
    if (cell === undefined) continue;
    rows.push(
      makeRow({
        claim: `${stage}: ${cell.count} window(s), ${Math.round(cell.time_s)}s active, ${cell.input} sent / ${cell.output} received`,
        measures_used: ['rollups.flow_stage (FlowEvent-primary)', 'semantic stage map'],
        n: cell.count,
        caveat,
        values: {
          stage,
          windows: cell.count,
          active_s: Math.round(cell.time_s),
          sent: cell.input,
          received: cell.output,
          avg_active_s_per_work_unit: workUnits > 0 ? Math.round(cell.time_s / workUnits) : null,
        },
      }),
    );
  }

  const { rendered, suppressed } = suppressLowN(rows, N_THRESHOLD);

  // explore→ship elapsed in BOTH clocks — a per-work-unit measure (single reports).
  const spanning = units.filter((u) => {
    const stages = new Set(u.flowStage.entries.map((e) => e.semantic_stage).filter(Boolean));
    return stages.has('research') && stages.has('ship');
  });
  if (spanning.length > 0) {
    const active = spanning.reduce((a, u) => a + u.active_s, 0);
    const withWall = spanning.filter((u) => u.wall_s !== null);
    const wall = withWall.reduce((a, u) => a + (u.wall_s ?? 0), 0);
    rendered.push(
      makeRow({
        claim: `explore→ship: ${spanning.length} work unit(s) spanned research→ship — ${Math.round(active)}s active vs ${Math.round(wall)}s wall`,
        measures_used: ['totals.time_s (active)', 'provenance.date_range (wall)'],
        n: spanning.length,
        caveat: `Wall is the calendar span of the unit's session(s) (includes overnight/idle); active is idle-excluded. Wall shown for ${withWall.length}/${spanning.length} unit(s) with a parseable date range.`,
        values: {
          work_units: spanning.length,
          active_s: Math.round(active),
          wall_s: withWall.length > 0 ? Math.round(wall) : null,
        },
      }),
    );
  }

  const section: InsightSection = {
    id: 'stage_economics',
    title: 'Stage economics',
    available: true,
    rows: rendered,
  };
  if (suppressed !== undefined) section.suppressed = suppressed;
  const coverage = coverageDeclaration(units);
  if (coverage !== undefined) section.coverage = coverage;
  if (units.length === 0) {
    section.note =
      'Per-work-unit averages and explore→ship elapsed need single-session reports (unavailable here — aggregate-only input).';
  }
  return section;
}

// ── §2 Skill breakdown ──────────────────────────────────────────────────────

function skillBreakdown(reports: InsightInput[]): InsightSection {
  const bySkill = aggregateDimension(
    reports,
    (r) => r.rollups.skill,
    (e) => e.key,
  );
  const rows: InsightRow[] = [];
  for (const [key, cell] of bySkill) {
    rows.push(
      makeRow({
        claim: `${key}: ${cell.count} run(s), ${Math.round(cell.time_s)}s active, ${cell.input} sent / ${cell.output} received`,
        measures_used: ['rollups.skill'],
        n: cell.count,
        caveat:
          'Active time spans this-call→next-skill-call (idle excluded); an ESTIMATE, not a ledger.',
        values: {
          skill: key,
          runs: cell.count,
          active_s: Math.round(cell.time_s),
          sent: cell.input,
          received: cell.output,
        },
      }),
    );
  }
  rows.sort((a, b) => (b.values.runs as number) - (a.values.runs as number));
  const { rendered, suppressed } = suppressLowN(rows, N_THRESHOLD);
  const section: InsightSection = {
    id: 'skill_breakdown',
    title: 'Skill breakdown',
    available: true,
    rows: rendered,
    note: 'Includes the-flow (D4). NOT additive with §1 Stage economics — the-flow spans stages, so this is a second view of the same time, not extra time.',
  };
  if (suppressed !== undefined) section.suppressed = suppressed;
  return section;
}

// ── §3 Bash commands ────────────────────────────────────────────────────────

function bashCommands(reports: InsightInput[]): InsightSection {
  const byCmd = aggregateDimension(
    reports,
    (r) => r.rollups.bash_command,
    (e) => e.key,
  );
  const rows: InsightRow[] = [];
  for (const [key, cell] of byCmd) {
    rows.push(
      makeRow({
        claim: `${key}: ${cell.count} call(s), ${cell.input} sent / ${cell.output} received`,
        measures_used: ['rollups.bash_command (FX001 signature)'],
        n: cell.count,
        caveat:
          'Keyed by the command SIGNATURE (program+verb, P12-safe); commands carry no honest per-call duration, so no time column.',
        values: { command: key, count: cell.count, sent: cell.input, received: cell.output },
      }),
    );
  }
  const { rendered, suppressed } = suppressLowN(rows, N_THRESHOLD);
  const keyOf = (r: InsightRow): string => String(r.values.command ?? r.claim);
  const byCount = [...rendered]
    .sort((a, b) => (b.values.count as number) - (a.values.count as number))
    .map(keyOf);
  const bySent = [...rendered]
    .sort((a, b) => (b.values.sent as number) - (a.values.sent as number))
    .map(keyOf);
  const section: InsightSection = {
    id: 'bash_commands',
    title: 'Bash commands',
    available: true,
    rows: rendered,
    orderings: { by_count: byCount, by_sent: bySent },
  };
  if (suppressed !== undefined) section.suppressed = suppressed;
  return section;
}

// ── §4 Subagents ────────────────────────────────────────────────────────────

function subagents(units: Unit[]): InsightSection {
  const withTimeline = units.filter((u) => u.hasTimeline);
  if (withTimeline.length === 0) {
    return {
      id: 'subagents',
      title: 'Subagents',
      available: false,
      rows: [],
      note: 'Unavailable: subagent counts need single-session reports carrying a control timeline.',
    };
  }
  const byName = new Map<string, number>();
  for (const u of withTimeline) {
    for (const m of u.timeline) {
      if (m.kind === 'subagent') byName.set(m.key, (byName.get(m.key) ?? 0) + 1);
    }
  }
  const rows: InsightRow[] = [];
  for (const [name, count] of byName) {
    rows.push(
      makeRow({
        claim: `${name}: ${count} spawn(s); tokens unmeasured`,
        measures_used: ['control_timeline (subagent markers)'],
        n: count,
        caveat:
          'Counts are EXACT (subagent markers); token attribution is an open phase-3 capture gap (WS001) — rendered as unmeasured, NEVER a fabricated zero.',
        values: { subagent: name, count, sent: null, received: null },
      }),
    );
  }
  const { rendered, suppressed } = suppressLowN(rows, N_THRESHOLD);
  const section: InsightSection = {
    id: 'subagents',
    title: 'Subagents',
    available: true,
    rows: rendered,
  };
  if (suppressed !== undefined) section.suppressed = suppressed;
  if (rendered.length === 0) section.note = 'No subagents observed in the single-session inputs.';
  return section;
}

// ── §5 Active-vs-wall ratio ─────────────────────────────────────────────────

function activeWallRatio(units: Unit[]): InsightSection {
  if (units.length === 0) {
    return {
      id: 'active_wall_ratio',
      title: 'Active-vs-wall ratio',
      available: false,
      rows: [],
      note: 'Unavailable: the active/wall ratio needs single-session reports (per-session grain).',
    };
  }
  const withWall = units.filter((u) => u.wall_s !== null);
  // D-A: a session whose active time exceeds its own calendar span is a timestamp-
  // precision artifact (the gap classifier accrued more active seconds than the
  // observed wall span). Honesty-first: EXCLUDE it from the cohort sums + DECLARE the
  // exclusion — never a silent clamp of the number.
  const impossible = (u: Unit): boolean => u.wall_s !== null && u.active_s > u.wall_s;
  const cohortUnits = withWall.filter((u) => !impossible(u));
  const excluded = withWall.length - cohortUnits.length;
  const active = cohortUnits.reduce((a, u) => a + u.active_s, 0);
  const wall = cohortUnits.reduce((a, u) => a + (u.wall_s ?? 0), 0);
  const rows: InsightRow[] = [];
  rows.push(
    makeRow({
      claim: `cohort: ${Math.round(active)}s active over ${Math.round(wall)}s wall (ratio ${wall > 0 ? (active / wall).toFixed(2) : 'n/a'})`,
      measures_used: ['totals.time_s (active)', 'provenance.date_range (wall)'],
      n: cohortUnits.length,
      caveat:
        `Active is idle-excluded; wall is the calendar span (includes overnight/idle). Over ${cohortUnits.length}/${units.length} session(s) with a parseable date range` +
        (excluded > 0
          ? `. Excluded ${excluded} session(s) whose active exceeded their calendar span (timestamp-precision artifact) so the aggregate is not inflated.`
          : '.'),
      values: {
        scope: 'cohort',
        active_s: Math.round(active),
        wall_s: Math.round(wall),
        ratio: wall > 0 ? Math.round((active / wall) * 100) / 100 : null,
        excluded,
      },
    }),
  );
  for (const u of units) {
    const bad = impossible(u);
    rows.push(
      makeRow({
        claim: `${u.sessionId}: ${Math.round(u.active_s)}s active over ${u.wall_s === null ? 'unknown' : `${Math.round(u.wall_s)}s`} wall`,
        measures_used: ['totals.time_s', 'provenance.date_range'],
        n: 1,
        caveat: bad
          ? 'Active exceeds the calendar span — a timestamp-precision artifact (coarse/anchored timestamps let the gap classifier over-accrue active seconds); EXCLUDED from the cohort aggregate.'
          : 'A single session (n=1); the cohort row above is the aggregate claim.',
        values: {
          session: u.sessionId,
          active_s: Math.round(u.active_s),
          wall_s: u.wall_s === null ? null : Math.round(u.wall_s),
          ratio:
            u.wall_s !== null && u.wall_s > 0
              ? Math.round((u.active_s / u.wall_s) * 100) / 100
              : null,
          ...(bad ? { data_quality: 'active-exceeds-wall' } : {}),
        },
      }),
    );
  }
  return { id: 'active_wall_ratio', title: 'Active-vs-wall ratio', available: true, rows };
}

// ── §6 Outlier sessions ─────────────────────────────────────────────────────

function topStage(u: Unit): string {
  let best: { stage: string; t: number } | null = null;
  for (const e of u.flowStage.entries) {
    if (e.semantic_stage === undefined) continue;
    if (best === null || (e.time_s ?? 0) > best.t)
      best = { stage: e.semantic_stage, t: e.time_s ?? 0 };
  }
  return best?.stage ?? '(none)';
}

function topCommand(u: Unit): string {
  const top = [...u.bash.entries].sort((a, b) => b.count - a.count)[0];
  return top?.key ?? '(none)';
}

function outliers(units: Unit[]): InsightSection {
  if (units.length === 0) {
    return {
      id: 'outlier_sessions',
      title: 'Outlier sessions',
      available: false,
      rows: [],
      note: 'Unavailable: outliers need single-session reports (per-session grain).',
    };
  }
  const rowFor = (u: Unit): InsightRow =>
    makeRow({
      claim: `${u.sessionId}: ${u.sent} sent / ${u.received} received, ${Math.round(u.active_s)}s active; mix ${topStage(u)} · ${topCommand(u)}`,
      measures_used: [
        'totals.tokens',
        'totals.time_s',
        'rollups.flow_stage',
        'rollups.bash_command',
      ],
      n: units.length,
      caveat: `A single session ranked within the ${units.length}-session population — averages hide the session that burned the most.`,
      values: {
        session: u.sessionId,
        sent: u.sent,
        received: u.received,
        active_s: Math.round(u.active_s),
        top_stage: topStage(u),
        top_command: topCommand(u),
      },
    });
  const bySent = [...units].sort((a, b) => b.sent - a.sent).slice(0, 3);
  const byActive = [...units].sort((a, b) => b.active_s - a.active_s).slice(0, 3);
  const chosen = new Map<string, Unit>();
  for (const u of [...bySent, ...byActive]) chosen.set(u.sessionId, u);
  const rows = [...chosen.values()].map(rowFor);
  return {
    id: 'outlier_sessions',
    title: 'Outlier sessions',
    available: true,
    rows,
    orderings: {
      by_sent: bySent.map((u) => u.sessionId),
      by_active: byActive.map((u) => u.sessionId),
    },
  };
}

// ── Discipline metrics (per-unit, reused by §7 + the panel) ─────────────────

interface DisciplineRaw {
  observes: number;
  convertedObserves: number;
  drains: number;
  hasChecks: boolean;
  bootBeforeChecks: boolean;
  pushes: number;
  pushesWithPriorChecks: number;
  recordTimes: number[];
}

/** True when a marker is a checks SIGNAL — a `checks` verdict OR the `checks` verb. */
function isChecksSignal(m: TimelineMarker): boolean {
  return m.kind === 'checks' || (m.kind === 'harness' && m.key === CHECKS_VERB);
}

/**
 * Sequence-join the ordered control markers of ONE work unit into discipline raw
 * counts (2.3). The push join is STRICT on time order (`checks.t < push.t`) — the
 * mutation that counts a checks AFTER a push as "before" flips the rate.
 */
function disciplineOf(markers: TimelineMarker[]): DisciplineRaw {
  const ordered = [...markers].sort((a, b) => parseIso(a.t) - parseIso(b.t));
  const observeTimes: number[] = [];
  const recordTimes: number[] = [];
  const checksTimes: number[] = [];
  let firstBoot: number | null = null;
  let firstChecks: number | null = null;
  const pushTimes: number[] = [];
  for (const m of ordered) {
    const t = parseIso(m.t);
    if (m.kind === 'harness' && m.key === OBSERVE_VERB) observeTimes.push(t);
    else if (m.kind === 'harness' && m.key === DRAIN_VERB) recordTimes.push(t);
    else if (m.kind === 'harness' && m.key === BACKPRESSURE_VERB && firstBoot === null)
      firstBoot = t;
    else if (m.kind === 'bash' && m.key === PUSH_KEY) pushTimes.push(t);
    if (isChecksSignal(m)) {
      checksTimes.push(t);
      if (firstChecks === null) firstChecks = t;
    }
  }
  const convertedObserves = observeTimes.filter((ot) => recordTimes.some((rt) => rt > ot)).length;
  const pushesWithPriorChecks = pushTimes.filter((pt) => checksTimes.some((ct) => ct < pt)).length;
  return {
    observes: observeTimes.length,
    convertedObserves,
    drains: recordTimes.length,
    hasChecks: firstChecks !== null,
    bootBeforeChecks: firstChecks !== null && firstBoot !== null && firstBoot < firstChecks,
    pushes: pushTimes.length,
    pushesWithPriorChecks,
    recordTimes,
  };
}

function sumRaw(parts: DisciplineRaw[]): DisciplineRaw {
  const acc: DisciplineRaw = {
    observes: 0,
    convertedObserves: 0,
    drains: 0,
    hasChecks: false,
    bootBeforeChecks: false,
    pushes: 0,
    pushesWithPriorChecks: 0,
    recordTimes: [],
  };
  for (const p of parts) {
    acc.observes += p.observes;
    acc.convertedObserves += p.convertedObserves;
    acc.drains += p.drains;
    acc.pushes += p.pushes;
    acc.pushesWithPriorChecks += p.pushesWithPriorChecks;
  }
  return acc;
}

// ── Work-unit grouping ──────────────────────────────────────────────────────

interface WorkUnit {
  branch: string;
  units: Unit[];
  markers: TimelineMarker[];
  discipline: DisciplineRaw;
}

function groupWorkUnits(units: Unit[]): WorkUnit[] {
  const byBranch = new Map<string, Unit[]>();
  for (const u of units) {
    const list = byBranch.get(u.branch);
    if (list === undefined) byBranch.set(u.branch, [u]);
    else list.push(u);
  }
  const out: WorkUnit[] = [];
  for (const [branch, list] of byBranch) {
    const markers = list.flatMap((u) => u.timeline).sort((a, b) => parseIso(a.t) - parseIso(b.t));
    out.push({ branch, units: list, markers, discipline: disciplineOf(markers) });
  }
  // Stable: real branches first (by name), the `unassigned` catch-all last.
  out.sort((a, b) =>
    a.branch === UNASSIGNED ? 1 : b.branch === UNASSIGNED ? -1 : a.branch < b.branch ? -1 : 1,
  );
  return out;
}

// ── §2.3 Discipline panel ───────────────────────────────────────────────────

function disciplinePanel(units: Unit[], workUnits: WorkUnit[]): InsightSection {
  const withTimeline = units.some((u) => u.hasTimeline);
  if (units.length === 0 || !withTimeline) {
    return {
      id: 'discipline',
      title: 'Discipline panel',
      available: false,
      rows: [],
      note: 'Unavailable: the discipline panel needs single-session reports carrying a control timeline (sequence joins over ordered harness events).',
    };
  }
  const totals = sumRaw(workUnits.map((w) => w.discipline));
  const coverage = coverageDeclaration(units);
  const rows: InsightRow[] = [];

  rows.push(
    makeRow({
      claim: `observe→drain: ${totals.convertedObserves}/${totals.observes} observations later harvested (\`harness record\`)`,
      measures_used: ['control_timeline (harness observe/record)'],
      n: totals.observes,
      caveat:
        'Conversion = an `observe` marker followed later by a `record` (retro drain) in the same work unit; verbs grounded in the loop (observe.ts).',
      values: {
        observes: totals.observes,
        drained: totals.convertedObserves,
        rate:
          totals.observes > 0
            ? Math.round((totals.convertedObserves / totals.observes) * 100) / 100
            : null,
      },
    }),
  );

  const withChecks = workUnits.filter((w) => w.discipline.hasChecks);
  const bootFirst = withChecks.filter((w) => w.discipline.bootBeforeChecks).length;
  rows.push(
    makeRow({
      claim: `backpressure-before-implement: ${bootFirst}/${withChecks.length} work unit(s) ran \`boot\` before their first \`checks\``,
      measures_used: ['control_timeline (harness boot/checks)'],
      n: withChecks.length,
      caveat:
        'Proxy: `boot` (backpressure survey) before the FIRST `checks` gate in the work unit (checks ≈ the implement gate). Only work units that ran checks are counted.',
      values: {
        work_units_with_checks: withChecks.length,
        boot_first: bootFirst,
        rate:
          withChecks.length > 0 ? Math.round((bootFirst / withChecks.length) * 100) / 100 : null,
      },
    }),
  );

  // D-B: when NO push happened AND some sessions ran bash without any signature marker,
  // `0/0` is UNMEASURABLE for those sessions (pre-FX001 era), not a confident zero.
  const pushUnmeasurable =
    totals.pushes === 0 && coverage !== undefined && coverage.push_signatures_unavailable > 0;
  rows.push(
    makeRow({
      claim: `checks-before-push: ${totals.pushesWithPriorChecks}/${totals.pushes} push(es) had a prior \`checks\``,
      measures_used: ['control_timeline (checks marker / harness checks, git push signature)'],
      n: totals.pushes,
      caveat:
        'A push is compliant when a checks signal (verdict or `harness checks`) precedes it in time within the work unit — strict `checks.t < push.t`.' +
        (pushUnmeasurable && coverage !== undefined
          ? ` UNMEASURABLE for ${coverage.push_signatures_unavailable}/${coverage.sessions} session(s): git push signatures are absent in that era (pre-FX001 markers) — distinct from a true 0/0.`
          : ''),
      values: {
        pushes: totals.pushes,
        with_prior_checks: totals.pushesWithPriorChecks,
        rate:
          totals.pushes > 0
            ? Math.round((totals.pushesWithPriorChecks / totals.pushes) * 100) / 100
            : null,
      },
    }),
  );

  const gaps: number[] = [];
  for (const w of workUnits) {
    const rts = [...w.discipline.recordTimes].sort((a, b) => a - b);
    for (let i = 1; i < rts.length; i++) gaps.push(rts[i] - rts[i - 1]);
  }
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  rows.push(
    makeRow({
      claim:
        avgGap === null
          ? 'retro cadence: not enough retros to measure a gap'
          : `retro cadence: ${Math.round(avgGap)}s average wall gap between retros`,
      measures_used: ['control_timeline (harness record)'],
      n: gaps.length,
      caveat:
        'Wall-clock gap between consecutive `record` (retro drain) markers within a work unit; needs ≥2 retros in a unit to register.',
      values: { retro_gaps: gaps.length, avg_gap_s: avgGap === null ? null : Math.round(avgGap) },
    }),
  );

  const section: InsightSection = {
    id: 'discipline',
    title: 'Discipline panel',
    available: true,
    rows,
  };
  if (coverage !== undefined) section.coverage = coverage;
  return section;
}

// ── §7 Per-work-unit table ──────────────────────────────────────────────────

function stageShares(units: Unit[]): Record<string, number | null> {
  const byStage = new Map<string, number>();
  let total = 0;
  for (const u of units) {
    for (const e of u.flowStage.entries) {
      if (e.semantic_stage === undefined) continue;
      const t = e.time_s ?? 0;
      byStage.set(e.semantic_stage, (byStage.get(e.semantic_stage) ?? 0) + t);
      total += t;
    }
  }
  const shares: Record<string, number | null> = {};
  for (const stage of SEMANTIC_ORDER) {
    const t = byStage.get(stage) ?? 0;
    shares[`share_${stage}`] = total > 0 ? Math.round((t / total) * 100) / 100 : null;
  }
  return shares;
}

function perWorkUnit(workUnits: WorkUnit[], units: Unit[]): InsightSection {
  if (units.length === 0) {
    return {
      id: 'per_work_unit',
      title: 'Per-work-unit table',
      available: false,
      rows: [],
      note: 'Unavailable: the per-work-unit table needs single-session reports (branch-keyed grain).',
    };
  }
  const rows: InsightRow[] = [];
  for (const w of workUnits) {
    const sent = w.units.reduce((a, u) => a + u.sent, 0);
    const received = w.units.reduce((a, u) => a + u.received, 0);
    const active = w.units.reduce((a, u) => a + u.active_s, 0);
    const d = w.discipline;
    rows.push(
      makeRow({
        claim: `${w.branch}: ${w.units.length} session(s), ${sent} sent / ${received} received, ${Math.round(active)}s active`,
        measures_used: ['totals', 'rollups.flow_stage', 'control_timeline (discipline)'],
        n: w.units.length,
        caveat:
          w.branch === UNASSIGNED
            ? 'Sessions with no single branch (branch-hopping or none) — grouped honestly, never split without events.'
            : `Work unit keyed by branch (n=${w.units.length} session(s)); the grain-validation table, so small units are shown, not suppressed.`,
        values: {
          work_unit: w.branch,
          sessions: w.units.length,
          sent,
          received,
          active_s: Math.round(active),
          ...stageShares(w.units),
          observe_to_drain:
            d.observes > 0 ? Math.round((d.convertedObserves / d.observes) * 100) / 100 : null,
          checks_before_push:
            d.pushes > 0 ? Math.round((d.pushesWithPriorChecks / d.pushes) * 100) / 100 : null,
        },
      }),
    );
  }
  return {
    id: 'per_work_unit',
    title: 'Per-work-unit table',
    available: true,
    rows,
    note: 'Keying rule: work unit = branch (provenance.branches[0] when exactly one, else `unassigned`). Stage-share columns are fractions of the unit\u2019s active time; discipline columns come from the panel.',
  };
}

// ── §2.4 Observe conversion + disposition mix (plan 056, workshop D6) ────────

/**
 * `observe_conversion` — the friction→observe conversion ratio: `harness observe`
 * events ÷ friction proxies (non-zero `command_exit` + `api_error`) across the
 * cohort. Deterministic, zero-LLM. A LOW ratio flags friction going uncaptured
 * (tripwire TW-1: the channels aren't landing). Correlational only.
 */
function observeConversion(inputs: InsightInput[]): InsightSection {
  let observes = 0;
  let friction = 0;
  for (const { report } of inputs) {
    observes += report.totals.observe_events ?? 0;
    const fr = report.totals.friction;
    friction += (fr?.command_errors ?? 0) + (fr?.api_errors ?? 0);
  }
  if (observes === 0 && friction === 0) {
    return {
      id: 'observe_conversion',
      title: 'Observe conversion',
      available: false,
      rows: [],
      note: 'Unavailable: the cohort carries no `observe` events and no friction proxies (non-zero command_exit / api_error).',
    };
  }
  const rate = friction > 0 ? Math.round((observes / friction) * 100) / 100 : null;
  return {
    id: 'observe_conversion',
    title: 'Observe conversion',
    available: true,
    rows: [
      makeRow({
        claim: `friction→observe: ${observes} observe event(s) against ${friction} friction proxy(ies)`,
        measures_used: ['harness observe events', 'command_exit(!=0) + api_error'],
        n: friction,
        caveat:
          'Conversion proxy = `harness observe` invocations / friction proxies (non-zero command_exit + api_error) across the cohort. Correlational; a low ratio flags friction going uncaptured (TW-1). A zero-friction cohort shows rate=null (no denominator).',
        values: { observes, friction, rate },
      }),
    ],
  };
}

/**
 * `disposition_mix` — the drain-outcome distribution from `retro` artifact events
 * (schema 1.2 `disp_*` counts). A high `declined` share flags junk drain options
 * (tripwire TW-2). Counts-only; disposition reasons never travel (workshop D5).
 * Definitionally zero at T0 (no 1.2 records exist yet) — renders `available:false`.
 */
function dispositionMix(inputs: InsightInput[]): InsightSection {
  const totals: Record<string, number> = {};
  let observations = 0;
  for (const { report } of inputs) {
    const retro = report.totals.retro;
    observations += retro?.observations ?? 0;
    for (const [k, v] of Object.entries(retro?.dispositions ?? {})) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (sum === 0) {
    return {
      id: 'disposition_mix',
      title: 'Disposition mix',
      available: false,
      rows: [],
      note: 'Unavailable: no retro artifact events carry dispositions in the cohort (definitionally zero until schema-1.2 records are drained).',
    };
  }
  const rows = Object.entries(totals)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) =>
      makeRow({
        claim: `${k.replace(/^disp_/, '')}: ${v}`,
        measures_used: ['retro artifact events (disp_* counts)'],
        n: v,
        caveat:
          'Drain-outcome mix from committed retro records (schema 1.2). A high `declined` share flags junk drain options (TW-2). Counts-only — no disposition reasons travel.',
        values: { count: v, share: sum > 0 ? Math.round((v / sum) * 100) / 100 : null },
      }),
    );
  return {
    id: 'disposition_mix',
    title: 'Disposition mix',
    available: true,
    rows,
    note: `Dispositions recorded across ${observations} presented observation(s).`,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Compute the WS001 v1 insights document over `1..N` saved reports. Grain-robust
 * (Q1): per-session sections use the single-session inputs and render
 * `available:false` when none exist. Never re-reads shards, never joins external
 * data, never fabricates a number.
 */
export function buildInsights(
  inputs: InsightInput[],
  opts: BuildInsightsOptions = {},
): InsightsDocument {
  const singles = inputs.filter((i) => i.report.scope.single);
  const aggregates = inputs.filter((i) => !i.report.scope.single);
  const units = singles.map(unitOf);
  const workUnits = groupWorkUnits(units);

  const sections: InsightSection[] = [
    stageEconomics(inputs, units),
    skillBreakdown(inputs),
    bashCommands(inputs),
    subagents(units),
    activeWallRatio(units),
    outliers(units),
    perWorkUnit(workUnits, units),
    observeConversion(inputs),
    dispositionMix(inputs),
  ];
  const discipline = disciplinePanel(units, workUnits);

  const mapVersions = new Set<string>();
  const coverage: TokenCoverage = { measured: 0, unmeasured: 0 };
  for (const { report } of inputs) {
    mapVersions.add(report.provenance.flow_stage_map_version);
    coverage.measured += report.provenance.token_coverage.measured;
    coverage.unmeasured += report.provenance.token_coverage.unmeasured;
  }

  const provenance: InsightsProvenance = {
    input_reports: inputs.map((i) => ({
      name: i.name,
      session_count: i.report.scope.session_count,
      single: i.report.scope.single,
    })),
    skipped_inputs: opts.skipped ?? [],
    single_session_reports: singles.length,
    aggregate_reports: aggregates.length,
    flow_stage_map_versions: [...mapVersions],
    keying_rule:
      'work unit = branch (provenance.branches[0] when exactly one, else `unassigned`); a branch-hopping session is never split without events (Q1).',
    n_threshold: N_THRESHOLD,
    token_coverage: coverage,
    caveats: [
      'Copilot tail-capture time-skew (dossier H-05): copilot sessions capture on a tail cadence, so a session\u2019s last events may be time-skewed relative to other harnesses — declared, not corrected (document-don\u2019t-fix).',
      'Subagent token attribution is unmeasured (open phase-3 capture gap) — subagent rows render counts only, never fabricated token zeros.',
      'All numbers are recomputed from saved reports only; observational data — correlational language only, no causal claims (WS001 epistemic contract).',
    ],
    generated_at: opts.generatedAt ?? '',
  };

  return { schema_version: INSIGHTS_SCHEMA_VERSION, sections, discipline, provenance };
}
