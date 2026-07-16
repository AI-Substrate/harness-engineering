import type { ProcessPort } from './process-port.js';

/**
 * Deterministic process access for tests. Seeded with a `{command: path}` map;
 * records every looked-up command on `lookups` (fakes over mocks).
 */
export class FakeProcess implements ProcessPort {
  readonly lookups: string[] = [];
  readonly kills: Array<{ pid: number; signal: 'SIGTERM' }> = [];
  readonly livePids: Set<number>;

  constructor(
    private readonly paths: Record<string, string> = {},
    private readonly cwdPath = '/repo',
    /** The Node version this fake reports — defaults to a patched ≥22 baseline (plan 031). */
    private readonly nodeVer = '22.0.0',
    livePids: readonly number[] = [],
  ) {
    this.livePids = new Set(livePids);
  }

  which(command: string): string | null {
    this.lookups.push(command);
    return this.paths[command] ?? null;
  }

  cwd(): string {
    return this.cwdPath;
  }

  nodeVersion(): string {
    return this.nodeVer;
  }

  kill(pid: number, signal: 'SIGTERM'): boolean {
    this.kills.push({ pid, signal });
    return this.livePids.delete(pid);
  }
}
