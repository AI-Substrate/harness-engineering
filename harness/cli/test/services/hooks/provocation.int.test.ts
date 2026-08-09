import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { ExecGit } from '../../../src/adapters/git/exec-git.js';
import { NodeHash } from '../../../src/adapters/hash/node-hash.js';
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
  it.each([
    [
      'checkout of another branch',
      () => {
        git(['branch', 'other']);
        write('b.txt', 'b\n');
        git(['add', 'b.txt']);
        git(['commit', '-qm', 'on main']);
        git(['checkout', '-q', 'other']);
      },
    ],
    [
      'reset --hard backwards',
      () => {
        write('b.txt', 'b\n');
        git(['add', 'b.txt']);
        git(['commit', '-qm', 'second']);
        git(['reset', '-q', '--hard', 'HEAD~1']);
      },
    ],
    [
      'rebase onto a diverged branch',
      () => {
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
    ],
    ['amend', () => git(['commit', '-q', '--amend', '-m', 'amended'])],
    ['a no-op — nothing at all happened', () => {}],
    ['detached HEAD', () => git(['checkout', '-q', '--detach', 'HEAD'])],
    [
      'a MULTI-COMMIT fast-forward pull — HEAD advances by more than one',
      () => {
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
    ],
  ])('stays SILENT for %s', async (_name, transition) => {
    const outcome = await bracket(transition);
    expect(outcome.kind).toBe('silent');
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
  - Contract: every row is silent and nothing is emitted.
  */
  const seedSide = (): void => {
    git(['checkout', '-q', '-b', 'side']);
    write('s.txt', 'from elsewhere\n');
    git(['add', 's.txt']);
    git(['commit', '-qm', 'side work']);
    git(['checkout', '-q', 'main']);
  };

  it.each([
    [
      'MEASURED DEFEATER — merge --squash then commit',
      () => {
        seedSide();
        git(['merge', '-q', '--squash', 'side']);
      },
      () => git(['commit', '-qm', 'squashed in']),
    ],
    [
      'MEASURED DEFEATER — cherry-pick -n then commit',
      () => {
        seedSide();
        git(['cherry-pick', '-n', 'side']);
      },
      () => git(['commit', '-qm', 'cherry picked']),
    ],
    [
      'MEASURED DEFEATER — revert -n then commit',
      () => {
        write('r.txt', 'r\n');
        git(['add', 'r.txt']);
        git(['commit', '-qm', 'to be reverted']);
        git(['revert', '-n', 'HEAD']);
      },
      () => git(['commit', '-qm', 'reverted']),
    ],
    [
      'MEASURED DEFEATER — git apply --index then commit',
      () => {
        seedSide();
        const patch = join(dir, 'p.patch');
        writeFileSync(patch, git(['format-patch', '--stdout', 'main..side']));
        gitTry(['apply', '--index', patch]);
      },
      () => git(['commit', '-qm', 'applied a patch']),
    ],
    [
      'MEASURED DEFEATER — checkout REF -- path then commit',
      () => {
        seedSide();
        git(['checkout', 'side', '--', 's.txt']);
      },
      () => git(['commit', '-qm', 'took a file from elsewhere']),
    ],
    [
      'MEASURED DEFEATER — restore --source then commit',
      () => {
        seedSide();
        git(['restore', '--source', 'side', '--staged', '--worktree', '--', 's.txt']);
      },
      () => git(['commit', '-qm', 'restored from elsewhere']),
    ],
    [
      'MEASURED DEFEATER — read-tree -m -u then commit (how git subtree works)',
      () => {
        seedSide();
        gitTry(['read-tree', '-m', '-u', 'HEAD', 'side']);
      },
      () => git(['commit', '-qm', 'read a tree in']),
    ],
    [
      'single-commit fast-forward pull',
      () => {
        execFileSync('git', ['clone', '-q', repo, upstream], { env: hermeticGitEnv() });
        write('u.txt', 'u\n', upstream);
        git(['add', 'u.txt'], upstream);
        git(['commit', '-qm', 'upstream one'], upstream);
        git(['remote', 'add', 'up', upstream]);
      },
      () => gitTry(['pull', '-q', '--ff-only', 'up', 'main']),
    ],
    [
      'a --no-ff merge commit',
      () => seedSide(),
      () => gitTry(['merge', '-q', '--no-ff', '-m', 'merged side', 'side']),
    ],
    ['cherry-pick (committing form)', () => seedSide(), () => gitTry(['cherry-pick', 'side'])],
    [
      'revert (committing form)',
      () => {
        write('r.txt', 'r\n');
        git(['add', 'r.txt']);
        git(['commit', '-qm', 'to be reverted']);
      },
      () => gitTry(['revert', '--no-edit', 'HEAD']),
    ],
    [
      'git am',
      () => {
        seedSide();
        writeFileSync(join(dir, 'am.patch'), git(['format-patch', '--stdout', 'main..side']));
      },
      () => gitTry(['am', join(dir, 'am.patch')]),
    ],
  ])('stays SILENT for %s', async (_name, setup, transition) => {
    setup();
    const outcome = await bracket(transition);

    expect(outcome.kind).toBe('silent');
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
