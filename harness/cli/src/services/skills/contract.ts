/**
 * Contract for `harness skills install` — the options the act collects and the
 * pure service turns into an `npx skills` argv. Kept tiny + I/O-free so the argv
 * construction is unit-testable (Principle 3: pure logic, no child spawn here).
 */

/**
 * The default skills source: this repo's `skills/` subtree (the `owner/repo/subdir`
 * form `npx skills add` accepts), so the command installs THIS harness's skills from
 * anywhere it runs. Scoped to `/skills` ON PURPOSE: a bare `owner/repo` makes the
 * installer fetch the whole repo and recursively sweep EVERY `SKILL.md` it finds —
 * which would pull in any stray skill under `agents/`, fixtures, or future top-level
 * dirs. Pinning the subdir keeps the install to the published skill set only.
 */
export const DEFAULT_SKILLS_SOURCE = 'AI-Substrate/harness-engineering/skills';

/** CLI targets the Vercel `skills` tool understands (the `-a <agent>` values). Surfaced for help/validation. */
export const KNOWN_SKILL_TARGETS = [
  'claude-code',
  'codex',
  'cursor',
  'github-copilot',
  'opencode',
  'pi',
] as const;

export interface SkillsInstallOptions {
  /** `owner/repo` (or `owner/repo/subdir`, or a local path) passed to `npx skills add`. */
  source: string;
  /** One or more CLI targets → fanned out as repeated `-a <target>`. Must be non-empty. */
  targets: string[];
  /** Global install (`-g`) vs project-local (omit `-g`). */
  global: boolean;
  /** Optional single-skill filters → repeated `-s <slug>`. */
  skills?: string[];
}
