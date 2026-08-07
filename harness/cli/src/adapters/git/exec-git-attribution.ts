import { spawnSync } from 'node:child_process';
import { GIT_MAX_BUFFER } from './exec-git-limits.js';
import type { CommitResult, CommitWindow, GitAttributionPort } from './git-attribution-port.js';

/**
 * The real {@link GitAttributionPort} (plan 074) — `spawnSync` with an ARGV
 * ARRAY, which is `execFile` semantics: no shell, ever. A commit message reaches
 * git as one argument, so nothing in it can be interpreted as a command
 * (ac-0005). The adapter is the ONLY place in this feature that spawns a child.
 *
 * Every read is fail-safe (a git that errors reads as "no information"), and the
 * one WRITE — {@link commit} — is fail-honest: its exit code is returned
 * verbatim and never swallowed, because a caller must be able to tell a commit
 * that did not happen from one that did.
 */
export class ExecGitAttribution implements GitAttributionPort {
  constructor(
    private readonly cwd?: string,
    private readonly timeoutMs = 30_000,
  ) {}

  private run(args: string[], env?: Record<string, string>) {
    return spawnSync('git', args, {
      ...(this.cwd !== undefined && { cwd: this.cwd }),
      encoding: 'utf8',
      timeout: this.timeoutMs,
      maxBuffer: GIT_MAX_BUFFER,
      ...(env !== undefined && { env: { ...process.env, ...env } }),
    });
  }

  private result(args: string[], env?: Record<string, string>): CommitResult {
    const r = this.run(args, env);
    const code = r.status ?? 1;
    return {
      ok: code === 0,
      code,
      sha: null,
      stdout: (r.stdout ?? '').trim(),
      stderr: (r.stderr ?? '').trim(),
    };
  }

  /** A read whose failure is indistinguishable from emptiness — trimmed stdout, or `null`. */
  private readLine(args: string[]): string | null {
    const r = this.run(args);
    if (r.status !== 0) return null;
    const value = (r.stdout ?? '').trim();
    return value === '' ? null : value;
  }

  globalTrace2Target(): string | null {
    return this.readLine(['config', '--global', '--get', 'trace2.eventTarget']);
  }

  stage(pathspecs: readonly string[]): CommitResult {
    // `--` terminates option parsing, so a pathspec starting with `-` is a path
    // and not a flag. Cheap, and the alternative is a real injection surface.
    return this.result(['add', '--', ...pathspecs]);
  }

  stagedPaths(): string[] {
    const out = this.readLine(['diff', '--cached', '--name-only']);
    return out === null ? [] : out.split('\n').filter((line) => line.trim() !== '');
  }

  /**
   * Commit, then read the sha back. The two are SEPARATE facts and are reported
   * as such (review F007): `ok` is git's own exit code for the commit, and `sha`
   * is `null` when — and only when — reading `HEAD` afterwards failed. A caller
   * must never collapse `sha === null` into "the commit failed", because a
   * successful commit with an unreadable HEAD is a commit that is really in the
   * history, and telling the operator otherwise invites a double commit.
   */
  commit(message: string, env?: Record<string, string>): CommitResult {
    const outcome = this.result(['commit', '-m', message], env);
    if (!outcome.ok) return outcome;
    return { ...outcome, sha: this.headSha() };
  }

  hasAiNote(sha: string): boolean {
    return this.run(['notes', '--ref=ai', 'show', sha]).status === 0;
  }

  /**
   * `git notes --ref=ai list` prints `<noteBlobSha> <annotatedObjectSha>` per
   * line; the SECOND column is the commit. An unborn notes ref simply exits
   * non-zero, which reads here as "nothing is annotated" — correct, and never an
   * error.
   */
  listNotedShas(): string[] {
    const out = this.readLine(['notes', '--ref=ai', 'list']);
    if (out === null) return [];
    return out
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((sha): sha is string => sha !== undefined && sha !== '');
  }

  headSha(): string | null {
    return this.readLine(['rev-parse', 'HEAD']);
  }

  /**
   * Resolve the window ac-0003 specifies: everything ahead of
   * `merge-base(HEAD, origin/<default-branch>)`, capped; otherwise the most
   * recent `fallback` commits.
   *
   * The default branch is read from `origin/HEAD`, which is what `git remote set-head`
   * records. A repo with no origin, no `origin/HEAD`, or no merge-base takes the
   * fallback — and says so, because "nothing unattributed here" is a much weaker
   * claim under a 50-commit tail than under a real branch window.
   */
  commitWindow(cap: number, fallback: number): CommitWindow {
    const originHead = this.readLine(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const base = originHead === null ? null : this.readLine(['merge-base', 'HEAD', originHead]);
    if (originHead !== null && base !== null) {
      const out = this.readLine(['rev-list', `--max-count=${cap}`, `${base}..HEAD`]);
      return {
        shas: out === null ? [] : out.split('\n').filter((line) => line.trim() !== ''),
        rule: 'merge-base',
        detail: `commits ahead of merge-base(HEAD, ${originHead}), capped at ${cap}`,
      };
    }
    const out = this.readLine(['rev-list', `--max-count=${fallback}`, 'HEAD']);
    return {
      shas: out === null ? [] : out.split('\n').filter((line) => line.trim() !== ''),
      rule: 'recent-fallback',
      detail: `no upstream merge-base available — the last ${fallback} commits on HEAD`,
    };
  }
}
