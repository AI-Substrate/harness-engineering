/**
 * Command-signature extraction for counts-only telemetry (plan 034 follow-on).
 *
 * Reduces a raw shell command line to privacy-safe SIGNATURES: the program plus
 * its leading sub-command verbs, with ALL parameters removed — flags, paths,
 * values, quoted strings, redirects, and env assignments. Counts-only telemetry
 * must never store free-form argument text (Constitution P12 / AC-04), so this is
 * an allowlist BY CONSTRUCTION: only the program basename and bare lower-case
 * sub-command words survive; the first flag/path/value/quote ends the signature.
 *
 * Splitting is QUOTE- and HEREDOC-aware so the body of an inline script never
 * leaks as fake "commands": `node -e "const x = …"` → `node` (the quoted code is
 * not split), and `python3 - <<PY … PY` → `python3` (the heredoc body is skipped).
 * A small control-word denylist drops `if`/`then`/`fi`/`const`/… that a bare
 * multi-line script would otherwise surface.
 *
 * Cross-platform — the harness runs on Windows too:
 *  - chains split on unquoted `&&`, `||`, `|`, `;`, `&`, and newlines;
 *  - a leading `VAR=value` env prefix (POSIX) is dropped;
 *  - the program is reduced to its basename, dropping any `/`- or `\`-directory
 *    and a `.exe`/`.cmd`/`.bat`/`.ps1`/`.com` suffix (`C:\t\git.exe` → `git`);
 *  - sub-command verbs are kept ONLY for tools with a known, non-sensitive verb
 *    vocabulary — `harness` (2 levels: `flow nav`) and a curated {@link VERB_TOOLS}
 *    set (1 verb: `git status`). Every other program is recorded ALONE, so a
 *    positional argument (a branch name, search pattern, filename, or secret) can
 *    never be mistaken for a sub-command and leak.
 *
 * Examples: `git commit -m "secret"` → `git commit`; `harness flow nav --to x` →
 * `harness flow nav`; `grep TOKEN src/` → `grep`; `cat /etc/passwd` → `cat`.
 */

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/;
const EXE_SUFFIX = /\.(?:exe|cmd|bat|ps1|com)$/i;
const PROGRAM = /^[A-Za-z][A-Za-z0-9._-]*$/;
const HEREDOC = /^<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/;

/**
 * Programs whose FIRST argument is a known, non-sensitive sub-command verb (kept,
 * 1 level). Anything not here (or `harness`) is recorded program-only, so a
 * positional secret/path/value never survives. Extend deliberately.
 */
const VERB_TOOLS = new Set([
  'git',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'bun',
  'deno',
  'docker',
  'docker-compose',
  'kubectl',
  'helm',
  'cargo',
  'go',
  'gh',
  'terraform',
  'dotnet',
  'gradle',
  'mvn',
  'make',
  'just',
  'brew',
  'pip',
  'pip3',
  'poetry',
  'uv',
  'rustup',
  'aws',
  'gcloud',
  'az',
]);

/**
 * Control / language keywords that are never a real program — they appear only
 * when a bare multi-line shell or inline script gets line-split. Dropped so the
 * command arrays stay signal, not noise.
 */
const NON_COMMANDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'select',
  'function',
  'time',
  'const',
  'let',
  'var',
  'return',
  'await',
  'async',
  'import',
  'export',
  'class',
  'def',
  'from',
  'with',
  'try',
  'except',
  'finally',
  'raise',
  'lambda',
  'pass',
  'and',
  'or',
  'not',
  'true',
  'false',
  'null',
  'none',
]);

function programBasename(token: string): string {
  const base = token.split(/[/\\]/).pop() ?? token;
  return base.replace(EXE_SUFFIX, '');
}

/** Number of bare sub-command verbs to keep after the program (0 for unknown tools). */
function maxSubcommands(program: string): number {
  if (program === 'harness') return 2; // `flow nav`, `telemetry sync`
  return VERB_TOOLS.has(program) ? 1 : 0;
}

/**
 * Split a raw command line into individual command segments — quote-aware (no
 * split inside '…', "…", `…`) and heredoc-aware (a `<<MARKER` body is skipped
 * entirely). Splits on unquoted `&&`, `||`, `|`, `;`, `&`, and newlines.
 */
function splitCommands(raw: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null; // persists ACROSS newlines (multi-line `node -e "…"`)
  const flush = (): void => {
    if (buf.trim() !== '') out.push(buf.trim());
    buf = '';
  };
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i] as string;
    if (quote !== null) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      buf += c;
      continue;
    }
    // Heredoc: the command before `<<MARKER` is complete; skip the body entirely.
    if (c === '<' && raw[i + 1] === '<') {
      const m = HEREDOC.exec(raw.slice(i));
      if (m !== null) {
        flush();
        const marker = m[1] as string;
        let nl = raw.indexOf('\n', i);
        while (nl !== -1) {
          const end = raw.indexOf('\n', nl + 1);
          const bodyLine = raw.slice(nl + 1, end === -1 ? raw.length : end);
          if (bodyLine.trim() === marker) {
            i = end === -1 ? raw.length : end; // resume after the marker line
            break;
          }
          if (end === -1) {
            i = raw.length;
            break;
          }
          nl = end;
        }
        if (nl === -1) i = raw.length; // unterminated heredoc → consume the rest
        continue;
      }
    }
    if (c === '\n') {
      flush();
      continue;
    }
    if ((c === '&' && raw[i + 1] === '&') || (c === '|' && raw[i + 1] === '|')) {
      flush();
      i += 1;
      continue;
    }
    if (c === ';' || c === '|' || c === '&') {
      flush();
      continue;
    }
    buf += c;
  }
  flush();
  return out;
}

/** One command segment → its signature (`null` if it has no plausible program). */
export function commandSignature(segment: string): string | null {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let i = 0;
  while (i < tokens.length && ENV_ASSIGN.test(tokens[i] ?? '')) i += 1; // drop FOO=bar prefixes
  const head = tokens[i];
  if (head === undefined) return null;
  const program = programBasename(head).toLowerCase();
  if (!PROGRAM.test(program)) return null; // a flag / path / quote / value, not a program
  if (NON_COMMANDS.has(program)) return null; // a control/language keyword, not a command
  const maxSub = maxSubcommands(program);
  const words = [program];
  i += 1;
  while (i < tokens.length && words.length - 1 < maxSub && SUBCOMMAND.test(tokens[i] ?? '')) {
    words.push(tokens[i] as string);
    i += 1;
  }
  return words.join(' ');
}

/** A raw command line (possibly chained / multi-line) → one signature per command. */
export function commandSignatures(raw: string): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const out: string[] = [];
  for (const seg of splitCommands(raw)) {
    const sig = commandSignature(seg);
    if (sig !== null) out.push(sig);
  }
  return out;
}

/** If a signature is a `harness …` invocation, its sub-command (prefix stripped); else null. */
export function harnessSubcommand(signature: string): string | null {
  if (signature.startsWith('harness ')) return signature.slice('harness '.length);
  return null; // bare `harness` (help) carries no verb
}

/**
 * The privacy-safe SHELL signature to attach to a shell tool event (FX001-A) —
 * the FIRST non-harness command signature of a (possibly chained) command line
 * (`rg foo` → `rg`; `rg foo && harness checks` → `rg`; `harness doctor` →
 * `undefined`). Reuses {@link partitionCommands} verbatim, so it inherits the
 * program+verb allowlist and NEVER carries a positional/flag/path/quote. A pure
 * harness invocation yields `undefined` (the harness verb is a separate
 * `HarnessEvent`, so attaching nothing here avoids a bash/harness double-count).
 */
export function shellSignature(raw: string): string | undefined {
  return partitionCommands([raw]).bash[0];
}

/**
 * A skill invocation's LEADING PURE-DIGIT positional (FX001-B) — the first
 * whitespace-delimited token of the raw ARGUMENT string (the text after the
 * skill name) IFF it matches `^\d+$` (`08`, `7`); otherwise `undefined`. A
 * bare integer is a fixed-shape, non-sensitive stage/step number; a non-digit
 * first token (`specify`, `a sldf`) or a quoted string (`"sldjdlf"`) can carry
 * free-form/sensitive content, so it is NEVER returned (P12/AC-15). Also drops
 * every token AFTER the first, so `08 "sldjdlf"` → `08`.
 */
export function skillDigitArg(rawArgs: unknown): string | undefined {
  if (typeof rawArgs !== 'string') return undefined;
  const first = rawArgs.trim().split(/\s+/)[0];
  return first !== undefined && /^\d+$/.test(first) ? first : undefined;
}

/**
 * Partition raw shell command lines into counts-only command signatures: harness
 * invocations (sub-command only, e.g. `flow nav`) vs every other bash command
 * (full signature, e.g. `git status`). Order preserved; nothing deduped — the
 * caller gets "every command run" in the window.
 */
export function partitionCommands(rawCommands: readonly string[]): {
  bash: string[];
  harness: string[];
} {
  const bash: string[] = [];
  const harness: string[] = [];
  for (const raw of rawCommands) {
    for (const sig of commandSignatures(raw)) {
      const sub = harnessSubcommand(sig);
      if (sub !== null) {
        harness.push(sub);
      } else if (sig !== 'harness') {
        bash.push(sig);
      }
      // a bare `harness` (no verb) is dropped — no signal
    }
  }
  return { bash, harness };
}
