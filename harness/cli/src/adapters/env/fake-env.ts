import type { EnvPort } from './env-port.js';

/**
 * Deterministic environment for tests. Seeded with a `{name: value}` map;
 * records every requested name on `gets` (fakes over mocks).
 */
export class FakeEnv implements EnvPort {
  readonly gets: string[] = [];
  /** How many times home() was called (fakes over mocks — assert on history). */
  homeCalls = 0;

  constructor(
    private readonly vars: Record<string, string> = {},
    private readonly homeDir?: string,
  ) {}

  get(name: string): string | undefined {
    this.gets.push(name);
    return this.vars[name];
  }

  entries(): Record<string, string> {
    return { ...this.vars };
  }

  home(): string | undefined {
    this.homeCalls++;
    return this.homeDir;
  }
}
