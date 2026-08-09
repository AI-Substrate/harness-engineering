/**
 * The PLAN semantic layer — the opinions a whole plan can hold that no single
 * document can.
 *
 * `dd validate` stays byte-for-byte mechanical: it answers "is this document
 * well-formed against its schema?" and nothing else, and plan 070 does not move
 * that line. Everything here is a question about a plan's STORY — does a row
 * claiming to be done rest on something still open, is any criterion unaccounted
 * for, what does this one address actually depend on — and it is deliberately a
 * separate verb (`harness plan validate`) so a mechanical check can never start
 * having opinions.
 *
 * Every check is written against RELATIONS, never field names. That is what lets
 * a second schema, or a renamed field, inherit the whole layer for free.
 */

export {
  isPlanCheckKind,
  PLAN_CHECK_KINDS,
  type PlanCheckDeps,
  type PlanCheckFailure,
  type PlanCheckFailureReason,
  type PlanCheckKind,
  type PlanCheckOptions,
  type PlanCheckReading,
  type PlanCheckResult,
  type PlanCheckSchemaResolver,
  planDocumentSet,
  readPlanCheck,
  resolvePlanAddress,
} from './check.js';
export {
  buildPlanIndex,
  claimSections,
  itemKey,
  type PlanDocument,
} from './index-plan.js';
export type {
  PlanEdge,
  PlanFinding,
  PlanFindingClass,
  PlanIndex,
  PlanItem,
  PlanSemanticOptions,
  PlanSemanticResult,
} from './model.js';
export {
  type CriteriaDimension,
  type CriteriaReason,
  computeReadiness,
  type ReadyReading,
  type ReadyReason,
  type ReadyVerdict,
  readCriteriaDimension,
  readPlanReadiness,
  type SurveyDimension,
  type SurveyReason,
  type UnclaimedCriterion,
} from './ready.js';
export { readPlanSemantics, scopeFrom } from './semantics.js';
