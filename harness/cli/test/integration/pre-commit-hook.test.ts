import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/*
Test Doc:
- Why: plan 068 phase 2 adds a `pre-commit` hook, and git HONOURS pre-commit's exit code —
  unlike post-commit's, which git ignores. Every safety property of this file is therefore
  something we build, not something we inherit, so every one of them is proven here against
  the REAL `.githooks/pre-commit` running in a throwaway repo — never a paraphrase of it.
- Contract (the o-prime's binding conditions):
    C1  `trap 'exit 0' EXIT` is the first executable line and `set -u` is banned — an injected
        unbound variable must still exit 0 AND the commit must land. Paired with a known-bad
        control (same injection, trap removed) that EATS the commit, so the assertion has been
        seen to fail.
    C2  `git commit --amend` fires the hook; the disposition is DEDUPE (skip), and skipping is
        proven LOSSLESS — the same work is still captured by the next fire.
    C4  the hook records its own wall duration where `harness doctor` can read it.
    C5  both kill switches, both directions: no-op when set, and DOES capture when unset (the
        half that gets skipped, and without which a permanently broken hook passes forever).
- Usage Notes: the throwaway repo carries a one-line shim at the exact path the hook resolves
  (`harness/cli/bin/harness.js`) which re-exports the real built CLI, so the hook's own bin
  resolution is exercised rather than stubbed. A copilot session is simulated with `$HOME` +
  `COPILOT_AGENT_SESSION_ID` and the committed copilot events fixture; APPENDING to that file
  is what advances the capture window, which is what makes a capture possible at all — every
  "did not capture" assertion below is taken with the window advanced, so it is a real no-op
  and not a vacuous one.
- Quality Contribution: this hook sits on the critical path of every commit in every clone that
  ran `just install-hooks`. These are the tests that stand between it and someone's lost work.
*/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const distEntry = join(repoRoot, 'harness/cli/dist/index.js');
const hookSource = join(repoRoot, '.githooks/pre-commit');
const eventsFixture = join(
  repoRoot,
  'harness/cli/test/services/telemetry/fixtures/copilot-events.jsonl',
);
const SESSION = 'sess-precommit-hook';

interface Sandbox {
  repo: string;
  home: string;
  events: string;
  telemetryDir: string;
}

/** A throwaway git repo wired exactly the way an installed clone is (`core.hooksPath=.githooks`). */
function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'harness-precommit-'));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const sessionDir = join(home, '.copilot/session-state', SESSION);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  mkdirSync(join(repo, 'harness/cli/bin'), { recursive: true });
  copyFileSync(eventsFixture, join(sessionDir, 'events.jsonl'));
  copyFileSync(hookSource, join(repo, '.githooks/pre-commit'));
  execFileSync('chmod', ['+x', join(repo, '.githooks/pre-commit')]);
  // The shim lives at the EXACT path the hook resolves, so bin resolution is real.
  writeFileSync(
    join(repo, 'harness/cli/bin/harness.js'),
    `import(${JSON.stringify(distEntry)});\n`,
  );
  git(repo, ['init', '-q', '-b', 'main', '.']);
  git(repo, ['config', 'user.email', 'hook@test.invalid']);
  git(repo, ['config', 'user.name', 'hook test']);
  git(repo, ['config', 'core.hooksPath', '.githooks']);
  return {
    repo,
    home,
    events: join(sessionDir, 'events.jsonl'),
    telemetryDir: join(repo, '.harness/temp/telemetry', SESSION),
  };
}

/** git, with the ambient agent session scrubbed so only what a test sets is visible to capture. */
function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const leaked of [
    'CLAUDE_CODE_SESSION_ID',
    'CURSOR_CONVERSATION_ID',
    'AI_AGENT',
    'HARNESS_TELEMETRY_DEPTH',
    'HARNESS_PLAN_ID',
  ]) {
    delete env[leaked];
  }
  if (!(('HARNESS_NO_TELEMETRY' as string) in extraEnv)) delete env.HARNESS_NO_TELEMETRY;
  // Plan 073: the capture opt-in is scrubbed the same way, so a test that does not
  // ask for capture genuinely runs as a default install rather than inheriting one.
  if (!(('HARNESS_TELEMETRY_CAPTURE' as string) in extraEnv)) delete env.HARNESS_TELEMETRY_CAPTURE;
  if (!(('COPILOT_AGENT_SESSION_ID' as string) in extraEnv)) delete env.COPILOT_AGENT_SESSION_ID;
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Session env for a capture-eligible commit.
 *
 * Plan 073 flipped harness capture OFF by default, so "capture-eligible" now
 * means a live session AND the explicit opt-in — the same two things a migrating
 * operator sets. The shipped default (opt-in absent) has its own test below, so
 * the flip is proved at the hook rather than assumed from the unit tests.
 */
function sessionEnv(box: Sandbox, extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: box.home,
    COPILOT_AGENT_SESSION_ID: SESSION,
    HARNESS_TELEMETRY_CAPTURE: '1',
    ...extra,
  };
}

/** The shipped default: a live session with NO telemetry env set at all. */
function defaultInstallEnv(box: Sandbox): Record<string, string> {
  return { HOME: box.home, COPILOT_AGENT_SESSION_ID: SESSION };
}

/** Advance the transcript window — WITHOUT this, capture correctly spools nothing. */
function advanceWindow(box: Sandbox): void {
  const first = readFileSync(box.events, 'utf8').split('\n')[0] ?? '';
  writeFileSync(box.events, `${readFileSync(box.events, 'utf8')}${first}\n`);
}

function segments(box: Sandbox): string[] {
  if (!existsSync(box.telemetryDir)) return [];
  return readdirSync(box.telemetryDir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort();
}

/** Stage a new file and commit; returns the resulting HEAD. */
function commit(
  box: Sandbox,
  file: string,
  env: Record<string, string>,
  args: string[] = [],
): string {
  writeFileSync(join(box.repo, file), `${file}\n`);
  git(box.repo, ['add', '-A'], env);
  // Extra flags go in FLAG POSITION, before `-m`, because that is how humans and
  // scripts write them (`git commit --amend --no-edit`) and because the hook can
  // only scan the argv prefix ahead of the message. The reverse ordering is a
  // real, deliberately-degraded case — it has its own test, so it must not also
  // be smuggled in here as the default.
  git(box.repo, ['commit', '-q', ...args, '-m', file], env);
  return git(box.repo, ['rev-parse', 'HEAD'], env).trim();
}

describe.skipIf(process.platform === 'win32')(
  'pre-commit telemetry capture hook (plan 068 phase 2)',
  () => {
    beforeAll(() => {
      if (!existsSync(distEntry)) {
        execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' });
      }
    }, 180_000);

    it('C5 positive — with both switches UNSET the hook captures a segment', () => {
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      expect(segments(box).length).toBe(1);
    }, 60_000);

    it('anchors the segment to the commit the work was BASED on (the whole point of the hook)', () => {
      /*
    Test Doc:
    - Why: the hook exists because `product_commit` captured AFTER HEAD moves anchors evidence
      one commit late. If the anchor were wrong this whole phase would be theatre.
    - Contract: the segment spooled during commit N carries product_commit === HEAD before N.
    */
      const box = sandbox();
      const base = commit(box, 'a.txt', sessionEnv(box));
      advanceWindow(box);
      commit(box, 'b.txt', sessionEnv(box));
      const spooled = segments(box);
      expect(spooled.length).toBe(2);
      const last = JSON.parse(
        readFileSync(join(box.telemetryDir, spooled[spooled.length - 1] as string), 'utf8'),
      );
      expect(last.product_commit).toBe(base);
    }, 60_000);

    it('plan 073 — a DEFAULT install captures nothing, even from a live session', () => {
      /*
    Test Doc:
    - Why: the collector handover is only real if the shipped default is silent at the
      hook too — this is the path that fires on every commit of every repo.
    - Contract: a live agent session with NO telemetry env set spools zero segments;
      the SAME work spools the moment the opt-in is set (non-vacuity).
    */
      const box = sandbox();
      commit(box, 'a.txt', defaultInstallEnv(box));
      expect(segments(box).length).toBe(0);
      commit(box, 'b.txt', sessionEnv(box));
      expect(segments(box).length).toBe(1);
    }, 60_000);

    it('C5 negative — HARNESS_NO_TELEMETRY=1 is a no-op even though the window advanced', () => {
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      expect(segments(box).length).toBe(1);
      advanceWindow(box);
      commit(box, 'b.txt', sessionEnv(box, { HARNESS_NO_TELEMETRY: '1' }));
      expect(segments(box).length).toBe(1);
      // …and the SAME pending work captures the moment the switch comes off (non-vacuity).
      commit(box, 'c.txt', sessionEnv(box));
      expect(segments(box).length).toBe(2);
    }, 60_000);

    it('C5 negative — HARNESS_NO_TELEMETRY_PRECOMMIT=1 disarms only this hook', () => {
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      advanceWindow(box);
      commit(box, 'b.txt', sessionEnv(box, { HARNESS_NO_TELEMETRY_PRECOMMIT: '1' }));
      expect(segments(box).length).toBe(1);
      commit(box, 'c.txt', sessionEnv(box));
      expect(segments(box).length).toBe(2);
    }, 60_000);

    it('C2 — `git commit --amend` FIRES the hook but is deduped, and the skip is LOSSLESS', () => {
      /*
    Test Doc:
    - Why: on amend HEAD is the commit about to be DISCARDED, so a capture there anchors
      evidence to an object that is about to become unreachable.
    - Contract: the amend spools nothing, AND the work pending at amend time is still spooled
      by the next fire — the disposition is dedupe, not data loss. The second half is what
      makes "we skip it" an argument rather than an excuse.
    */
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      const before = segments(box).length;
      advanceWindow(box);
      commit(box, 'b.txt', sessionEnv(box), ['--amend', '--no-edit']);
      expect(segments(box).length).toBe(before);
      commit(box, 'c.txt', sessionEnv(box));
      expect(segments(box).length).toBe(before + 1);
    }, 60_000);

    it('C2 — all four amend abbreviations dedupe in flag position, and a message MENTIONING --am is not one', () => {
      /*
    Test Doc:
    - Why: git accepts any unambiguous prefix (`--am`/`--ame`/`--amen`/`--amend` all amend;
      `--a` is ambiguous and rejected — measured), so a full-spelling-only matcher would let
      an abbreviated amend anchor evidence to a discarded commit. The mirror risk is a false
      positive: the invoking argv carries the commit MESSAGE, so a substring matcher would let
      `-m "use --among other flags"` silently disarm the hook on an ordinary commit. Tokens,
      not substrings.
    - Contract: every accepted abbreviation, in flag position, spools nothing; an ordinary
      commit whose message contains `--among` captures normally.
    */
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      const before = segments(box).length;
      for (const abbreviation of ['--am', '--ame', '--amen', '--amend']) {
        advanceWindow(box);
        writeFileSync(join(box.repo, `b-${abbreviation}.txt`), 'b\n');
        git(box.repo, ['add', '-A'], sessionEnv(box));
        git(box.repo, ['commit', '-q', abbreviation, '--no-edit'], sessionEnv(box));
        expect(segments(box).length).toBe(before);
      }
      writeFileSync(join(box.repo, 'c.txt'), 'c\n');
      git(box.repo, ['add', '-A'], sessionEnv(box));
      git(box.repo, ['commit', '-q', '-m', 'use --among other flags'], sessionEnv(box));
      expect(segments(box).length).toBe(before + 1);
    }, 60_000);

    it('C2 — a message CONTAINING the real `--amend` token still captures (terra reproduction)', () => {
      /*
    Test Doc:
    - Why: this is the reviewed HIGH, verbatim. `ps -o args=` renders the invoking argv
      SPACE-JOINED, so a commit message is indistinguishable from a flag; a whole-token
      matcher over the whole string therefore deduped the ORDINARY commit
      `-m "use --amend in a message"`. The `--among` case above does NOT exercise this —
      that string never contains the real token — which is precisely why the bug survived
      a test that looked like it covered the area.
    - Consequence being prevented: a skipped capture on a plain commit, so the pending
      window anchors to a LATER HEAD. That is the attribution skew this hook exists to
      remove, produced by the hook itself.
    - Contract: the commit captures — two segments, not one — and the message is preserved
      verbatim, proving the guard was exercised rather than the message being mangled.
    */
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      const before = segments(box).length;
      advanceWindow(box);
      writeFileSync(join(box.repo, 'b.txt'), 'b\n');
      git(box.repo, ['add', '-A'], sessionEnv(box));
      git(box.repo, ['commit', '-q', '-m', 'use --amend in a message'], sessionEnv(box));
      expect(segments(box).length).toBe(before + 1);
      expect(git(box.repo, ['log', '-1', '--pretty=%s'], sessionEnv(box)).trim()).toBe(
        'use --amend in a message',
      );
    }, 60_000);

    it('C2 — a genuine `--amend` written AFTER -m degrades to CAPTURE, the declared safe direction', () => {
      /*
    Test Doc:
    - Why: the matcher can only scan the argv prefix BEFORE the first message-bearing flag,
      because everything after it may be prose. A real amend written after `-m` therefore
      falls outside the scanned prefix and is NOT recognised. This test exists to name that
      residual error rather than let it be discovered later as a surprise.
    - Which way it fails matters, and this asserts the direction: we CAPTURE. The cost is
      noise — one segment anchored to a SHA that is about to be discarded — versus the
      opposite error's cost, a silently skipped capture on an ordinary commit. Noise is
      recoverable; a missing anchor is the fault we were hired to fix.
    - Contract: the amend really amends (history does not grow), and a segment IS spooled.
    */
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      const before = segments(box).length;
      const heightBefore = git(box.repo, ['rev-list', '--count', 'HEAD'], sessionEnv(box)).trim();
      advanceWindow(box);
      writeFileSync(join(box.repo, 'b.txt'), 'b\n');
      git(box.repo, ['add', '-A'], sessionEnv(box));
      git(box.repo, ['commit', '-q', '-m', 'amended subject', '--amend'], sessionEnv(box));
      expect(git(box.repo, ['rev-list', '--count', 'HEAD'], sessionEnv(box)).trim()).toBe(
        heightBefore,
      );
      expect(segments(box).length).toBe(before + 1);
    }, 60_000);

    it('C2 — an amend flag sitting IMMEDIATELY before -m still dedupes (truncation boundary)', () => {
      /*
    Test Doc:
    - Why: the fix cuts the scanned argv at the first message-bearing flag, and the step-2
      patterns match whole tokens by requiring a space on BOTH sides. Cutting removes the
      separator, so an amend flag in the LAST prefix position loses its right-hand space and
      stops matching — a real amend would then be captured. Nothing else in this file pins
      that boundary: every other amend case has a following token (`--no-edit`) or no `-m`
      at all, so the defect survived the whole suite. Found by mutation, not by reading.
    - Contract: `git commit --amend -m <msg>` — amend flag directly abutting the cut point —
      spools nothing, for every accepted abbreviation.
    */
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      const before = segments(box).length;
      for (const abbreviation of ['--am', '--ame', '--amen', '--amend']) {
        advanceWindow(box);
        writeFileSync(join(box.repo, `b-${abbreviation}.txt`), 'b\n');
        git(box.repo, ['add', '-A'], sessionEnv(box));
        git(
          box.repo,
          ['commit', '-q', abbreviation, '-m', `amended via ${abbreviation}`],
          sessionEnv(box),
        );
        expect(segments(box).length).toBe(before);
      }
    }, 60_000);

    it('C4 — each fire records its own wall duration where doctor can read it', () => {
      const box = sandbox();
      commit(box, 'a.txt', sessionEnv(box));
      const samples = join(box.repo, '.harness/temp/precommit-latency.tsv');
      expect(existsSync(samples)).toBe(true);
      const lines = readFileSync(samples, 'utf8').trim().split('\n');
      expect(lines.length).toBe(1);
      const [stamp, duration] = (lines[0] as string).split('\t');
      expect(Number(stamp)).toBeGreaterThan(0);
      expect(Number(duration)).toBeGreaterThanOrEqual(0);
      // The sample file is transient by construction — never staged, never committed.
      expect(git(box.repo, ['status', '--short'], sessionEnv(box)).trim()).toBe('');
    }, 60_000);

    it('C1 — an injected unbound variable still exits 0 and the commit LANDS', () => {
      /*
    Test Doc:
    - Why: this is the condition that changed the design. `set -u` aborts BEFORE any `|| true`
      guard or trailing `exit 0`, so exit-0 has to be structural. Injecting the banned idiom
      into the real hook is the only honest way to show the trap actually defeats it.
    - Contract: real hook + `set -u; echo "$UNBOUND"` right after the trap → exit 0, commit lands.
    */
      const box = sandbox();
      const hook = join(box.repo, '.githooks/pre-commit');
      const body = readFileSync(hook, 'utf8').replace(
        "trap 'exit 0' EXIT\n",
        'trap \'exit 0\' EXIT\nset -u\necho "$HARNESS_DEFINITELY_UNBOUND_VARIABLE"\n',
      );
      writeFileSync(hook, body);
      expect(body).toContain('HARNESS_DEFINITELY_UNBOUND_VARIABLE'); // the injection landed
      commit(box, 'a.txt', sessionEnv(box));
      expect(git(box.repo, ['log', '--oneline'], sessionEnv(box))).toContain('a.txt');
    }, 60_000);

    it('C1 known-bad control — the SAME injection without the trap EATS the commit', () => {
      /*
    Test Doc:
    - Why: an assertion that has never failed is not yet a control. This is the failing shape
      of the test above, and it is the o-prime's measured incident reproduced in CI.
    */
      const box = sandbox();
      const hook = join(box.repo, '.githooks/pre-commit');
      const body = readFileSync(hook, 'utf8').replace(
        "trap 'exit 0' EXIT\n",
        'set -u\necho "$HARNESS_DEFINITELY_UNBOUND_VARIABLE"\n',
      );
      writeFileSync(hook, body);
      writeFileSync(join(box.repo, 'a.txt'), 'a\n');
      git(box.repo, ['add', '-A'], sessionEnv(box));
      expect(() => git(box.repo, ['commit', '-q', '-m', 'a.txt'], sessionEnv(box))).toThrow();
      expect(() => git(box.repo, ['rev-parse', 'HEAD'], sessionEnv(box))).toThrow(); // nothing landed
    }, 60_000);

    it('C1 structural — the trap is the FIRST executable line and `set -u` is absent', () => {
      /*
    Test Doc:
    - Why: the two tests above prove the trap works; this one stops it from drifting to line 90
      behind some "quick" guard, where an interior failure would escape it again.
    - Contract: the first non-comment, non-blank line of the shipped hook is `trap 'exit 0' EXIT`,
      and no `set -u`/`set -eu`-family line appears anywhere in the file.
    */
      const lines = readFileSync(hookSource, 'utf8').split('\n');
      const firstExecutable = lines.find((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
      expect(firstExecutable).toBe("trap 'exit 0' EXIT");
      for (const line of lines) {
        expect(line.trimStart()).not.toMatch(/^set\s+-[a-z]*[eu]/);
      }
    });

    it('never syncs or pushes — it runs the harness with NO verb, outside housekeeping scope', () => {
      /*
    Test Doc:
    - Why: capture-only is the safety claim that separates this hook from the removed pre-push
      gate. Telemetry housekeeping (the only auto-push path) is scoped to boot/checks/doctor,
      so invoking a VERB here would put this hook one rename away from pushing on every commit.
    - Contract: the hook's node invocation carries no verb, and mentions neither sync nor push.
    */
      const body = readFileSync(hookSource, 'utf8');
      const invocation = body
        .split('\n')
        .filter((l) => l.trimStart().startsWith('node '))
        .join('\n');
      expect(invocation).toContain('node "$bin" --json --no-extensions');
      expect(invocation).not.toMatch(/telemetry|sync|push|checks/);
    });
  },
);
