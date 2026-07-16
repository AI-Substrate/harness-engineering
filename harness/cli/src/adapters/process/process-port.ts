/**
 * Process port — toolchain probing behind an interface (read-only this slice).
 *
 * `which` answers "is this tool on PATH, and where?" for `doctor`'s toolchain
 * layer. Injected so the doctor service stays unit-testable with `FakeProcess`
 * and never spawns a real process.
 */
export interface ProcessPort {
  /** Absolute path to `command` if found on PATH, else null. */
  which(command: string): string | null;
  /** The current working directory — the root discovery resolves `.harness/extensions/` against. */
  cwd(): string;
  /**
   * The RUNNING Node.js version string, e.g. "22.7.0" (`process.versions.node`).
   * Injected so the doctor's runtime-version guard (plan 031) stays unit-testable
   * with `FakeProcess` and never reads the global directly.
   */
  nodeVersion(): string;
  /** Send the bounded watcher-stop signal; false means the pid is already gone/unreachable. */
  kill(pid: number, signal: 'SIGTERM'): boolean;
}
