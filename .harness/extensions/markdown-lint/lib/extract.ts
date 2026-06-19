/**
 * Pure ` ```mermaid ` fence extractor for `harness markdown-lint` (plan 029).
 *
 * No I/O, no `node:*` imports, fully synchronous — the shell reads each file and
 * feeds the text in; this returns the mermaid blocks with their source location.
 * The mermaid syntax check (a subprocess) then validates each block's `text`.
 *
 * A line-based fence state machine tracks EVERY fenced code block (not just
 * mermaid) so that a non-mermaid block which merely *shows* a ` ```mermaid `
 * example (e.g. docs wrapped in a 4-backtick fence) is correctly skipped — only
 * top-level mermaid fences are extracted (finding 02).
 */

export interface MermaidFence {
  /** Repo-relative path of the source file (passed through verbatim). */
  path: string;
  /** 1-based line number of the opening fence. */
  line: number;
  /** The fence body (between the open and close markers), `\n`-joined. */
  text: string;
}

interface OpenFence {
  /** The exact fence marker run, e.g. '```' or '~~~~'. */
  marker: string;
  isMermaid: boolean;
  startLine: number;
  body: string[];
}

/** Match a fence-open line → its marker run + trimmed info string, or null. */
function matchFenceOpen(line: string): { marker: string; info: string } | null {
  const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const info = m[2];
  // CommonMark: a backtick info string may not itself contain a backtick.
  if (m[1][0] === '`' && info.includes('`')) return null;
  return { marker: m[1], info: info.trim() };
}

/** A closing fence: same char, length ≥ the opener, nothing but whitespace after. */
function isFenceClose(line: string, marker: string): boolean {
  const ch = marker[0] === '`' ? '`' : '~';
  return new RegExp(`^\\s{0,3}${ch === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(line);
}

/** Does an info string declare a mermaid block? (first token, case-insensitive). */
function isMermaidInfo(info: string): boolean {
  return info.toLowerCase().split(/\s+/)[0] === 'mermaid';
}

/**
 * Extract every top-level mermaid fence from `markdown`. Unterminated mermaid
 * fences at EOF are emitted best-effort (the parser will judge the body).
 */
export function extractMermaidFences(markdown: string, path: string): MermaidFence[] {
  const lines = markdown.split(/\r?\n/);
  const fences: MermaidFence[] = [];
  let open: OpenFence | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      if (isFenceClose(line, open.marker)) {
        if (open.isMermaid) fences.push({ path, line: open.startLine, text: open.body.join('\n') });
        open = null;
      } else if (open.isMermaid) {
        open.body.push(line);
      }
      continue;
    }
    const o = matchFenceOpen(line);
    if (o) {
      open = { marker: o.marker, isMermaid: isMermaidInfo(o.info), startLine: i + 1, body: [] };
    }
  }

  if (open && open.isMermaid) {
    fences.push({ path, line: open.startLine, text: open.body.join('\n') });
  }
  return fences;
}
