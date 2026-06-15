/**
 * Version-lookup port — the latest published version of the harness package on
 * its registry (GitHub Packages, plan 018).
 *
 * Injected so the update service stays unit-testable with `FakeVersionLookup`
 * and never shells a child or touches the network directly. The Node adapter
 * shells `npm view` (architecture §2.1 defers a real HTTP adapter), composing
 * `ExecPort` rather than spawning itself.
 */
export interface VersionLookupPort {
  /**
   * Latest published version string (e.g. "0.3.0"), or null when it cannot be
   * determined — package not found, empty registry, or an auth/transport
   * failure. Implementations SHOULD map failures to null so the caller can
   * degrade silently (AC9); tests may also reject to exercise the caller's
   * defensive catch.
   */
  latest(): Promise<string | null>;
}
