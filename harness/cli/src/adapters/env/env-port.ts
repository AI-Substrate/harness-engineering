/**
 * Environment port — reads process environment variables behind an interface.
 *
 * Lets services read/report env (e.g. `HARNESS_JSON`) without touching
 * `process.env` directly, so they stay unit-testable with `FakeEnv`.
 */
export interface EnvPort {
  /** Value of an env var, or undefined if unset. */
  get(name: string): string | undefined;
}
