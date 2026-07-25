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
  readonly mtimeReads: string[] = [];
  readonly writes: string[] = [];
  readonly mkdirs: string[] = [];
  /** Every rename as a `${from}->${to}` pair (fakes over mocks — assert on history). */
  readonly renames: string[] = [];
  /** Every `copy` call's logical intent (fakes over mocks — assert on history). */
  readonly copies: { src: string; destDir: string; confineRoot?: string }[] = [];
  /** Every `copyDir` call's logical intent (fakes over mocks — assert on history). */
  readonly copyDirs: { src: string; dest: string }[] = [];
  /**
   * Sources the fake should treat as ESCAPING a `confineRoot` — so a verb test
   * can model the CWE-59 refusal the real `NodeFs.copy` enforces (without real
   * symlinks). A confined `copy` of one of these returns false (plan 031 F002).
   */
  readonly confineEscapes = new Set<string>();
  /** Every `mkdtemp` prefix requested (fakes over mocks — assert on history). */
  readonly mkdtemps: string[] = [];
  /** Every `deleteFile` path, in call order (fakes over mocks — assert on history). */
  readonly deletes: string[] = [];
  /** Every `removeDir` path, in call order. */
  readonly removedDirs: string[] = [];
  /**
   * Paths whose `deleteFile`/`removeDir` the fake should FAIL (throw) — models a
   * real I/O error so a caller's error-swallowing (the T007 prune) is provable.
   */
  readonly failDeletes = new Set<string>();
  /** Paths modelled as symlinks/devices for no-follow bundle checks. */
  readonly nonRegularPaths = new Set<string>();
  /** Paths modelled specifically as symlinks for typed no-follow failures. */
  readonly symlinkPaths = new Set<string>();
  /** Optional metadata sizes, used to model oversize without content allocation. */
  readonly reportedSizes = new Map<string, number>();
  /** Ordered bounded-read operations (metadata before content). */
  readonly noFollowOps: Array<{
    op: 'probe' | 'read';
    path: string;
    maxBytes: number;
  }> = [];
  /** Created sibling temp directories, in order. */
  readonly siblingTemps: string[] = [];
  /** Exclusive directory publish attempts. */
  readonly publishedDirectories: Array<{ temp: string; target: string; lockKey: string }> = [];
  /** Force the exclusive publish operation to throw before lock acquisition. */
  failDirectoryPublish = false;
  /** Force a failure after this writer acquires the lock; its finally must release ownership. */
  failDirectoryPublishAfterLock = false;
  /** Observable cooperating-writer lock state for ownership/cleanup contract tests. */
  readonly heldBundleLocks = new Set<string>();
  private readonly byteFiles = new Map<string, Uint8Array>();
  private readonly madeDirs = new Set<string>();
  private nextMtime: number;

  constructor(
    private readonly files: Record<string, string> = {},
    private readonly dirs: Record<string, string[]> = {},
    private readonly mtimes: Record<string, number> = {},
  ) {
    for (const path of Object.keys(files)) {
      this.mtimes[path] ??= 0;
    }
    this.nextMtime = Math.max(0, ...Object.values(this.mtimes)) + 1;
  }

  exists(path: string): boolean {
    this.reads.push(path);
    return path in this.files || this.byteFiles.has(path) || this.madeDirs.has(path);
  }

  readText(path: string): string | null {
    this.reads.push(path);
    if (path in this.files) return this.files[path] ?? null;
    const bytes = this.byteFiles.get(path);
    return bytes === undefined ? null : new TextDecoder().decode(bytes);
  }

  probeRegularFileNoFollow(
    root: string,
    path: string,
    maxBytes: number,
  ): ReturnType<FsPort['probeRegularFileNoFollow']> {
    this.noFollowOps.push({ op: 'probe', path, maxBytes });
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedPath = path.replace(/\\/g, '/');
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return { status: 'unavailable', reason: 'symlink' };
    }
    const bytes = this.byteFiles.get(path);
    const text = this.files[path];
    if (bytes === undefined && text === undefined) {
      return { status: 'unavailable', reason: 'missing' };
    }
    if (this.symlinkPaths.has(path)) {
      return { status: 'unavailable', reason: 'symlink' };
    }
    if (this.nonRegularPaths.has(path)) {
      return { status: 'unavailable', reason: 'non-file' };
    }
    const size =
      this.reportedSizes.get(path) ??
      (bytes !== undefined ? bytes.byteLength : Buffer.byteLength(text as string, 'utf8'));
    if (!Number.isSafeInteger(size) || size < 0) {
      return { status: 'unavailable', reason: 'io-error' };
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || size > maxBytes) {
      return { status: 'unavailable', reason: 'oversize' };
    }
    return { status: 'ok', bytes: size };
  }

  readTextFileNoFollow(
    root: string,
    path: string,
    maxBytes: number,
  ): ReturnType<FsPort['readTextFileNoFollow']> {
    const probe = this.probeRegularFileNoFollow(root, path, maxBytes);
    if (probe.status === 'unavailable') return probe;
    this.noFollowOps.push({ op: 'read', path, maxBytes });
    const bytes = this.byteFiles.get(path);
    const text = bytes === undefined ? this.files[path] : new TextDecoder().decode(bytes);
    if (text === undefined) return { status: 'unavailable', reason: 'missing' };
    return { status: 'ok', bytes: probe.bytes, text };
  }

  readBytesNoFollow(path: string): Uint8Array | null {
    this.reads.push(path);
    if (this.nonRegularPaths.has(path)) return null;
    const bytes = this.byteFiles.get(path);
    if (bytes !== undefined) return Uint8Array.from(bytes);
    const text = this.files[path];
    return text === undefined ? null : new TextEncoder().encode(text);
  }

  listRegularFilesNoFollow(root: string): string[] | null {
    this.reads.push(root);
    const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const prefix = `${normalized}/`;
    if ([...this.nonRegularPaths].some((path) => path === normalized || path.startsWith(prefix))) {
      return null;
    }
    const paths = new Set([...Object.keys(this.files), ...this.byteFiles.keys()]);
    const out = [...paths]
      .map((path) => path.replace(/\\/g, '/'))
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((path) => path.length > 0)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const exists = this.madeDirs.has(normalized) || out.length > 0;
    return exists ? out : null;
  }

  mtimeMs(path: string): number | null {
    this.mtimeReads.push(path);
    return path in this.files || this.byteFiles.has(path) || this.madeDirs.has(path)
      ? (this.mtimes[path] ?? 0)
      : null;
  }

  setMtime(path: string, value: number): void {
    this.mtimes[path] = value;
    this.nextMtime = Math.max(this.nextMtime, value + 1);
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
    this.byteFiles.delete(path);
    this.mtimes[path] = this.nextMtime++;
  }

  writeBytes(path: string, contents: Uint8Array): void {
    this.writes.push(path);
    this.byteFiles.set(path, Uint8Array.from(contents));
    delete this.files[path];
    this.mtimes[path] = this.nextMtime++;
  }

  normalizeBundleTargetIdentity(target: string): string {
    const shaped = target.replace(/\\/g, '/').replace(/\/+$/, '');
    const drive = /^([A-Za-z]):(?:\/|$)/.exec(shaped);
    const absolute = drive !== null || shaped.startsWith('/');
    const source = absolute ? shaped : `/cwd/${shaped}`;
    const prefix =
      drive !== null ? `${drive[1]?.toUpperCase()}:` : source.startsWith('//') ? '//' : '';
    const body = drive !== null ? source.slice(2) : source;
    const parts: string[] = [];
    for (const part of body.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    if (prefix === '//') return `//${parts.join('/')}`;
    if (prefix !== '') return `${prefix}/${parts.join('/')}`;
    return `/${parts.join('/')}`;
  }

  createSiblingTempDir(target: string, prefix: string): string {
    const normalized = target.replace(/\\/g, '/').replace(/\/+$/, '');
    const slash = normalized.lastIndexOf('/');
    const parent = slash < 0 ? '.' : normalized.slice(0, slash) || '/';
    const name = slash < 0 ? normalized : normalized.slice(slash + 1);
    this.mkdirp(parent);
    const temp =
      `${parent === '/' ? '' : parent}/.${name}.${prefix}${this.siblingTemps.length}` || '/';
    this.siblingTemps.push(temp);
    this.mkdirp(temp);
    return temp;
  }

  publishDirectoryExclusive(temp: string, target: string, lockKey: string): void {
    this.publishedDirectories.push({ temp, target, lockKey });
    if (this.failDirectoryPublish || this.heldBundleLocks.has(lockKey)) {
      throw new Error('FakeFs.publishDirectoryExclusive: forced failure');
    }
    if (this.exists(target)) throw new Error('FakeFs.publishDirectoryExclusive: target exists');
    if (
      !this.madeDirs.has(temp) &&
      ![...Object.keys(this.files), ...this.byteFiles.keys()].some((path) =>
        path.startsWith(`${temp}/`),
      )
    ) {
      throw new Error('FakeFs.publishDirectoryExclusive: temp missing');
    }
    this.heldBundleLocks.add(lockKey);
    try {
      if (this.failDirectoryPublishAfterLock) {
        throw new Error('FakeFs.publishDirectoryExclusive: forced post-lock failure');
      }
      const prefix = `${temp.replace(/\/+$/, '')}/`;
      const targetPrefix = `${target.replace(/\/+$/, '')}/`;
      for (const path of Object.keys(this.files)) {
        if (!path.startsWith(prefix)) continue;
        const moved = `${targetPrefix}${path.slice(prefix.length)}`;
        this.files[moved] = this.files[path] as string;
        delete this.files[path];
      }
      for (const [path, bytes] of [...this.byteFiles]) {
        if (!path.startsWith(prefix)) continue;
        const moved = `${targetPrefix}${path.slice(prefix.length)}`;
        this.byteFiles.set(moved, bytes);
        this.byteFiles.delete(path);
      }
      for (const dir of [...this.madeDirs]) {
        if (dir === temp || dir.startsWith(prefix)) {
          const moved = dir === temp ? target : `${targetPrefix}${dir.slice(prefix.length)}`;
          this.madeDirs.add(moved);
          this.madeDirs.delete(dir);
        }
      }
      this.madeDirs.add(target);
    } finally {
      this.heldBundleLocks.delete(lockKey);
    }
  }

  rename(from: string, to: string): void {
    this.renames.push(`${from}->${to}`);
    const contents = this.files[from];
    if (contents === undefined) {
      // Match NodeFs: renaming a missing source throws (callers map to an error).
      throw new Error(`FakeFs.rename: source does not exist: ${from}`);
    }
    this.files[to] = contents;
    this.mtimes[to] = this.mtimes[from] ?? this.nextMtime++;
    delete this.files[from];
    delete this.mtimes[from];
  }

  deleteFile(path: string): void {
    this.deletes.push(path);
    if (this.failDeletes.has(path)) {
      throw new Error(`FakeFs.deleteFile: forced failure: ${path}`);
    }
    // Idempotent (mirrors NodeFs `rmSync({force:true})`): a missing path is a no-op.
    delete this.files[path];
    this.byteFiles.delete(path);
    this.nonRegularPaths.delete(path);
    delete this.mtimes[path];
    this.dropFromParentListing(path);
  }

  removeDir(path: string): void {
    this.removedDirs.push(path);
    if (this.failDeletes.has(path)) {
      throw new Error(`FakeFs.removeDir: forced failure: ${path}`);
    }
    const posix = path.replace(/\\/g, '/');
    const prefix = posix.endsWith('/') ? posix : `${posix}/`;
    // Recursively drop every file at or under the dir (mirrors recursive rmSync).
    for (const p of Object.keys(this.files)) {
      if (p === posix || p.startsWith(prefix)) delete this.files[p];
    }
    for (const p of [...this.byteFiles.keys()]) {
      if (p === posix || p.startsWith(prefix)) this.byteFiles.delete(p);
    }
    for (const p of [...this.nonRegularPaths]) {
      if (p === posix || p.startsWith(prefix)) this.nonRegularPaths.delete(p);
    }
    for (const p of Object.keys(this.mtimes)) {
      if (p === posix || p.startsWith(prefix)) delete this.mtimes[p];
    }
    delete this.dirs[posix];
    for (const d of [...this.madeDirs]) {
      if (d === posix || d.startsWith(prefix)) this.madeDirs.delete(d);
    }
    this.dropFromParentListing(posix);
  }

  copyDir(src: string, dest: string): boolean {
    const source = src.replace(/\\/g, '/').replace(/\/+$/, '');
    const target = dest.replace(/\\/g, '/').replace(/\/+$/, '');
    this.copyDirs.push({ src, dest });
    const hasSource =
      source in this.dirs ||
      Object.keys(this.files).some((p) => p === source || p.startsWith(`${source}/`));
    if (!hasSource) return false;

    this.mkdirp(target);
    for (const [path, contents] of Object.entries(this.files)) {
      const posixPath = path.replace(/\\/g, '/');
      if (posixPath === source || posixPath.startsWith(`${source}/`)) {
        const rel = posixPath === source ? '' : posixPath.slice(source.length + 1);
        if (rel) {
          const out = `${target}/${rel}`;
          const slash = out.lastIndexOf('/');
          if (slash >= 0) this.mkdirp(out.slice(0, slash));
          this.files[out] = contents;
          this.writes.push(out);
          this.registerParentListing(out);
        }
      }
    }
    for (const dir of [...Object.keys(this.dirs), ...this.madeDirs]) {
      const posixDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
      if (posixDir === source || posixDir.startsWith(`${source}/`)) {
        const rel = posixDir === source ? '' : posixDir.slice(source.length + 1);
        const out = rel ? `${target}/${rel}` : target;
        this.mkdirp(out);
        this.registerParentListing(out);
      }
    }
    return true;
  }

  /** Remove `path`'s basename from its parent dir's seeded listing (so readdir reflects the delete). */
  private dropFromParentListing(path: string): void {
    const posix = path.replace(/\\/g, '/');
    const slash = posix.lastIndexOf('/');
    if (slash < 0) return;
    const parent = posix.slice(0, slash);
    const name = posix.slice(slash + 1);
    const listing = this.dirs[parent];
    if (listing) {
      const i = listing.indexOf(name);
      if (i >= 0) listing.splice(i, 1);
    }
  }

  private registerParentListing(path: string): void {
    const posix = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const slash = posix.lastIndexOf('/');
    if (slash < 0) return;
    const parent = posix.slice(0, slash);
    const name = posix.slice(slash + 1);
    if (this.dirs[parent] === undefined) this.dirs[parent] = [];
    const listing = this.dirs[parent];
    if (name && !listing.includes(name)) listing.push(name);
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
