/**
 * THE BINARY PATH — resolve, normalise, quote, and read back out (plan 082 tk-0006).
 *
 * The hook we install is a SHELL COMMAND STRING, so the binary path has to survive
 * a round trip through it. Four properties, and they are not independent — each one
 * exists because the previous one made it possible to get wrong:
 *
 * 1. **ABSOLUTE.** A relative path resolves against the agent's cwd, which is
 *    whatever directory the user happened to open. It must also point at an
 *    INSTALLED binary — MEASURED HAZARD: the live hook on this machine points into
 *    an untracked `scratch/` directory, so it works only for the person who wrote it
 *    and breaks silently the moment that tree is cleaned.
 * 2. **WINDOWS-NORMALISED.** Strip the `\\?\` extended-length prefix that
 *    `realpath` can return, and turn `C:\x\y.exe` into `C:/x/y.exe`. git-ai
 *    normalises in only 3 of its 15 installers.
 * 3. **ALWAYS QUOTED.** Seven of git-ai's installers interpolate an unquoted path;
 *    only Copilot and Cline quote. A path containing a space then produces a broken
 *    hook — and the failure is INVISIBLE until a user whose home directory has a
 *    space in it installs, which is why it needs an assertion rather than a
 *    rationale.
 * 4. **EXTRACTABLE AGAIN.** `status` has to stat the configured binary, which means
 *    getting a quoted, possibly space-bearing, possibly forward-slashed path back
 *    OUT of a command string. The naive `split(' ')[0]` returns a leading quote,
 *    stats false, and reports every healthy install as broken.
 */

/** The `\\?\` extended-length prefix Windows `realpath` can return. */
const WINDOWS_EXTENDED_PREFIX = /^\\\\\?\\/;

/**
 * Normalise a resolved path for embedding in a hook command.
 *
 * Strips the extended-length prefix and converts backslashes to forward slashes.
 * Forward slashes are correct on Windows for this purpose — the shell and Node both
 * accept them — and they remove an entire class of escaping bugs, because a
 * backslash inside a double-quoted string is an escape character on POSIX shells.
 */
export function normaliseBinaryPath(path: string): string {
  return path.replace(WINDOWS_EXTENDED_PREFIX, '').replace(/\\/g, '/');
}

/**
 * Quote a path for a shell command — ALWAYS, not only when it contains a space.
 *
 * Unconditional on purpose. "Quote if it looks like it needs it" is a predicate that
 * has to be right about every character a filesystem allows, and it is wrong the
 * first time someone's username contains a character nobody thought of. Quoting
 * always is one rule with no exceptions to get wrong.
 *
 * An embedded double quote is escaped rather than rejected: a path can legally
 * contain one on POSIX.
 */
export const quoteForShell = (path: string): string => `"${path.replace(/"/g, '\\"')}"`;

/** Normalise and quote in one step — what gets embedded in a hook command. */
export const embedBinaryPath = (path: string): string => quoteForShell(normaliseBinaryPath(path));

/**
 * Pull the binary path back OUT of a hook command string.
 *
 * The inverse of {@link embedBinaryPath}, and the reason `status` can stat what it
 * configured. Handles the quoted form (including spaces, which is the whole point)
 * and tolerates an unquoted first token so a hand-edited entry is still readable.
 *
 * Returns `null` when the command does not start with a path we can identify —
 * never a guess, because a wrong path stats false and reports a healthy install as
 * broken.
 */
export function extractBinaryPath(command: string): string | null {
  const trimmed = command.trimStart();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('"')) {
    // Walk to the closing quote, honouring \" so an escaped quote does not end it.
    let out = '';
    for (let i = 1; i < trimmed.length; i += 1) {
      const char = trimmed[i];
      if (char === '\\' && trimmed[i + 1] === '"') {
        out += '"';
        i += 1;
        continue;
      }
      if (char === '"') return out.length > 0 ? out : null;
      out += char;
    }
    return null; // unterminated quote — not a path we can identify
  }

  const token = trimmed.split(/\s+/)[0];
  return token.length > 0 ? token : null;
}

/**
 * Does this path look like a real installed binary rather than a working tree?
 *
 * MEASURED HAZARD, not a hypothetical: the live Cursor hook on this machine points
 * into untracked `scratch/`. A hook pointing at a source checkout or a scratch
 * directory works for exactly one person and breaks silently when that tree moves.
 * Absolute is necessary and not sufficient — `/Users/x/repo/scratch/probe.mjs` is
 * absolute too.
 */
export function looksLikeInstalledBinary(path: string): boolean {
  const normalised = normaliseBinaryPath(path);
  if (!isAbsolutePath(normalised)) return false;
  const segments = normalised.split('/');
  return !segments.some((segment) => DEV_TREE_SEGMENTS.has(segment));
}

/** Directory names that mean "someone's working tree", never an install. */
const DEV_TREE_SEGMENTS = new Set(['scratch', 'node_modules', 'src', 'dist', '.git', 'worktrees']);

/** POSIX `/x` or Windows `C:/x` — both after normalisation. */
export const isAbsolutePath = (path: string): boolean =>
  path.startsWith('/') || /^[A-Za-z]:\//.test(path);
