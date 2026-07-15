import { spawnSync } from 'node:child_process';
import type { ProcessPort } from './process-port.js';

/** Real process access — the only place a child process is spawned. */
export class NodeProcess implements ProcessPort {
  which(command: string): string | null {
    const locator = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(locator, [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout) {
      const first = result.stdout.split('\n')[0]?.trim();
      return first ? first : null;
    }
    return null;
  }

  cwd(): string {
    return process.cwd();
  }

  nodeVersion(): string {
    return process.versions.node;
  }

  kill(pid: number, signal: 'SIGTERM'): boolean {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
