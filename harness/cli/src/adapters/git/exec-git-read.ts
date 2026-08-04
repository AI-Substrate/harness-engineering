import { spawnSync } from 'node:child_process';
import { readFlatTree } from './cat-file-tree.js';
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

  private run(args: string[], input?: string) {
    return spawnSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      // A shard blob can be large; lift the default 1MB stdout cap generously
      // (shared with the WRITE adapter — plan 049 round-2 F1).
      maxBuffer: GIT_MAX_BUFFER,
      ...(input !== undefined && { input }),
    });
  }

  /**
   * The same invocation as {@link run} but handing back RAW BYTES — `cat-file --batch`
   * frames its records by BYTE length, so decoding to a string first would
   * desynchronise the stream on any multi-byte character (plan 067).
   */
  private runBytes(args: string[], input?: string) {
    const r = spawnSync('git', args, {
      cwd: this.cwd,
      timeout: this.timeoutMs,
      maxBuffer: GIT_MAX_BUFFER,
      ...(input !== undefined && { input }),
    });
    return { status: r.status, stdout: r.stdout, error: r.error };
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
    // contact — then read its blobs in ONE `cat-file --batch`. Only `cat-file` verbs.
    return this.readTreeAt(`${ref}^{tree}`);
  }

  /**
   * ONE `cat-file --batch-check` over `<ref>:<name>` for every ref — header-only, so a
   * ref whose tree holds 17k blobs costs the same as one holding 3 (plan 067). Output
   * is one line per request IN ORDER: `<oid> SP <type> SP <size>` when the path exists,
   * `<request> SP missing` when it does not. Read-only, local, `cat-file` class.
   */
  refsWithBlob(refs: readonly string[], name: string): string[] {
    if (refs.length === 0) return [];
    const r = this.run(
      ['cat-file', '--batch-check'],
      `${refs.map((ref) => `${ref}:${name}`).join('\n')}\n`,
    );
    if (r.error || r.status !== 0) return [];
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    if (lines.length !== refs.length) return []; // desynchronised → classify nothing
    return refs.filter((_, i) => {
      const parts = lines[i].split(' ');
      return parts.length === 3 && parts[1] === 'blob';
    });
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

  /** Shared read-only `cat-file` tree walk of a `<rev>^{tree}` spec — BATCHED (plan 067). */
  private readTreeAt(treeSpec: string): ShardBlob[] {
    // One `cat-file --batch` for the whole tree instead of a spawn per blob. A failed
    // or absent read degrades to `[]` — the read path's existing policy (the WRITE
    // adapter's `readRefTree`, which rewrites refs from what it reads, fails closed).
    const result = readFlatTree((args, input) => this.runBytes(args, input), treeSpec);
    return result.kind === 'ok' ? result.blobs : [];
  }
}
