import { spawnSync } from 'node:child_process';
import type { GitPort } from './git-port.js';

/** Real git access — wraps `git rev-parse` (read-only, informational). */
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
}
