import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';

const EXTENSIONS_DIR = ['.harness', 'extensions'];
const CODE_FILE = /\.(ts|tsx|mjs|cjs|js)$/;
/** Per-folder convention chain, probed in order after the manifest (plan 014 AC-6). */
const ENTRY_CHAIN = ['extension.ts', 'extension.js', 'index.ts', 'index.js'];

/** A directory entry discovery refused, with the reason doctor should surface. */
export interface RejectedExtension {
  /** Resolved absolute path of the refused entry. */
  path: string;
  /** Human-actionable reason (becomes the E143 record detail). */
  reason: string;
}

/** What one discovery pass yields: loadable entry paths + refused entries (plan 014 D1). */
export interface DiscoveryResult {
  /** Sorted, deduped entry-file paths the loader should import. */
  candidates: string[];
  /** Entries refused with a reason (e.g. unsupported flat layout) — never loaded. */
  rejected: RejectedExtension[];
}

/**
 * Scan `<cwd>/.harness/extensions/` ONE level and resolve each entry to the
 * extension entry file the loader should import (WS-A Decision 4; folder-only
 * since plan 014). Pure of direct Node I/O — the directory listing comes from
 * `FsPort.readdir`, the cwd from `ProcessPort.cwd`, so the whole thing is
 * unit-testable with fakes.
 *
 * Rules (plan 014 AC-6 / D1):
 * - An extension is a FOLDER (a little package). Per folder, the first hit of
 *   `package.json` `harness.extensions[]` manifest → `extension.ts` →
 *   `extension.js` → `index.ts` → `index.js` is the entry. `.tsx`/`.mjs`/`.cjs`
 *   entries are reachable only via the manifest.
 * - A direct `*.ts|*.tsx|*.mjs|*.cjs|*.js` file is the retired flat layout →
 *   `rejected[]` with reason `unsupported flat layout — move to <name>/extension.ts`
 *   (the registry turns each into a `failed` E143 record for doctor).
 * - Other direct files (`README`, `*.md`, …) and unresolvable folders are
 *   silently ignored, as before.
 * - Manifest entries that resolve OUTSIDE their own subdir are dropped (no
 *   `../escape.ts` path traversal — lexical containment only; see the realpath
 *   note below for symlinks).
 * - Entries are processed in **sorted** name order (stable "first wins").
 * - Candidates are **deduped** by resolved absolute path (first occurrence kept).
 * - Absent / empty dir → empty result (never an error).
 *
 * NOTE: dedup + containment are by `path.resolve` of the candidate; symlink-
 * following (true realpath) is deferred — it would need a new `FsPort.realpath`
 * capability, so the `../escape` guard is lexical and does NOT stop a symlink
 * inside the subdir from pointing elsewhere.
 */
export function discoverExtensions(fs: FsPort, proc: ProcessPort): DiscoveryResult {
  const base = join(proc.cwd(), ...EXTENSIONS_DIR);
  const entries = fs.readdir(base);
  if (entries.length === 0) {
    return { candidates: [], rejected: [] };
  }

  const candidates: string[] = [];
  const rejected: RejectedExtension[] = [];
  for (const entry of [...entries].sort()) {
    const entryPath = join(base, entry);
    if (CODE_FILE.test(entry)) {
      const name = entry.replace(CODE_FILE, '');
      rejected.push({
        path: entryPath,
        reason: `unsupported flat layout — move to ${name}/extension.ts`,
      });
      continue;
    }
    candidates.push(...resolveSubdir(fs, entryPath));
  }

  return { candidates: dedupeByAbsolutePath(candidates), rejected };
}

/** Resolve a sub-directory to its entry file(s): manifest → extension.ts → extension.js → index.ts → index.js → none. */
function resolveSubdir(fs: FsPort, dir: string): string[] {
  const manifestPaths = readManifest(fs, dir);
  if (manifestPaths.length > 0) {
    return manifestPaths;
  }
  for (const entry of ENTRY_CHAIN) {
    const entryPath = join(dir, entry);
    if (fs.exists(entryPath)) {
      return [entryPath];
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
