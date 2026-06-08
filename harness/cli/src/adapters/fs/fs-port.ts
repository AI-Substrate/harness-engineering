/**
 * Filesystem port — the side effect `doctor`/config reads sit behind, plus the
 * writes the scaffolder (`harness new`, plan 006) needs.
 *
 * Reads (`exists`/`readText`/`readdir`) and writes (`mkdirp`/`writeText`) are
 * injected so services stay unit-testable with `FakeFs` and never import
 * `node:fs`.
 */
export interface FsPort {
  /** True if a path exists on disk. */
  exists(path: string): boolean;
  /** File contents as UTF-8, or null if missing/unreadable (never throws). */
  readText(path: string): string | null;
  /** Entry names directly inside a directory, or `[]` if missing/unreadable (never throws). */
  readdir(path: string): string[];
  /** Recursively create a directory (no-op if it already exists). For the scaffolder. */
  mkdirp(path: string): void;
  /** Write UTF-8 text to a path, overwriting. Caller ensures the parent dir exists (mkdirp). */
  writeText(path: string, contents: string): void;
}
