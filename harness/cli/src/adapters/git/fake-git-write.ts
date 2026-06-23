import { type GitWritePort, TELEMETRY_AUTHOR, type TreeEntry } from './git-write-port.js';

/**
 * Deterministic git-write plumbing for tests (fakes over mocks — assert on
 * history). Records every call on `calls`; deterministic object/commit shas;
 * an in-memory ref map with real compare-and-set semantics so a service test can
 * exercise the ff-retry, the orphan rollback, and the offline push-failure path.
 *
 * §T1: `commitTree` records {@link TELEMETRY_AUTHOR} for every commit — the
 * identity is never an argument, mirroring the real adapter.
 */
export class FakeGitWrite implements GitWritePort {
  readonly calls: string[] = [];
  readonly commits: {
    tree: string;
    parent: string | null;
    message: string;
    author: typeof TELEMETRY_AUTHOR;
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

  constructor(seedRefs: Record<string, string> = {}) {
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
    this.commits.push({ tree, parent, message, author: TELEMETRY_AUTHOR });
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
