import { spawnSync } from 'node:child_process';
import { type GitWritePort, TELEMETRY_FALLBACK_AUTHOR, type TreeEntry } from './git-write-port.js';

/**
 * Real git WRITE plumbing (plan 034 Phase 4) — wraps `hash-object` / `mktree` /
 * `commit-tree` / `update-ref` / `push`. Pure plumbing: it writes objects + the
 * orphan ref WITHOUT ever staging (`git add`) or checking anything out, so a
 * telemetry flush leaves the index and working tree byte-identical (AC-06).
 *
 * ATTRIBUTION (2026-06-25 decision): `commitTree` lets git use the contributor's
 * configured identity, so a telemetry ref is traceable to who pushed it. It only
 * injects {@link TELEMETRY_FALLBACK_AUTHOR} via `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
 * env when the repo has NO configured `user.name`/`user.email`, so an unconfigured
 * environment never fails the commit.
 *
 * `cwd` is injectable (default `process.cwd()`) so the integration test can point
 * the adapter at a throwaway repo; the composition root uses `new ExecGitWrite()`.
 *
 * `timeoutMs` bounds every git invocation (default 10s) — a defensive guard so a
 * network black-hole during a push can never hang the host command (notably the
 * `checks` auto-sync). On timeout `spawnSync` returns a non-zero/`null` status, so
 * the affected method throws and the fail-safe sync-service rolls back + retries
 * next time.
 */
export class ExecGitWrite implements GitWritePort {
  constructor(
    private readonly cwd?: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private run(args: string[], input?: string, extraEnv?: NodeJS.ProcessEnv) {
    return spawnSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      ...(input !== undefined && { input }),
      ...(extraEnv && { env: { ...process.env, ...extraEnv } }),
    });
  }

  hashObject(content: string): string {
    const r = this.run(['hash-object', '-w', '--stdin'], content);
    if (r.status !== 0) throw new Error(`git hash-object failed: ${r.stderr?.trim()}`);
    return r.stdout.trim();
  }

  mktree(entries: TreeEntry[]): string {
    // `git mktree` reads `<mode> SP <type> SP <sha> TAB <name>` lines on stdin.
    const input = entries.map((e) => `${e.mode} ${e.type} ${e.sha}\t${e.name}\n`).join('');
    const r = this.run(['mktree'], input);
    if (r.status !== 0) throw new Error(`git mktree failed: ${r.stderr?.trim()}`);
    return r.stdout.trim();
  }

  refTip(ref: string): string | null {
    const r = this.run(['rev-parse', '--verify', '--quiet', ref]);
    if (r.status !== 0) return null;
    const sha = r.stdout.trim();
    return sha.length > 0 ? sha : null;
  }

  refTree(ref: string): string | null {
    // LOCAL peel of the ref's own commit to its tree — no remote contact.
    const r = this.run(['rev-parse', '--verify', '--quiet', `${ref}^{tree}`]);
    if (r.status !== 0) return null;
    const sha = r.stdout.trim();
    return sha.length > 0 ? sha : null;
  }

  commitTree(tree: string, parent: string | null, message: string): string {
    const args = ['commit-tree', tree, '-m', message];
    if (parent !== null) args.push('-p', parent);
    // Attributable: a `undefined` env lets `git commit-tree` use the contributor's
    // configured identity. Only an unconfigured repo gets the fallback injected.
    const r = this.run(args, undefined, this.fallbackIdentityEnv());
    if (r.status !== 0) throw new Error(`git commit-tree failed: ${r.stderr?.trim()}`);
    return r.stdout.trim();
  }

  /**
   * `undefined` in the normal case → git uses the contributor's configured
   * `user.name`/`user.email` (attributable). Returns the {@link
   * TELEMETRY_FALLBACK_AUTHOR} env override ONLY when neither is configured, so the
   * commit never fails for lack of an identity.
   */
  private fallbackIdentityEnv(): NodeJS.ProcessEnv | undefined {
    const name = this.run(['config', 'user.name']);
    const email = this.run(['config', 'user.email']);
    const configured =
      name.status === 0 &&
      name.stdout.trim() !== '' &&
      email.status === 0 &&
      email.stdout.trim() !== '';
    if (configured) return undefined;
    return {
      GIT_AUTHOR_NAME: TELEMETRY_FALLBACK_AUTHOR.name,
      GIT_AUTHOR_EMAIL: TELEMETRY_FALLBACK_AUTHOR.email,
      GIT_COMMITTER_NAME: TELEMETRY_FALLBACK_AUTHOR.name,
      GIT_COMMITTER_EMAIL: TELEMETRY_FALLBACK_AUTHOR.email,
    };
  }

  updateRef(ref: string, newSha: string, oldSha: string | null): boolean {
    // An empty oldvalue ("") asserts the ref must not currently exist (orphan
    // create); a concrete oldSha is the compare-and-set. A non-zero exit = the
    // tip moved (a concurrent writer) → the caller re-reads + retries.
    const r = this.run(['update-ref', ref, newSha, oldSha ?? '']);
    return r.status === 0;
  }

  deleteRef(ref: string): void {
    this.run(['update-ref', '-d', ref]);
  }

  push(refspec: string): void {
    const r = this.run(['push', 'origin', refspec]);
    if (r.status !== 0) throw new Error(`git push failed: ${r.stderr?.trim()}`);
  }
}
