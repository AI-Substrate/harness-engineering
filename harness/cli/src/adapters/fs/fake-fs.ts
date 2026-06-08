import type { FsPort } from './fs-port.js';

/**
 * Deterministic filesystem for tests. Seeded with a `{path: contents}` map and
 * an optional `{dir: entryNames[]}` map; records every probed path on `reads`,
 * every written path on `writes`, and every `mkdirp` on `mkdirs` (fakes over
 * mocks — assert on history). Writes mutate the in-memory file map so a later
 * `exists`/`readText` sees what was written.
 */
export class FakeFs implements FsPort {
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly mkdirs: string[] = [];
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
    return this.dirs[path] ?? [];
  }

  mkdirp(path: string): void {
    this.mkdirs.push(path);
    // Register each ancestor segment so exists() models a recursive create
    // (matches NodeFs.mkdirSync({ recursive: true }); F001).
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const seg = parts.slice(0, i).join('/');
      if (seg) this.madeDirs.add(seg);
    }
  }

  writeText(path: string, contents: string): void {
    this.writes.push(path);
    this.files[path] = contents;
  }
}
