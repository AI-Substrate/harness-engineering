import type { VersionLookupPort } from './version-lookup-port.js';

/**
 * Deterministic version lookup for tests. Returns a scripted latest version
 * (or null), or rejects with a scripted error to exercise the caller's failure
 * handling; records how many times it was called (fakes over mocks).
 */
export class FakeVersionLookup implements VersionLookupPort {
  calls = 0;

  constructor(
    private readonly result: string | null = null,
    private readonly error?: Error,
  ) {}

  latest(): Promise<string | null> {
    this.calls++;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result);
  }
}
