import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyHeadTransition,
  type TransitionInputs,
} from '../../../src/services/hooks/classify-head-transition.js';

const PREV = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

/** A genuine authored commit — every field in the state that produces `emit`. */
const authored: TransitionInputs = {
  prev: PREV,
  head: HEAD,
  parents: [PREV],
  reflogSubject: 'commit: the agent wrote this',
  indexAtPre: 'clean',
  commandScan: 'authors-only',
};

const decide = (over: Partial<TransitionInputs>) =>
  classifyHeadTransition({ ...authored, ...over });

describe('classifyHeadTransition — the positive case (plan 082 tk-0004)', () => {
  it('emits for a commit authored here, so the suite can see the opposite of silence', () => {
    expect(classifyHeadTransition(authored)).toEqual({
      decision: 'emit',
      reason: 'authored-here',
    });
  });
});

describe('classifyHeadTransition — class (a): HEAD did not advance by exactly one', () => {
  it.each([
    ['no prior state recorded', { prev: null }, 'no-prior-state'],
    ['HEAD unreadable at POST', { head: null }, 'head-unreadable'],
    ['nothing moved', { head: PREV }, 'head-unchanged'],
    [
      'a root commit (no parents)',
      { parents: [] as readonly string[] },
      'not-a-child-of-recorded-head',
    ],
    [
      'checkout / reset / rebase — lineage broken',
      { parents: [OTHER] },
      'not-a-child-of-recorded-head',
    ],
    [
      'a multi-commit fast-forward pull — HEAD advanced by MORE than one',
      { parents: [OTHER], reflogSubject: 'pull: Fast-forward' },
      'not-a-child-of-recorded-head',
    ],
  ])('stays SILENT for %s', (_name, over, reason) => {
    expect(decide(over as Partial<TransitionInputs>)).toEqual({ decision: 'silent', reason });
  });
});

describe('classifyHeadTransition — class (b): HEAD advanced by one, authored elsewhere', () => {
  it('stays SILENT for a --no-ff merge, whose first parent IS the recorded HEAD', () => {
    // The one case parent-count alone actually catches, kept so a future
    // simplification cannot quietly remove the check.
    expect(
      decide({
        parents: [PREV, OTHER],
        reflogSubject: 'merge side: Merge made by the recursive strategy.',
      }),
    ).toEqual({
      decision: 'silent',
      reason: 'multiple-parents',
    });
  });

  // MEASURED subjects, copied from real git runs — NOT invented. An earlier
  // version of this list used the plausible-looking `pull: Fast-forward`, which
  // real git never writes: it writes the whole argv, `pull -q --ff-only origin
  // main: Fast-forward`. The fabricated string passed while the code matched no
  // real pull at all. Every row below is a string git actually produced.
  it.each([
    ['single-commit fast-forward pull', 'pull -q --ff-only origin main: Fast-forward'],
    ['a merge', "merge side: Merge made by the 'ort' strategy."],
    ['cherry-pick', 'cherry-pick: fast-forward'],
    ['revert', 'revert: Revert "a thing"'],
    ['git am', 'am: apply the patch'],
    ['amend', 'commit (amend): the agent wrote this'],
    ['rebase', 'rebase (finish): returning to refs/heads/main'],
    ['merge, recorded as a commit', 'commit (merge): merged'],
    ['reset', 'reset: moving to HEAD~1'],
    ['checkout', 'checkout: moving from main to side'],
  ])('stays SILENT when the reflog names %s', (_name, reflogSubject) => {
    expect(decide({ reflogSubject })).toEqual({
      decision: 'silent',
      reason: 'reflog-says-not-authored',
    });
  });

  it('stays SILENT when the reflog could not be read — cannot establish is not fine', () => {
    expect(decide({ reflogSubject: null })).toEqual({
      decision: 'silent',
      reason: 'reflog-says-not-authored',
    });
  });

  it('reads the operation from the phrase BEFORE the first colon, so a commit MESSAGE cannot silence a real commit', () => {
    // A substring match would let `commit: pull: rename the helper` — a perfectly
    // ordinary commit message — be classified as a fast-forward pull and lose its note.
    expect(decide({ reflogSubject: 'commit: pull: rename the helper' })).toEqual({
      decision: 'emit',
      reason: 'authored-here',
    });
    expect(decide({ reflogSubject: 'commit: merge the config files by hand' })).toEqual({
      decision: 'emit',
      reason: 'authored-here',
    });
  });

  it('treats `commit (initial)` as authorship — the first commit in a repository', () => {
    expect(decide({ reflogSubject: 'commit (initial): the very first one' })).toEqual({
      decision: 'emit',
      reason: 'authored-here',
    });
  });
});

describe('classifyHeadTransition — the command scan is the SECOND layer (tk-000d)', () => {
  /*
  Test Doc:
  - Why: MEASURED from 76 captured Cursor PRE payloads — the agent chains
    `git add -A && git commit …` in ONE Shell tool call. An import chained the same
    way reaches PRE with a CLEAN index, so index-at-PRE cannot see it.
  - Contract: `imports-content` silences regardless of index state.
  - Quality Contribution: the two layers catch DIFFERENT shapes; this pins the one
    the index cannot.
  */
  it('stays SILENT when the bracket command imports content, even with a CLEAN index', () => {
    expect(decide({ commandScan: 'imports-content', indexAtPre: 'clean' })).toEqual({
      decision: 'silent',
      reason: 'command-imports-content',
    });
  });

  it('ABSTAINS when the command is unavailable — the other layers still decide', () => {
    // Not silence (that would switch the feature off for a client that sends no
    // command) and not approval (an unread payload is not evidence).
    expect(decide({ commandScan: 'unavailable' })).toEqual({
      decision: 'emit',
      reason: 'authored-here',
    });
    expect(decide({ commandScan: 'unavailable', indexAtPre: 'already-staged' })).toEqual({
      decision: 'silent',
      reason: 'index-was-not-clean',
    });
  });
});

describe('classifyHeadTransition — the index at PRE is what catches the seven defeaters', () => {
  /*
  Test Doc:
  - Why: these seven are byte-identical to an authored commit on parent count AND
    reflog subject — measured across isolated repos. Every check above this one
    passes them. The index check is the only thing between them and a false note.
  - Contract: with an already-staged index at PRE, the decision is silent.
  - Quality Contribution: each row is built from the state that DEFEATS the other
    two discriminators (one parent, `commit: <msg>`), so the row can only be
    rejected by the index.
  */
  it.each([
    'merge --squash',
    'cherry-pick -n',
    'revert -n',
    'git apply',
    'checkout REF -- path',
    'restore --source',
    'read-tree -m -u',
  ])('stays SILENT for %s — one parent, reflog reads `commit: <msg>`, index already-staged', (transition) => {
    expect(
      decide({ reflogSubject: `commit: ${transition} result`, indexAtPre: 'already-staged' }),
    ).toEqual({ decision: 'silent', reason: 'index-was-not-clean' });
  });

  it('treats an UNREADABLE index exactly as it treats already-staged', () => {
    // A read we could not make is not evidence. Silence is the safe direction.
    expect(decide({ indexAtPre: 'unknown' })).toEqual({
      decision: 'silent',
      reason: 'index-was-not-clean',
    });
  });

  it('is the LAST check — a defeater that also fails an earlier check still stays silent', () => {
    expect(decide({ parents: [OTHER], indexAtPre: 'already-staged' }).decision).toBe('silent');
  });
});

describe('classifyHeadTransition — purity (dw-0005, dw-0006)', () => {
  it('is pure: the same inputs give the same answer, and calling it changes nothing', () => {
    const inputs: TransitionInputs = { ...authored };
    const first = classifyHeadTransition(inputs);
    const second = classifyHeadTransition(inputs);
    expect(first).toEqual(second);
    // The inputs are not mutated — a classifier that rewrote its argument would
    // make the runtime's second read differ from its first.
    expect(inputs).toEqual(authored);
  });

  it('imports NOTHING that can perform IO — no fs, no child_process, no net, no git shell-out', () => {
    /*
    Test Doc:
    - Why: dw-0005. "Pure" asserted in a comment is a claim; asserted against the
      module's own source it is a fact that stays true as the file changes.
    - Contract: the module's only import is a TYPE import.
    - Quality Contribution: this is the guard that stops someone adding a
      convenience `execFileSync` later and calling it a refactor.
    */
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../src/services/hooks/classify-head-transition.ts',
      ),
      'utf8',
    );
    for (const forbidden of [
      /from\s+['"]node:fs['"]/,
      /from\s+['"]node:child_process['"]/,
      /from\s+['"]node:net['"]/,
      /from\s+['"]node:os['"]/,
      /require\(/,
      /\bspawnSync\b/,
      /\bexecFileSync\b/,
    ]) {
      expect(forbidden.test(source), `${forbidden} must not appear`).toBe(false);
    }
    // Every import in the file is type-only, so nothing is even loaded at runtime.
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line.startsWith('import type ')).toBe(true);
  });

  it('does NOT accept `.git` state as a parameter — it does not exist at decision time', () => {
    /*
    Test Doc:
    - Why: dw-0006. MERGE_HEAD is never written by `merge --squash`, and git
      unlinks SQUASH_MSG before its own post-commit hook runs — our hook fires
      later still. A classifier taking it as a parameter would let a fabricated
      test input make a broken system look green.
    - Contract: no field of TransitionInputs names `.git` state.
    */
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../src/services/hooks/classify-head-transition.ts',
      ),
      'utf8',
    );
    const interfaceBlock = source.slice(
      source.indexOf('export interface TransitionInputs'),
      source.indexOf('const NOT_AUTHORED_HERE'),
    );
    expect(interfaceBlock.length).toBeGreaterThan(0);
    for (const banned of ['MERGE_HEAD', 'SQUASH_MSG', 'gitDirState', 'CHERRY_PICK_HEAD']) {
      // Named in the PROSE (explaining the absence) is fine; declared as a FIELD is not.
      expect(new RegExp(`^\\s*${banned}\\??:`, 'm').test(interfaceBlock)).toBe(false);
    }
  });
});
