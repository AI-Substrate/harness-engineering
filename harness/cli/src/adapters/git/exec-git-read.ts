import { spawnSync } from 'node:child_process';
import { GIT_MAX_BUFFER } from './exec-git-limits.js';
import type { GitReadPort, ShardBlob } from './git-read-port.js';

/**
 * Real git READ plumbing (plan 047 Phase 3) — the read-only mirror of
 * {@link ExecGitWrite}. Wraps ONLY `for-each-ref` (enumerate the telemetry ref
 * namespace) + `cat-file` (walk a shard's flat tree, then read each blob). It
 * NEVER writes an object, moves a ref, fetches a remote, or checks anything out,
 * so reading a committed shard leaves the index + working tree byte-identical
 * (`git status --porcelain` unchanged) — read-only BY CONSTRUCTION (KF-06, AC-08).
 *
 * `cwd` is injectable (default `process.cwd()`) so a round-trip test can point the
 * adapter at a throwaway repo; the composition root uses `new ExecGitRead()`.
 *
 * `timeoutMs` bounds every git invocation (default 10s) — a defensive guard so a
 * pathological repo can never hang the host command. On timeout `spawnSync`
 * returns a non-zero/`null` status, so the affected method surfaces empty rather
 * than fabricating a partial read.
 */
export class ExecGitRead implements GitReadPort {
  constructor(
    private readonly cwd?: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private run(args: string[]) {
    return spawnSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      // A shard blob can be large; lift the default 1MB stdout cap generously
      // (shared with the WRITE adapter — plan 049 round-2 F1).
      maxBuffer: GIT_MAX_BUFFER,
    });
  }

  listTelemetryRefs(glob: string): string[] {
    // `for-each-ref` is a pure enumeration — no ref is created, moved, or fetched.
    // Its pattern is PREFIX-matched (a trailing `/*` fnmatch does NOT cross `/`, so
    // `refs/harness-telemetry/*` would miss the deep `…/<YYYY>/<MM>/<DD>/<session>`
    // refs). Strip the refspec-style `/*` to the namespace prefix — the same set,
    // matched recursively.
    const pattern = glob.endsWith('/*') ? glob.slice(0, -2) : glob;
    const r = this.run(['for-each-ref', '--format=%(refname)', pattern]);
    if (r.status !== 0) return [];
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  readShardTree(ref: string): ShardBlob[] {
    // Walk the ref's tree with `cat-file -p <ref>^{tree}` — LOCAL peel, no remote
    // contact — then `cat-file blob <sha>` each entry. Only `cat-file` verbs.
    return this.readTreeAt(`${ref}^{tree}`);
  }

  listRefHistory(ref: string): string[] {
    // `rev-list <ref>` lists every commit sha reachable from the ref, tip-first —
    // a pure read (no ref created/moved/fetched). The migration walks this to union
    // trees across the full history and recover clobbered segments (F-03).
    const r = this.run(['rev-list', ref]);
    if (r.status !== 0) return [];
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  readTreeAtCommit(commit: string): ShardBlob[] {
    // The per-commit tree read for the history union — `<commit>^{tree}`, same
    // read-only `cat-file` walk as {@link readShardTree}.
    return this.readTreeAt(`${commit}^{tree}`);
  }

  /** Shared read-only `cat-file` tree walk of a `<rev>^{tree}` spec. */
  private readTreeAt(treeSpec: string): ShardBlob[] {
    const tree = this.run(['cat-file', '-p', treeSpec]);
    if (tree.status !== 0) return [];
    const blobs: ShardBlob[] = [];
    for (const line of tree.stdout.split('\n')) {
      // `<mode> SP <type> SP <sha> TAB <name>` (the flat shard tree; subtrees are
      // skipped — a shard tree is flat by construction, sync-service.ts).
      const m = /^(\S+) (\S+) (\S+)\t(.+)$/.exec(line);
      if (m === null) continue;
      const [, , type, sha, name] = m;
      if (type !== 'blob') continue;
      const blob = this.run(['cat-file', 'blob', sha]);
      if (blob.status !== 0) continue;
      blobs.push({ name, content: blob.stdout });
    }
    return blobs;
  }
}
