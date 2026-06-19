import type { HarnessVerb, VerbContext, VerbResult } from '@ai-substrate/engineering-harness/contract';
import { type CheckResult, decide } from './lib/decision.js';
import { extractMermaidFences, type MermaidFence } from './lib/extract.js';
import { filterInScope, normalizePath } from './lib/scope.js';

/**
 * `harness markdown-lint` — one honest envelope over three third-party markdown
 * checks (plan 029), wired into `just fft`:
 *
 *   1. markdown lint            — markdownlint-cli2 (style/structure)
 *   2. in-repo links & anchors  — remark-validate-links (relative files + headings)
 *   3. mermaid syntax           — headless `mermaid.parse()` in a subprocess (AC-07)
 *
 * "Wrap, don't rebuild" (P8): every check shells a real local bin via `ctx.exec`
 * (no shell, argv only → injection-safe) and the verb implements only the glue —
 * scope resolution, fence extraction, and the warn-launch envelope decision (all
 * unit-tested under `lib/`). The frozen scope (`lib/scope.ts`) is the single
 * source of truth for which authored markdown is checked, shared by all three
 * checks so they never drift (AC-04).
 *
 * Guardrails (mirrors arch-check): no `node:*` imports; all I/O via `ctx`; never
 * throws; every non-ok result carries a `next_action`. Warn-launch: findings land
 * as `degraded`/exit 0 (visible, non-blocking) until authored docs are clean.
 */

const MDL_BIN = 'node_modules/.bin/markdownlint-cli2';
const REMARK_BIN = 'node_modules/.bin/remark';
const REMARK_PLUGIN = 'node_modules/remark-validate-links';
const REMARK_CONFIG = '.remarkrc.json';
const MERMAID_PKG = 'node_modules/mermaid';
const JSDOM_PKG = 'node_modules/jsdom';
const RUNNER = '.harness/extensions/markdown-lint/lib/mermaid-runner.mjs';

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');
const snippet = (s: string): string => stripAnsi(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
const numFrom = (m: RegExpExecArray | null): number | undefined => (m ? Number(m[1]) : undefined);

function unavailable(name: CheckResult['name'], reason: string, examined = 0): CheckResult {
  return { name, outcome: 'unavailable', findings: 0, examined, summary: reason, unavailableReason: reason };
}

/** markdownlint-cli2 over the explicit in-scope file list (config = rules only). */
async function runMarkdownlint(ctx: VerbContext, files: string[]): Promise<CheckResult> {
  if (!ctx.fs.exists(`${ctx.cwd}/${MDL_BIN}`)) {
    return unavailable('markdownlint', 'markdownlint-cli2 not installed — run `npm install` at the repo root');
  }
  if (files.length === 0) {
    return { name: 'markdownlint', outcome: 'pass', findings: 0, examined: 0, summary: 'no in-scope markdown files' };
  }
  const r = await ctx.exec(MDL_BIN, files, { cwd: ctx.cwd });
  const combined = `${r.stdout}\n${r.stderr}`;
  const filesLinted = numFrom(/Linting:\s*(\d+)\s*file/i.exec(combined)) ?? files.length;

  if (r.code === 0) {
    return { name: 'markdownlint', outcome: 'pass', findings: 0, examined: filesLinted, summary: `${filesLinted} file(s) linted, 0 issues` };
  }
  // Exit code can't be trusted for the count — parse the summary, then fall back
  // to counting `path:line[:col] (error|warning) MDxxx` lines (finding 03/06).
  const findingLines = combined.match(/^.+?:\d+(?::\d+)?\s+(?:error|warning)\s+MD\d+.*$/gim) ?? [];
  const findings = numFrom(/Summary:\s*(\d+)\s*(?:error|warning)/i.exec(combined)) ?? findingLines.length;
  if (findings > 0) {
    return {
      name: 'markdownlint',
      outcome: 'findings',
      findings,
      examined: filesLinted,
      summary: stripAnsi(findingLines[0] ?? `${findings} markdownlint issue(s)`).trim(),
    };
  }
  // Non-zero exit with nothing parseable → the tool itself failed (e.g. bad config).
  return unavailable('markdownlint', `markdownlint-cli2 exited ${r.code}: ${snippet(r.stderr)}`, filesLinted);
}

/** remark-validate-links — check-only (never rewrites files): relative links + heading anchors. */
async function runLinks(ctx: VerbContext, files: string[]): Promise<CheckResult> {
  if (!ctx.fs.exists(`${ctx.cwd}/${REMARK_BIN}`) || !ctx.fs.exists(`${ctx.cwd}/${REMARK_PLUGIN}`)) {
    return unavailable('links', 'remark / remark-validate-links not installed — run `npm install` at the repo root');
  }
  // Preflight the config (arch-check pattern): the plugin loads from .remarkrc.json,
  // so a missing config would silently no-op the check — report it honestly instead.
  if (!ctx.fs.exists(`${ctx.cwd}/${REMARK_CONFIG}`)) {
    return unavailable('links', `${REMARK_CONFIG} is missing — restore it (it loads remark-validate-links)`);
  }
  if (files.length === 0) {
    return { name: 'links', outcome: 'pass', findings: 0, examined: 0, summary: 'no in-scope markdown files' };
  }
  // No `--output`: that would REWRITE files (finding 04). cwd = repo root so the
  // plugin resolves and its `git remote -v` lookup works (finding 03 / PL-09).
  // The plugin comes from .remarkrc.json (preflighted above), not a CLI `--use`.
  const r = await ctx.exec(REMARK_BIN, ['--frail', '--quiet', ...files], { cwd: ctx.cwd });
  const findingLines = r.stderr.split('\n').filter((l) => l.includes('remark-validate-links:'));
  if (findingLines.length > 0) {
    return {
      name: 'links',
      outcome: 'findings',
      findings: findingLines.length,
      examined: files.length,
      summary: stripAnsi(findingLines[0]).trim(),
    };
  }
  if (r.code !== 0) {
    // Non-zero with no link findings ⇒ a processing failure, not a finding
    // (e.g. "Cannot process file" — outside a git tree, or a parse error).
    return unavailable('links', `remark could not process the docs: ${snippet(r.stderr)}`, files.length);
  }
  return { name: 'links', outcome: 'pass', findings: 0, examined: files.length, summary: `${files.length} file(s) link-checked, 0 issues` };
}

/** Headless mermaid syntax check via the subprocess runner (AC-07). */
async function runMermaid(ctx: VerbContext, files: string[]): Promise<CheckResult> {
  if (!ctx.fs.exists(`${ctx.cwd}/${MERMAID_PKG}`) || !ctx.fs.exists(`${ctx.cwd}/${JSDOM_PKG}`)) {
    return unavailable('mermaid', 'mermaid / jsdom not installed — run `npm install` at the repo root');
  }
  if (!ctx.fs.exists(`${ctx.cwd}/${RUNNER}`)) {
    return unavailable('mermaid', `mermaid runner missing at ${RUNNER}`);
  }
  const fences: MermaidFence[] = [];
  for (const f of files) {
    const text = ctx.fs.readText(`${ctx.cwd}/${f}`);
    if (text != null) fences.push(...extractMermaidFences(text, f));
  }
  if (fences.length === 0) {
    return { name: 'mermaid', outcome: 'pass', findings: 0, examined: 0, summary: 'no mermaid fences in scope' };
  }
  // Fences travel as ONE argv arg (ctx.exec has no stdin; payload is tiny — see plan).
  const r = await ctx.exec('node', [`${ctx.cwd}/${RUNNER}`, JSON.stringify(fences)], { cwd: ctx.cwd });
  let parsed:
    | { ok?: boolean; loadError?: string; results?: Array<{ path: string; line: number; valid: boolean; error?: string }> }
    | null;
  try {
    parsed = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.ok !== true || !Array.isArray(parsed.results)) {
    const reason = parsed?.loadError ?? `mermaid runner failed (exit ${r.code}): ${snippet(r.stderr || r.stdout)}`;
    return unavailable('mermaid', reason, fences.length);
  }
  const invalid = parsed.results.filter((x) => !x.valid);
  if (invalid.length > 0) {
    const first = invalid[0];
    return {
      name: 'mermaid',
      outcome: 'findings',
      findings: invalid.length,
      examined: fences.length,
      summary: `invalid mermaid at ${first.path}:${first.line}${first.error ? ` — ${first.error}` : ''}`,
    };
  }
  return { name: 'mermaid', outcome: 'pass', findings: 0, examined: fences.length, summary: `${fences.length} mermaid fence(s) parsed, 0 invalid` };
}

const markdownLint: HarnessVerb = {
  name: 'markdown-lint',
  summary: 'Lint authored markdown, validate in-repo links/anchors, and syntax-check mermaid fences — one honest envelope.',
  description:
    "Runs three third-party checks over the repo's authored markdown (the frozen scope in lib/scope.ts): " +
    'markdownlint-cli2 (style/structure), remark-validate-links (relative links + heading anchors, check-only), ' +
    'and a headless mermaid.parse() subprocess (syntax only — no Chromium). Aggregates to one envelope: ' +
    '0 findings => ok/exit 0 with evidence counts; any findings => degraded/exit 0 (warn-launch — visible, ' +
    'non-blocking, promote to error once authored docs are clean); a missing tool => unconfigured/exit 2. ' +
    'See `harness instructions markdown-lint`.',
  options: [{ flags: '--dir <path>', description: 'restrict the checks to in-scope markdown under this directory' }],
  async run(ctx): Promise<VerbResult> {
    try {
      if (!ctx.git.isRepo()) {
        return ctx.unconfigured(
          "markdown-lint checks the repo's tracked markdown — run it from inside the git work tree (repo root).",
        );
      }
      // `-z`: NUL-delimited, raw paths — without it git C-quotes non-ASCII
      // filenames (e.g. `"docs/caf\303\251.md"`), which would miss the scope
      // globs and silently under-scope the run (review F001).
      const ls = await ctx.exec('git', ['ls-files', '-z', '*.md', '*.markdown'], { cwd: ctx.cwd });
      if (!ls.ok) {
        return ctx.unconfigured(
          `Could not list tracked markdown (git ls-files exited ${ls.code}). Run from the repo root. ${snippet(ls.stderr)}`,
        );
      }
      let files = filterInScope(ls.stdout.split('\0'));
      // Normalize `--dir` the same way the scoped paths are (strip `./`, backslashes,
      // trailing `/`), so `--dir ./docs/how` actually matches them (review F002).
      const dir = typeof ctx.options.dir === 'string' ? normalizePath(ctx.options.dir).replace(/\/+$/, '') : undefined;
      if (dir) files = files.filter((f) => f === dir || f.startsWith(`${dir}/`));

      const [mdl, links, mermaid] = await Promise.all([
        runMarkdownlint(ctx, files),
        runLinks(ctx, files),
        runMermaid(ctx, files),
      ]);
      const decision = decide([mdl, links, mermaid]);

      if (decision.status === 'unconfigured') {
        return ctx.unconfigured(decision.next_action as string, { data: decision.data });
      }
      if (decision.status === 'degraded') {
        return ctx.degraded(decision.data, decision.next_action as string);
      }
      return ctx.ok(decision.data);
    } catch (e) {
      return ctx.error('E_MARKDOWN_LINT_UNEXPECTED', 'markdown-lint failed unexpectedly', {
        details: e instanceof Error ? e.message : String(e),
        next_action:
          'Re-run from the repo root. To localise, run the tools directly: ' +
          './node_modules/.bin/markdownlint-cli2 <files>; ' +
          './node_modules/.bin/remark --frail --quiet <files> (plugin from .remarkrc.json)',
      });
    }
  },
};

export default markdownLint;
