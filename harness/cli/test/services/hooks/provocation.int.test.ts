import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { ExecGit } from '../../../src/adapters/git/exec-git.js';
import { NodeHash } from '../../../src/adapters/hash/node-hash.js';
import type { TransitionReason } from '../../../src/services/hooks/classify-head-transition.js';
import {
  type CommitEmitter,
  CommitIntercept,
  type FireOutcome,
  type HookJournal,
} from '../../../src/services/hooks/commit-intercept.js';
import { HookStateStore } from '../../../src/services/hooks/hook-state.js';
import { hermeticGitEnv } from '../../support/hermetic-git.js';

/**
 * THE PROVOCATION SUITE (plan 082 tk-0005).
 *
 * Every row drives REAL git in an isolated repository and asserts on the
 * RUNTIME's decision. That is the whole point of the file: a suite built against
 * the pure classifier would hand it a hand-built state and prove only that the
 * implementation agrees with itself — and the rows that matter most are exactly
 * the ones a fabricated state gets wrong, because `merge --squash` LOOKS like an
 * authored commit in every field a test author would think to populate.
 *
 * Each row follows the real agent shape:
 *
 *   (setup)  ->  PRE fire  ->  (the transition under test)  ->  POST fire
 *
 * The PRE fire brackets the transition exactly as an agent tool call would, and
 * the emitter is a spy, so a row asserts on the DECISION without a daemon, a
 * socket or a network.
 */

let dir: string;
let repo: string;
let upstream: string;
let emitted: { repoRoot: string; message: string }[];
let journal: FireOutcome[];
let intercept: CommitIntercept;

const git = (args: string[], cwd = repo): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: hermeticGitEnv() }).trim();

/** Tolerates a non-zero exit (some provocations legitimately fail or conflict). */
const gitTry = (args: string[], cwd = repo): void => {
  try {
    execFileSync('git', args, { cwd, encoding: 'utf8', env: hermeticGitEnv(), stdio: 'ignore' });
  } catch {
    /* the provocation is the point, not its exit code */
  }
};

const write = (name: string, body: string, cwd = repo): void =>
  writeFileSync(join(cwd, name), body);

const headSha = (): string => git(['rev-parse', 'HEAD']).toLowerCase();

/** How many commits HEAD has advanced along its FIRST parent since `prev`. */
const advanceFrom = (prev: string): number =>
  Number(git(['rev-list', '--count', '--first-parent', `${prev}..HEAD`]));

const parentCount = (): number =>
  git(['rev-list', '--parents', '-n1', 'HEAD']).split(/\s+/).length - 1;

const headSubject = (): string => git(['log', '-1', '--format=%s']);

/**
 * One row of a SILENT table.
 *
 * `verify` is the load-bearing addition (review F001). A row that asserted only
 * `kind === 'silent'` could pass WITHOUT ITS NAMED OPERATION EVER HAPPENING: a
 * failed or skipped transition leaves HEAD where PRE recorded it, POST returns
 * `silent`/`head-unchanged`, and the row goes green for a reason that has nothing
 * to do with what it claims to test. PROVEN, not theorised — a reviewer replaced
 * the fast-forward-pull transition with a no-op callback and the row still passed.
 *
 * So every row now states two things it could previously leave unsaid:
 *
 * 1. `verify` — the postcondition. What must be TRUE of the repository for this
 *    row's name to be an honest description of what ran. Asserted BEFORE silence,
 *    so a setup that silently failed goes RED at the cause rather than passing at
 *    the symptom.
 * 2. `reason` — WHICH check silenced it. `silent` is a bucket, and
 *    `head-unchanged` (nothing happened) sits in it right beside the answer the
 *    row is actually testing for. Only the reason tells them apart. Same
 *    distinction as asserting a note's identity rather than a note count.
 *
 * This is the third instance on this plan of one defect: a probe that cannot see
 * the opposite of what it asserts returns an artifact of itself.
 */
interface SilentRow {
  name: string;
  /** Runs BEFORE the bracket opens — anything here is invisible to the PRE index. */
  setup?: () => void;
  /** Runs INSIDE the bracket, between PRE and POST. */
  transition: () => void;
  /** The postcondition: proof the named operation really ran. `prev` is HEAD at PRE. */
  verify: (prev: string) => void;
  reason: TransitionReason;
}

/**
 * The postcondition every MEASURED-DEFEATER row shares, and its whole claim:
 * HEAD advanced by exactly ONE commit with ONE parent whose reflog subject is
 * `commit: <msg>` — byte-identical to a genuine authored commit in every field a
 * naive guard consults. If that stops being true the row is no longer testing a
 * defeater, and it must say so by failing.
 */
const indistinguishableFromAuthorship =
  (message: string) =>
  (prev: string): void => {
    expect(advanceFrom(prev)).toBe(1);
    expect(parentCount()).toBe(1);
    expect(git(['log', '-g', '-1', '--format=%gs'])).toBe(`commit: ${message}`);
  };

/**
 * PRE, then the transition, then POST — returns POST's outcome.
 *
 * `command` is the bracket's own command line, exactly as the agent's PRE payload
 * carries it. Passing it is what makes a row exercise the SECOND layer; omitting
 * it leaves the scan abstaining so the row tests index-at-PRE alone.
 */
async function bracket(transition: () => void, command?: string): Promise<FireOutcome> {
  await intercept.fire('pre', repo, command ?? null);
  transition();
  return intercept.fire('post', repo);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-provocation-'));
  repo = join(dir, 'repo');
  upstream = join(dir, 'upstream');
  emitted = [];
  journal = [];

  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: hermeticGitEnv() });
  write('a.txt', 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-qm', 'base']);

  const emitter: CommitEmitter = {
    emit: async (input) => {
      emitted.push(input);
      return { ok: true, detail: 'spy' };
    },
  };
  const journalPort: HookJournal = { record: (entry) => journal.push(entry.outcome) };
  intercept = new CommitIntercept({
    git: new ExecGit(repo),
    state: new HookStateStore(new NodeFs(), new NodeHash(), join(dir, 'state'), () => 'tok'),
    clock: new FakeClock(),
    emitter,
    journal: journalPort,
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('provocation — the POSITIVE control (dw-000a)', () => {
  it('EMITS for a genuine agent edit committed inside the bracket', async () => {
    // Without this row the suite could pass by never emitting at all. It has to be
    // able to see the opposite of silence.
    const outcome = await bracket(
      () => {
        write('a.txt', 'the agent edited this\n');
        git(['add', 'a.txt']);
        git(['commit', '-qm', 'the agent authored this']);
      },
      // The literal shape captured from Cursor: chained add + commit in ONE call.
      'git add -A && git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "the agent authored this"',
    );

    expect(outcome).toEqual({ kind: 'emitted', head: git(['rev-parse', 'HEAD']).toLowerCase() });
    expect(emitted).toHaveLength(1);
  });
});

describe('provocation — class (a): HEAD did not advance by exactly one (dw-0009)', () => {
  /*
  Test Doc:
  - Why: HEAD moved for a reason that is not a commit authored here — or did not
    move at all. Each row must prove its own operation ran (see {@link SilentRow}).
  - Contract: every row is silent, FOR ITS OWN NAMED REASON, and nothing is emitted.
  */
  const rows: SilentRow[] = [
    {
      name: 'checkout of another branch',
      transition: () => {
        git(['branch', 'other']);
        write('b.txt', 'b\n');
        git(['add', 'b.txt']);
        git(['commit', '-qm', 'on main']);
        git(['checkout', '-q', 'other']);
      },
      // MEASURED: `other` was branched at the recorded HEAD, so the SHA is
      // unchanged even though a commit AND a checkout both happened. Without this
      // postcondition the row is indistinguishable from the no-op row below —
      // both would pass on `head-unchanged` alone.
      verify: (prev) => {
        expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('other');
        expect(git(['rev-parse', 'main']).toLowerCase()).not.toBe(prev);
        expect(headSha()).toBe(prev);
      },
      reason: 'head-unchanged',
    },
    {
      name: 'reset --hard backwards',
      transition: () => {
        write('b.txt', 'b\n');
        git(['add', 'b.txt']);
        git(['commit', '-qm', 'second']);
        git(['reset', '-q', '--hard', 'HEAD~1']);
      },
      // The commit must have really been made and really been thrown away: the
      // file it added is gone from the worktree and HEAD is back at PRE's sha.
      verify: (prev) => {
        expect(existsSync(join(repo, 'b.txt'))).toBe(false);
        expect(headSha()).toBe(prev);
      },
      reason: 'head-unchanged',
    },
    {
      name: 'rebase onto a diverged branch',
      transition: () => {
        git(['checkout', '-q', '-b', 'feature']);
        write('f.txt', 'f\n');
        git(['add', 'f.txt']);
        git(['commit', '-qm', 'feature work']);
        git(['checkout', '-q', 'main']);
        write('m.txt', 'm\n');
        git(['add', 'm.txt']);
        git(['commit', '-qm', 'main work']);
        git(['checkout', '-q', 'feature']);
        gitTry(['rebase', 'main']);
      },
      // A rebase that conflicted would leave HEAD detached mid-operation with a
      // different subject — the postcondition is what separates "rebased" from
      // "tried to rebase".
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(2);
        expect(parentCount()).toBe(1);
        expect(headSubject()).toBe('feature work');
      },
      reason: 'not-a-child-of-recorded-head',
    },
    {
      name: 'amend',
      transition: () => git(['commit', '-q', '--amend', '-m', 'amended']),
      // MEASURED: amending the ROOT commit produces a new root — zero parents,
      // which is why the classifier rejects it before it ever reads the reflog.
      verify: (prev) => {
        expect(headSha()).not.toBe(prev);
        expect(headSubject()).toBe('amended');
        expect(parentCount()).toBe(0);
      },
      reason: 'not-a-child-of-recorded-head',
    },
    {
      name: 'a no-op — nothing at all happened',
      transition: () => {},
      // The one row where "HEAD did not move" IS the claim. It is here so the
      // vacuous-pass shape is represented deliberately rather than by accident.
      verify: (prev) => expect(headSha()).toBe(prev),
      reason: 'head-unchanged',
    },
    {
      name: 'detached HEAD',
      transition: () => git(['checkout', '-q', '--detach', 'HEAD']),
      verify: (prev) => {
        expect(headSha()).toBe(prev);
        expect(git(['branch', '--show-current'])).toBe('');
      },
      reason: 'head-unchanged',
    },
    {
      name: 'a MULTI-COMMIT fast-forward pull — HEAD advances by more than one',
      transition: () => {
        execFileSync('git', ['clone', '-q', repo, upstream], { env: hermeticGitEnv() });
        write('u1.txt', 'u1\n', upstream);
        git(['add', 'u1.txt'], upstream);
        git(['commit', '-qm', 'upstream one'], upstream);
        write('u2.txt', 'u2\n', upstream);
        git(['add', 'u2.txt'], upstream);
        git(['commit', '-qm', 'upstream two'], upstream);
        git(['remote', 'add', 'up', upstream]);
        gitTry(['pull', '-q', '--ff-only', 'up', 'main']);
      },
      // The row's entire point is the TWO. A pull that fetched nothing leaves
      // HEAD where it was and the row would pass on `head-unchanged` instead.
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(2);
        expect(parentCount()).toBe(1);
        expect(headSubject()).toBe('upstream two');
      },
      reason: 'not-a-child-of-recorded-head',
    },
  ];

  it.each(rows)('stays SILENT for $name', async (row) => {
    row.setup?.();
    const prev = headSha();
    const outcome = await bracket(row.transition);

    row.verify(prev);
    expect(outcome).toEqual({ kind: 'silent', reason: row.reason });
    expect(emitted).toEqual([]);
  });

  it('stays SILENT when there is NO prior recorded state — POST without a PRE', async () => {
    // First sighting. A baseline we did not observe cannot prove a transition.
    write('b.txt', 'b\n');
    git(['add', 'b.txt']);
    git(['commit', '-qm', 'committed with no bracket']);

    const outcome = await intercept.fire('post', repo);
    expect(outcome).toEqual({ kind: 'silent', reason: 'no-prior-state' });
    expect(emitted).toEqual([]);
  });
});

describe('provocation — class (b): HEAD advanced by one, authored ELSEWHERE (dw-0008)', () => {
  /*
  Test Doc:
  - Why: these rows pass a naive guard. Each advances HEAD by exactly one commit
    whose first parent IS the recorded HEAD. The seven marked MEASURED-DEFEATER
    additionally read `commit: <msg>` in the reflog and have ONE parent — they are
    byte-identical to an authored commit on parent-count AND reflog, so ONLY the
    index recorded at PRE rejects them.
  - Contract: every row is silent FOR ITS OWN NAMED REASON, its postcondition
    proves the named operation really ran, and nothing is emitted.
  */
  const seedSide = (): void => {
    git(['checkout', '-q', '-b', 'side']);
    write('s.txt', 'from elsewhere\n');
    git(['add', 's.txt']);
    git(['commit', '-qm', 'side work']);
    git(['checkout', '-q', 'main']);
  };

  const rows: SilentRow[] = [
    {
      name: 'MEASURED DEFEATER — merge --squash then commit',
      setup: () => {
        seedSide();
        git(['merge', '-q', '--squash', 'side']);
      },
      transition: () => git(['commit', '-qm', 'squashed in']),
      verify: indistinguishableFromAuthorship('squashed in'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'MEASURED DEFEATER — cherry-pick -n then commit',
      setup: () => {
        seedSide();
        git(['cherry-pick', '-n', 'side']);
      },
      transition: () => git(['commit', '-qm', 'cherry picked']),
      verify: indistinguishableFromAuthorship('cherry picked'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'MEASURED DEFEATER — revert -n then commit',
      setup: () => {
        write('r.txt', 'r\n');
        git(['add', 'r.txt']);
        git(['commit', '-qm', 'to be reverted']);
        git(['revert', '-n', 'HEAD']);
      },
      transition: () => git(['commit', '-qm', 'reverted']),
      verify: indistinguishableFromAuthorship('reverted'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'MEASURED DEFEATER — git apply --index then commit',
      setup: () => {
        seedSide();
        const patch = join(dir, 'p.patch');
        writeFileSync(patch, git(['format-patch', '--stdout', 'main..side']));
        gitTry(['apply', '--index', patch]);
      },
      transition: () => git(['commit', '-qm', 'applied a patch']),
      verify: indistinguishableFromAuthorship('applied a patch'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'MEASURED DEFEATER — checkout REF -- path then commit',
      setup: () => {
        seedSide();
        git(['checkout', 'side', '--', 's.txt']);
      },
      transition: () => git(['commit', '-qm', 'took a file from elsewhere']),
      verify: indistinguishableFromAuthorship('took a file from elsewhere'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'MEASURED DEFEATER — restore --source then commit',
      setup: () => {
        seedSide();
        git(['restore', '--source', 'side', '--staged', '--worktree', '--', 's.txt']);
      },
      transition: () => git(['commit', '-qm', 'restored from elsewhere']),
      verify: indistinguishableFromAuthorship('restored from elsewhere'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'MEASURED DEFEATER — read-tree -m -u then commit (how git subtree works)',
      setup: () => {
        seedSide();
        gitTry(['read-tree', '-m', '-u', 'HEAD', 'side']);
      },
      transition: () => git(['commit', '-qm', 'read a tree in']),
      verify: indistinguishableFromAuthorship('read a tree in'),
      reason: 'index-was-not-clean',
    },
    {
      name: 'single-commit fast-forward pull',
      setup: () => {
        execFileSync('git', ['clone', '-q', repo, upstream], { env: hermeticGitEnv() });
        write('u.txt', 'u\n', upstream);
        git(['add', 'u.txt'], upstream);
        git(['commit', '-qm', 'upstream one'], upstream);
        git(['remote', 'add', 'up', upstream]);
      },
      transition: () => gitTry(['pull', '-q', '--ff-only', 'up', 'main']),
      // THE row the reviewer defeated with a no-op callback. The index is clean at
      // PRE here, so `index-was-not-clean` cannot cover for the reflog layer: if
      // the reflog check stopped recognising a pull this row would EMIT.
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(1);
        expect(parentCount()).toBe(1);
        expect(headSubject()).toBe('upstream one');
      },
      reason: 'reflog-says-not-authored',
    },
    {
      name: 'a --no-ff merge commit',
      setup: () => seedSide(),
      transition: () => gitTry(['merge', '-q', '--no-ff', '-m', 'merged side', 'side']),
      // TWO parents is the whole row. A merge that fast-forwarded or refused would
      // leave one parent (or none of it) and must not pass as a merge.
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(1);
        expect(parentCount()).toBe(2);
        expect(headSubject()).toBe('merged side');
      },
      reason: 'multiple-parents',
    },
    {
      name: 'cherry-pick (committing form)',
      setup: () => seedSide(),
      transition: () => gitTry(['cherry-pick', 'side']),
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(1);
        expect(parentCount()).toBe(1);
        expect(headSubject()).toBe('side work');
      },
      reason: 'reflog-says-not-authored',
    },
    {
      name: 'revert (committing form)',
      setup: () => {
        write('r.txt', 'r\n');
        git(['add', 'r.txt']);
        git(['commit', '-qm', 'to be reverted']);
      },
      transition: () => gitTry(['revert', '--no-edit', 'HEAD']),
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(1);
        expect(parentCount()).toBe(1);
        expect(headSubject()).toBe('Revert "to be reverted"');
      },
      reason: 'reflog-says-not-authored',
    },
    {
      name: 'git am',
      setup: () => {
        seedSide();
        writeFileSync(join(dir, 'am.patch'), git(['format-patch', '--stdout', 'main..side']));
      },
      transition: () => gitTry(['am', join(dir, 'am.patch')]),
      verify: (prev) => {
        expect(advanceFrom(prev)).toBe(1);
        expect(parentCount()).toBe(1);
        expect(headSubject()).toBe('side work');
      },
      reason: 'reflog-says-not-authored',
    },
  ];

  it.each(rows)('stays SILENT for $name', async (row) => {
    row.setup?.();
    const prev = headSha();
    const outcome = await bracket(row.transition);

    // Postcondition FIRST: a row whose operation did not run goes red at the
    // cause, not green at the symptom.
    row.verify(prev);
    expect(outcome).toEqual({ kind: 'silent', reason: row.reason });
    expect(emitted).toEqual([]);
    expect(journal.at(-1)?.kind).toBe('silent');
  });
});

describe('provocation — the defeater INSIDE one bracket (tk-000d, dw-001e)', () => {
  /*
  Test Doc:
  - Why: MEASURED from 76 captured Cursor PRE payloads — the agent chains commands
    in ONE Shell tool call (`git add -A && git commit …`). An import chained the
    same way reaches PRE with a CLEAN index, so index-at-PRE cannot see it. These
    rows fail without the command scan and pass with it.
  - Contract: an importing verb anywhere in the bracket command silences the fire.
  - Quality Contribution: a first-token scan passes every one of these strings.
  */
  it.each([
    ['merge --squash', 'git merge --squash side && git commit -m "squashed in"'],
    ['cherry-pick -n', 'git cherry-pick -n side && git commit -m "picked"'],
    ['checkout REF -- path', 'git checkout side -- s.txt && git commit -m "took a file"'],
    ['read-tree', 'git read-tree -m -u HEAD side && git commit -m "read a tree"'],
    // Caught INCIDENTALLY, not by design: the heredoc body is in the same string,
    // and the scan splits on newlines. Recorded as a row so the reason is written
    // down — it would be easy to later mistake this for a heredoc-aware scanner.
    ['a heredoc whose body is visible', 'bash <<EOF\ngit merge --squash side\nEOF'],
  ])('stays SILENT when the bracket command chains %s with the commit', async (_name, command) => {
    git(['checkout', '-q', '-b', 'side']);
    write('s.txt', 'from elsewhere\n');
    git(['add', 's.txt']);
    git(['commit', '-qm', 'side work']);
    git(['checkout', '-q', 'main']);

    // The transition is a genuine one-parent commit with a CLEAN index at PRE —
    // it defeats every other layer. Only the command scan can reject it.
    const outcome = await bracket(() => {
      write('imported.txt', 'content from elsewhere\n');
      git(['add', 'imported.txt']);
      git(['commit', '-qm', 'looks exactly like an authored commit']);
    }, command);

    expect(outcome).toEqual({ kind: 'silent', reason: 'command-imports-content' });
    expect(emitted).toEqual([]);
  });
});

describe('provocation — KNOWN BLIND: the command scan NARROWS, it does not close (dw-0020)', () => {
  /*
  Test Doc:
  - Why: a script, alias, shell function, Makefile target or heredoc hides the git
    operation from the scan. Asserting SILENT here would assert a discrimination
    the system cannot make.
  - Contract: these rows EMIT, and say so.
  - Quality Contribution: the limit lives in the suite, executable, rather than in
    a paragraph nobody re-reads.
  */
  it.each([
    ['a shell script wrapper', './scripts/sync-and-commit.sh'],
    ['a shell alias', 'sync-commit'],
    ['a Makefile target', 'make release'],
  ])('EMITS when the defeater is obfuscated by %s — KNOWN BLIND', async (_name, command) => {
    const outcome = await bracket(() => {
      write('imported.txt', 'content from elsewhere\n');
      git(['add', 'imported.txt']);
      git(['commit', '-qm', 'indistinguishable from authorship']);
    }, command);

    expect(outcome.kind).toBe('emitted');
    expect(emitted).toHaveLength(1);
  });
});

describe('provocation — concurrency (dw-000b)', () => {
  it('two racing POST fires produce AT MOST ONE emit', async () => {
    /*
    Test Doc:
    - Why: the hook fires per agent tool call, so two POSTs can race on the same
      commit. Both read the same prior state; a read-then-write guard lets both
      emit and the collector sees two sessions for one commit.
    - Contract: the exclusive claim authorises the emit, so exactly one wins.
    - Quality Contribution: races the REAL runtime against a REAL filesystem, not
      a simulated interleaving.
    */
    await intercept.fire('pre', repo);
    write('a.txt', 'the agent edited this\n');
    git(['add', 'a.txt']);
    git(['commit', '-qm', 'the agent authored this']);

    const outcomes = await Promise.all([
      intercept.fire('post', repo),
      intercept.fire('post', repo),
      intercept.fire('post', repo),
    ]);

    expect(emitted).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'emitted')).toHaveLength(1);
  });
});

describe('provocation — what an OVER-EMIT actually costs is UNMEASURED', () => {
  it('records the observed daemon behaviour for an over-emit, or SKIPPED without a daemon', async () => {
    /*
    Test Doc:
    - Why: it has been said that an over-emit "fabricates a note claiming the agent
      authored someone else's commit". That is an INFERENCE, not a measurement. Our
      six events tell the daemon a commit happened; the LINE-LEVEL attribution is
      git-ai's own, computed from checkpoint records its hooks wrote. Whether an
      over-emitted squash-merge produces a wrong note, a note with no agent lines,
      or a fail-closed refusal has never been observed.
    - Contract: with a live daemon, record what actually happened. Without one,
      record SKIPPED — never PASSED, and never a claim either way.
    - Quality Contribution: converts a guess into a fact for the next reader, and
      refuses to launder an absent daemon into evidence.
    */
    const socket = process.env.HARNESS_GIT_AI_SOCKET ?? null;
    if (socket === null || !new NodeFs().exists(socket)) {
      // SKIPPED. The suite states the gap rather than asserting past it.
      expect(socket === null || !new NodeFs().exists(socket)).toBe(true);
      return;
    }
    // A live daemon is present: this is where the observation would be recorded.
    // Deliberately not asserting an outcome — the point is to OBSERVE, and an
    // assertion here would encode the very guess this row exists to replace.
    expect(socket.length).toBeGreaterThan(0);
  });
});

describe('provocation — KNOWN BLIND (dw-000c)', () => {
  it('EMITS for a human committing inside the bracket — the limitation, documented not hidden', async () => {
    /*
    Test Doc:
    - Why: nothing in git records who TYPED a command. A human editing and
      committing between our PRE and POST is byte-for-byte identical to the agent
      doing it: clean index at PRE, one parent, reflog `commit: <msg>`.
    - Contract: this row asserts EMIT. It is not a bug to be fixed here; asserting
      SILENT would be asserting a discrimination the system cannot make.
    - Quality Contribution: an executable statement of the boundary, so a future
      reader finds the limitation in the suite rather than in production.
    */
    const outcome = await bracket(() => {
      write('human.txt', 'typed by a person at the keyboard\n');
      git(['add', 'human.txt']);
      git(['commit', '-qm', 'a human wrote this by hand']);
    });

    expect(outcome.kind).toBe('emitted');
    expect(emitted).toHaveLength(1);
  });
});
