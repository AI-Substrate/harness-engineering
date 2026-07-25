import { spawnSync } from 'node:child_process';
import type { GitPort } from './git-port.js';

/** Real git access — wraps `git rev-parse` (read-only, informational). */
function isAbsoluteWorktreePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** Parse Git's NUL-delimited worktree porcelain without truncation or fallback. */
export function parseWorktreePorcelain(
  raw: string,
  maxCandidates: number,
): ReturnType<GitPort['knownWorktreeRoots']> {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    return { status: 'unavailable', reason: 'too-many' };
  }
  if (raw.length === 0 || !raw.endsWith('\0\0')) {
    return { status: 'unavailable', reason: 'malformed' };
  }

  const records = raw.slice(0, -2).split('\0\0');
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const fields = record.split('\0');
    const worktree = fields[0];
    const head = fields.find((field) => field.startsWith('HEAD '));
    if (
      worktree === undefined ||
      !worktree.startsWith('worktree ') ||
      head === undefined ||
      !/^(?:HEAD )[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?$/.test(head)
    ) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    const root = worktree.slice('worktree '.length);
    if (root.length === 0 || !isAbsoluteWorktreePath(root)) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    if (seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
    if (roots.length > maxCandidates) {
      return { status: 'unavailable', reason: 'too-many' };
    }
  }
  return { status: 'ok', roots };
}

export class ExecGit implements GitPort {
  constructor(private readonly cwd?: string) {}

  isRepo(): boolean {
    const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    return result.status === 0 && result.stdout.trim() === 'true';
  }

  currentBranch(): string | null {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }
    const branch = result.stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  }

  currentCommit(): string | null {
    const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const oid = result.stdout.trim().toLowerCase();
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) ? oid : null;
  }

  remoteUrl(): string | null {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }
    const url = result.stdout.trim();
    return url.length > 0 ? url : null;
  }

  knownWorktreeRoots(maxCandidates: number): ReturnType<GitPort['knownWorktreeRoots']> {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') {
      return { status: 'unavailable', reason: 'not-a-repository' };
    }
    return parseWorktreePorcelain(result.stdout, maxCandidates);
  }
}
