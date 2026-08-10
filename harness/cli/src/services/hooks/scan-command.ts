/**
 * The COMMAND SCAN (plan 082 tk-000d) — the second guard layer.
 *
 * WHY IT EXISTS, measured rather than assumed. The index-at-PRE discriminator
 * separates content imported from elsewhere from content authored here — but only
 * when the import happened BEFORE the PRE fire that brackets the commit. Parsing
 * 76 captured Cursor PRE payloads on this machine (2026-08-09) shows that is not
 * how the agent commits. The last real commit run issued, as ONE Shell tool call:
 *
 *   git add -A && git commit --trailer "Co-authored-by: …" -m "…"
 *
 * Chained with `&&`, inside a single bracket. `git merge --squash X && git commit
 * -m …` is the same sentence with a different verb, and it sails straight through
 * the index check: PRE sees a CLEAN index because the merge has not run yet.
 *
 * So the bracket is interrogated directly. The same PRE record carries
 * `tool_input.command`, so when the command itself names a content-importing
 * operation, this bracket cannot be trusted to have authored what it commits.
 *
 * WHAT THIS BUYS, stated honestly: it NARROWS, it does not close. A script, a
 * shell function, an alias, a Makefile target, a heredoc, or a git command issued
 * by something other than the Shell tool all hide the operation from this scan.
 * Those cases still emit, and they are asserted as KNOWN-BLIND rows rather than
 * quietly hoped about.
 *
 * It is a SECOND LAYER over index-at-PRE, never a replacement — the two catch
 * different shapes (import-before-bracket vs import-inside-bracket) and neither
 * subsumes the other.
 *
 * DIRECTION: like every other check in this guard, it can only move the answer
 * TOWARD silence. It adds no new false-positive path — the worst it can do is
 * suppress a note that would have been correct.
 */

/**
 * Git subcommands that deliver content the bracket did not author.
 *
 * `checkout`, `restore` and `reset` are here because all three can pull content
 * from another ref into the working tree or index. They are also the most common
 * INNOCENT commands in the list — `git checkout -b foo` authors nothing and
 * imports nothing — so they are qualified below rather than blanket-matched.
 */
const IMPORTING = new Set([
  'merge',
  'cherry-pick',
  'revert',
  'am',
  'apply',
  'rebase',
  'read-tree',
  'subtree',
  'stash',
  'checkout',
  'restore',
  'reset',
  'pull',
]);

/** `stash` only imports on these; `git stash` (push) exports. */
const STASH_IMPORTING = new Set(['pop', 'apply']);

/**
 * Split a shell command line into the segments that run as separate commands.
 *
 * The defeater and the commit are DIFFERENT SEGMENTS of one line, so a scan that
 * only looks at the first token misses it every single time — which is precisely
 * the shape the captured payload showed. Splitting on `&&`, `||`, `;`, `|` and
 * newline is deliberately crude: this is a screen, not a shell parser, and it errs
 * toward finding more segments rather than fewer.
 */
export function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Tokens of one segment, with quotes stripped so `"merge"` cannot hide the verb. */
function tokens(segment: string): string[] {
  return segment
    .split(/\s+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
    .filter((token) => token.length > 0);
}

/**
 * Whether `command` names an operation that imports content this bracket did not
 * author. `null`/empty is NOT treated as safe by the caller — see
 * {@link CommandScan}.
 *
 * Matching is per segment and anchored at the git INVOCATION, so a commit MESSAGE
 * mentioning a verb cannot silence a real commit: in `git commit -m "merge the
 * configs"`, `merge` is an argument to `commit`, not a subcommand.
 */
export function commandImportsContent(command: string): boolean {
  for (const segment of commandSegments(command)) {
    const parts = tokens(segment);
    const gitAt = parts.findIndex((t) => t === 'git' || t.endsWith('/git'));
    if (gitAt === -1) continue;

    // Skip git's own global options (`-C <path>`, `-c k=v`, `--git-dir=…`) to
    // reach the subcommand.
    let i = gitAt + 1;
    while (i < parts.length && parts[i].startsWith('-')) {
      if (parts[i] === '-C' || parts[i] === '-c') i += 1;
      i += 1;
    }
    const subcommand = parts[i];
    if (subcommand === undefined || !IMPORTING.has(subcommand)) continue;

    const args = parts.slice(i + 1);
    if (subcommand === 'stash') {
      if (args.some((a) => STASH_IMPORTING.has(a))) return true;
      continue;
    }
    if (subcommand === 'checkout') {
      // `checkout -b foo` / `checkout foo` author nothing. `checkout <ref> -- <path>`
      // imports. The `--` pathspec separator is the honest signal.
      if (args.includes('--')) return true;
      continue;
    }
    if (subcommand === 'restore') {
      // `restore --source <ref>` imports from elsewhere; a bare `restore <path>`
      // reverts to the index, which this bracket already owns.
      if (args.some((a) => a === '--source' || a.startsWith('--source='))) return true;
      continue;
    }
    if (subcommand === 'reset') {
      // A soft/mixed reset to another ref stages content from it. `reset` alone
      // (unstage) imports nothing.
      if (args.some((a) => !a.startsWith('-') && a !== '--')) return true;
      continue;
    }
    return true;
  }
  return false;
}

/**
 * What the runtime knows about the bracket's command.
 *
 * `unavailable` is NOT the same as "no import found", and the difference is the
 * whole reason this is three-valued: a payload we could not read tells us nothing
 * about the bracket, and a guard whose safe direction is silence must not treat an
 * absent reading as an all-clear.
 */
export type CommandScan = 'imports-content' | 'authors-only' | 'unavailable';

/** Classify the bracket's command. `null`/blank is `unavailable`, never `authors-only`. */
export function scanCommand(command: string | null | undefined): CommandScan {
  if (typeof command !== 'string' || command.trim().length === 0) return 'unavailable';
  return commandImportsContent(command) ? 'imports-content' : 'authors-only';
}
