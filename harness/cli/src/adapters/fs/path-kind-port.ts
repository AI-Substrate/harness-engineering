/**
 * What is AT a path, without following the final component (plan 073 · the
 * skills precondition guard).
 *
 * Narrow and separate from {@link import('./fs-port.js').FsPort} for the same
 * reason as the executable bit: one caller needs one fact that no other caller
 * has ever needed, and the fact is only useful if it does NOT follow links.
 *
 * The distinction it exists to make is the entire guard: a **symlink** at
 * `~/.claude/skills/ask` is git-ai's own link and may be replaced; a real
 * **directory** at the same path is somebody's skill, and an installer that
 * cannot tell them apart deletes work. `unknown` is a real answer — a path we
 * could not classify is treated as content, never as free space.
 */
export type PathKind = 'absent' | 'symlink' | 'directory' | 'file' | 'unknown';

export interface PathKindPort {
  /** Classify `path` by `lstat` — the final component is never dereferenced. */
  kindNoFollow(path: string): PathKind;
}
