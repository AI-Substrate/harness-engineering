import { toPosix } from '../shared/posix-path.js';

/**
 * The plan-folder path grammar — ONE address for one fact.
 *
 * A plan lives at `docs/plans/<id>/` while it is live and at
 * `docs/plans/archive/<id>/` once it is done. Four call sites lifted the id with
 * their own copy of `/(?:^|\/)docs\/plans\/([^/]+)/` and a fifth classified plan
 * documents with the same shape inlined. Five copies of one grammar means the
 * archive move is correct in none of them until it is fixed in all five: the
 * regex happily matches the literal segment `archive` and reports it AS the plan
 * id, so every archived plan's telemetry collapses onto a single fabricated plan
 * called `archive` — a wrong answer, not a missing one, which is why nothing
 * downstream can notice.
 *
 * Two rules this module fixes in one place:
 *
 * 1. **`archive/` is a location, not an identity.** The id is the leaf folder
 *    either way, so a plan's telemetry keeps ONE identity across the day it is
 *    archived. Encoding the location into the id (`archive/065-…`) would fork
 *    every historical join at the archive boundary and silently halve the
 *    measured history of exactly the plans old enough to be worth measuring.
 * 2. **The `archive` segment is never itself an id.** `docs/plans/archive/` with
 *    nothing under it yields `null`, not `"archive"`.
 *
 * P12-safe: path prefixes only, no content. Anchored on the literal
 * `docs/plans/` segment, so `docs/plansfoo/x` never false-matches — the property
 * each of the five copies documented and which is preserved here.
 */
const PLAN_ID = /(?:^|\/)docs\/plans\/(?:archive\/)?([^/]+)/;

/**
 * The `<ordinal>-<slug>` id of the plan a path belongs to, live or archived, or
 * `null` when the path is not under a plan folder. Accepts absolute or
 * repo-relative, POSIX or Windows separators.
 */
export function planIdFromPath(path: string): string | null {
  const m = PLAN_ID.exec(toPosix(path));
  const id = m?.[1];
  if (id === undefined || id.length === 0 || id === 'archive') return null;
  return id;
}

/**
 * Does this path name a plan document (`docs/plans/[archive/]<id>/<x>-plan.md`)?
 * The plan extractor's match predicate, sharing the grammar above so a plan does
 * not stop being classified as a plan on the day it is archived.
 */
export function isPlanDocPath(path: string): boolean {
  return /(?:^|\/)docs\/plans\/(?:archive\/)?[^/]+\/[^/]*-plan\.md$/.test(toPosix(path));
}

/**
 * The plan folder's repo-relative candidates, live first then archived.
 *
 * Callers resolving a file inside a plan folder (the flight plan, say) know the
 * id but not the location — the id deliberately does not carry it (rule 1). Both
 * candidates are tried in order rather than guessing, so an archived plan's
 * `the-flow.json` still resolves instead of silently reading as absent.
 */
export function planDirCandidates(planId: string): readonly string[] {
  return [`docs/plans/${planId}`, `docs/plans/archive/${planId}`];
}
