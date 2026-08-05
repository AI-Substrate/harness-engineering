import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { dedupeKey, isWithin, posixJoin, toPosix } from '../shared/posix-path.js';

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
 * - Candidates are **deduped** by POSIX-normalized logical path (first
 *   occurrence kept; case-folded on win32 — see `dedupeKey`).
 * - Absent / empty dir → empty result (never an error).
 *
 * Discovery is the SINGLE POSIX ORIGIN for extension paths (plan 017): the cwd
 * is converted via `toPosix` at the boundary and every emitted `entryPath` /
 * `folder` / rejected `path` is a logical POSIX path, so downstream consumers
 * (doctor, instructions, registry) never re-normalize per site.
 *
 * NOTE: dedup + containment are lexical in POSIX space (posix-path helper —
 * never `resolve`, which corrupts drive-letter paths); symlink-following (true
 * realpath) is deferred — it would need a new `FsPort.realpath` capability, so
 * the `../escape` guard is lexical and does NOT stop a symlink inside the
 * subdir from pointing elsewhere.
 */
export function discoverExtensions(fs: FsPort, proc: ProcessPort): DiscoveryResult {
  return discoverExtensionsAt(fs, toPosix(proc.cwd()));
}

/**
 * {@link discoverExtensions} for an EXPLICIT directory rather than the process cwd.
 *
 * Same rules, same single POSIX origin — this is the implementation and the cwd form
 * is the one-line wrapper, so there is no second copy of the resolution rules to drift
 * (the "one implementation, not two" constraint this repo holds elsewhere).
 *
 * It exists so a DIAGNOSTIC can probe a directory the loader itself never looks at:
 * the loader is deliberately cwd-only, but a message explaining that no extensions
 * were found may legitimately search for one that would work — provided it VERIFIES
 * what it finds instead of guessing (packet ruling #3.2).
 */
export function discoverExtensionsAt(fs: FsPort, dir: string): DiscoveryResult {
  const base = posixJoin(dir, ...EXTENSIONS_DIR);
  const entries = fs.readdir(base);
  if (entries.length === 0) {
    return { candidates: [], rejected: [] };
  }

  const candidates: string[] = [];
  const rejected: RejectedExtension[] = [];
  for (const entry of [...entries].sort()) {
    const entryPath = posixJoin(base, entry);
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
    const entryPath = posixJoin(dir, entry);
    if (fs.exists(entryPath)) {
      return [entryPath];
    }
  }
  return [];
}

/** Read `<dir>/package.json` and return resolved `harness.extensions[]` paths, or []. */
function readManifest(fs: FsPort, dir: string): string[] {
  const pkgPath = posixJoin(dir, 'package.json');
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
      .map((rel) => posixJoin(dir, rel))
      .filter((candidate) => isWithin(dir, candidate));
  } catch {
    return [];
  }
}

/** Keep the first occurrence of each logical path (POSIX-normalized `dedupeKey`; preserves order). */
function dedupeByAbsolutePath(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = dedupeKey(path);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path);
    }
  }
  return result;
}
