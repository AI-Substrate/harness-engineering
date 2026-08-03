import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FakeFs } from '../../../../src/adapters/fs/fake-fs.js';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

export interface SchemaWorld {
  fs: SchemaFs;
  /** Absolute POSIX path of the world's git root (`<case>/repo`). */
  repoRoot: string;
  /** Absolute POSIX path of the world's home dir (`<case>/home`), always defined. */
  home: string;
  /** Absolute POSIX path of a document inside `repo/docs`. */
  doc(name: string): string;
  /** Absolute POSIX path of anything else in the world, relative to the case root. */
  path(relative: string): string;
}

function walk(dir: string, files: Record<string, string>, dirs: Record<string, string[]>): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  dirs[dir.replaceAll('\\', '/')] = entries.map((entry) => entry.name).sort();
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(full, files, dirs);
    } else if (statSync(full).isFile()) {
      files[full.replaceAll('\\', '/')] = readFileSync(full, 'utf8');
    }
  }
}

/**
 * Load one fixture world into a `FakeFs`.
 *
 * The corpus stays REAL, enumerable files on disk (a human can read them, and
 * `dd validate`'s live proof runs against the same bytes) while the resolver
 * under test still runs against a fake port — the house fakes-only rule holds
 * without the corpus degrading into inline string literals.
 */
export function loadSchemaWorld(caseName: string): SchemaWorld {
  const root = `${FIXTURES}${caseName}`.replaceAll('\\', '/').replace(/\/$/, '');
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = {};
  walk(root, files, dirs);
  return {
    fs: new FakeFs(files, dirs),
    repoRoot: `${root}/repo`,
    home: `${root}/home`,
    doc: (name: string) => `${root}/repo/docs/${name}`,
    path: (relative: string) => `${root}/${relative}`,
  };
}

/** Absolute POSIX path of the fixture corpus root — for the real-fs live proofs. */
export const FIXTURE_ROOT = FIXTURES.replaceAll('\\', '/').replace(/\/$/, '');
