/**
 * Pure, deterministic Windows-compat rules for `harness windows-check` (plan
 * 031). NO `ctx`, NO I/O — just text → findings, so every rule is unit-tested
 * over hostile + safe fixtures and runs identically on ubuntu (the
 * by-construction replacement for a Windows CI executor, plan 017).
 *
 * Scope is the EXTENSION verb layer (`.harness/extensions/**`), where `node:*`
 * and POSIX shell-outs are forbidden (Constitution P2/P8) — NOT the core
 * (`harness/cli/src`), whose adapters legitimately own `node:*`. The verb passes
 * only in-scope files (see {@link inScope}) to {@link scanText}.
 *
 * Warn-launch: every rule ships at `warn` (visible, non-blocking) — findings land
 * as `degraded`/exit 0, never a hard fail. A line carrying `// win-ok: <reason>`
 * is suppressed (the documented escape hatch).
 */

export type Severity = 'warn';

export interface WinRule {
  /** Stable id, e.g. `WIN001`. */
  id: string;
  /** Short human title. */
  title: string;
  severity: Severity;
  /**
   * True when `line` violates the rule. `fileText` is the whole file, for the
   * few rules that need cross-line context (e.g. clone-without-longpaths).
   */
  test(line: string, fileText: string): boolean;
  /** What's wrong + how to fix it (the finding's `next_action`-style hint). */
  message: string;
}

export interface Finding {
  rule: string;
  title: string;
  file: string;
  /** 1-based line number. */
  line: number;
  snippet: string;
  message: string;
}

/** A line opts out of ALL rules with a trailing `// win-ok: <reason>`. */
const SUPPRESS = /\/\/\s*win-ok:/;

export const RULES: WinRule[] = [
  {
    id: 'WIN001',
    title: 'POSIX shell-out / coreutil',
    severity: 'warn',
    test: (line) =>
      /(?:ctx\.exec|[^.\w]exec|[^.\w]spawn|execSync|spawnSync)\(\s*['"`](?:bash|sh|zsh|dash|mkdir|cp|mv|rm|ln|chmod|chown|touch|cat|ls|sleep|realpath|readlink|printf|nohup|which|grep|sed|awk|dirname|basename)\b/.test(
        line,
      ),
    message:
      'Spawning a shell or coreutil is POSIX-only. Use the portable verb contract instead: ctx.fsWrite (write/mkdir/copy/mkdtemp), ctx.clock.sleep, ctx.background.spawnDetached, or ctx.exec of a real cross-platform tool (git/minih/node).',
  },
  {
    id: 'WIN002',
    title: 'hard-coded /tmp path',
    severity: 'warn',
    test: (line) => /['"`][^'"`]*\/tmp(?:\/|['"`])/.test(line),
    message:
      'A /tmp literal does not exist on Windows. Create a temp dir via ctx.fsWrite.mkdtemp(prefix) (resolves under the OS temp dir).',
  },
  {
    id: 'WIN003',
    title: 'git clone without core.longpaths',
    severity: 'warn',
    test: (line, fileText) => /['"`]clone['"`]/.test(line) && !/core\.longpaths/.test(fileText),
    message:
      "Windows' 260-char MAX_PATH truncates deep clones. Pass -c core.longpaths=true to git clone (e.g. ctx.exec('git', ['clone', '-c', 'core.longpaths=true', '--depth=1', url, dest])).",
  },
  {
    id: 'WIN004',
    title: 'single-separator basename split',
    severity: 'warn',
    test: (line) => /\.split\(\s*['"]\/['"]\s*\)\s*(?:\.pop\(|\[)/.test(line),
    message:
      "Splitting a path on '/' only drops the basename of a Windows backslash path. Split on /[/\\\\]/ instead.",
  },
  {
    id: 'WIN005',
    title: 'node: builtin import in an extension',
    severity: 'warn',
    test: (line) =>
      /(?:from\s+|require\(\s*)['"](?:node:[a-z_/]+|fs|fs\/promises|path|os|child_process)['"]/.test(
        line,
      ),
    message:
      'Extensions must not import node:* (Constitution P2 — node:* lives only in the core adapters). Use the injected ctx ports (ctx.fs / ctx.fsWrite / ctx.exec / ctx.background / ctx.clock).',
  },
  {
    id: 'WIN006',
    title: 'direct child_process spawn',
    severity: 'warn',
    test: (line) =>
      /(?<![.\w])(?:spawn|spawnSync|execSync|execFile|execFileSync|fork)\s*\(/.test(line),
    message:
      'Spawning a child process directly bypasses the core .cmd resolver (a bare .cmd EINVALs on Windows). Use ctx.exec (blocking) or ctx.background.spawnDetached (detached).',
  },
  {
    id: 'WIN007',
    title: 'POSIX absolute path or HOME env',
    severity: 'warn',
    test: (line) =>
      /process\.env\.HOME\b/.test(line) || /['"`]\/(?:usr|bin|sbin|etc|home|root|opt)\//.test(line),
    message:
      'POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths.',
  },
  {
    id: 'WIN008',
    title: 'POSIX background-spawn idiom (nohup / & echo $!)',
    severity: 'warn',
    test: (line) => /\bnohup\b/.test(line) || /&\s*echo\s+\$!/.test(line),
    message:
      'nohup / `& echo $!` is a POSIX-only detached-launch idiom. Use ctx.background.spawnDetached(...) (returns the pid; survives the parent on every OS).',
  },
];

/**
 * Should this tracked path be scanned? In scope = an extension SOURCE file under
 * `.harness/extensions/`, EXCLUDING: the windows-check extension's own files
 * (they contain the rule patterns as data), `fixtures/`, and `*.test.*` (test
 * data legitimately carries the patterns). Other layers (the core) are out of
 * scope — they own `node:*`.
 */
export function inScope(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  if (!/^\.harness\/extensions\//.test(p)) return false;
  if (!/\.(?:ts|js|mjs|cjs)$/.test(p)) return false;
  if (/\.(?:test|spec)\.[a-z]+$/.test(p)) return false;
  if (p.includes('/windows-check/')) return false;
  if (p.includes('/fixtures/')) return false;
  return true;
}

/** Scan one file's text, honoring `// win-ok:` line suppressions. */
export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (SUPPRESS.test(line)) return; // documented escape hatch
    for (const rule of RULES) {
      if (rule.test(line, text)) {
        findings.push({
          rule: rule.id,
          title: rule.title,
          file,
          line: i + 1,
          snippet: line.trim().slice(0, 160),
          message: rule.message,
        });
      }
    }
  });
  return findings;
}
