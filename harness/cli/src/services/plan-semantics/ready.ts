import type { PlanCheckResult } from './check.js';

/**
 * Readiness — the one question `plan validate` cannot answer.
 *
 * `validate` answers "is this plan well-formed and self-consistent?". Readiness
 * asks something narrower and more useful at a gate: "is there enough here to
 * start work on?" — and it is deliberately THREE-valued, because the two
 * substrates it joins can disagree about whether they even know. The plan
 * document knows which criteria no task accounts for; only the flight plan knows
 * whether a human declined the backpressure survey rather than never running it.
 * A plan authored without a flight plan has no chore to read, and guessing there
 * would be inventing an answer.
 *
 * This module is PURE and holds no reader of its own: the criteria dimension is
 * read off a `PlanCheckResult` (the SAME reading `plan validate` and the flow's
 * departure gate take — never a second opinion), and the survey dimension arrives
 * already read. Composition is the act's job.
 */

export type ReadyVerdict = 'ready' | 'not-ready' | 'cant-tell';

/**
 * Why the criteria dimension reads the way it does.
 *
 * `nothing-to-check` is not a failure and not a pass — it is the refusal. A plan
 * with no claim rows cannot produce an unclaimed one, so every existing check
 * scores it perfectly; calling that "ready" would make the emptiest plan the
 * readiest, which is the defect this whole verb exists to prevent.
 */
export type CriteriaReason =
  | 'all-claimed'
  | 'unclaimed-criteria'
  | 'nothing-to-check'
  | 'plan-unreadable';

/**
 * Why the survey dimension reads the way it does.
 *
 * The union lives HERE, with the rest of the verdict model, rather than with the
 * reader that fills it in — and the import runs flow → dd, never the other way.
 * `dd/plan` is a filesystem-free library that takes already-loaded documents; a
 * type import pointing at the flow service would drag the flow's fs/clock/git
 * ports and the output error table into this layer transitively, which is exactly
 * what the architecture rules forbid. So the consumer owns the shape and the
 * producer fills it.
 */
export type SurveyReason =
  /** A `done` chore whose receipt matches the plan's current bytes. */
  | 'survey-done'
  /**
   * A `decision` receipt — the human declined, on the record, in their own words.
   * No basis is required or expected: the doctrine's decline command records the
   * human's verbatim words and no `basis_sha256` at all. A decline is a decision
   * about the WORK, not about the bytes, so nothing later can make it stale.
   */
  | 'declined-with-receipt'
  /** Terminal, but nothing on the node says what was surveyed. */
  | 'missing-receipt'
  /** A receipt-shaped comment exists, but it is not authoritative or well-formed. */
  | 'invalid-receipt'
  /**
   * Terminal with the doctrine's unavailable attempt, recorded as the operative
   * `decision:unavailable` form or the documented `noop` / `UNAVAILABLE`
   * alternative. It produced no survey basis, so this reads **can't-tell**.
   */
  | 'missing-basis'
  /** Terminal with a receipt, but for different plan bytes than the ones on disk. */
  | 'stale-basis'
  /** A survey node exists and has not reached a terminal status. */
  | 'not-run'
  /** The flight plan is readable and carries no backpressure node at all. */
  | 'no-survey-node'
  /** No flight plan beside this plan — a document-only plan cannot answer this. */
  | 'no-flight-plan'
  /** A flight plan is there but could not be read (invalid JSON, legacy format…). */
  | 'flight-plan-unreadable';

export interface SurveyDimension {
  /** `null` means "cannot be determined", never "no". */
  satisfied: boolean | null;
  reason: SurveyReason;
  /** The backpressure node the verdict came from, when one was found. */
  node: string | null;
  status: string | null;
  /** The `basis_sha256` the receipt recorded, when it carried one. */
  basis: string | null;
  /** The plan bytes the receipt was compared against. */
  expected_basis: string;
}

/** The overall verdict's reason: `ready`, or the reason of the dimension that decided it. */
export type ReadyReason = 'ready' | CriteriaReason | SurveyReason;

/** One acceptance criterion no task accounts for, quoted by address. */
export interface UnclaimedCriterion {
  /** Repo-relative `path#interior` — what a human pastes to go look at it. */
  address: string;
  /** The document that must change to resolve it. */
  owner: string;
  message: string;
}

export interface CriteriaDimension {
  /** `null` means "cannot be determined", never "no". */
  satisfied: boolean | null;
  reason: CriteriaReason;
  /** How many claim rows the plan has — the non-vacuity measure (AC-11). */
  claims: number;
  unclaimed: UnclaimedCriterion[];
}

export interface ReadyReading {
  verdict: ReadyVerdict;
  reason: ReadyReason;
  /** The dimension whose reason became the verdict's; `null` when nothing dissented. */
  decided_by: 'criteria' | 'survey' | null;
  criteria: CriteriaDimension;
  survey: SurveyDimension;
}

/**
 * The criteria dimension, COMPOSED from a plan check rather than re-derived.
 *
 * `orphan-claim` — "has no incoming satisfies — no task accounts for it" — is
 * already exactly the question, and it is emitted only under `--complete`. So the
 * caller must have asked for a complete read; this reads the answer, and adds no
 * semantics of its own. Nothing here reaches into `semantics.ts`: that module
 * excludes `pressure` from the claiming relations on stated grounds, and a
 * consumer that started extending it would reverse that decision by accident.
 */
export function readCriteriaDimension(check: PlanCheckResult): CriteriaDimension {
  // A plan that will not load, or whose blocking mechanical errors stopped the
  // semantic read, cannot be judged. Reporting "not ready" would blame the plan
  // for a question that was never asked of it.
  if (!check.ok || check.index === null) {
    return { satisfied: null, reason: 'plan-unreadable', claims: 0, unclaimed: [] };
  }

  const claims = check.index.items.filter((item) => item.claim).length;

  // The refusal, and the centre of the design. Zero claim rows means zero
  // criteria that COULD be orphaned, so every existing check scores this plan
  // perfectly — `orphans: 0, error: 0` on a fresh scaffold (dossier F-06, proven
  // by probe). A gate that inherited that would call the emptiest plan the
  // readiest, which is worse than no gate because it manufactures confidence.
  //
  // Non-vacuity is "at least one claim row", read off `PlanIndex.items[].claim`
  // — the relation-derived flag — and NOT off a count field, because
  // `PlanSemanticResult.counts` exposes no criterion count at all. A plan WITH
  // claim rows and no tasks is not vacuous: it is not-ready, and the orphan-claim
  // read already says so in the branch below.
  if (claims === 0) {
    return { satisfied: null, reason: 'nothing-to-check', claims: 0, unclaimed: [] };
  }

  const unclaimed = check.findings
    .filter((finding) => finding.class === 'orphan-claim')
    .map((finding) => ({
      address: finding.address,
      owner: finding.owner,
      message: finding.message,
    }));

  return {
    satisfied: unclaimed.length === 0,
    reason: unclaimed.length === 0 ? 'all-claimed' : 'unclaimed-criteria',
    claims,
    unclaimed,
  };
}

/**
 * Join the two dimensions into one verdict.
 *
 * Precedence, and why:
 *   0. **Vacuity refuses outright.** A plan with nothing in it to judge reports
 *      `cant-tell` whatever else is true — including when the survey has
 *      affirmatively failed. Answering "not ready, because the survey is missing"
 *      would imply the plan was otherwise judgeable, and it was not. AC-03 states
 *      this without conditions: a vacuous plan is never `ready`, and its answer is
 *      always `nothing-to-check`.
 *   1. A KNOWN failure outranks an UNKNOWN. If a criterion is unclaimed, the plan
 *      is not ready whether or not the flight plan is readable — "I can't tell"
 *      would be a less true answer than the one already in hand.
 *   2. An unknown outranks a pass. A dimension nobody can read is not a dimension
 *      that passed.
 *   3. Only when both are affirmatively satisfied is the answer `ready`.
 * Criteria are consulted before the survey purely so the reported reason names the
 * document a reader can act on first.
 */
export function computeReadiness(
  criteria: CriteriaDimension,
  survey: SurveyDimension,
): ReadyReading {
  const base = { criteria, survey };

  if (criteria.reason === 'nothing-to-check') {
    return { verdict: 'cant-tell', reason: 'nothing-to-check', decided_by: 'criteria', ...base };
  }
  if (criteria.satisfied === false) {
    return { verdict: 'not-ready', reason: criteria.reason, decided_by: 'criteria', ...base };
  }
  if (survey.satisfied === false) {
    return { verdict: 'not-ready', reason: survey.reason, decided_by: 'survey', ...base };
  }
  if (criteria.satisfied === null) {
    return { verdict: 'cant-tell', reason: criteria.reason, decided_by: 'criteria', ...base };
  }
  if (survey.satisfied === null) {
    return { verdict: 'cant-tell', reason: survey.reason, decided_by: 'survey', ...base };
  }
  return { verdict: 'ready', reason: 'ready', decided_by: null, ...base };
}

/**
 * The whole readiness verdict as ONE pure computation, so the verb and any test
 * reach it the same way and can never drift into two answers about one plan.
 */
export function readPlanReadiness(check: PlanCheckResult, survey: SurveyDimension): ReadyReading {
  return computeReadiness(readCriteriaDimension(check), survey);
}
