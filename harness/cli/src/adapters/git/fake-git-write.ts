import type { GitIdentity, GitWritePort, TreeEntry } from './git-write-port.js';

/**
 * Deterministic git-write plumbing for tests (fakes over mocks — assert on
 * history). Records every call on `calls`; deterministic object/commit shas;
 * an in-memory ref map with real compare-and-set semantics so a service test can
 * exercise the ff-retry, the orphan rollback, and the offline push-failure path.
 *
 * ATTRIBUTION: `commitTree` records the **contributor's identity** (the
 * constructor's `identity`, default a representative engineer) — mirroring the
 * real adapter, which lets git use the configured `user.name`/`user.email`.
 */
export class FakeGitWrite implements GitWritePort {
  readonly calls: string[] = [];
  readonly commits: {
    tree: string;
    parent: string | null;
    message: string;
    author: GitIdentity;
    committer: GitIdentity;
  }[] = [];
  readonly trees: TreeEntry[][] = [];
  readonly blobs: string[] = [];
  readonly pushed: string[] = [];

  /** Set true to make `push` throw (models offline / auth failure / non-ff). */
  failPush = false;
  /** Set true to make the FIRST `updateRef` lose a race (a concurrent writer moves the tip). */
  staleOnce = false;

  private objN = 0;
  private commitN = 0;
  private staleConsumed = false;
  private readonly refs = new Map<string, string>();

  constructor(
    seedRefs: Record<string, string> = {},
    /** The contributor identity each recorded commit carries (attributable). */
    private readonly identity: GitIdentity = { name: 'Engineer', email: 'engineer@example.com' },
  ) {
    for (const [ref, sha] of Object.entries(seedRefs)) this.refs.set(ref, sha);
  }

  hashObject(content: string): string {
    this.calls.push('hashObject');
    this.blobs.push(content);
    return `blob${++this.objN}`;
  }

  mktree(entries: TreeEntry[]): string {
    this.calls.push('mktree');
    this.trees.push(entries);
    return `tree${++this.objN}`;
  }

  refTip(ref: string): string | null {
    this.calls.push('refTip');
    return this.refs.get(ref) ?? null;
  }

  commitTree(tree: string, parent: string | null, message: string): string {
    this.calls.push('commitTree');
    // Attribution: author AND committer are the contributor's identity (the real
    // adapter lets git use the configured user.name/user.email) — record both.
    this.commits.push({
      tree,
      parent,
      message,
      author: this.identity,
      committer: this.identity,
    });
    return `commit${++this.commitN}`;
  }

  updateRef(ref: string, newSha: string, oldSha: string | null): boolean {
    this.calls.push('updateRef');
    if (this.staleOnce && !this.staleConsumed) {
      // A concurrent writer moves the tip out from under this CAS — once.
      this.staleConsumed = true;
      this.refs.set(ref, `concurrent-${ref}`);
      return false;
    }
    if ((this.refs.get(ref) ?? null) !== (oldSha ?? null)) return false; // stale CAS
    this.refs.set(ref, newSha);
    return true;
  }

  deleteRef(ref: string): void {
    this.calls.push('deleteRef');
    this.refs.delete(ref);
  }

  push(refspec: string): void {
    this.calls.push('push');
    if (this.failPush) throw new Error('FakeGitWrite.push: simulated push failure');
    this.pushed.push(refspec);
  }

  /** Test helper — current tip without recording a `refTip` call. */
  tip(ref: string): string | null {
    return this.refs.get(ref) ?? null;
  }
}
