/**
 * Unexamined-markdown detection for `harness markdown-lint` (plan 081 IMPROVE,
 * DL-001).
 *
 * The three tool checks report on markdown they DID examine. Their file list
 * comes from `git ls-files`, so a brand-new UNTRACKED `.md` is not in it — and a
 * check that never receives a file cannot fail on it. The gate therefore reported
 * green over documents it had never opened, which is the exact defect class plan
 * 081 was filed against, living in one of our own gates.
 *
 * This module answers the complementary question: what markdown SHOULD this run
 * have examined, and did not? It deliberately reuses {@link filterInScope} rather
 * than re-deriving "authored markdown", so the definition of scope cannot drift
 * between what the gate lints and what it notices it failed to lint — the same
 * single-source property (AC-04) the three tool checks already share.
 *
 * Pure: no I/O, no `node:*` imports, fully synchronous. The shell runs
 * `git status --porcelain --untracked-files=all -z` and hands the bytes here.
 */

import { filterInScope, normalizePath } from './scope.js';

export interface UnexaminedScan {
  /**
   * EVERY untracked path parsed out of the porcelain output — markdown or not,
   * in scope or not. This is the denominator, and it exists so a broken parser
   * is loud: a reader that silently returned nothing would otherwise report
   * "no unexamined markdown" and be indistinguishable from a clean tree.
   */
  untracked: string[];
  /** The subset this run should have examined: in-scope authored markdown. */
  unexamined: string[];
}

const MARKDOWN = /\.(?:md|markdown)$/i;

/**
 * Parse `git status --porcelain --untracked-files=all -z` and split it into the
 * denominator and the in-scope markdown subset.
 *
 * Only `?? ` entries are read. In `-z` porcelain a rename emits its old path as a
 * bare extra field, which does not carry a status prefix and is skipped here for
 * that reason rather than by accident.
 *
 * `dir` mirrors the verb's `--dir` narrowing: a run scoped to one directory must
 * not make claims about markdown outside it.
 */
export function scanUntracked(porcelainZ: string, dir?: string): UnexaminedScan {
  const untracked: string[] = [];
  for (const raw of porcelainZ.split('\0')) {
    if (!raw.startsWith('?? ')) continue;
    const p = normalizePath(raw.slice(3).trim());
    if (p.length > 0) untracked.push(p);
  }
  let unexamined = filterInScope(untracked.filter((p) => MARKDOWN.test(p)));
  if (dir !== undefined && dir.length > 0) {
    unexamined = unexamined.filter((f) => f === dir || f.startsWith(`${dir}/`));
  }
  return { untracked, unexamined };
}

/** How many names to list before summarising the rest. */
const MAX_NAMED = 5;

/**
 * The one-line summary. It NAMES the files and states the repair, because a
 * finding a reader cannot act on is only a slower way of being silent.
 */
export function describeUnexamined(unexamined: string[]): string {
  const named = unexamined.slice(0, MAX_NAMED).join(', ');
  const rest = unexamined.length - MAX_NAMED;
  const list = rest > 0 ? `${named} (+${rest} more)` : named;
  return (
    `${unexamined.length} untracked markdown file(s) in scope were NOT examined: ${list} — ` +
    'this verb reads `git ls-files`, so an untracked file is skipped, not passed. ' +
    'What to do depends on whose file it is: if it is YOURS and should be tracked, ' +
    '`git add -N <file>` makes it visible here. If it is yours and deliberately untracked, ' +
    'this degraded reading is the correct report of a file nobody linted and needs no action. ' +
    'If it is NOT yours, leave it and say so in your result — in a shared worktree an untracked ' +
    "file is another agent's in-flight work, and deleting, committing, moving or stashing it to " +
    'clear this gate destroys or publishes work that has no other copy.'
  );
}
