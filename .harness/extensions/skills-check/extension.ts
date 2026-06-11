import type { HarnessVerb, VerbContext } from '@ai-substrate/engineering-harness/contract';
import { checkAll, type SkillFile, toDecision } from './frontmatter.js';

/**
 * `harness skills-check` — deterministic skill-loadability back pressure.
 *
 * Hosts (Claude Code, Copilot CLI, Cursor, …) silently SKIP a SKILL.md whose
 * frontmatter violates the Agent Skills spec — measured in the field
 * 2026-06-11 when Copilot CLI dropped `eng-harness-flow` because its
 * description ran 1379 chars (spec max: 1024). "Installed but invisible" is
 * the worst failure mode: nothing errors, the skill just never fires.
 *
 * This verb walks every SKILL.md under `skills/` (or `--dir <path>`) and
 * validates the spec rules via the pure `frontmatter.ts` (unit-tested); this
 * shell only walks the tree and maps the decision onto an honest envelope.
 *
 * Guardrails honoured: no `node:*` imports; all I/O via `ctx.fs`; never
 * throws; every non-ok result carries a `next_action`.
 */

const DEFAULT_DIR = 'skills';
const SKIP_DIRS = new Set(['node_modules', '.git']);

function collectSkills(ctx: VerbContext, root: string, rel: string, out: SkillFile[]): void {
  for (const entry of ctx.fs.readdir(`${root}/${rel}`)) {
    if (SKIP_DIRS.has(entry)) continue;
    const relPath = `${rel}/${entry}`;
    if (entry === 'SKILL.md') {
      const text = ctx.fs.readText(`${root}/${relPath}`);
      if (text !== null) {
        const parts = rel.split('/');
        out.push({ path: relPath, dirName: parts[parts.length - 1], text });
      }
    } else {
      // readdir on a file returns [] (adapter contract), so blind recursion is safe.
      collectSkills(ctx, root, relPath, out);
    }
  }
}

const skillsCheck: HarnessVerb = {
  name: 'skills-check',
  summary:
    'Prove every SKILL.md is loadable: validate frontmatter against the Agent Skills spec limits hosts silently enforce.',
  description:
    'Walks skills/ (or --dir <path>) for SKILL.md files and checks the Agent Skills spec rules: ' +
    'name required, ≤64 chars, lowercase/digits/hyphens, equal to its directory name, unique across the tree; ' +
    'description required, ≤1024 chars (error — hosts silently skip the skill) with a >900-char headroom warning. ' +
    'Envelope: violations => error/exit 1; headroom warnings only => degraded/exit 0; clean => ok/exit 0; ' +
    'no skills found => unconfigured/exit 2. See `harness instructions skills-check`.',
  options: [
    {
      flags: '--dir <path>',
      description: `directory to scan for SKILL.md files (default: ${DEFAULT_DIR})`,
    },
  ],
  run(ctx) {
    try {
      const dir = typeof ctx.options.dir === 'string' ? ctx.options.dir : DEFAULT_DIR;
      const root = dir.startsWith('/') ? dir : `${ctx.cwd}/${dir}`;

      if (!ctx.fs.exists(root)) {
        return ctx.unconfigured(
          `'${dir}' does not exist at ${ctx.cwd}. Run from the repo root, or point --dir at a skills tree ` +
            '(e.g. `harness skills-check --dir ./.claude/skills`).',
        );
      }

      const skills: SkillFile[] = [];
      collectSkills(ctx, root, '.', skills);
      // Repo-relative display paths (collect uses './…' internally).
      for (const s of skills) s.path = `${dir}/${s.path.slice(2)}`;

      if (skills.length === 0) {
        return ctx.unconfigured(
          `no SKILL.md files found under '${dir}'. Point --dir at a skills tree, or add a skill first.`,
        );
      }

      const decision = toDecision(skills.length, checkAll(skills));
      if (decision.status === 'error' && decision.error) {
        // The kernel's error envelope has no top-level data slot — findings
        // ride in error.details so the scan result survives finalization.
        return ctx.error(decision.error.code, decision.error.message, {
          details: decision.data,
          next_action: decision.next_action,
        });
      }
      if (decision.status === 'degraded' && decision.next_action) {
        return ctx.degraded(decision.data, decision.next_action);
      }
      return ctx.ok(decision.data);
    } catch (e) {
      // "Never throws" backstop — any unexpected failure is still an honest envelope.
      return ctx.error('E_SKILLS_CHECK_UNEXPECTED', 'skills-check failed unexpectedly', {
        details: e instanceof Error ? e.message : String(e),
        next_action: 'Inspect error.details, then re-run `harness skills-check --json`.',
      });
    }
  },
};

export default skillsCheck;
