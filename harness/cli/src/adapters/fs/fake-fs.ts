import type { FsPort } from './fs-port.js';

/**
 * Deterministic filesystem for tests. Seeded with a `{path: contents}` map and
 * an optional `{dir: entryNames[]}` map; records every probed path on `reads`
 * (fakes over mocks — assert on history).
 */
export class FakeFs implements FsPort {
  readonly reads: string[] = [];

  constructor(
    private readonly files: Record<string, string> = {},
    private readonly dirs: Record<string, string[]> = {},
  ) {}

  exists(path: string): boolean {
    this.reads.push(path);
    return path in this.files;
  }

  readText(path: string): string | null {
    this.reads.push(path);
    return this.files[path] ?? null;
  }

  readdir(path: string): string[] {
    this.reads.push(path);
    return this.dirs[path] ?? [];
  }
}
