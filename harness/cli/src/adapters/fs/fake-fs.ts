import type { FileSystemWritePort, FsPort } from './fs-port.js';

/**
 * Deterministic filesystem for tests. Seeded with a `{path: contents}` map and
 * an optional `{dir: entryNames[]}` map; records every probed path on `reads`,
 * every written path on `writes`, and every `mkdirp` on `mkdirs` (fakes over
 * mocks — assert on history). Writes mutate the in-memory file map so a later
 * `exists`/`readText` sees what was written.
 */
export class FakeFs implements FsPort, FileSystemWritePort {
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly mkdirs: string[] = [];
  /** Every rename as a `${from}->${to}` pair (fakes over mocks — assert on history). */
  readonly renames: string[] = [];
  /** Every `copy` call's logical intent (fakes over mocks — assert on history). */
  readonly copies: { src: string; destDir: string; confineRoot?: string }[] = [];
  /**
   * Sources the fake should treat as ESCAPING a `confineRoot` — so a verb test
   * can model the CWE-59 refusal the real `NodeFs.copy` enforces (without real
   * symlinks). A confined `copy` of one of these returns false (plan 031 F002).
   */
  readonly confineEscapes = new Set<string>();
  /** Every `mkdtemp` prefix requested (fakes over mocks — assert on history). */
  readonly mkdtemps: string[] = [];
  private readonly madeDirs = new Set<string>();

  constructor(
    private readonly files: Record<string, string> = {},
    private readonly dirs: Record<string, string[]> = {},
  ) {}

  exists(path: string): boolean {
    this.reads.push(path);
    return path in this.files || this.madeDirs.has(path);
  }

  readText(path: string): string | null {
    this.reads.push(path);
    return this.files[path] ?? null;
  }

  readdir(path: string): string[] {
    this.reads.push(path);
    // Seeded names first, then immediate child dirs created via mkdirp — so a
    // dir made DURING the test is visible to a later listing, as NodeFs would
    // be (plan 015: capture mkdirps a bucket; a later sweep readdirs its parent).
    // Probes tolerate Windows-shaped paths; registered state is canonical
    // POSIX (plan 017 — Windows-shaped-input sensors run on every OS).
    const posixPath = path.replace(/\\/g, '/');
    const names = [...(this.dirs[path] ?? this.dirs[posixPath] ?? [])];
    const prefix = posixPath.endsWith('/') ? posixPath : `${posixPath}/`;
    for (const dir of this.madeDirs) {
      if (dir.startsWith(prefix)) {
        const name = dir.slice(prefix.length).split(/[\\/]/)[0];
        if (name && !names.includes(name)) names.push(name);
      }
    }
    return names;
  }

  mkdirp(path: string): void {
    this.mkdirs.push(path);
    // Register each ancestor segment so exists() models a recursive create
    // (matches NodeFs.mkdirSync({ recursive: true }); F001). Segments split on
    // either separator and are stored in canonical POSIX form (plan 017).
    const parts = path.split(/[\\/]/);
    for (let i = 1; i <= parts.length; i++) {
      const seg = parts.slice(0, i).join('/');
      if (seg) this.madeDirs.add(seg);
    }
  }

  writeText(path: string, contents: string): void {
    this.writes.push(path);
    this.files[path] = contents;
  }

  rename(from: string, to: string): void {
    this.renames.push(`${from}->${to}`);
    const contents = this.files[from];
    if (contents === undefined) {
      // Match NodeFs: renaming a missing source throws (callers map to an error).
      throw new Error(`FakeFs.rename: source does not exist: ${from}`);
    }
    this.files[to] = contents;
    delete this.files[from];
  }

  realpath(path: string): string | null {
    this.reads.push(path);
    // No symlinks in the fake — realpath is identity for a path that exists,
    // null otherwise (mirrors NodeFs returning null for a missing/dangling path).
    return path in this.files || this.madeDirs.has(path) ? path : null;
  }

  copy(src: string, destDir: string, opts?: { confineRoot?: string }): boolean {
    // Record the LOGICAL intent (real confinement lives in NodeFs, proven by the
    // adapter contract test with a planted symlink — the fake never escapes).
    this.copies.push({
      src,
      destDir,
      ...(opts?.confineRoot !== undefined && { confineRoot: opts.confineRoot }),
    });
    // Mirror NodeFs: a missing source is refused (false), never a phantom copy.
    if (!(src in this.files)) return false;
    // Model the CWE-59 confine refusal NodeFs enforces with realpath: a seeded
    // escaping source under a confineRoot is refused (plan 031 F002).
    if (opts?.confineRoot !== undefined && this.confineEscapes.has(src)) return false;
    // Model a successful copy so a later exists()/readText() sees the dest file.
    this.mkdirp(destDir);
    const name = src.replace(/\\/g, '/').split('/').pop() ?? src;
    const dest = `${destDir.replace(/\\/g, '/').replace(/\/+$/, '')}/${name}`;
    this.files[dest] = this.files[src] ?? '';
    this.writes.push(dest);
    return true;
  }

  mkdtemp(prefix: string): string {
    // Deterministic, unique-per-call fake temp dir (no real fs / os.tmpdir()).
    const dir = `/tmp/${prefix}${this.mkdtemps.length}`;
    this.mkdtemps.push(prefix);
    this.mkdirp(dir);
    return dir;
  }
}
