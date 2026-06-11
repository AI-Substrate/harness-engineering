import { spawnSync } from 'node:child_process';
import type { GitPort } from './git-port.js';

/** Real git access — wraps `git rev-parse` (read-only, informational). */
export class ExecGit implements GitPort {
  isRepo(): boolean {
    const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
    });
    return result.status === 0 && result.stdout.trim() === 'true';
  }

  currentBranch(): string | null {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }
    const branch = result.stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  }
}
