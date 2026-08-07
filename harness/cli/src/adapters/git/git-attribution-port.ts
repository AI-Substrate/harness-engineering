/**
 * Git ATTRIBUTION port (plan 074) — the narrow slice of git that the sandbox
 * attribution work needs, and nothing else.
 *
 * A new port rather than methods bolted onto {@link GitPort} (informational
 * facts for doctor) or {@link GitWritePort} (telemetry ref plumbing), because
 * this is a genuinely different job: read `refs/notes/ai`, walk a bounded commit
 * window, and — the only mutating capability in the whole plan — stage and
 * commit on the caller's behalf with a controlled environment.
 *
 * Two properties are load-bearing:
 *
 * 1. **`execFile` semantics only.** Every implementation spawns `git` with an
 *    ARGV ARRAY and no shell. A commit message is data, never a fragment of a
 *    command line, so no message can ever be interpolated into a shell (ac-0005).
 * 2. **Environment is an explicit argument.** {@link GitAttributionPort.commit}
 *    takes the trace2 override as a parameter rather than reading it from
 *    ambient state, because the entire correctness of ac-0005 rests on WHICH
 *    branch set that variable — and a parameter is assertable in a test where
 *    ambient state is not.
 *
 * Injected, so every CI test drives {@link FakeGitAttribution}: no real repo, no
 * daemon, no network (ac-000a).
 */

/** The outcome of a `git commit` attempt. `sha` is present only when it succeeded. */
export interface CommitResult {
  ok: boolean;
  /** Exit code, verbatim. NEVER swallowed — a failed commit must surface honestly. */
  code: number;
  /** HEAD after a successful commit; `null` when the commit did not happen. */
  sha: string | null;
  stdout: string;
  stderr: string;
}

/** Which rule bounded an at-risk enumeration — reported, never guessed (ac-0003). */
export type CommitWindowRule = 'merge-base' | 'recent-fallback';

/** A bounded slice of history, with the rule that produced it. */
export interface CommitWindow {
  /** Commit shas, NEWEST FIRST. */
  shas: string[];
  rule: CommitWindowRule;
  /** Human phrasing of the bound actually applied (e.g. the merge-base ref, or `last 50`). */
  detail: string;
}

export interface GitAttributionPort {
  /**
   * The GLOBAL `trace2.eventTarget`, or `null` when unset.
   *
   * GLOBAL specifically, and this is a real constraint rather than a detail
   * (dossier F-08): git reads trace2 settings from SYSTEM and GLOBAL config plus
   * the environment ONLY — a repo-local `trace2.eventTarget` is ignored. So the
   * ingress cannot be reconfigured per repo, and the buffer path has to come
   * from the entrypoint's own environment.
   */
  globalTrace2Target(): string | null;

  /** Stage EXPLICIT pathspecs. There is no `--all` form on this port, by design (tk-0006). */
  stage(pathspecs: readonly string[]): CommitResult;

  /** Paths currently staged (`diff --cached --name-only`). `[]` when the index is clean. */
  stagedPaths(): string[];

  /**
   * Commit with `message`, overlaying `env` onto the inherited environment.
   *
   * `env` is how the buffered branch points trace2 at a file. Note that
   * `GIT_TRACE2_EVENT` REPLACES the configured target rather than adding to it —
   * which is exactly why ac-0005's connected and buffered branches are mutually
   * exclusive, not a belt-and-braces pair.
   */
  commit(message: string, env?: Record<string, string>): CommitResult;

  /** True when `sha` carries a `refs/notes/ai` note. Never throws. */
  hasAiNote(sha: string): boolean;

  /**
   * EVERY sha that carries a `refs/notes/ai` note, in ONE call.
   *
   * The at-risk enumeration walks up to 200 commits, and asking
   * {@link hasAiNote} per commit would be 200 child processes on a surface that
   * runs on every `doctor` — a diagnostic nobody would leave enabled. `git notes
   * list` answers the whole set in one spawn, so the cost is independent of the
   * window size. {@link hasAiNote} stays for the few-sha cases (commit verify,
   * nudge confirmation) where a targeted read is the cheaper shape.
   */
  listNotedShas(): string[];

  /** Current HEAD sha, or `null` (unborn branch / not a repo). */
  headSha(): string | null;

  /**
   * A bounded window of commits on the current branch, newest first.
   *
   * Implementations resolve `merge-base(HEAD, origin/<default-branch>)` and
   * return everything ahead of it capped at `cap`; when there is no upstream or
   * no merge-base they fall back to the most recent `fallback` commits. The rule
   * that applied comes back in the result, because "no unattributed commits
   * found" means something different under each one.
   */
  commitWindow(cap: number, fallback: number): CommitWindow;
}
