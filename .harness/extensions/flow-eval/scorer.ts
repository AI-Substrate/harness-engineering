/**
 * `flow-eval` scorer (plan 041 Phase 2, T004; two-axis hardening plan 046 Phase 1).
 *
 * Walks a scenario's assertions, dispatches each DETERMINISTIC one to the
 * resolver registry for a three-valued verdict, and folds the results into a
 * TWO-AXIS score (workshop 003 §D1):
 *
 *  - `score = Σ(weight of pass) / Σ(weight of pass+fail)` — back-compat single
 *    number over all lanes; `unknown` is excluded from the denominator.
 *  - `axis_scores: {process, capability}` — the same pass-rate per **axis**
 *    (`axisFor(type)`), unknown-excluded per axis. Safety is cap-only, not scored.
 *  - the FAIL cap consults **only capability + safety**: a `required` fail on those
 *    axes increments `required_failed` and caps the `verdict` to FAIL; a required
 *    PROCESS fail informs `axis_scores.process` but never caps (AC-02).
 *  - `alarms` carries `'mimicry'` when process ≥ .8 AND capability ≤ .4 (both
 *    measured) — the "right ritual, broken artifact" signal.
 *  - `judged` assertions are NOT scored — they are surfaced as fields for the
 *    orchestrator LLM to fill, reported separately from the deterministic core.
 *
 * Node-free; pure over the resolver verdicts.
 */

import { type ResolveContext, resolveAssertionDetailed, type Verdict } from './resolvers.js';
import {
  DEFERRED_CALIBRATION_SET,
  type Assertion,
  type Axis,
  type JudgeConfig,
  type JudgedCriterionName,
  JUDGED_CRITERIA,
  axisFor,
} from './scenario.js';

/** One row of the deterministic results table. */
export interface ResultRow {
  id: string;
  type: string;
  source: string;
  /** The scorecard axis this row scores on (workshop 003 §D1). */
  axis: Axis;
  status: Verdict;
  required: boolean;
  weight: number;
  describe?: string;
  /**
   * WHY the resolver returned this status, when it had something to say (FX003 ·
   * D1/D6). Present mostly on `unknown` rows, where a bare `?` otherwise collapses
   * "no subject evidence", "unfilled run parameter" and "the lane cannot record
   * this" into one glyph.
   */
  note?: string;
}

/** A `judged` assertion surfaced as a field (verdict left null for the orchestrator). */
export interface JudgedField {
  id: string;
  criterion?: JudgedCriterionName;
  field: string;
  prompt: string;
  rubric?: string;
  describe?: string;
  /** Filled by the orchestrator LLM after the run — null until then. */
  verdict: Verdict | null;
  /** Filled by the orchestrator after the run (F-C re-render surfaces it); null until then. */
  rationale: string | null;
  /** Who filled the verdict (judge model id); null until then. */
  by: string | null;
}

/**
 * Per-axis pass-rates (unknown-excluded), workshop 003 §D1. Safety is cap-only, not scored.
 *
 * `null` means the axis had **no scorable (pass|fail) lane at all** — it measured
 * nothing (FX003 · D2). That is not the same fact as `0`, which means every measured
 * check on the axis FAILED, and rendering the first as the second is the instrument
 * reporting a conclusion it never reached. This type is the ONE place that
 * distinction is decided; `report.ts` and `ledger.ts` consume it rather than each
 * re-deriving measured-ness from the result rows.
 */
export interface AxisScores {
  process: number | null;
  capability: number | null;
}

/** The deterministic score block (workshop §4 + 003 §D1 two-axis split). */
export interface DeterministicScore {
  /**
   * Back-compat single pass-rate over ALL deterministic lanes (still written to
   * reports). `null` when NOTHING was scorable — same honesty as
   * {@link AxisScores} (FX003 · D2): a run that measured nothing did not score zero.
   */
  score: number | null;
  /** Two-axis pass-rates: process (never caps) + capability (caps when required). */
  axis_scores: AxisScores;
  passed: number;
  failed: number;
  unknown: number;
  total: number;
  /** Count of required fails on **capping** axes (capability + safety) — `>0 ⟺ verdict FAIL`. */
  required_failed: number;
  results: ResultRow[];
}

export type RunVerdict = 'PASS' | 'PASS_WITH_NOTES' | 'FAIL';

export interface ScoredReport {
  deterministic: DeterministicScore;
  judged: JudgedField[];
  /** Report-level flags (e.g. `'mimicry'` — high process, low capability; workshop 003 §D1). */
  alarms: string[];
  verdict: RunVerdict;
}

/** Build the legacy single judged field surfaced for the orchestrator from a `judged` assertion. */
function toLegacyJudged(a: Assertion): JudgedField {
  const field = typeof a.params.field === 'string' ? a.params.field : a.id;
  const prompt = typeof a.params.prompt === 'string' ? a.params.prompt : '';
  const rubric = typeof a.params.rubric === 'string' ? a.params.rubric : undefined;
  return {
    id: a.id,
    field,
    prompt,
    ...(rubric !== undefined && { rubric }),
    ...(a.describe !== undefined && { describe: a.describe }),
    verdict: null,
    rationale: null,
    by: null,
  };
}

function judgedPrompt(criterion: JudgedCriterionName, config: JudgeConfig): string {
  const c = JUDGED_CRITERIA[criterion];
  // The human-gold calibration set is deliberately deferred in 046 Phase 3.3; keep
  // this anchor slot stable so the later set can be dropped in without reshaping reports.
  return [
    'CoT-before-score: first write concise evidence notes from verified artifacts, then choose exactly one verdict: pass | fail | unknown.',
    'Artifact boundary: use report.json/report.md, deterministic result rows, session-export.json, and worktree artifacts only; do not use subject prose, chat transcript, identity hints, or self-report.',
    `Canonical good-flow anchor slot (content deferred until ${DEFERRED_CALIBRATION_SET} lands):\n<canonical_good_flow_anchor>\nTODO: deferred canonical good-flow exemplar.\n</canonical_good_flow_anchor>`,
    `Criterion: ${c.title}\nQuestion: ${c.question}`,
    `Anti-verbosity criterion: ${config.anti_verbosity}`,
  ].join('\n\n');
}

/** Expand the scenario-listed judged criteria into named, independent fields. */
function toJudged(a: Assertion, config: JudgeConfig | undefined): JudgedField[] {
  if (!config || config.criteria.length === 0) return [toLegacyJudged(a)];
  return config.criteria.map((criterion) => {
    const c = JUDGED_CRITERIA[criterion];
    return {
      id: `${a.id}.${criterion}`,
      criterion,
      field: criterion,
      prompt: judgedPrompt(criterion, config),
      rubric: c.rubric,
      ...(a.describe !== undefined && { describe: `${a.describe}: ${c.title}` }),
      verdict: null,
      rationale: null,
      by: null,
    };
  });
}

/**
 * Score a scenario's assertions against the resolve context. `judged`
 * assertions (type `judged`) are routed to `judged[]`; every other type is
 * dispatched to its resolver. Async — `command-succeeds` runs a real command.
 */
export async function scoreScenario(
  assertions: readonly Assertion[],
  rc: ResolveContext,
  judge?: JudgeConfig,
): Promise<ScoredReport> {
  const results: ResultRow[] = [];
  const judged: JudgedField[] = [];

  let passWeight = 0;
  let failWeight = 0;
  let passed = 0;
  let failed = 0;
  let unknown = 0;
  // Cap consults ONLY capability + safety (workshop 003 §D1/§D2 AC-02) — a required
  // process fail informs the process axis but must NOT sink the run.
  let requiredFailed = 0;
  // Per-axis weight buckets for axis_scores (unknown excluded per axis). Safety is
  // cap-only. These are ACCUMULATORS, not scores — always numeric, never null (the
  // null lives in AxisScores, where "no measurement" is a real state).
  const axisPass: Record<'process' | 'capability', number> = { process: 0, capability: 0 };
  const axisFail: Record<'process' | 'capability', number> = { process: 0, capability: 0 };

  for (const a of assertions) {
    if (a.type === 'judged') {
      judged.push(...toJudged(a, judge));
      continue;
    }
    const { verdict: status, note } = await resolveAssertionDetailed(a, rc);
    const weight = typeof a.weight === 'number' ? a.weight : 1;
    const required = a.required === true;
    const axis: Axis = a.axis ?? axisFor(a.type);
    results.push({
      id: a.id,
      type: a.type,
      source: a.source,
      axis,
      status,
      required,
      weight,
      ...(a.describe !== undefined && { describe: a.describe }),
      ...(note !== undefined && { note }),
    });
    if (status === 'pass') {
      passed++;
      passWeight += weight;
      if (axis === 'process' || axis === 'capability') axisPass[axis] += weight;
    } else if (status === 'fail') {
      failed++;
      failWeight += weight;
      if (axis === 'process' || axis === 'capability') axisFail[axis] += weight;
      if (required && (axis === 'capability' || axis === 'safety')) requiredFailed++;
    } else {
      unknown++;
    }
  }

  const denom = passWeight + failWeight;
  // FX003 · D2: nothing scorable ⇒ NO score. `0` would be indistinguishable from
  // "every check failed", which is the opposite claim about the subject.
  const score = denom === 0 ? null : passWeight / denom;
  const procDenom = axisPass.process + axisFail.process;
  const capDenom = axisPass.capability + axisFail.capability;
  const axisScores: AxisScores = {
    process: procDenom === 0 ? null : axisPass.process / procDenom,
    capability: capDenom === 0 ? null : axisPass.capability / capDenom,
  };

  // Mimicry/contamination alarm (workshop 003 §D1): the "right ritual, broken artifact"
  // signal — high process, low capability. Gated on BOTH axes actually having evidence, so
  // a run with no artifacts measured never false-claims "broken artifact".
  const alarms: string[] = [];
  if (
    axisScores.process !== null &&
    axisScores.capability !== null &&
    axisScores.process >= 0.8 &&
    axisScores.capability <= 0.4
  ) {
    alarms.push('mimicry');
  }

  const verdict: RunVerdict =
    requiredFailed > 0 ? 'FAIL' : failed === 0 && unknown === 0 ? 'PASS' : 'PASS_WITH_NOTES';

  return {
    deterministic: {
      score,
      axis_scores: axisScores,
      passed,
      failed,
      unknown,
      total: results.length,
      required_failed: requiredFailed,
      results,
    },
    judged,
    alarms,
    verdict,
  };
}
