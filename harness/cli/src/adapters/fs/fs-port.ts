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
  /**
   * Inspect one path without following symlinks. `root` is the explicit
   * confinement boundary; resolved candidates outside it fail closed. The byte
   * ceiling is checked from metadata before a caller may allocate or read content.
   */
  probeRegularFileNoFollow(
    root: string,
    path: string,
    maxBytes: number,
  ):
    | { status: 'ok'; bytes: number }
    | {
        status: 'unavailable';
        reason: 'missing' | 'symlink' | 'non-file' | 'oversize' | 'io-error';
      };
  /**
   * Read one bounded regular file as UTF-8 within `root`, without following the
   * final component. The implementation repeats confinement and metadata checks
   * against the opened handle.
   */
  readTextFileNoFollow(
    root: string,
    path: string,
    maxBytes: number,
  ):
    | { status: 'ok'; bytes: number; text: string }
    | {
        status: 'unavailable';
        reason: 'missing' | 'symlink' | 'non-file' | 'oversize' | 'io-error';
      };
  /** Raw regular-file bytes without following symlinks, or null for missing/non-regular input. */
  readBytesNoFollow(path: string): Uint8Array | null;
  /** Sorted POSIX-relative regular files, or null if root contains a symlink/non-regular entry. */
  listRegularFilesNoFollow(root: string): string[] | null;
  /** Last-modified epoch milliseconds, or null if missing/unreadable (never throws). */
  mtimeMs(path: string): number | null;
  /** Entry names directly inside a directory, or `[]` if missing/unreadable (never throws). */
  readdir(path: string): string[];
  /** Recursively create a directory (no-op if it already exists). For the scaffolder. */
  mkdirp(path: string): void;
  /** Write UTF-8 text to a path, overwriting. Caller ensures the parent dir exists (mkdirp). */
  writeText(path: string, contents: string): void;
  /** Write raw bytes exactly. Caller ensures the parent directory exists. */
  writeBytes(path: string, contents: Uint8Array): void;
  /** Canonical native absolute identity for a bundle target; path aliases converge. */
  normalizeBundleTargetIdentity(target: string): string;
  /** Create a unique sibling temp directory on the target filesystem. */
  createSiblingTempDir(target: string, prefix: string): string;
  /** Publish a sibling temp directory only when target and the parent-local lock are absent. */
  publishDirectoryExclusive(temp: string, target: string, lockKey: string): void;
  /**
   * Atomically move `from` → `to`, replacing any existing file at `to` (the
   * commit half of a temp-write + rename). Throws on failure (callers map it to
   * an error envelope); unlike the read ops this is NOT swallowed, because a
   * failed rename must not look like a successful write. Caller ensures `to`'s
   * parent dir exists.
   */
  rename(from: string, to: string): void;
  /**
   * Delete a single file. Idempotent — a missing path is a no-op, never an error
   * (mirrors `rmSync(path, { force:true })`). Additive for the telemetry buffer
   * prune (plan 049 T007): sync deletes flushed `<seq>` buffer files once their
   * bytes are durably pushed. A real I/O failure MAY throw; callers that must not
   * fail on a prune error (the sync) wrap it in their own try/catch.
   */
  deleteFile(path: string): void;
  /**
   * Recursively delete a directory and everything under it. Idempotent — a missing
   * path is a no-op (mirrors `rmSync(path, { recursive:true, force:true })`).
   * Additive for the T007 prune: an aged-out, fully-flushed session dir is removed
   * whole. MAY throw on a real I/O failure; the sync swallows it.
   */
  removeDir(path: string): void;
  /**
   * Recursively copy directory `src` into directory path `dest`, creating `dest`
   * first. Returns true on success, false if the copy was refused or failed
   * (never throws). Unlike copy(), `dest` is the destination root itself; the
   * source basename is not added.
   */
  copyDir(src: string, dest: string): boolean;
  /**
   * Create a UNIQUE temp directory under the OS temp dir (`os.tmpdir()`) with the
   * given name prefix, returning its absolute path.
   */
  mkdtemp(prefix: string): string;
  /**
   * Canonical absolute path with every symlink resolved, or null if the path is
   * missing / unresolvable (never throws). The portable replacement for a POSIX
   * `realpath` shell-out — it underpins the CWE-59 confine guard (plan 031).
   */
  realpath(path: string): string | null;
}

/**
 * Write-side filesystem capability a verb reaches through `ctx.fsWrite` (plan
 * 031). It lets a portable verb create dirs, write files, and copy artifacts
 * WITHOUT a POSIX `mkdir`/`cp`/`bash` shell-out — the in-contract substitute for
 * the dogfood verbs' old coreutil calls.
 *
 * `NodeFs` implements this alongside {@link FsPort}; tests use `FakeFs`, which
 * records an ops log instead of touching disk.
 */
export type BundleFsPort = Pick<
  FsPort,
  | 'exists'
  | 'readBytesNoFollow'
  | 'listRegularFilesNoFollow'
  | 'normalizeBundleTargetIdentity'
  | 'createSiblingTempDir'
  | 'mkdirp'
  | 'writeBytes'
  | 'writeText'
  | 'publishDirectoryExclusive'
  | 'removeDir'
>;

export interface FileSystemWritePort {
  /** Write UTF-8 text to a path, overwriting. Caller ensures the parent dir exists (mkdirp). */
  writeText(path: string, contents: string): void;
  /** Recursively create a directory (no-op if it already exists). */
  mkdirp(path: string): void;
  /** Atomically move `from` → `to`, replacing any existing file at `to`. Throws on failure. */
  rename(from: string, to: string): void;
  /**
   * Copy `src` into `destDir` (the source basename is preserved), creating
   * `destDir` first. Returns true on success, false if the copy was refused or
   * failed (never throws).
   *
   * With `confineRoot`, the source is treated as living inside an UNTRUSTED tree
   * (e.g. a cloned repo): the copy is REFUSED unless `src`'s real path stays
   * within `confineRoot`'s real path, and the bytes are read from the RESOLVED
   * real path — so resolve + contain + copy happen as ONE operation. That closes
   * the check-then-copy TOCTOU window a separate guard+`cp` would open, and never
   * silently skips every copy the way a POSIX `realpath` shell-out does on
   * Windows. Defeats the CWE-59 symlink-exfiltration attack where a malicious
   * clone commits a fixed artifact path as a symlink to an out-of-tree host file.
   */
  copy(src: string, destDir: string, opts?: { confineRoot?: string }): boolean;
  /**
   * Recursively copy directory `src` into directory path `dest`, creating `dest`
   * first. Returns true on success, false if the copy was refused or failed
   * (never throws). Unlike copy(), `dest` is the destination root itself; the
   * source basename is not added.
   */
  copyDir(src: string, dest: string): boolean;
  /**
   * Create a UNIQUE temp directory under the OS temp dir (`os.tmpdir()`) with the
   * given name prefix, returning its absolute path. The portable, race-free
   * replacement for a hand-built `/tmp/<name>-<ts>` literal + `mkdir -p` (plan
   * 031) — keeps `os`/`fs` in the adapter so verbs stay `node:*`-free.
   */
  mkdtemp(prefix: string): string;
}
