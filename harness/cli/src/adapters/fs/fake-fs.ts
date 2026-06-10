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
    // Seeded names first, then immediate child dirs created via mkdirp — so a
    // dir made DURING the test is visible to a later listing, as NodeFs would
    // be (plan 015: capture mkdirps a bucket; a later sweep readdirs its parent).
    const names = [...(this.dirs[path] ?? [])];
    const prefix = path.endsWith('/') ? path : `${path}/`;
    for (const dir of this.madeDirs) {
      if (dir.startsWith(prefix)) {
        const name = dir.slice(prefix.length).split('/')[0];
        if (name && !names.includes(name)) names.push(name);
      }
    }
    return names;
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
