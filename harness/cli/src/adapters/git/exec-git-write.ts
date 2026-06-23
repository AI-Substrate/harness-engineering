import { spawnSync } from 'node:child_process';
import { type GitWritePort, TELEMETRY_AUTHOR, type TreeEntry } from './git-write-port.js';

/**
 * Real git WRITE plumbing (plan 034 Phase 4) — wraps `hash-object` / `mktree` /
 * `commit-tree` / `update-ref` / `push`. Pure plumbing: it writes objects + the
 * orphan ref WITHOUT ever staging (`git add`) or checking anything out, so a
 * telemetry flush leaves the index and working tree byte-identical (AC-06).
 *
 * §T1 (AC-07/13): `commitTree` forces author AND committer to
 * {@link TELEMETRY_AUTHOR} via `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env on the spawn —
 * the repo's `git config user.email` is never read, so no individual identity can
 * leak into the durable ref.
 *
 * `cwd` is injectable (default `process.cwd()`) so the integration test can point
 * the adapter at a throwaway repo; the composition root uses `new ExecGitWrite()`.
 */
export class ExecGitWrite implements GitWritePort {
  constructor(private readonly cwd?: string) {}

  private run(args: string[], input?: string, extraEnv?: NodeJS.ProcessEnv) {
    return spawnSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf8',
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

  commitTree(tree: string, parent: string | null, message: string): string {
    const args = ['commit-tree', tree, '-m', message];
    if (parent !== null) args.push('-p', parent);
    const r = this.run(args, undefined, {
      GIT_AUTHOR_NAME: TELEMETRY_AUTHOR.name,
      GIT_AUTHOR_EMAIL: TELEMETRY_AUTHOR.email,
      GIT_COMMITTER_NAME: TELEMETRY_AUTHOR.name,
      GIT_COMMITTER_EMAIL: TELEMETRY_AUTHOR.email,
    });
    if (r.status !== 0) throw new Error(`git commit-tree failed: ${r.stderr?.trim()}`);
    return r.stdout.trim();
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
