/**
 * Frozen scope contract for `harness markdown-lint` (plan 029 § Scope contract).
 *
 * THE single source of truth for which authored markdown the verb checks. The
 * shell derives ALL THREE checks' file lists from `inScope()` (it filters
 * `git ls-files '*.md' '*.markdown'`), so markdownlint, remark-validate-links,
 * and the mermaid walk can never drift apart — that is what makes AC-04
 * ("zero findings from excluded dirs") provable here, in one unit-tested place,
 * rather than re-asserted in two tool configs.
 *
 * Pure: no I/O, no `node:*` imports, fully synchronous. The tune step (T009) may
 * relax markdownlint RULES only — it must never widen these globs.
 */

/** Authored prose we lint. Exactly the plan's § Scope contract include set. */
export const INCLUDE_GLOBS: readonly string[] = [
  'README.md',
  'AGENTS.md',
  'AGENTS_README.md',
  'INSTALL.md',
  'CHANGELOG.md',
  'docs/guide/**',
  'docs/how/**',
  'docs/project-rules/**',
  'harness-foundations/**',
  'skills/**',
  'harness/cli/docs/**',
  'harness/cli/README.md',
];

/** Generated / transient / vendored markdown we never lint. Ignore wins over include. */
export const IGNORE_GLOBS: readonly string[] = [
  'docs/plans/**',
  '.harness/**',
  'agents/**',
  'docs/retros/**',
  'harness/cli/test/**',
  '**/reviews/**',
  'node_modules/**',
  'dist/**',
  'coverage/**',
  'scratch/**',
  '**/the-flow.md',
  '**/*.fltplan.md',
  '**/tasks/**',
];

/**
 * Convert a path glob into an anchored RegExp. Supports `**` (any chars incl.
 * `/`), a `**\/` segment (zero or more directories), `*` (within one segment),
 * and `?` (one non-`/` char). Everything else is matched literally.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const prevSlash = i === 0 || glob[i - 1] === '/';
        const nextIsSlash = glob[i + 2] === '/';
        if (prevSlash && nextIsSlash) {
          // `**\/` → zero or more leading directory segments
          re += '(?:.*/)?';
          i += 2;
        } else {
          // bounded/trailing `**` → any chars including `/`
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`);
}

const INCLUDE_RE = INCLUDE_GLOBS.map(globToRegExp);
const IGNORE_RE = IGNORE_GLOBS.map(globToRegExp);

/** Normalize to repo-relative POSIX form: backslashes → `/`, drop a leading `./`. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** True when `path` is authored markdown the verb should check. Ignore beats include. */
export function inScope(path: string): boolean {
  const p = normalizePath(path);
  if (IGNORE_RE.some((re) => re.test(p))) return false;
  return INCLUDE_RE.some((re) => re.test(p));
}

/** Filter a list of repo-relative paths to the in-scope authored set (sorted, deduped). */
export function filterInScope(paths: string[]): string[] {
  const kept = new Set<string>();
  for (const raw of paths) {
    const p = normalizePath(raw);
    if (p && inScope(p)) kept.add(p);
  }
  return [...kept].sort();
}
