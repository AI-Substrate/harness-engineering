import type { IndexState } from '../../adapters/git/git-port.js';
import type { CommandScan } from './scan-command.js';

/**
 * What the POST phase decides (plan 082 tk-0004).
 *
 * `emit` means: tell the collector a commit command ran here, so it resolves the
 * transition from the reflog cursor it already holds. `silent` means: say nothing.
 *
 * The two are NOT symmetric, and the asymmetry is the whole design. A missing
 * emit loses a note. A wrong emit makes the daemon claim an unrelated reflog
 * entry and write a CONFIDENT FALSE note — worse than a missing one, because it
 * attributes someone else's lines to this agent. So every ambiguity resolves to
 * `silent`.
 */
export type TransitionDecision = 'emit' | 'silent';

/** Why the classifier decided as it did — for the journal, never for control flow. */
export type TransitionReason =
  | 'no-prior-state'
  | 'head-unreadable'
  | 'head-unchanged'
  | 'not-a-child-of-recorded-head'
  | 'multiple-parents'
  | 'reflog-says-not-authored'
  | 'command-imports-content'
  | 'index-was-not-clean'
  | 'authored-here';

export interface TransitionOutcome {
  decision: TransitionDecision;
  reason: TransitionReason;
}

/**
 * The inputs the decision is made from — ALL of them, and nothing else.
 *
 * Note what is ABSENT: `.git` state (MERGE_HEAD / SQUASH_MSG). That is deliberate
 * and it is a correctness property, not a simplification. Measured with a real
 * post-commit hook: `merge --squash` never writes MERGE_HEAD at all, and git
 * unlinks SQUASH_MSG before its OWN post-commit hook fires — an agent hook fires
 * later still and would read an empty directory. Accepting it as a parameter
 * would let a test hand the classifier a state the runtime can never observe, and
 * a broken system would go green.
 */
export interface TransitionInputs {
  /** HEAD recorded at PRE. `null` when PRE saw an unborn branch. */
  prev: string | null;
  /** HEAD observed at POST. `null` when it could not be read. */
  head: string | null;
  /**
   * The parents of `head`, in order. `[]` for a root commit. Only the FIRST
   * parent is consulted for lineage; the COUNT rejects merge commits.
   */
  parents: readonly string[];
  /**
   * The newest reflog subject (`%gs`), whole. `null` when the reflog could not be
   * read — which is treated as "cannot establish", not as "fine".
   */
  reflogSubject: string | null;
  /** The index as it was at PRE. See {@link IndexState}. */
  indexAtPre: IndexState;
  /**
   * What the bracket's own command line says it was doing, from the PRE payload
   * (see `scan-command.ts`). The SECOND layer, catching the shape index-at-PRE
   * cannot: an import and its commit chained inside ONE bracket.
   *
   * `unavailable` ABSTAINS — it neither silences nor approves. A client that sends
   * no command must fall back to the other layers rather than have the feature
   * silently switched off, and an unread payload is never an all-clear.
   */
  commandScan: CommandScan;
}

/**
 * Reflog OPERATIONS that prove the content came from somewhere else.
 *
 * MEASURED, not guessed — and the measurement corrected a real bug. A reflog
 * subject is `<operation> [<argv>]: <detail>`, and git puts the ARGV in it:
 * a fast-forward pull reads
 *
 *   pull -q --ff-only origin main: Fast-forward
 *
 * not `pull: Fast-forward`. An earlier version of this file matched the literal
 * prefix `pull:` and therefore matched NO REAL PULL — while its unit test, which
 * fed the classifier the fabricated string `pull: Fast-forward`, passed. The
 * provocation suite caught it against real git. That is the whole argument for
 * driving real repositories rather than hand-built states.
 *
 * So the operation is taken as the leading WORD of the phrase before the first
 * colon, which is where git writes it and where a commit message can never reach.
 *
 * This list is a FILTER, NOT THE DISCRIMINATOR. It catches the transitions git
 * bothers to name; seven others read `commit: <msg>` byte-identically to a genuine
 * commit and are caught by the index and command-scan layers instead.
 */
const NOT_AUTHORED_OPERATIONS = new Set([
  'pull',
  'merge',
  'cherry-pick',
  'revert',
  'rebase',
  'am',
  'reset',
  'checkout',
  'clone',
  'fetch',
  'restore',
  'stash',
  'rebase-i',
]);

/**
 * `commit` qualified by a parenthetical that says it was not authored here.
 * `commit` and `commit (initial)` ARE authorship; the rest are not.
 */
const NOT_AUTHORED_COMMIT_KINDS = new Set(['amend', 'merge', 'cherry-pick', 'revert', 'rebase']);

/**
 * The operation a reflog subject names, or `null` when it names nothing usable.
 *
 * Everything before the FIRST colon is the operation phrase — git's own framing,
 * and the reason a commit MESSAGE containing `pull:` cannot be mistaken for a
 * pull: in `commit: pull: rename the helper` the phrase is just `commit`.
 */
export function reflogOperation(subject: string): { op: string; kind: string | null } | null {
  const colon = subject.indexOf(':');
  const phrase = (colon === -1 ? subject : subject.slice(0, colon)).trim();
  if (phrase.length === 0) return null;
  const op = phrase.split(/\s+/)[0].toLowerCase();
  const parenthetical = /\(([^)]+)\)/.exec(phrase);
  return { op, kind: parenthetical === null ? null : parenthetical[1].trim().toLowerCase() };
}

/**
 * Decide whether the observed HEAD transition was a commit AUTHORED BY THE AGENT
 * in this repository (plan 082 tk-0004).
 *
 * PURE: no filesystem, no git, no clock, no environment. Every input is a value,
 * so the provocation suite can exercise a case without the runtime — while the
 * suite that actually PROVES the guard drives real git through the runtime
 * (tk-0005), because a pure function fed a hand-built state only proves the
 * implementation agrees with itself.
 *
 * The checks run cheapest-first and each one can only ever move the answer TOWARD
 * silence:
 *
 * 1. inputs we do not have (no prior state, unreadable HEAD)
 * 2. HEAD did not advance by exactly one commit on top of what we recorded
 * 3. more than one parent — a merge commit
 * 4. the reflog names an operation that is not authorship
 * 5. **the bracket's command names a content import** — the second layer
 * 6. **the index was not clean at PRE** — the discriminator for the case where
 *    the import happened before the bracket
 *
 * TWO LAYERS, TWO DIFFERENT SHAPES, and neither subsumes the other:
 * - import BEFORE the bracket -> PRE sees an already-staged index (check 6)
 * - import INSIDE the bracket -> PRE sees a CLEAN index, and only the command
 *   scan can see it (check 5). MEASURED: 76 captured Cursor PRE payloads show the
 *   agent chaining `git add -A && git commit …` in one Shell tool call, so this is
 *   the NORMAL shape, not an exotic one.
 *
 * WHERE THIS STOPS, stated plainly rather than discovered later. The command scan
 * NARROWS, it does not close: a script, alias, shell function, Makefile target or
 * heredoc hides the operation, and a human committing inside the bracket is
 * indistinguishable from the agent doing it — nothing in git records who typed.
 * Those cases EMIT, and they are asserted as known-blind rows.
 *
 * WHAT AN OVER-EMIT ACTUALLY COSTS IS UNMEASURED. The six events tell the daemon a
 * commit happened; the LINE-LEVEL attribution is git-ai's own, computed from
 * checkpoint records its hooks wrote. Whether an over-emitted squash-merge makes
 * the daemon write a wrong note, write a note with no agent lines, or fail closed
 * has NOT been observed. Stated as the open question it is — neither upgraded to
 * "fabricates authorship" nor downgraded to "harmless".
 *
 * The chosen error direction is the cheap one: an agent that stages in one tool
 * call and commits in the next reaches PRE already-staged and stays SILENT — a
 * false NEGATIVE, a missing note.
 */
export function classifyHeadTransition(inputs: TransitionInputs): TransitionOutcome {
  const { prev, head, parents, reflogSubject, indexAtPre, commandScan } = inputs;

  // We never observed a baseline, so no transition can be established from it.
  // Never guess on the first sighting.
  if (prev === null) {
    return { decision: 'silent', reason: 'no-prior-state' };
  }
  if (head === null) {
    return { decision: 'silent', reason: 'head-unreadable' };
  }
  if (prev === head) {
    return { decision: 'silent', reason: 'head-unchanged' };
  }
  // Class (a): HEAD moved, but not by one commit on top of where we were —
  // checkout, reset, rebase, a multi-commit fast-forward, a root commit.
  if (parents.length === 0 || parents[0] !== prev) {
    return { decision: 'silent', reason: 'not-a-child-of-recorded-head' };
  }
  // A merge commit. Its content was authored elsewhere even when the merge itself
  // happened here.
  if (parents.length > 1) {
    return { decision: 'silent', reason: 'multiple-parents' };
  }
  // A reflog we could not read is "cannot establish", never "fine".
  if (reflogSubject === null) {
    return { decision: 'silent', reason: 'reflog-says-not-authored' };
  }
  const operation = reflogOperation(reflogSubject);
  if (operation === null) {
    return { decision: 'silent', reason: 'reflog-says-not-authored' };
  }
  if (NOT_AUTHORED_OPERATIONS.has(operation.op)) {
    return { decision: 'silent', reason: 'reflog-says-not-authored' };
  }
  if (operation.op === 'commit' && operation.kind !== null) {
    // `commit (initial)` is the first commit in a repository — authorship.
    // `commit (amend)` / `(merge)` / `(cherry-pick)` are not.
    if (NOT_AUTHORED_COMMIT_KINDS.has(operation.kind)) {
      return { decision: 'silent', reason: 'reflog-says-not-authored' };
    }
  }
  // SECOND LAYER. Catches the import chained into the same bracket as the commit,
  // which reaches PRE with a clean index and defeats every check above.
  // `unavailable` abstains — it is not evidence in either direction.
  if (commandScan === 'imports-content') {
    return { decision: 'silent', reason: 'command-imports-content' };
  }
  // `index-was-not-clean` WAS HERE, AND WAS REMOVED (2026-08-10, Jordan's ruling).
  //
  // It asked the wrong question. Every check above answers "was a genuine new commit
  // AUTHORED HERE?" — which is what the six synthetic events assert. This one asked
  // "did someone stage in a SEPARATE tool call?", which is not evidence about whether
  // a commit happened, and it made the relay an adjudicator of whether a commit
  // DESERVES attribution. That call is git-ai's, not ours: we emit no sha, no line
  // ranges and no authorship, so we cannot mis-attribute — only wrongly assert that a
  // commit occurred.
  //
  // MEASURED COST of keeping it (Windows, run 8, commit d35a2c6e): the agent staged
  // with `git add -A` in one tool call and committed in the next, so PRE saw a dirty
  // index and we stayed SILENT. git-ai attributed the commit anyway through its own
  // channel and got it WRONG — eight files the agent never opened claimed in full, and
  // eight hand-typed human lines claimed for the agent. Our silence bought no safety;
  // it only removed us from a note that was written regardless.
  return { decision: 'emit', reason: 'authored-here' };
}
