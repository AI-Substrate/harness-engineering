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
}
