import type { GitPort, ReflogEntry, ReflogRead } from './git-port.js';

/**
 * Deterministic git for tests. Seeded with repo/branch state; records each
 * method called on `calls` (fakes over mocks).
 */
export class FakeGit implements GitPort {
  readonly calls: string[] = [];

  constructor(
    private readonly state: {
      isRepo?: boolean;
      branch?: string | null;
      currentCommit?: string | null;
      remoteUrl?: string | null;
      worktreeRoots?: readonly string[];
      worktreeFailure?: 'not-a-repository' | 'malformed' | 'too-many';
      /** Reflog entries NEWEST FIRST, exactly as a real read returns them. */
      reflog?: readonly ReflogEntry[];
      /** Seed a failing read; takes precedence over `reflog`. */
      reflogFailure?: 'unreadable' | 'malformed' | 'bad-limit';
    } = {},
  ) {}

  isRepo(): boolean {
    this.calls.push('isRepo');
    return this.state.isRepo ?? false;
  }

  currentBranch(): string | null {
    this.calls.push('currentBranch');
    return this.state.branch ?? null;
  }

  currentCommit(): string | null {
    this.calls.push('currentCommit');
    const value = this.state.currentCommit?.toLowerCase() ?? null;
    return value !== null && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) ? value : null;
  }

  remoteUrl(): string | null {
    this.calls.push('remoteUrl');
    return this.state.remoteUrl ?? null;
  }

  knownWorktreeRoots(maxCandidates: number): ReturnType<GitPort['knownWorktreeRoots']> {
    this.calls.push(`knownWorktreeRoots:${maxCandidates}`);
    if (this.state.worktreeFailure !== undefined) {
      return { status: 'unavailable', reason: this.state.worktreeFailure };
    }
    const roots = [...new Set(this.state.worktreeRoots ?? [])];
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || roots.length > maxCandidates) {
      return { status: 'unavailable', reason: 'too-many' };
    }
    return { status: 'ok', roots };
  }

  /**
   * The seeded reflog, newest first, truncated to `limit` — the same `-n` bound
   * the real adapter hands to git, applied here so a test seeding ten entries and
   * asking for one gets the same answer both adapters would give.
   *
   * Unseeded is `{ status: 'ok', entries: [] }`, NOT a failure: an existing ref
   * with no reflog is exactly what git reports (exit 0, empty output), and the
   * default must model the honest case rather than the convenient one.
   */
  readReflog(ref: string, limit: number): ReflogRead {
    this.calls.push(`readReflog:${ref}:${limit}`);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      return { status: 'unavailable', reason: 'bad-limit' };
    }
    if (this.state.reflogFailure !== undefined) {
      return { status: 'unavailable', reason: this.state.reflogFailure };
    }
    return { status: 'ok', entries: (this.state.reflog ?? []).slice(0, limit) };
  }
}
