/**
 * `flow-eval` scorer (plan 041 Phase 2, T004).
 *
 * Walks a scenario's assertions, dispatches each DETERMINISTIC one to the
 * resolver registry for a three-valued verdict, and folds the results into a
 * score (AC-06):
 *
 *  - `score = Σ(weight of pass) / Σ(weight of pass+fail)` — `unknown` is excluded
 *    from the denominator (a capability gap never drags the score down).
 *  - a `required` assertion that resolves `fail` increments `required_failed`,
 *    which caps the run `verdict` to FAIL.
 *  - `judged` assertions are NOT scored — they are surfaced as fields for the
 *    orchestrator LLM to fill, reported separately from the deterministic core.
 *
 * Node-free; pure over the resolver verdicts.
 */

import { type ResolveContext, resolveAssertion, type Verdict } from './resolvers.js';
import type { Assertion } from './scenario.js';

/** One row of the deterministic results table. */
export interface ResultRow {
  id: string;
  type: string;
  source: string;
  status: Verdict;
  required: boolean;
  weight: number;
  describe?: string;
}

/** A `judged` assertion surfaced as a field (verdict left null for the orchestrator). */
export interface JudgedField {
  id: string;
  field: string;
  prompt: string;
  rubric?: string;
  describe?: string;
  /** Filled by the orchestrator LLM after the run — null until then. */
  verdict: null;
  rationale: null;
  by: null;
}

/** The deterministic score block (workshop §4). */
export interface DeterministicScore {
  score: number;
  passed: number;
  failed: number;
  unknown: number;
  total: number;
  required_failed: number;
  results: ResultRow[];
}

export type RunVerdict = 'PASS' | 'PASS_WITH_NOTES' | 'FAIL';

export interface ScoredReport {
  deterministic: DeterministicScore;
  judged: JudgedField[];
  verdict: RunVerdict;
}

/** Build the judged field surfaced for the orchestrator from a `judged` assertion. */
function toJudged(a: Assertion): JudgedField {
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

/**
 * Score a scenario's assertions against the resolve context. `judged`
 * assertions (type `judged`) are routed to `judged[]`; every other type is
 * dispatched to its resolver. Async — `command-succeeds` runs a real command.
 */
export async function scoreScenario(
  assertions: readonly Assertion[],
  rc: ResolveContext,
): Promise<ScoredReport> {
  const results: ResultRow[] = [];
  const judged: JudgedField[] = [];

  let passWeight = 0;
  let failWeight = 0;
  let passed = 0;
  let failed = 0;
  let unknown = 0;
  let requiredFailed = 0;

  for (const a of assertions) {
    if (a.type === 'judged') {
      judged.push(toJudged(a));
      continue;
    }
    const status = await resolveAssertion(a, rc);
    const weight = typeof a.weight === 'number' ? a.weight : 1;
    const required = a.required === true;
    results.push({
      id: a.id,
      type: a.type,
      source: a.source,
      status,
      required,
      weight,
      ...(a.describe !== undefined && { describe: a.describe }),
    });
    if (status === 'pass') {
      passed++;
      passWeight += weight;
    } else if (status === 'fail') {
      failed++;
      failWeight += weight;
      if (required) requiredFailed++;
    } else {
      unknown++;
    }
  }

  const denom = passWeight + failWeight;
  const score = denom === 0 ? 0 : passWeight / denom;
  const verdict: RunVerdict =
    requiredFailed > 0 ? 'FAIL' : failed === 0 && unknown === 0 ? 'PASS' : 'PASS_WITH_NOTES';

  return {
    deterministic: {
      score,
      passed,
      failed,
      unknown,
      total: results.length,
      required_failed: requiredFailed,
      results,
    },
    judged,
    verdict,
  };
}
