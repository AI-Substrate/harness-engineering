import type { HarnessVerb, VerbContext, VerbResult } from '@ai-substrate/engineering-harness/contract';
import { type Finding, inScope, RULES, scanText } from './lib/rules.js';

/**
 * `harness windows-check` — deterministic Windows-compat back pressure (plan
 * 031). Statically flags the cross-platform anti-patterns the dogfood verbs
 * regressed on (POSIX shell-outs, `/tmp`, `node:*` in a verb, a bare-`.cmd`
 * launch idiom, a clone without `core.longpaths`, …) so Windows compatibility is
 * proven BY CONSTRUCTION on the existing ubuntu CI legs — no Windows runner
 * (continuing plan 017's posture).
 *
 * "Wrap, don't rebuild" (P8): the only side effects are `ctx.exec('git ls-files')`
 * to enumerate and `ctx.fs.readText` to read; ALL rule logic is the pure,
 * unit-tested `lib/rules.ts`. Scope is the extension verb layer
 * (`.harness/extensions/**`, minus self/tests/fixtures) — the core's adapters
 * legitimately own `node:*` and are out of scope.
 *
 * Warn-launch (mirrors arch-check / markdown-lint): findings land as
 * `degraded`/exit 0 (visible, non-blocking); a clean tree is `ok`/exit 0; no git
 * tree is `unconfigured`/exit 2. Guardrails: no `node:*`; all I/O via `ctx`;
 * never throws; every non-ok result carries a `next_action`.
 */

interface WindowsCheckData {
  scanned: number;
  findingCount: number;
  byRule: Record<string, number>;
  findings: Finding[];
}

const windowsCheck: HarnessVerb = {
  name: 'windows-check',
  summary:
    'Statically flag Windows-incompatible patterns in the extension verbs (POSIX shell-outs, /tmp, node:* in a verb, bare-.cmd launch, …) — warn-launch, no Windows CI needed.',
  description:
    "Enumerates tracked extension sources (.harness/extensions/**, excluding this verb's own files, tests, and fixtures) via `git ls-files`, reads each through ctx.fs, and applies the pure rule set in lib/rules.ts. " +
    'Aggregates to one honest envelope: 0 findings => ok/exit 0 with counts; any findings => degraded/exit 0 (warn-launch — visible, non-blocking, promote to error once the verbs are clean); not a git tree => unconfigured/exit 2. ' +
    'Suppress a deliberate line with a trailing `// win-ok: <reason>`. See `harness instructions windows-check`.',
  options: [
    {
      flags: '--dir <path>',
      description: 'restrict the scan to in-scope extension sources under this directory',
    },
  ],
  async run(ctx): Promise<VerbResult> {
    try {
      if (!ctx.git.isRepo()) {
        return ctx.unconfigured(
          'windows-check scans the repo tracked sources — run it from inside the git work tree (repo root).',
        );
      }
      // `-z`: NUL-delimited raw paths (git C-quotes non-ASCII names otherwise,
      // which would slip the scope filter — mirrors markdown-lint).
      const ls = await ctx.exec('git', ['ls-files', '-z'], { cwd: ctx.cwd });
      if (!ls.ok) {
        return ctx.unconfigured(
          `Could not list tracked files (git ls-files exited ${ls.code}). Run from the repo root.`,
        );
      }

      const dir =
        typeof ctx.options.dir === 'string'
          ? ctx.options.dir.replace(/\\/g, '/').replace(/\/+$/, '')
          : undefined;
      const files = ls.stdout
        .split('\0')
        .filter(Boolean)
        .filter(inScope)
        .filter((f) => !dir || f === dir || f.startsWith(`${dir}/`));

      const findings: Finding[] = [];
      for (const file of files) {
        const text = ctx.fs.readText(`${ctx.cwd}/${file}`);
        if (text != null) findings.push(...scanText(file, text));
      }

      const byRule: Record<string, number> = {};
      for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;

      const data: WindowsCheckData = {
        scanned: files.length,
        findingCount: findings.length,
        byRule,
        findings,
      };

      if (findings.length === 0) {
        return ctx.ok(data, {
          next_action:
            files.length === 0
              ? 'No in-scope extension sources found under .harness/extensions/.'
              : undefined,
        });
      }

      const first = findings[0];
      const ruleSummary = Object.entries(byRule)
        .map(([id, n]) => `${id}×${n}`)
        .join(', ');
      return ctx.degraded(
        data,
        `windows-check found ${findings.length} cross-platform hazard(s) in ${Object.keys(byRule).length} rule class(es) [${ruleSummary}] (warn-launch — non-blocking). ` +
          `First: ${first.file}:${first.line} [${first.rule}] ${first.title}. Fix per each finding's message, or add \`// win-ok: <reason>\` to intentionally allow a line. ` +
          `Rules: ${RULES.map((r) => r.id).join(', ')}. See \`harness instructions windows-check\`.`,
      );
    } catch (e) {
      return ctx.error('E_WINDOWS_CHECK_UNEXPECTED', 'windows-check failed unexpectedly', {
        details: e instanceof Error ? e.message : String(e),
        next_action:
          'Re-run from the repo root. If it persists, report it — the scan is pure text matching over .harness/extensions/ sources.',
      });
    }
  },
};

export default windowsCheck;
