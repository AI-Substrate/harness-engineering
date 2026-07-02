/**
 * `flow-eval` ledger reader views (plan 046 Phase 2, tasks 2.4–2.5; workshop 004).
 *
 * The read-side of the ledger: derive the longitudinal + comparison views the
 * raw {@link RunRecord}s support. Aggregates are computed HERE, at read time
 * (workshop 004 Decision) — the ledger stores raw per-run facts; `pass^k`, Wilson
 * CIs, McNemar, flips + cost are derived, so the stats can change without
 * rewriting history.
 *
 *  - **2.4 list** — runs over time + per-lane verdict history with **flips**
 *    marked (a lane whose verdict changes between consecutive runs of the SAME
 *    seed_tuple — real drift, not a model difference).
 *  - **2.5 compare** — group by model, `pass^1` (mean rate + Wilson CI) AND
 *    `pass^k` (observed all-k reliability) per lane, Wilson CIs per axis, McNemar
 *    per binary lane (paired by TRIAL KEY — seed_tuple minus model — never array
 *    index, and OMITTED when the groups don't align 1:1), **REFUSE** a comparison
 *    across a mismatched `scenario_hash`/`base_ref` (a refusal, never a misleading
 *    delta), and **cost columns** from `telemetry_summary` (avg active time + avg
 *    non-cache in/out; cache shown but NEVER ranked; a run with no summary is
 *    counted + excluded, never zero-filled).
 *
 * Node-free: pure arithmetic + string building.
 */

import type { LaneOutcome, RunRecord, TelemetrySummary } from './ledger.js';

// ---- stats primitives ------------------------------------------------------

/** 95% Wilson score interval for a binomial proportion; null when n = 0 (honest). */
export function wilson(passes: number, total: number): { p: number; lo: number; hi: number } | null {
  if (total <= 0) return null;
  const z = 1.959963984540054; // 95%
  const p = passes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { p, lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

/**
 * McNemar's test on a paired binary contrast — `b` = A-pass/B-fail, `c` =
 * A-fail/B-pass (the discordant pairs). Chi-square WITH continuity correction;
 * `significant` at α=.05 (χ² > 3.841) and only when there is ≥1 discordant pair.
 */
export function mcnemar(b: number, c: number): { chi2: number; discordant: number; significant: boolean } {
  const discordant = b + c;
  if (discordant === 0) return { chi2: 0, discordant: 0, significant: false };
  const chi2 = ((Math.abs(b - c) - 1) ** 2) / discordant;
  return { chi2, discordant, significant: chi2 > 3.841 };
}

/** Two Wilson intervals are "separated" (a ✱ signal) when their ranges do not overlap. */
function ciSeparated(a: { lo: number; hi: number } | null, b: { lo: number; hi: number } | null): boolean {
  if (!a || !b) return false;
  return a.hi < b.lo || b.hi < a.lo;
}

// ---- seed-tuple identity ---------------------------------------------------

/**
 * The within-model drift key — a flip is only "real variance" within ONE full
 * seed_tuple (workshop §2 / WS004). Comparable fields are the whole reproduction
 * tuple: model (+ `model_version` when present), harness, effort, base_ref,
 * `scenario_hash`, AND `prompt_hash` — so a changed subject prompt (a new
 * `prompt_hash`) reads as a DIFFERENT seed, never as within-seed drift (F3).
 */
export function seedKey(r: RunRecord): string {
  const t = r.seed_tuple;
  return [
    t.model,
    t.model_version ?? '',
    t.harness,
    t.effort ?? '',
    t.base_ref,
    t.scenario_hash,
    t.prompt_hash,
  ].join('|');
}

const GLYPH: Record<LaneOutcome['verdict'], string> = { pass: '✓', fail: '✗', unknown: '?' };

// ---- 2.4 list view ---------------------------------------------------------

export interface RunRow {
  run_id: string;
  ts: string;
  subject: string;
  effort: string;
  capability: number | null;
  process: number | null;
  verdict: RunRecord['verdict'];
  duration_s: number | null;
}

export interface LaneHistory {
  assertion_id: string;
  lane: string;
  axis: LaneOutcome['axis'];
  required: boolean;
  /** One entry per run in ts order; `null` when that run lacked the assertion. */
  verdicts: Array<LaneOutcome['verdict'] | null>;
  /** True when the verdict changed between consecutive runs of the SAME seed_tuple. */
  flipped: boolean;
}

export interface LedgerListData {
  scenario: string;
  run_count: number;
  base_refs: string[];
  runs: RunRow[];
  lanes: LaneHistory[];
  flipped_lanes: string[];
}

function laneOf(r: RunRecord, assertionId: string): LaneOutcome | undefined {
  return r.lanes.find((l) => l.assertion_id === assertionId);
}

/** Distinct assertion ids in first-seen order across all runs (labels may evolve; ids are stable). */
function assertionIds(records: RunRecord[]): string[] {
  const ids: string[] = [];
  for (const r of records) for (const l of r.lanes) if (!ids.includes(l.assertion_id)) ids.push(l.assertion_id);
  return ids;
}

/** Build the per-lane verdict history + flip detection (within-seed-tuple only). */
function buildLaneHistories(records: RunRecord[]): LaneHistory[] {
  return assertionIds(records).map((id) => {
    const verdicts = records.map((r) => laneOf(r, id)?.verdict ?? null);
    const meta = records.map((r) => laneOf(r, id)).find((l) => l !== undefined);
    // Flip = consecutive runs of the SAME seed_tuple whose verdict for this lane differs.
    let flipped = false;
    for (let i = 1; i < records.length; i++) {
      if (seedKey(records[i]) !== seedKey(records[i - 1])) continue;
      const a = laneOf(records[i - 1], id)?.verdict;
      const b = laneOf(records[i], id)?.verdict;
      if (a !== undefined && b !== undefined && a !== b) {
        flipped = true;
        break;
      }
    }
    return {
      assertion_id: id,
      lane: meta?.lane ?? id,
      axis: meta?.axis ?? 'process',
      required: meta?.required ?? false,
      verdicts,
      flipped,
    };
  });
}

function fmtScore(n: number | null): string {
  return n === null ? '—' : n.toFixed(2);
}

function subjectLabel(r: RunRecord): string {
  return `${r.subject.harness} ${r.subject.model}`;
}

/** Derive the 2.4 list data + a rendered board from the scenario's records. */
export function renderLedgerList(scenario: string, records: RunRecord[]): { data: LedgerListData; board: string } {
  const runs: RunRow[] = records.map((r) => ({
    run_id: r.run_id,
    ts: r.ts,
    subject: subjectLabel(r),
    effort: r.subject.effort ?? '—',
    capability: r.axis_scores.capability,
    process: r.axis_scores.process,
    verdict: r.verdict,
    duration_s: r.duration_s,
  }));
  const lanes = buildLaneHistories(records);
  const baseRefs = [...new Set(records.map((r) => r.base_ref))];
  const data: LedgerListData = {
    scenario,
    run_count: records.length,
    base_refs: baseRefs,
    runs,
    lanes,
    flipped_lanes: lanes.filter((l) => l.flipped).map((l) => l.assertion_id),
  };

  const lines: string[] = [];
  lines.push(`${scenario} · ${records.length} run(s) · base ${baseRefs.join(', ') || '—'}`);
  if (records.length === 0) {
    lines.push('(no runs recorded yet)');
    return { data, board: lines.join('\n') };
  }
  lines.push('');
  lines.push('  #  date/ts               subject                     effort  cap    proc   verdict');
  runs.forEach((row, i) => {
    lines.push(
      `  ${String(i + 1).padStart(2)} ${row.ts.padEnd(22).slice(0, 22)}${row.subject.padEnd(28).slice(0, 28)}${row.effort.padEnd(8).slice(0, 8)}${fmtScore(row.capability).padEnd(7)}${fmtScore(row.process).padEnd(7)}${row.verdict}`,
    );
  });
  lines.push('');
  lines.push('Per-lane verdict history  (✓ pass · ✗ fail · ? unknown · ⚑ flipped within a seed):');
  for (const lane of lanes) {
    const glyphs = lane.verdicts.map((v) => (v === null ? '·' : GLYPH[v])).join('  ');
    const flag = lane.flipped ? ' ⚑' : '';
    const tag = `${lane.assertion_id} ${lane.lane}${lane.required ? ' (req)' : ''}`;
    lines.push(`  ${tag.padEnd(34).slice(0, 34)}${glyphs}${flag}`);
  }
  if (data.flipped_lanes.length > 0) {
    lines.push('');
    lines.push(`⚑ flipped lane(s): ${data.flipped_lanes.join(', ')}`);
  }
  return { data, board: lines.join('\n') };
}

// ---- 2.5 compare view ------------------------------------------------------

export interface AxisCompare {
  axis: 'capability' | 'process';
  by_model: Record<string, { passes: number; total: number; wilson: { p: number; lo: number; hi: number } | null }>;
  separated: boolean;
}

/**
 * A lane's reliability for ONE model over its K runs. `pass_1` is the MEAN pass
 * rate (with its Wilson CI); `pass_k` is the OBSERVED all-k reliability — `1` iff
 * every one of the K runs passed, else `0` — reported ALONGSIDE the mean, never
 * instead of it (WS003 D3: "never surface pass@k alone"). `pass_k_est` is the
 * point estimator `p̂^K` (mean^K), carried separately and labeled `est` so a
 * reader never mistakes the smooth estimate for the observed 0/1 fact (F1).
 */
export interface LaneReliability {
  passes: number;
  k: number;
  /** Mean pass rate `passes/k` (a.k.a. `pass^1`); `null` at k = 0. */
  pass_1: number | null;
  /** 95% Wilson CI on the mean rate; `null` at k = 0. */
  pass_1_wilson: { p: number; lo: number; hi: number } | null;
  /** OBSERVED all-k reliability: `1` iff all K passed, else `0`; `null` at k = 0. */
  pass_k: number | null;
  /** Estimator `p̂^K = (passes/k)^k`, labeled `est`; `null` at k = 0. */
  pass_k_est: number | null;
}

export interface LaneCompare {
  assertion_id: string;
  lane: string;
  required: boolean;
  /** Per-model reliability: BOTH the mean (`pass_1` + CI) and observed all-k (`pass_k`). */
  by_model: Record<string, LaneReliability>;
  /**
   * McNemar over the first two compared models, paired by an explicit TRIAL KEY
   * (seed_tuple minus model + a ts-ordered ordinal), NEVER by array index (F2).
   * `pairs` is the number of aligned pass/fail pairs the test consumed.
   */
  mcnemar: {
    a: string;
    b: string;
    b_count: number;
    c_count: number;
    chi2: number;
    significant: boolean;
    pairs: number;
  } | null;
  /** Present when McNemar was OMITTED — the honest reason (trial keys didn't align 1:1). */
  mcnemar_omitted?: string;
}

export interface CostRow {
  model: string;
  /** Runs WITH a telemetry_summary (the average's denominator) vs total runs in the group. */
  with_summary: number;
  runs: number;
  avg_active_time_s: number | null;
  avg_tokens: { input: number; output: number } | null;
  /** Shown, never ranked (cross-harness cache economics differ). */
  avg_cache: { read: number; create: number } | null;
}

export interface CompareData {
  scenario: string;
  models: string[];
  scenario_hash: string;
  base_ref: string;
  counts: Record<string, number>;
  axes: AxisCompare[];
  lanes: LaneCompare[];
  cost: CostRow[];
}

export type CompareResult = { ok: true; data: CompareData; board: string } | { ok: false; error: string };

function mean(nums: number[]): number | null {
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Average the counts-only cost fields over ONLY the runs that carry a summary (never zero-fill). */
function costRow(model: string, group: RunRecord[]): CostRow {
  const summaries = group
    .map((r) => r.telemetry_summary)
    .filter((s): s is TelemetrySummary => s !== null);
  const active = mean(summaries.map((s) => s.active_time_s));
  const inTok = mean(summaries.map((s) => s.tokens.input));
  const outTok = mean(summaries.map((s) => s.tokens.output));
  const cRead = mean(summaries.map((s) => s.cache.read));
  const cCreate = mean(summaries.map((s) => s.cache.create));
  return {
    model,
    with_summary: summaries.length,
    runs: group.length,
    avg_active_time_s: active,
    avg_tokens: inTok === null || outTok === null ? null : { input: inTok, output: outTok },
    avg_cache: cRead === null || cCreate === null ? null : { read: cRead, create: cCreate },
  };
}

/** Count pass vs (pass+fail) lane outcomes on an axis across a model's runs (unknown excluded). */
function axisTally(group: RunRecord[], axis: 'capability' | 'process'): { passes: number; total: number } {
  let passes = 0;
  let total = 0;
  for (const r of group) {
    for (const l of r.lanes) {
      if (l.axis !== axis) continue;
      if (l.verdict === 'pass') {
        passes++;
        total++;
      } else if (l.verdict === 'fail') {
        total++;
      }
    }
  }
  return { passes, total };
}

function fmtCi(w: { p: number; lo: number; hi: number } | null): string {
  return w === null ? '—' : `${w.p.toFixed(2)} [${w.lo.toFixed(2)}–${w.hi.toFixed(2)}]`;
}

// ---- trial-key pairing (F2) ------------------------------------------------

/**
 * The paired-trial identity — the seed_tuple MINUS the model (+ model_version):
 * `scenario_hash | base_ref | prompt_hash | harness | effort`. Two runs of
 * DIFFERENT models that share this key are the "same trial" under distinct
 * models — the unit McNemar pairs on (WS003 D5: shared seeds + McNemar), never
 * array position.
 */
function trialKey(r: RunRecord): string {
  const t = r.seed_tuple;
  return [t.scenario_hash, t.base_ref, t.prompt_hash, t.harness, t.effort ?? ''].join('|');
}

/**
 * Assign every run in a model's group a stable pairing id: its `trialKey` plus a
 * ts-ordered ordinal within that (model, trialKey). Two models' runs pair iff
 * their pairing-id SETS are identical — otherwise the groups don't align 1:1 and
 * McNemar is omitted (F2). Deterministic: same records ⇒ same ids.
 */
function pairingIds(group: RunRecord[]): Map<string, RunRecord> {
  const byTrial = new Map<string, RunRecord[]>();
  for (const r of group) {
    const tk = trialKey(r);
    const bucket = byTrial.get(tk);
    if (bucket) bucket.push(r);
    else byTrial.set(tk, [r]);
  }
  const out = new Map<string, RunRecord>();
  for (const [tk, recs] of byTrial) {
    const ordered = [...recs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    ordered.forEach((r, i) => out.set(`${tk}#${i}`, r));
  }
  return out;
}

// ---- per-lane reliability (F1) ---------------------------------------------

/**
 * Build a model's {@link LaneReliability} for one lane: the mean (`pass_1` + its
 * Wilson CI) AND the observed all-k reliability (`pass_k` = 1 iff every present
 * run passed, else 0) — never the mean masquerading as `pass^k`. `k` is the
 * number of runs that carried the lane; a run without it is excluded (F1).
 */
function laneReliability(group: RunRecord[], id: string): LaneReliability {
  const present = group.filter((r) => laneOf(r, id) !== undefined);
  const k = present.length;
  const passes = present.filter((r) => laneOf(r, id)?.verdict === 'pass').length;
  if (k === 0) {
    return { passes: 0, k: 0, pass_1: null, pass_1_wilson: null, pass_k: null, pass_k_est: null };
  }
  const mean = passes / k;
  return {
    passes,
    k,
    pass_1: mean,
    pass_1_wilson: wilson(passes, k),
    // OBSERVED all-k: one failure in K can NEVER read as a fractional pass_k.
    pass_k: passes === k ? 1 : 0,
    // Estimator p̂^K — the smooth "chance all K pass" curve, labeled `est`.
    pass_k_est: mean ** k,
  };
}

function fmtInt(n: number | null): string {
  return n === null ? '—' : String(Math.round(n));
}

/**
 * Build the 2.5 model-vs-model board. REFUSES (returns an error, never a partial
 * board) when the compared runs don't share ONE `scenario_hash` + ONE `base_ref`
 * — comparing across a rubric/base change is a category error, so it's flagged,
 * not computed. Groups the ledger by `seed_tuple.model` (only the requested
 * models), then derives per-axis Wilson + per-lane pass^k/McNemar + cost.
 */
export function compareModels(scenario: string, records: RunRecord[], models: string[]): CompareResult {
  const wanted = models.filter((m) => m.length > 0);
  if (wanted.length < 2) {
    return { ok: false, error: 'compare needs at least two --compare <model> groups' };
  }
  const groups = new Map<string, RunRecord[]>();
  for (const m of wanted) groups.set(m, []);
  for (const r of records) {
    const m = r.seed_tuple.model;
    if (groups.has(m)) groups.get(m)?.push(r);
  }

  const compared = records.filter((r) => groups.has(r.seed_tuple.model));
  if (compared.length === 0) {
    return { ok: false, error: `no runs found for models: ${wanted.join(', ')}` };
  }
  // Refusal: a valid comparison holds scenario_hash + base_ref FIXED across groups.
  const hashes = [...new Set(compared.map((r) => r.seed_tuple.scenario_hash))];
  const bases = [...new Set(compared.map((r) => r.base_ref))];
  if (hashes.length > 1 || bases.length > 1) {
    return {
      ok: false,
      error:
        `refusing to compare across a rubric/base change — ` +
        `scenario_hash: {${hashes.join(', ')}}, base_ref: {${bases.join(', ')}}. ` +
        `A comparison is only valid when both match across groups (workshop 004 §Comparison).`,
    };
  }

  const counts: Record<string, number> = {};
  for (const [m, g] of groups) counts[m] = g.length;

  // Per-axis Wilson.
  const axes: AxisCompare[] = (['capability', 'process'] as const).map((axis) => {
    const byModel: AxisCompare['by_model'] = {};
    for (const [m, g] of groups) {
      const { passes, total } = axisTally(g, axis);
      byModel[m] = { passes, total, wilson: wilson(passes, total) };
    }
    const [m1, m2] = wanted;
    return { axis, by_model: byModel, separated: ciSeparated(byModel[m1]?.wilson, byModel[m2]?.wilson) };
  });

  // Per-lane reliability (pass_1 + pass_k, F1) + McNemar over the first two
  // models paired by TRIAL KEY (F2). Pairing is model-level, so it's derived ONCE
  // here; a lane just reads the aligned pairs.
  const [mA, mB] = wanted;
  const gA = groups.get(mA) ?? [];
  const gB = groups.get(mB) ?? [];
  const pairA = pairingIds(gA);
  const pairB = pairingIds(gB);
  const keysA = [...pairA.keys()].sort();
  const keysB = [...pairB.keys()].sort();
  // A valid McNemar needs a 1:1 alignment of trial keys across the two groups.
  const aligned =
    keysA.length > 0 && keysA.length === keysB.length && keysA.every((k, i) => k === keysB[i]);
  const alignReason = aligned
    ? ''
    : `trial keys don't align 1:1 (${mA}: ${keysA.length} trial(s), ${mB}: ${keysB.length}) — McNemar omitted`;

  const ids = assertionIds(compared);
  const lanes: LaneCompare[] = ids.map((id) => {
    const byModel: LaneCompare['by_model'] = {};
    for (const [m, g] of groups) byModel[m] = laneReliability(g, id);

    // McNemar: walk the ALIGNED pair ids (shared trial key + ordinal), never the
    // array index; only pass/fail-vs-pass/fail pairs are discordant-eligible.
    let bCount = 0;
    let cCount = 0;
    let pairs = 0;
    if (aligned) {
      for (const key of keysA) {
        const va = laneOf(pairA.get(key) as RunRecord, id)?.verdict;
        const vb = laneOf(pairB.get(key) as RunRecord, id)?.verdict;
        if ((va === 'pass' || va === 'fail') && (vb === 'pass' || vb === 'fail')) {
          pairs++;
          if (va === 'pass' && vb === 'fail') bCount++;
          else if (va === 'fail' && vb === 'pass') cCount++;
        }
      }
    }
    const mc = mcnemar(bCount, cCount);
    const meta = compared.map((r) => laneOf(r, id)).find((l) => l !== undefined);
    const omitted = !aligned ? alignReason : pairs === 0 ? 'no paired pass/fail trials on this lane' : '';
    return {
      assertion_id: id,
      lane: meta?.lane ?? id,
      required: meta?.required ?? false,
      by_model: byModel,
      mcnemar:
        aligned && pairs > 0
          ? { a: mA, b: mB, b_count: bCount, c_count: cCount, chi2: mc.chi2, significant: mc.significant, pairs }
          : null,
      ...(omitted.length > 0 && { mcnemar_omitted: omitted }),
    };
  });

  const cost: CostRow[] = wanted.map((m) => costRow(m, groups.get(m) ?? []));

  const data: CompareData = {
    scenario,
    models: wanted,
    scenario_hash: hashes[0],
    base_ref: bases[0],
    counts,
    axes,
    lanes,
    cost,
  };
  return { ok: true, data, board: renderCompareBoard(data) };
}

function renderCompareBoard(d: CompareData): string {
  const lines: string[] = [];
  const kDesc = d.models.map((m) => `${m} (K=${d.counts[m] ?? 0})`).join(' vs ');
  lines.push(`${d.scenario} · base ${d.base_ref} · scenario_hash ${d.scenario_hash} · shared seed set`);
  lines.push(kDesc);
  const excluded = d.models.filter((m) => (d.counts[m] ?? 0) === 0);
  if (excluded.length > 0) lines.push(`(no runs — counted, excluded from stats: ${excluded.join(', ')})`);
  lines.push('');

  // Axis rows.
  lines.push('  axis         ' + d.models.map((m) => m.padEnd(20)).join('') + 'signal');
  for (const a of d.axes) {
    const cells = d.models.map((m) => fmtCi(a.by_model[m]?.wilson).padEnd(20)).join('');
    lines.push(`  ${a.axis.padEnd(12)}${cells}${a.separated ? '✱ (CIs separated)' : 'n.s.'}`);
  }
  lines.push('');

  // Lane rows — BOTH pass^1 (mean [Wilson CI]) and pass^k (observed all-k), so a
  // reader never sees the mean mislabeled as reliability (F1).
  lines.push(
    '  lane (assertion)              ' +
      d.models.map((m) => `pass^1 [CI] ${m}`.padEnd(28)).join('') +
      d.models.map((m) => `pass^k ${m}`.padEnd(14)).join('') +
      'paired test',
  );
  for (const l of d.lanes) {
    const tag = `${l.assertion_id} ${l.lane}${l.required ? ' (req)' : ''}`;
    const p1Cells = d.models
      .map((m) => {
        const r = l.by_model[m];
        return (r.pass_1 === null ? '—' : `${fmtCi(r.pass_1_wilson)} (k=${r.k})`).padEnd(28);
      })
      .join('');
    const pkCells = d.models
      .map((m) => {
        const r = l.by_model[m];
        return (r.pass_k === null ? '—' : `${r.pass_k} (est ${(r.pass_k_est ?? 0).toFixed(2)})`).padEnd(14);
      })
      .join('');
    const test = l.mcnemar
      ? `McNemar χ²=${l.mcnemar.chi2.toFixed(2)}${l.mcnemar.significant ? ' ✱' : ' n.s.'} (b=${l.mcnemar.b_count},c=${l.mcnemar.c_count},pairs=${l.mcnemar.pairs})`
      : `omitted (${l.mcnemar_omitted ?? 'unpaired'})`;
    lines.push(`  ${tag.padEnd(30).slice(0, 30)}${p1Cells}${pkCells}${test}`);
  }
  lines.push('');

  // Cost rows (never ranked; honest absence).
  lines.push('  cost (avg over runs WITH a summary; cache shown, never ranked)');
  lines.push('  model                 active_s   in       out      cache(r/c)         coverage');
  for (const c of d.cost) {
    const cache = c.avg_cache ? `${fmtInt(c.avg_cache.read)}/${fmtInt(c.avg_cache.create)}` : '—';
    lines.push(
      `  ${c.model.padEnd(22)}${fmtInt(c.avg_active_time_s).padEnd(11)}${fmtInt(c.avg_tokens?.input ?? null).padEnd(9)}${fmtInt(c.avg_tokens?.output ?? null).padEnd(9)}${cache.padEnd(19)}${c.with_summary}/${c.runs} w/ summary`,
    );
  }
  lines.push('');
  lines.push(
    '✱ = Wilson CIs separated / McNemar significant (paired by trial key, shared seeds). ' +
      'pass^1 = mean rate [95% Wilson CI]; pass^k = observed all-k reliability (est = p̂^K). Cache is never ranked.',
  );
  return lines.join('\n');
}
