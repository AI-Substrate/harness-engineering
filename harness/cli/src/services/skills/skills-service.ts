import { fileURLToPath } from 'node:url';
import type { SkillsInstallOptions, SkillsRemoveOptions } from './contract.js';

/**
 * Outcome of resolving a `--source` (+ optional branch) into a specifier `npx
 * skills add` actually understands. Discriminated so the act can map a bad
 * combination onto an `E108` envelope without the pure layer doing any I/O.
 */
export type SkillsSourceResolution =
  | { ok: true; source: string; branch?: string }
  | { ok: false; reason: string };

/** GitHub `owner/repo` shorthand, optionally with a `/subdir` tail. */
const GH_SHORTHAND = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:\/(.+))?$/;
/** A bare GitHub repo URL (`https://github.com/owner/repo`, optional `.git` / trailing slash) — no further path. */
const GH_URL = /^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export function resolvePackagedSkillsDir(moduleUrl = import.meta.url): string {
  return fileURLToPath(new URL('../../../../../skills', moduleUrl));
}

/**
 * Translate a friendly `--source` (+ optional `--branch`, or a `#ref` suffix on
 * the source) into the specifier the Vercel installer truly accepts.
 *
 * Why this exists: `npx skills add` has NO `--branch`/`--ref` flag and NO
 * `owner/repo#ref` shorthand (vercel-labs/skills#42 is an open request for it).
 * Its ONLY documented branch mechanism is a GitHub *tree URL*:
 * `https://github.com/<owner>/<repo>/tree/<ref>[/<subdir>]`. So when the user
 * names a branch, we rewrite the GitHub shorthand into that URL form.
 *
 * Invariants:
 *   - **No ref → verbatim pass-through.** The source is returned unchanged (the
 *     default `owner/repo` shorthand installs the default branch, exactly as
 *     before this flag existed) — so every existing call site is untouched.
 *   - **Ref precedence**: an explicit `branch` arg wins over a `#ref` suffix.
 *   - **Slashed refs are rejected** (`ok:false`). The installer reads the first
 *     path segment after `/tree/` as the *entire* ref, so `feat/x` would silently
 *     mis-resolve to branch `feat` + subdir `x`. Failing fast (deterministic
 *     backpressure) beats handing the installer a URL it will mis-parse.
 *   - **Branch only applies to GitHub sources** (`owner/repo[/subdir]` or
 *     `https://github.com/owner/repo`). A branch against a local path / GitLab /
 *     generic git URL is rejected with guidance rather than ignored.
 */
export function resolveSkillsSource(rawSource: string, branch?: string): SkillsSourceResolution {
  const hashIdx = rawSource.indexOf('#');
  const base = hashIdx === -1 ? rawSource : rawSource.slice(0, hashIdx);
  const refFromHash = hashIdx === -1 ? undefined : rawSource.slice(hashIdx + 1);
  const ref = (branch ?? refFromHash)?.trim() || undefined;

  // No ref → preserve today's verbatim pass-through (installs the default branch).
  if (!ref) {
    return { ok: true, source: base };
  }

  if (ref.includes('/')) {
    return {
      ok: false,
      reason:
        `branch '${ref}' contains a '/': the \`npx skills add\` GitHub tree-URL form cannot ` +
        'express a slashed branch name (it reads the first path segment after /tree/ as the ' +
        'whole ref). Use a single-segment branch, merge the skills to the default branch, or ' +
        'pass a local --source path.',
    };
  }

  // Local path or non-GitHub URL → branch translation doesn't apply.
  const looksLocalOrUrl =
    base.startsWith('.') || base.startsWith('/') || (base.includes('://') && !GH_URL.test(base));

  const shorthand = looksLocalOrUrl ? null : base.match(GH_SHORTHAND);
  if (shorthand) {
    const [, owner, repo, subdir] = shorthand;
    const tail = subdir ? `/${subdir}` : '';
    return {
      ok: true,
      source: `https://github.com/${owner}/${repo}/tree/${ref}${tail}`,
      branch: ref,
    };
  }

  const url = base.match(GH_URL);
  if (url) {
    const [, owner, repo] = url;
    return { ok: true, source: `https://github.com/${owner}/${repo}/tree/${ref}`, branch: ref };
  }

  return {
    ok: false,
    reason:
      `--branch only applies to a GitHub \`owner/repo\` (optionally \`owner/repo/subdir\`) or ` +
      `\`https://github.com/owner/repo\` source; '${base}' isn't one. Drop --branch, or point ` +
      '--source at a GitHub repo.',
  };
}

/**
 * Pure `npx skills add …` argv builder — the one place the Vercel `skills` flag
 * surface is encoded (Principle 8: wrap, don't rebuild). No I/O, no child spawn:
 * the act feeds the returned argv to the injected `ExecPort`, and tests assert
 * the exact array (Principle 3). The returned array is the args AFTER `npx`, i.e.
 * `['skills@latest', 'add', <source>, '-a', <t>, …, '-g'?, '-s', <slug>, …, '-y']`.
 *
 * Invariants (AC3/AC4):
 *   - always pins `skills@latest` and always appends `-y` (UNCONDITIONALLY — the
 *     builder makes it impossible to construct a blocking invocation, so the
 *     interactive picker never appears regardless of caller input);
 *   - each target fans out as a repeated `-a <target>`;
 *   - `-g` is present iff `global` is true.
 *
 * Precondition: `targets` is non-empty — enforced by the act (missing `--target`
 * → `E108`) before this is ever called.
 */
export function buildInstallArgv(opts: SkillsInstallOptions): string[] {
  const argv: string[] = ['skills@latest', 'add', opts.source];
  for (const target of opts.targets) {
    argv.push('-a', target);
  }
  if (opts.global) {
    argv.push('-g');
  }
  for (const slug of opts.skills ?? []) {
    argv.push('-s', slug);
  }
  // Unconditional: never let the Vercel interactive picker block (AC3).
  argv.push('-y');
  return argv;
}

/**
 * Pure `npx skills remove …` argv builder — the PRUNE half of `harness skills
 * update` (Principle 8: wrap, don't rebuild). No I/O. Renamed/removed skills are
 * passed as POSITIONAL slugs; `npx skills remove` no-ops (exit 0) on any slug that
 * isn't installed, so it is safe to call with the full legacy list every time.
 * Like the install builder it fans out `-a <target>`, adds `-g` iff global, and
 * always appends `-y` (never blocks). Returns the args AFTER `npx`:
 * `['skills@latest', 'remove', <slug>, …, '-a', <t>, …, '-g'?, '-y']`.
 *
 * Precondition: `slugs` and `targets` are both non-empty — enforced by the act.
 */
export function buildRemoveArgv(opts: SkillsRemoveOptions): string[] {
  const argv: string[] = ['skills@latest', 'remove', ...opts.slugs];
  for (const target of opts.targets) {
    argv.push('-a', target);
  }
  if (opts.global) {
    argv.push('-g');
  }
  // Unconditional: never let the Vercel interactive picker block (mirrors install).
  argv.push('-y');
  return argv;
}

/**
 * The human-readable command line we announce before running (and echo in the JSON
 * envelope). Generic over any `npx skills …` argv — used for both `add` and `remove`.
 */
export function formatInstallCommand(argv: string[]): string {
  return `npx ${argv.join(' ')}`;
}
