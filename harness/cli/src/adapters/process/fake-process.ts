import type { ProcessPort } from './process-port.js';

/**
 * Deterministic process access for tests. Seeded with a `{command: path}` map;
 * records every looked-up command on `lookups` (fakes over mocks).
 */
export class FakeProcess implements ProcessPort {
  readonly lookups: string[] = [];

  constructor(
    private readonly paths: Record<string, string> = {},
    private readonly cwdPath = '/repo',
  ) {}

  which(command: string): string | null {
    this.lookups.push(command);
    return this.paths[command] ?? null;
  }

  cwd(): string {
    return this.cwdPath;
  }
}
