import type { EnvPort } from './env-port.js';

/**
 * Deterministic environment for tests. Seeded with a `{name: value}` map;
 * records every requested name on `gets` (fakes over mocks).
 */
export class FakeEnv implements EnvPort {
  readonly gets: string[] = [];

  constructor(private readonly vars: Record<string, string> = {}) {}

  get(name: string): string | undefined {
    this.gets.push(name);
    return this.vars[name];
  }
}
