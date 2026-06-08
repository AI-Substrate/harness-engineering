/**
 * Filesystem port — the side effect `doctor`/config reads sit behind.
 *
 * Read-only in this slice (is `dist/` built?, read a config file). Injected so
 * services stay unit-testable with `FakeFs` and never import `node:fs`.
 */
export interface FsPort {
  /** True if a path exists on disk. */
  exists(path: string): boolean;
  /** File contents as UTF-8, or null if missing/unreadable (never throws). */
  readText(path: string): string | null;
  /** Entry names directly inside a directory, or `[]` if missing/unreadable (never throws). */
  readdir(path: string): string[];
}
