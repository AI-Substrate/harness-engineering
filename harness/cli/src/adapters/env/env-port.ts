/**
 * Environment port — reads process environment variables behind an interface.
 *
 * Lets services read/report env (e.g. `HARNESS_JSON`) without touching
 * `process.env` directly, so they stay unit-testable with `FakeEnv`.
 */
export interface EnvPort {
  /** Value of an env var, or undefined if unset. */
  get(name: string): string | undefined;
  /**
   * Every defined env var as a `{name: value}` snapshot — the enumeration
   * primitive `get(name)` cannot provide. Used by telemetry's globbed env
   * capture (an allowlist matched against the full key set); unset/undefined
   * values are omitted so the result is always `string`-valued.
   */
  entries(): Record<string, string>;
  /**
   * Absolute path to the user's home directory (`$HOME` / `%USERPROFILE%`), or
   * undefined if it cannot be resolved. Lets services place user-global state
   * (e.g. the update-check cache under `~/.harness/`) without reading
   * `os.homedir()` directly — keeping them free of `node:*` (P2).
   */
  home(): string | undefined;
}
