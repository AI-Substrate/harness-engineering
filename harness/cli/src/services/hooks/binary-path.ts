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
 * THE INVOCATION — the interpreter AND the script, both normalised, both quoted.
 *
 * MEASURED ON A WINDOWS 11 GUEST, 2026-08-10 (plan 082, F008):
 *
 *   .js=JSFile
 *   JSFile=C:\Windows\System32\WScript.exe "%1" %*
 *
 * A bare `.js` path as the first token of a command is dispatched by FILE
 * ASSOCIATION to Windows Script Host — not Node. WScript opened our ES module,
 * could not execute it, and EXITED 0. The exact command from `hooks.json` moved
 * the fires journal 2 -> 2 lines; the identical command with `node` in front
 * moved it 2 -> 3. Every hook we ever installed on Windows was decorative, and
 * F005's entry shapes and F006's relay were both correct and both unreachable,
 * because the process carrying them was not our program.
 *
 * THE ORIGINAL RATIONALE SURVIVES INTACT — it was the CONCLUSION that was
 * POSIX-only. "The path written into a user's config IS the running binary and
 * no caller can supply a truthful substitute" is still why we use
 * `process.argv[1]`; `process.execPath` is the same kind of fact about the same
 * running process. A truthful PAIR rather than a truthful single. No PATH lookup
 * (a hook subprocess may not inherit the user's PATH), no guess at where npm put
 * a `.cmd` shim (a dev checkout has none, so shim-resolution would silently
 * regress the dogfood machine), correct under global install, npx, and a
 * relocated node alike.
 *
 * ONE FORM ON EVERY PLATFORM, deliberately. An explicit interpreter is correct
 * on POSIX too — it removes the shebang from the trust chain — and one form
 * means the string shipped to Windows users is the string every macOS gate run
 * exercises. The divergence is what let this defect live for the life of the
 * feature.
 *
 * The self-invocation case (`script === interpreter`, i.e. a single-file
 * executable) collapses to one token rather than naming the binary twice.
 */
export function embedInvocation(interpreter: string, script: string): string {
  const node = normaliseBinaryPath(interpreter);
  const target = normaliseBinaryPath(script);
  if (node === target || target === '') return embedBinaryPath(node);
  return `${quoteForShell(node)} ${INTERPRETER_FLAGS.join(' ')} ${quoteForShell(target)}`;
}

/**
 * Flags the composed invocation gives the INTERPRETER, before the script.
 *
 * `--no-warnings` DEFENDS THE SILENT CONTRACT AGAINST AN ENVIRONMENT WE DO NOT
 * CONTROL (plan 082 F010 F5). `fire` runs inside an agent's tool loop and must
 * print nothing an agent can see; since F008 the command launches Node directly,
 * and Node writes `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR'
 * env being set.` to stderr AT STARTUP — before a line of our code runs, so no
 * discipline inside `fire` can suppress it. MEASURED on node v24.7.0, and found by
 * a reviewer in a real environment rather than a constructed one.
 *
 * WHAT IT HIDES, stated plainly because a suppression that is not reasoned about
 * is a defect waiting: every process warning for the hook process — deprecations,
 * experimental-feature notices, MaxListenersExceeded. We accept that HERE and only
 * here, because this is the one process contractually forbidden from speaking, and
 * a warning it cannot deliver has nowhere useful to go: it lands mid-tool-call in
 * an agent's transcript, where it is noise at best and a corrupted turn at worst.
 * The same code runs under the ordinary CLI, and under every test, with warnings
 * ON — so the surface is not lost, only moved to where someone can read it.
 *
 * A LIST, so `upgradeLegacyEntries` can ask whether an installed command carries
 * what this binary now requires. That is what makes the fix reach the installs
 * that already exist rather than only new ones.
 */
export const INTERPRETER_FLAGS: readonly string[] = ['--no-warnings'];

/**
 * Pull the binary path back OUT of a hook command string.
 *
 * The inverse of {@link embedBinaryPath}, and the reason `status` can stat what it
 * configured. Handles the quoted form (including spaces, which is the whole point)
 * and tolerates an unquoted first token so a hand-edited entry is still readable.
 *
 * INTERPRETER-AWARE SINCE F008, and this is the single most dangerous edge in
 * that change. This function returns what `status` STATS. Once the command names
 * `node` first, a reader that still took token one would stat `node.exe` — which
 * exists on every machine capable of running this code. `binaryState` would then
 * report `resolves` UNCONDITIONALLY: a green light that cannot go red, which is
 * strictly worse than the bug it was hiding. So the SCRIPT is what comes back
 * out, and the interpreter is available by name from
 * {@link extractInterpreterPath} rather than silently discarded.
 *
 * Returns `null` when the command does not start with a path we can identify —
 * never a guess, because a wrong path stats false and reports a healthy install as
 * broken.
 */
export function extractBinaryPath(command: string): string | null {
  const [first, second] = leadingTokens(command);
  if (first === null) return null;
  return isPathLike(second) ? second : first;
}

/**
 * The INTERPRETER a command names, or `null` when it names none.
 *
 * `null` is a real answer and not a failure: a hand-edited entry, or any config
 * written before F008, carries the one-token form. Reporting that honestly is
 * what lets `status` say "this install predates the fix" instead of guessing an
 * interpreter that was never configured.
 */
export function extractInterpreterPath(command: string): string | null {
  const [first, second] = leadingTokens(command);
  if (first === null) return null;
  return isPathLike(second) ? first : null;
}

/**
 * Is this token a PATH rather than a subcommand?
 *
 * The structural rule, chosen over a name test (`basename === 'node'`) on
 * purpose: a name test has to be right about every interpreter anyone might
 * legitimately configure — `node`, `node.exe`, a version-managed shim, a future
 * runtime — and it is wrong the first time it meets one it does not know. Our
 * command shape is `<invocation> hooks fire <agent> …`, so the question that
 * actually decides it is whether the second token is a path or the literal verb
 * `hooks`. A separator answers that without knowing any interpreter's name.
 */
const isPathLike = (token: string | null): token is string =>
  token !== null && token.length > 0 && (token.includes('/') || /^[A-Za-z]:/.test(token));

/**
 * The first two whitespace-separated tokens, with quoting honoured.
 *
 * ONE tokenizer for both readers, so "where does the first token end" cannot be
 * answered two different ways — the split-on-space version of this question is
 * the naive extractor that returns `"/Users/ada` and reports every healthy
 * install broken.
 */
/**
 * The first two PATH-BEARING tokens, with quoting honoured and interpreter FLAGS
 * skipped.
 *
 * ONE tokenizer for both readers, so "where does the first token end" cannot be
 * answered two different ways — the split-on-space version of this question is
 * the naive extractor that returns `"/Users/ada` and reports every healthy
 * install broken.
 *
 * FLAGS ARE SKIPPED BETWEEN THEM, AND THAT IS LOAD-BEARING (plan 082 F010 F5).
 * The invocation now carries `--no-warnings` between the interpreter and the
 * script. A reader that still asked "is token TWO a path" would answer NO for
 * every command we ship, and both callers would then be wrong in the worst
 * available direction: {@link extractInterpreterPath} would report `null`, so
 * every current entry reads as PRE-F008 LEGACY and the upgrade path rewrites
 * every config on every run — churn that, through the install compensation, can
 * uninstall a healthy hook to make up for an unrelated failure. And
 * {@link extractBinaryPath} would return the INTERPRETER, so `status` stats
 * `node` on a machine that is by definition running node: a green light that
 * cannot go red, which F008 already established is strictly worse than the bug it
 * hides.
 *
 * ONLY leading `-` tokens are skipped, and only BEFORE the second path. Our shape
 * is `<interpreter> [flags] <script> hooks fire …`, so scanning stops at the
 * first token that is neither a flag nor a path — the literal verb `hooks` — and
 * a bare-script command therefore still reports NO interpreter, which is what
 * keeps the Windows repair firing.
 */
function leadingTokens(command: string): [string | null, string | null] {
  const tokens: string[] = [];
  let rest = command;
  for (;;) {
    const read = readToken(rest);
    if (read === null) break;
    rest = read.rest;
    if (read.token.startsWith('-')) {
      // A command whose FIRST token is a flag names no binary we can identify —
      // never guess, because a wrong path stats false and reports a healthy
      // install as broken. Later flags are part of the invocation and are skipped.
      if (tokens.length === 0) return [null, null];
      continue;
    }
    tokens.push(read.token);
    if (tokens.length === 2) break;
  }
  return [tokens[0] ?? null, tokens[1] ?? null];
}

function readToken(input: string): { token: string; rest: string } | null {
  const trimmed = input.trimStart();
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
      if (char === '"') return out.length > 0 ? { token: out, rest: trimmed.slice(i + 1) } : null;
      out += char;
    }
    return null; // unterminated quote — not a path we can identify
  }

  const token = trimmed.split(/\s+/)[0];
  return token.length > 0 ? { token, rest: trimmed.slice(token.length) } : null;
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
