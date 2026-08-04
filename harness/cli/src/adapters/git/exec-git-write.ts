import { spawnSync } from 'node:child_process';
import { readFlatTree } from './cat-file-tree.js';
import { GIT_MAX_BUFFER } from './exec-git-limits.js';
import {
  type GitWritePort,
  type RefTreeBlob,
  TELEMETRY_FALLBACK_AUTHOR,
  TELEMETRY_REF_PREFIX,
  type TreeEntry,
} from './git-write-port.js';

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
      // A rolled blob (`session.logs.jsonl`) can exceed Node's default 1 MiB cap;
      // lift it to the shared ceiling so `readRefTree` reads the whole blob rather
      // than an ENOBUFS-truncated prefix (plan 049 round-2 F1).
      maxBuffer: GIT_MAX_BUFFER,
      ...(input !== undefined && { input }),
      ...(extraEnv && { env: { ...process.env, ...extraEnv } }),
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

  readRefTree(ref: string): RefTreeBlob[] | null {
    // Walk the ref's tip tree with `cat-file -p <ref>^{tree}` — a LOCAL read of the
    // ref's OWN object, never the remote (AC-03) — then read every flat entry's blob
    // in ONE `cat-file --batch` (plan 067: a spawn PER blob made a 17.5k-entry legacy
    // tree cost 17.5k subprocesses). The rolled tree is flat by construction
    // (sync-service builds no subtrees), so a non-recursive walk suffices; a subtree
    // entry (should never occur) is skipped.
    //
    // FAIL CLOSED (plan 049 round-2 F1): this is the T007 union base — the flushed
    // half of the rolled rewrite — so a PARTIAL read would force-push a truncated
    // roll (the F-03 data-loss class, via ops). `null` means ONLY the clean "ref
    // absent" case (git exits non-zero, no spawn error); any spawn-level failure
    // (ENOBUFS truncation, timeout) or a blob read that fails after its sha came
    // FROM the tree THROWS, so the sync surfaces `ok:false` and leaves the ref +
    // buffer + watermark untouched — never a silently short tree.
    const result = readFlatTree((args, input) => this.runBytes(args, input), `${ref}^{tree}`);
    if (result.kind === 'failed') {
      throw new Error(`git cat-file read failed for ${ref}: ${result.message}`);
    }
    if (result.kind === 'absent') return null; // clean non-zero exit → the ref/tree is absent
    return result.blobs;
  }

  readRefBlob(ref: string, name: string): string | null {
    // Targeted LOCAL single-blob read `cat-file blob <ref>:<name>` — the manifest-only
    // fast path for the steady-state no-op sync decision (plan 049 DL-001). The no-op
    // decision needs ONLY `manifest.json`'s max_seq; the full `readRefTree` cat-files
    // EVERY blob (incl. the multi-MB `session.logs.jsonl`) just to reach it, which
    // dominated a no-op sync (~96s CPU on this repo). Reads exactly one blob instead.
    //
    // FAIL CLOSED like `readRefTree`: a spawn-level failure (ENOBUFS truncation on an
    // outsized blob, timeout) sets `.error` → THROW (never a silent partial); a clean
    // non-zero exit (the ref or the path is absent) → null. LOCAL only — reads the
    // ref's OWN object, never the remote (AC-03), in the same `cat-file` class as
    // `readRefTree`, so the fetch-free invariant holds. `<ref>:<name>` is git's
    // extended-object syntax for "the blob at <name> in <ref>'s tree".
    const r = this.run(['cat-file', 'blob', `${ref}:${name}`]);
    if (r.error)
      throw new Error(`git cat-file blob read failed for ${ref}:${name}: ${r.error.message}`);
    if (r.status !== 0) return null; // clean non-zero exit → the ref or the path is absent
    return r.stdout;
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
    // `--no-verify` is LOAD-BEARING, not a convenience: telemetry pushes go to
    // `refs/harness-telemetry/*` and must never trigger a `pre-push` hook. A
    // push-triggered gate that itself pushes telemetry would recurse (the pre-push
    // checks gate did exactly this — load avg 175). Bypassing hooks here makes the
    // telemetry flush hook-immune, so a `post-commit` flush can never recurse.
    const r = this.run(['push', '--no-verify', 'origin', refspec]);
    if (r.status !== 0) throw new Error(`git push failed: ${r.stderr?.trim()}`);
  }

  lsRemoteTelemetryRefs(): string[] {
    // The ONE sanctioned remote read (plan 049 migration) — `ls-remote` lists ref
    // names without fetching objects. `<sha> TAB <ref>` lines; keep the ref column.
    const r = this.run(['ls-remote', 'origin', `${TELEMETRY_REF_PREFIX}/*`]);
    if (r.status !== 0) throw new Error(`git ls-remote failed: ${r.stderr?.trim()}`);
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.split('\t')[1] ?? '')
      .filter((ref) => ref.startsWith(`${TELEMETRY_REF_PREFIX}/`));
  }

  fetchRef(ref: string): void {
    // Bring ONE old-shape ref's full history local so the migration can walk it
    // (`rev-list` + tree reads). Forced (`+`) so a divergent local copy is replaced;
    // `--no-tags` keeps the fetch scoped to exactly this ref.
    const r = this.run(['fetch', '--no-tags', 'origin', `+${ref}:${ref}`]);
    if (r.status !== 0) throw new Error(`git fetch failed: ${r.stderr?.trim()}`);
  }

  deleteRemoteRef(ref: string): void {
    // Delete the remote ref via the SAME hook-immune push path (`--no-verify`) — a
    // colon-prefixed refspec (`:<ref>`) is git's delete form.
    const r = this.run(['push', '--no-verify', 'origin', `:${ref}`]);
    if (r.status !== 0) throw new Error(`git delete-remote failed: ${r.stderr?.trim()}`);
  }
}
