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
 *  - `flow_stage`   — `flow` event stages; wall-time from `computeRollup` (the
 *                     authoritative stage windowing, `flow_stage_time_s`).
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
import { computeRollup, parseIso } from './rollup.js';
import type { SessionExport } from './session-export.js';

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

/** Estimated token attribution for a row (`output` = generated tokens; `total` = all buckets). */
export interface RollupTokens {
  output: number;
  total: number;
}

/** One row — identical across every dimension so the HTML renders them uniformly. */
export interface RollupEntry {
  /** `'rg'` | `'harness nav'` | `'the-flow'` | `'Read'` | `'implement'`. */
  key: string;
  /** EXACT (event/segment count). */
  count: number;
  /** ESTIMATE (timeline-bracket). */
  time_s: number;
  /** ESTIMATE (turn-window even-split). */
  tokens: RollupTokens;
}

export interface Rollup {
  dimension: ReportDimension;
  /** Sorted desc (default `tokens.total`; `--sort` overrides). */
  entries: RollupEntry[];
  total: { count: number; time_s: number; tokens: RollupTokens };
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
   * Echoed for self-description only — NOT applied. A `SessionExport` carries no
   * repo facet in v1; repo-granular narrowing is Phase 3 / workshop 004 (central
   * storage keyed by repo path). Kept so a `--filter-repo` report is honest about
   * intent without pretending it filtered.
   */
  repo?: string[];
  date_from?: string;
  date_to?: string;
}

export interface ReportTotals {
  time_s: number;
  tokens: RollupTokens;
  sessions: number;
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
}

export interface BuildReportOptions {
  /** Facets to narrow by (applied to `harness`/`model`/`branch`/date; `repo` echoed only). */
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

/** The concrete (never-'unknown') token buckets a turn carries, defaulted to 0. */
function turnTokens(e: { in?: number; out?: number; cache_read?: number; cache_create?: number }): {
  output: number;
  total: number;
} {
  const inn = e.in ?? 0;
  const out = e.out ?? 0;
  const cr = e.cache_read ?? 0;
  const cc = e.cache_create ?? 0;
  return { output: out, total: inn + out + cr + cc };
}

/** A per-session, time-ordered view of the stream with the derived rollup (flow_log excluded). */
interface SessionView {
  export: SessionExport;
  /** Sorted asc by `t`, `flow_log` markers removed (replay-only — KF gap math). */
  events: ReturnType<typeof otlpLogsToEvents>;
  rollup: ReturnType<typeof computeRollup>;
}

function viewOf(exp: SessionExport): SessionView {
  const events = otlpLogsToEvents(exp.signals.logs)
    .filter((e) => e.kind !== 'flow_log')
    .sort((a, b) => parseIso(a.t) - parseIso(b.t));
  return { export: exp, events, rollup: computeRollup(events) };
}

// ── Accumulator (mutable per-dimension row map, folded across sessions) ──────

interface Cell {
  count: number;
  time_s: number;
  output: number;
  total: number;
}

class DimAcc {
  private readonly cells = new Map<string, Cell>();

  cell(key: string): Cell {
    let c = this.cells.get(key);
    if (c === undefined) {
      c = { count: 0, time_s: 0, output: 0, total: 0 };
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

  addTokens(key: string, output: number, total: number): void {
    const c = this.cell(key);
    c.output += output;
    c.total += total;
  }

  /** Snapshot to a finished, sorted, optionally-truncated `Rollup`. */
  finish(dimension: ReportDimension, sort: ReportSortKey, top?: number): Rollup {
    const entries: RollupEntry[] = [...this.cells.entries()]
      .filter(([key]) => key.length > 0)
      .map(([key, c]) => ({
        key,
        count: Math.round(c.count),
        time_s: Math.round(c.time_s),
        tokens: { output: Math.round(c.output), total: Math.round(c.total) },
      }));
    sortEntries(entries, sort);

    const total = entries.reduce(
      (acc, e) => {
        acc.count += e.count;
        acc.time_s += e.time_s;
        acc.tokens.output += e.tokens.output;
        acc.tokens.total += e.tokens.total;
        return acc;
      },
      { count: 0, time_s: 0, tokens: { output: 0, total: 0 } },
    );

    const rollup: Rollup = { dimension, entries, total };
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
    sort === 'time' ? e.time_s : sort === 'count' ? e.count : e.tokens.total;
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
 * Fold ONE session's events into the shared accumulators. Cross-session
 * aggregation is just calling this per session (re-aggregate from Logs, never
 * sum cumulative metrics — KF-03).
 */
function foldSession(
  view: SessionView,
  acc: Accs,
): { output: number; total: number; wall: number } {
  const ev = view.events;
  const n = ev.length;

  // Gap AFTER each event (timeline-bracket time attribution). Last event = 0.
  const gapAfter: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const g = parseIso(ev[i + 1].t) - parseIso(ev[i].t);
    gapAfter[i] = Number.isFinite(g) && g > 0 ? g : 0;
  }

  // Which shell tools events are FULLY consumed by a co-timed harness call (D1
  // no-double-count): match each harness event's `t` to a shell tools event at
  // the same `t`, greedily. `bashNet[i]` = the bash-count that shell event i
  // contributes AFTER excluding harness invocations.
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

  // ── Counts + time (per event) ──
  for (let i = 0; i < n; i++) {
    const e = ev[i];
    const gap = gapAfter[i];
    if (e.kind === 'flow') {
      acc.flow_stage.addCount(e.stage, 1);
      // flow_stage time comes from computeRollup (authoritative stage windowing), below.
    } else if (e.kind === 'skill') {
      acc.skill.addCount(e.name, 1);
      acc.skill.addTime(e.name, gap);
    } else if (e.kind === 'tools') {
      acc.tool.addCount(e.name, e.count);
      acc.tool.addTime(e.name, gap);
      const sk = shellKey(e.name);
      if (sk !== null && bashNet[i] > 0) {
        // FX001-5: key by the captured command signature (`rg`, `git commit`) when
        // present, else fall back to the shell-tool name (old data / no signature).
        const bk = e.signature ?? sk;
        acc.bash_command.addCount(bk, bashNet[i]);
        acc.bash_command.addTime(bk, gap);
      }
    } else if (e.kind === 'harness') {
      acc.harness_command.addCount(e.verb, 1);
      acc.harness_command.addTime(e.verb, gap);
    }
  }

  // flow_stage wall-time from the authoritative engine (`IDLE_CAP_S=300`).
  for (const [stage, s] of Object.entries(view.rollup.flow_stage_time_s)) {
    acc.flow_stage.addTime(stage, s);
  }

  // ── Token attribution: turn-window even-split ──
  const turnIdx: number[] = [];
  for (let i = 0; i < n; i++) if (ev[i].kind === 'turn') turnIdx.push(i);

  let sessionOut = 0;
  let sessionTotal = 0;
  for (let k = 0; k < turnIdx.length; k++) {
    const ti = turnIdx[k];
    const turn = ev[ti] as {
      in?: number;
      out?: number;
      cache_read?: number;
      cache_create?: number;
    };
    const { output, total } = turnTokens(turn);
    sessionOut += output;
    sessionTotal += total;
    if (total === 0 && output === 0) continue;

    // The turn's window = [t_k, t_{k+1}) — activity this turn drove.
    const from = parseIso(ev[ti].t);
    const to = k + 1 < turnIdx.length ? parseIso(ev[turnIdx[k + 1]].t) : Number.POSITIVE_INFINITY;
    const inWindow = (i: number): boolean => {
      const t = parseIso(ev[i].t);
      return Number.isFinite(t) ? t >= from && t < to : i > ti; // NaN t: fall back to index order
    };

    // Per-dimension distinct active keys in the window, split evenly.
    const toolKeys = new Set<string>();
    const bashKeys = new Set<string>();
    const skillKeys = new Set<string>();
    const harnessKeys = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (i === ti || !inWindow(i)) continue;
      const e = ev[i];
      if (e.kind === 'tools') {
        toolKeys.add(e.name);
        const sk = shellKey(e.name);
        if (sk !== null && bashNet[i] > 0) bashKeys.add(e.signature ?? sk);
      } else if (e.kind === 'skill') {
        skillKeys.add(e.name);
      } else if (e.kind === 'harness') {
        harnessKeys.add(e.verb);
      }
    }
    // flow_stage is ALWAYS "active" via the stage in force at the turn.
    const stage = stageActiveAt(ev, ti);

    splitInto(acc.tool, toolKeys, output, total);
    splitInto(acc.bash_command, bashKeys, output, total);
    splitInto(acc.skill, skillKeys, output, total);
    splitInto(acc.harness_command, harnessKeys, output, total);
    if (stage !== null) splitInto(acc.flow_stage, new Set([stage]), output, total);
  }

  return { output: sessionOut, total: sessionTotal, wall: view.rollup.activity.wall_s };
}

/** The `flow` stage in force at (≤) event index `ti` — the last flow marker before it. */
function stageActiveAt(ev: SessionView['events'], ti: number): string | null {
  let stage: string | null = null;
  const at = parseIso(ev[ti].t);
  for (let i = 0; i <= ti; i++) {
    const e = ev[i];
    if (e.kind !== 'flow') continue;
    const t = parseIso(ev[i].t);
    // Prefer time order; tolerate NaN by index order (i <= ti already holds).
    if (!Number.isFinite(at) || !Number.isFinite(t) || t <= at) stage = e.stage;
  }
  return stage;
}

/** Even-split a turn's tokens across the distinct keys active in its window. */
function splitInto(acc: DimAcc, keys: Set<string>, output: number, total: number): void {
  if (keys.size === 0) return;
  const shareOut = output / keys.size;
  const shareTot = total / keys.size;
  for (const key of keys) acc.addTokens(key, shareOut, shareTot);
}

// ── Filtering ───────────────────────────────────────────────────────────────

/** Does this export pass the applied facets (`harness`/`model`/`branch`/date)? `repo` is echo-only. */
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
 * Roll up 1..N `SessionExport`s into one `TelemetryReport`. Applies `opts.filter`
 * (echoing the facets into `report.filter`), folds every matching session's event
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

  let totalOut = 0;
  let totalTok = 0;
  let totalWall = 0;
  const sessionIds: string[] = [];
  const branches: string[] = [];
  const harnesses: string[] = [];
  const models: string[] = [];
  let from: string | null = null;
  let to: string | null = null;

  for (const exp of included) {
    const sums = foldSession(viewOf(exp), acc);
    totalOut += sums.output;
    totalTok += sums.total;
    totalWall += sums.wall;
    sessionIds.push(exp.identity.harness_session_id);
    uniquePush(branches, exp.identity.branch);
    uniquePush(harnesses, exp.identity.harness);
    for (const m of exp.identity.models) uniquePush(models, m);
    const f = exp.summary.first_timecode;
    const l = exp.summary.last_timecode;
    if (f !== null && (from === null || f < from)) from = f;
    if (l !== null && (to === null || l > to)) to = l;
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
      time_s: Math.round(totalWall),
      tokens: { output: Math.round(totalOut), total: Math.round(totalTok) },
      sessions: included.length,
    },
    rollups: {
      flow_stage: acc.flow_stage.finish('flow_stage', sort, opts.top),
      skill: acc.skill.finish('skill', sort, opts.top),
      tool: acc.tool.finish('tool', sort, opts.top),
      bash_command: acc.bash_command.finish('bash_command', sort, opts.top),
      harness_command: acc.harness_command.finish('harness_command', sort, opts.top),
    },
    attribution: {
      tokens: 'turn-window-even-split',
      time: 'timeline-bracket',
      exact: ['count'],
      bash_command_key: 'shell-command-signature-or-tool-name',
      notes: [
        // D1 + FX001-5: when a shell call's command signature was captured
        // (program+verb only, P12-safe — `rg`, `git commit`), bash_command keys by
        // it (argv-token granularity, the workshop-002 `rg ×54` ask); for older data
        // with no signature it falls back to the shell-tool name (`bash`/`shell`).
        'bash_command keys by the captured command signature (program+verb, e.g. rg / git commit) when available, else the shell-tool name (bash/shell); only the signature — never full argv — is stored (P12).',
        'harness_command counts in-stream harness verbs; bash_command excludes co-timed harness invocations to avoid double-count.',
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
    },
  };
}
