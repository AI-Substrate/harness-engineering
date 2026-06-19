import { existsSync } from 'node:fs';
import { win32 as winPath } from 'node:path';

/**
 * Windows command resolution for {@link NodeExec} (cross-platform exec).
 * `spawn(cmd, args, { shell: false })` on Windows can launch `.exe` binaries
 * (CreateProcess appends `.exe`) but NOT `.cmd`/`.bat` shims — and npm installs
 * most Node CLIs (npm, npx, tsc, biome, depcruise, minih, the harness bin
 * itself) as `.cmd` shims. The historical fix — `shell: true` — re-opens a
 * shell-injection surface (Node DEP0190: args are concatenated, not escaped),
 * violating KF-06.
 *
 * The injection-safe fix: detect a `.cmd`/`.bat` target and run it through
 * `cmd.exe /d /s /c "<target> <args…>"`. The whole command tail is built into a
 * single, fully-quoted string and spawned with `windowsVerbatimArguments` so
 * Node passes it through unaltered (no shell re-parse of our args). POSIX is
 * never touched — there, the raw command is spawned with `shell: false`.
 *
 * Why the OUTER quote pair matters (the bug this encodes a fix for): with `/s`,
 * cmd.exe strips the FIRST and LAST quote of everything after `/c`. The naive
 * `['/c', target, ...args]` form let Node quote a spaced target on its own —
 * e.g. `"C:\Program Files\nodejs\npx.cmd"` — and `/s` then stripped exactly
 * those quotes, so the space in `Program Files` split the command (`'C:\Program'
 * is not recognized`). Wrapping the entire tail in an extra outer pair gives
 * `/s` quotes to strip while the inner per-arg quotes survive intact.
 *
 * Two Windows gotchas this handles:
 *  - npm ships a BARE, extensionless unix shim beside the real `.cmd` (e.g.
 *    `minih` next to `minih.cmd`); that shell script is not CreateProcess-
 *    executable, so PATHEXT variants are tried BEFORE the bare name.
 *  - cmd.exe cannot run a forward-slash relative path (`./node_modules/.bin/x`
 *    → `'.' is not recognized`); the resolved target is therefore made an
 *    ABSOLUTE backslash path (against the spawn cwd) before handing it to cmd.
 *
 * Caveat (documented, not a bug): cmd.exe still expands `%VAR%` inside an arg.
 * Our verbs pass filesystem paths and flags, not `%`-bearing values, so this is
 * acceptable; a path containing a literal `%` is the one unsupported case.
 *
 * A token containing a literal double-quote `"` is REJECTED on the cmd-wrapped
 * path (cmdWrap throws): it cannot be escaped for cmd.exe's tokenizer and the
 * shim's CommandLineToArgvW parser at once, so emitting it would re-open the
 * BatBadBut / CVE-2024-27980 injection. Every other cmd metacharacter is made
 * inert by per-arg quoting, so only `"` is refused.
 */

const PATHEXT_DEFAULT = '.COM;.EXE;.BAT;.CMD';

/** True for shims cmd.exe must interpret (CreateProcess cannot exec these). */
function needsCmd(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file);
}

/**
 * Resolve `command` against the spawn `cwd` (for relative paths) and PATH +
 * PATHEXT (for bare names). Returns an absolute path to the first match, or
 * null when nothing resolves (caller spawns the raw name so the natural ENOENT
 * still surfaces).
 */
function resolveOnPath(command: string, cwd: string, env: NodeJS.ProcessEnv): string | null {
  const pathext = (env.PATHEXT ?? PATHEXT_DEFAULT).split(';').filter(Boolean);

  // Candidate filenames for a base, PATHEXT variants first (see gotcha above).
  const candidatesFor = (base: string): string[] => {
    if (/\.[^./\\]+$/.test(base)) return [base];
    const out: string[] = [];
    for (const ext of pathext) out.push(base + ext.toLowerCase());
    out.push(base);
    return out;
  };

  const hasSep = command.includes('/') || command.includes('\\');

  // An explicit path (absolute or relative-with-separator) resolves against the
  // spawn cwd and is returned ABSOLUTE so cmd.exe accepts it.
  if (hasSep || winPath.isAbsolute(command)) {
    const baseAbs = winPath.isAbsolute(command) ? command : winPath.resolve(cwd, command);
    for (const c of candidatesFor(baseAbs)) {
      if (existsSync(c)) return c;
    }
    return null;
  }

  const dirs = (env.PATH ?? env.Path ?? '').split(winPath.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const c of candidatesFor(winPath.join(dir, command))) {
      if (existsSync(c)) return c; // join on an absolute PATH dir => already absolute
    }
  }
  return null;
}

export interface ResolvedSpawn {
  command: string;
  args: string[];
  /**
   * When true, the caller must spawn with `windowsVerbatimArguments: true` —
   * `args` is already a fully-quoted command line that Node must NOT re-quote.
   * Set only for the cmd.exe-wrapped path. Absent/false everywhere else.
   */
  windowsVerbatimArguments?: boolean;
}

/**
 * Quote one token for the inside of a cmd.exe `/c "<line>"`. Tokens with no
 * whitespace, quote, or cmd metacharacter pass through verbatim; the rest are
 * wrapped in double quotes with backslash/quote escaping per the Windows
 * CommandLineToArgvW rules (so the .cmd shim's own arg parser sees them whole).
 */
function quoteCmdArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  // Double any backslashes that precede a quote (and the trailing run), then
  // escape embedded quotes — the standard MSVC/CommandLineToArgvW quoting.
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * Map a logical `(command, args)` to the real `(command, args)` to spawn with
 * `shell: false`. On non-Windows this is the identity. On Windows:
 *  - a command with an explicit `.cmd`/`.bat` extension is cmd-wrapped (the
 *    extension itself signals it needs cmd.exe — no existence check required);
 *  - a command with any other explicit extension (`.exe`) spawns directly;
 *  - a bare / extensionless name is resolved against `cwd` + PATH/PATHEXT to
 *    discover whether the real target is a `.cmd` shim (→ cmd-wrap) or an
 *    `.exe` (→ direct). Unresolved names pass through so the natural ENOENT
 *    still surfaces.
 *
 * Any cmd-wrapped target is made an ABSOLUTE backslash path first (cmd.exe
 * rejects forward-slash relative paths like `./node_modules/.bin/x`).
 */
export function resolveSpawn(
  command: string,
  args: string[],
  cwd: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSpawn {
  if (platform !== 'win32') return { command, args };

  const cmdWrap = (target: string): ResolvedSpawn => {
    // A literal double-quote is the ONE byte we cannot encode safely for BOTH
    // cmd.exe's tokenizer AND the shim's CommandLineToArgvW parser at once: our
    // `\"` escaping (below, in quoteCmdArg) is correct for CommandLineToArgvW
    // but is NOT an escape to cmd, which reads the `"` as a quote-state toggle
    // and exposes any following `& | < >` to its command parser — the
    // BatBadBut / CVE-2024-27980 injection. Every OTHER cmd metacharacter
    // (& | < > ^ ( )) is rendered inert because quoteCmdArg wraps any arg
    // containing one in double quotes, which cmd honours (so e.g. a
    // `Program Files (x86)` path stays safe). So reject a token bearing a `"`
    // rather than emit an injectable line — NodeExec maps the throw to a 127
    // failure, keeping the advertised no-shell-injection guarantee (KF-06).
    for (const token of [target, ...args]) {
      if (token.includes('"')) {
        throw new Error(
          `unsafe argument for the cmd.exe shim path: a literal double-quote cannot be ` +
            `escaped for both cmd.exe and the target program at once (${JSON.stringify(token)}). ` +
            `Remove the double-quote, or invoke a non-shim (.exe) target.`,
        );
      }
    }
    // /d (skip AutoRun) /s + /c (run then terminate). The whole tail is one
    // fully-quoted line wrapped in an OUTER quote pair: cmd /s strips that outer
    // pair, leaving each inner per-arg quote (e.g. around a spaced path) intact.
    // Spawned with windowsVerbatimArguments so Node passes the line unaltered.
    // This cmd.exe + verbatim route is LOAD-BEARING and must not be "simplified"
    // away: a bare `.cmd` spawn EINVALs on patched Node (>=20.12.2), and dropping
    // verbatim corrupts the /s line (plan 031 / workshops/001-windows-cmd-launch-escaping.md).
    const line = `"${[target, ...args].map(quoteCmdArg).join(' ')}"`;
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', line], windowsVerbatimArguments: true };
  };

  const hasSep = command.includes('/') || command.includes('\\');
  const toAbs = (p: string): string =>
    winPath.isAbsolute(p) || !hasSep ? p : winPath.resolve(cwd, p);

  // Case 1 — an explicit extension was given: trust it, no existence probe.
  if (/\.[^./\\]+$/.test(command)) {
    return needsCmd(command) ? cmdWrap(toAbs(command)) : { command: toAbs(command), args };
  }

  // Case 2 — no extension: resolve to discover .cmd vs .exe (existence-based).
  const resolved = resolveOnPath(command, cwd, env);
  if (resolved && needsCmd(resolved)) return cmdWrap(resolved);
  return { command: resolved ?? command, args };
}
