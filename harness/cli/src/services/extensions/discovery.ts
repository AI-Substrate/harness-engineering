import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';

const EXTENSIONS_DIR = ['.harness', 'extensions'];
const CODE_FILE = /\.(ts|tsx|mjs|cjs|js)$/;
const SUBDIR_INDEXES = ['index.ts', 'index.js'];

/**
 * Scan `<cwd>/.harness/extensions/` ONE level and return the candidate extension
 * file paths the loader should import (WS-A Decision 4). Pure of direct Node I/O
 * — the directory listing comes from `FsPort.readdir`, the cwd from
 * `ProcessPort.cwd`, so the whole thing is unit-testable with fakes.
 *
 * Rules:
 * - A direct `*.ts|*.tsx|*.mjs|*.cjs|*.js` file → a candidate.
 * - A sub-directory → resolved by its `package.json` `harness.extensions[]`
 *   manifest, else `index.ts`, else `index.js`; anything else is ignored.
 *   Manifest entries that resolve OUTSIDE their own subdir are rejected (no
 *   `../escape.ts` path traversal — lexical containment only; see the realpath
 *   note below for symlinks).
 * - Entries are processed in **sorted** name order (stable "first wins").
 * - Candidates are **deduped** by resolved absolute path (first occurrence kept).
 * - Absent / empty dir → `[]` (never an error).
 *
 * NOTE: dedup + containment are by `path.resolve` of the candidate; symlink-
 * following (true realpath) is deferred — it would need a new `FsPort.realpath`
 * capability, so the `../escape` guard is lexical and does NOT stop a symlink
 * inside the subdir from pointing elsewhere.
 */
export function discoverExtensions(fs: FsPort, proc: ProcessPort): string[] {
  const base = join(proc.cwd(), ...EXTENSIONS_DIR);
  const entries = fs.readdir(base);
  if (entries.length === 0) {
    return [];
  }

  const candidates: string[] = [];
  for (const entry of [...entries].sort()) {
    const entryPath = join(base, entry);
    if (CODE_FILE.test(entry)) {
      candidates.push(entryPath);
      continue;
    }
    candidates.push(...resolveSubdir(fs, entryPath));
  }

  return dedupeByAbsolutePath(candidates);
}

/** Resolve a sub-directory to its entry file(s): manifest → index.ts → index.js → none. */
function resolveSubdir(fs: FsPort, dir: string): string[] {
  const manifestPaths = readManifest(fs, dir);
  if (manifestPaths.length > 0) {
    return manifestPaths;
  }
  for (const index of SUBDIR_INDEXES) {
    const indexPath = join(dir, index);
    if (fs.exists(indexPath)) {
      return [indexPath];
    }
  }
  return [];
}

/** Read `<dir>/package.json` and return resolved `harness.extensions[]` paths, or []. */
function readManifest(fs: FsPort, dir: string): string[] {
  const pkgPath = join(dir, 'package.json');
  if (!fs.exists(pkgPath)) {
    return [];
  }
  const raw = fs.readText(pkgPath);
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { harness?: { extensions?: unknown } };
    const list = parsed.harness?.extensions;
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter((entry): entry is string => typeof entry === 'string')
      .map((rel) => join(dir, rel))
      .filter((candidate) => isWithin(dir, candidate));
  } catch {
    return [];
  }
}

/** True when `candidate` resolves to `dir` or a descendant of it (no `../` escape). */
function isWithin(dir: string, candidate: string): boolean {
  const rel = relative(resolve(dir), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Keep the first occurrence of each resolved absolute path (preserves order). */
function dedupeByAbsolutePath(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = resolve(path);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path);
    }
  }
  return result;
}
