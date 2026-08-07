/**
 * The Unix executable bit — a capability no other harness code has ever needed,
 * because nothing in the harness had ever PLACED an executable before the git-ai
 * collector (plan 073 · ac-0016).
 *
 * Deliberately not folded into {@link import('./fs-port.js').FsPort}: that port
 * is about content, this is about mode, and widening a port every consumer
 * already depends on for one caller's sake is how ports stop meaning anything.
 *
 * Implementations no-op on Windows, where executability is extension-driven
 * rather than a mode bit — and say so by returning `false`, never by pretending.
 */
export interface ExecutableBitPort {
  /** Set mode 0o755 on an existing path. False when the mode could not be set. */
  setExecutable(path: string): boolean;
}
