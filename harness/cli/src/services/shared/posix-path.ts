import { posix } from 'node:path';

/**
 * Logical paths are POSIX on every OS (plan 017).
 *
 * Every path the CLI *surfaces or compares* — envelope `data.path`, record
 * messages, extension `entryPath`/`folder`, doctor hints, dedupe keys — is a
 * LOGICAL path: forward slashes only, `.harness/...` shapes literal, identical
 * on Windows and POSIX hosts. Physical I/O (NodeFs) keeps native separators;
 * conversion happens ONCE at the boundary (`toPosix(proc.cwd())`,
 * `toPosix(entryPath)`), after which everything stays in POSIX space.
 *
 * Allowed surface (all lexical): `toPosix`, `posixNormalize`, `posixJoin`,
 * `posixDirname`, `posixRelative`, `isWithin`, `dedupeKey`.
 *
 * FORBIDDEN: `posix.resolve` (and native `resolve`) on logical paths. A
 * drive-letter path (`C:/repo`) does not start with `/`, so `posix.resolve`
 * treats it as RELATIVE and prepends the host cwd — silently corrupting the
 * path. Everything here is built on `posix.normalize`/`posix.join` instead.
 *
 * UNC guard: Node's `posix.normalize` collapses a leading `//`
 * (`//server/share` → `/server/share`), so every normalize-based op reattaches
 * the second slash when the input was UNC-rooted.
 */

/** Module-level platform constant — the DEFAULT for case-folding, never probed in tests (P3: pass the parameter explicitly instead of patching `process.platform`). */
export const IS_WIN32 = process.platform === 'win32';

/** True when the (already forward-slashed) path is UNC-rooted: exactly `//` then a name. */
const UNC_ROOT = /^\/\/[^/]/;

/** Reattach the UNC root a normalize-style op collapsed (`/server/…` → `//server/…`). */
function reattachUncRoot(original: string, result: string): string {
  if (UNC_ROOT.test(original) && !result.startsWith('//')) {
    return `/${result}`;
  }
  return result;
}

/**
 * Convert a possibly-Windows-shaped path to its logical POSIX form:
 * backslashes → `/`, drive letter upper-cased (`c:` → `C:`), UNC
 * `\\server\share` → `//server/share`. POSIX inputs pass through unchanged.
 */
export function toPosix(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  return slashed.replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
}

/** Lexical normalize in POSIX space (UNC-guarded). Accepts Windows-shaped input. */
export function posixNormalize(path: string): string {
  const p = toPosix(path);
  return reattachUncRoot(p, posix.normalize(p));
}

/** Join in POSIX space (UNC-guarded). Each segment is converted via `toPosix` on the way in. */
export function posixJoin(...parts: string[]): string {
  const posixParts = parts.map(toPosix);
  const joined = posix.join(...posixParts);
  return reattachUncRoot(posixParts[0] ?? '', joined);
}

/** Dirname in POSIX space (UNC-guarded). Accepts Windows-shaped input. */
export function posixDirname(path: string): string {
  const p = toPosix(path);
  return reattachUncRoot(p, posix.dirname(p));
}

/**
 * Relative in POSIX space. Drive-letter inputs are safe: when both sides are
 * resolved against the same host cwd the shared prefix cancels, so the result
 * is the lexical relative between the two logical paths.
 */
export function posixRelative(from: string, to: string): string {
  return posix.relative(toPosix(from), toPosix(to));
}

/**
 * True when `candidate` is `dir` or a descendant of it — the `../`-escape
 * guard, computed entirely in POSIX space (literal `'../'`, never `sep`).
 */
export function isWithin(dir: string, candidate: string): boolean {
  const d = posixNormalize(dir);
  const c = posixNormalize(candidate);
  // Root kinds must match: a UNC tree (`//server/…`) never contains a
  // single-slash path (or vice versa). Without this, Node's relative()
  // collapses the doubled slash and conflates the two roots (companion F001).
  if (UNC_ROOT.test(d) !== UNC_ROOT.test(c)) {
    return false;
  }
  const rel = posixRelative(d, c);
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !posix.isAbsolute(rel));
}

/** A logical path is already root-anchored: leading `/` (incl. UNC `//`) or a drive root `C:/`. */
const ABSOLUTE_LOGICAL = /^([A-Za-z]:)?\//;

/**
 * Resolve a user-supplied path to a logical absolute, anchoring a RELATIVE path
 * against `repoRoot` first. A bare relative `--path`/`--output` (e.g.
 * `.harness/flows/x.json`) is the in-repo location the default would write to,
 * so it must anchor to the repo before any `isWithin` containment check —
 * otherwise `posixRelative(root, ".harness/…")` yields `../…` and the guard
 * wrongly rejects an in-repo write with `E303`. An already-absolute path
 * (leading `/`, UNC `//`, or a drive root) passes through unchanged; containment
 * still applies AFTER resolution, so a `../escape` still resolves out-of-repo
 * and is correctly refused. Built on `posixJoin` (never `posix.resolve`, which
 * would mis-handle drive-letter inputs — see the module header).
 */
export function resolveInRepo(rawPath: string, repoRoot: string): string {
  const p = toPosix(rawPath);
  return ABSOLUTE_LOGICAL.test(p) ? p : posixJoin(toPosix(repoRoot), p);
}

/**
 * Stable identity key for dedupe maps: POSIX-normalized, optionally
 * case-folded. Case sensitivity is an EXPLICIT parameter so tests exercise
 * both branches deterministically on any host; the default follows the
 * platform (Windows filesystems are case-insensitive).
 */
export function dedupeKey(path: string, caseInsensitive: boolean = IS_WIN32): string {
  const key = posixNormalize(path);
  return caseInsensitive ? key.toLowerCase() : key;
}
