import type { GitPort } from './git-port.js';

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
}
