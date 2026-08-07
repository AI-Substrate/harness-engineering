import type { CommitResult, CommitWindow, GitAttributionPort } from './git-attribution-port.js';

/** One recorded commit attempt — including the env overlay, which ac-0005 turns on. */
export interface FakeCommitCall {
  message: string;
  env: Record<string, string> | undefined;
}

/** Seed state for {@link FakeGitAttribution}. Every field has an honest default. */
export interface FakeGitAttributionState {
  trace2Target?: string | null;
  /**
   * This repository's identity — the git COMMON dir. Defaults to `/repo/.git`,
   * matching the `/repo` cwd every attribution test uses, so a sidecar sha
   * recorded by one fake repo reads as FOREIGN to a fake with a different value
   * (review round 2's two-repository regression).
   */
  commonDir?: string | null;
  /** Paths reported as staged. Defaults to one path, so `commit` has something to do. */
  staged?: string[];
  /** Shas that already carry a `refs/notes/ai` note. */
  notes?: string[];
  /** HEAD before any commit. */
  head?: string | null;
  /** The sha a successful commit produces. */
  commitSha?: string;
  /** Make `git commit` fail with this exit code. */
  commitFails?: number;
  /** Make `git add` fail with this exit code. */
  stageFails?: number;
  /**
   * `git commit` SUCCEEDS but the follow-up `rev-parse HEAD` fails, so the sha
   * is unknown. The real adapter reports exactly this — `ok: true`, `sha: null`
   * — and the two facts must stay separate (review F007): a caller that reads
   * the null sha as "the commit failed" tells the operator to re-run a commit
   * that is already in their history.
   */
  headUnreadable?: boolean;
  window?: CommitWindow;
  /**
   * Shas whose note appears only AFTER the first `hasAiNote` miss — models
   * git-ai's asynchronous note write, so the bounded verify loop is exercised
   * without any wall-clock wait.
   */
  notesAfterDelay?: string[];
}

/**
 * Deterministic git for the attribution paths (plan 074 · ac-000a). Records
 * every call so a test can assert the two things that actually matter: WHICH
 * env the commit ran under, and — for ac-0007 — that a read-only surface issued
 * no `add`, no `commit`, and no note write at all.
 */
export class FakeGitAttribution implements GitAttributionPort {
  readonly calls: string[] = [];
  readonly commits: FakeCommitCall[] = [];
  readonly staged: string[][] = [];

  private readonly landed: Set<string>;
  private readonly pending: Set<string>;
  private head: string | null;

  constructor(private readonly state: FakeGitAttributionState = {}) {
    this.landed = new Set(state.notes ?? []);
    this.pending = new Set(state.notesAfterDelay ?? []);
    this.head = state.head ?? null;
  }

  globalTrace2Target(): string | null {
    this.calls.push('globalTrace2Target');
    return this.state.trace2Target ?? null;
  }

  gitCommonDir(): string | null {
    this.calls.push('gitCommonDir');
    return this.state.commonDir === undefined ? '/repo/.git' : this.state.commonDir;
  }

  stage(pathspecs: readonly string[]): CommitResult {
    this.calls.push(`stage:${pathspecs.join(',')}`);
    this.staged.push([...pathspecs]);
    const code = this.state.stageFails ?? 0;
    return { ok: code === 0, code, sha: null, stdout: '', stderr: code === 0 ? '' : 'add failed' };
  }

  stagedPaths(): string[] {
    this.calls.push('stagedPaths');
    return this.state.staged ?? ['src/example.ts'];
  }

  commit(message: string, env?: Record<string, string>): CommitResult {
    this.calls.push('commit');
    this.commits.push({ message, env: env === undefined ? undefined : { ...env } });
    const code = this.state.commitFails ?? 0;
    if (code !== 0) {
      return { ok: false, code, sha: null, stdout: '', stderr: 'commit failed' };
    }
    this.head = this.state.commitSha ?? 'a'.repeat(40);
    if (this.state.headUnreadable === true) {
      return { ok: true, code: 0, sha: null, stdout: '', stderr: '' };
    }
    return { ok: true, code: 0, sha: this.head, stdout: '', stderr: '' };
  }

  hasAiNote(sha: string): boolean {
    this.calls.push(`hasAiNote:${sha}`);
    if (this.landed.has(sha)) return true;
    // First ask misses, second lands — the asynchronous note, without a sleep.
    if (this.pending.has(sha)) {
      this.pending.delete(sha);
      this.landed.add(sha);
      return false;
    }
    return false;
  }

  headSha(): string | null {
    this.calls.push('headSha');
    return this.head;
  }

  listNotedShas(): string[] {
    this.calls.push('listNotedShas');
    return [...this.landed];
  }

  commitWindow(cap: number, fallback: number): CommitWindow {
    this.calls.push(`commitWindow:${cap}:${fallback}`);
    return (
      this.state.window ?? {
        shas: [],
        rule: 'recent-fallback',
        detail: `no upstream merge-base available — the last ${fallback} commits on HEAD`,
      }
    );
  }
}
