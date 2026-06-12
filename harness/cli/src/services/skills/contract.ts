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

/**
 * Slugs this harness PUBLISHED in the past and has since RENAMED or REMOVED. The
 * Vercel `npx skills` installer has no native prune — `add` and `update` are both
 * additive (verified empirically), so a renamed skill's OLD copy lingers on disk
 * (and keeps loading) forever. `harness skills update` removes these AFTER the
 * refresh, so a rename never leaves a stale twin behind — the exact failure this
 * fixes is `harnessability-assessment` AND its new name
 * `eng-harness-0-harnessability-assessment` both installed at once.
 *
 * MAINTENANCE CONTRACT: when you RENAME or REMOVE a published skill (any dir under
 * `skills/`), add its OLD slug here IN THE SAME CHANGE. `npx skills remove` no-ops
 * (exit 0) on a slug that isn't installed, so over-listing is harmless; the only
 * cost of forgetting is that the old copy lingers for consumers. Keep every entry
 * HARNESS-NAMESPACED (`harness-*` / `eng-harness-*` / `engineering-harness-*` /
 * `harnessability-*`) so a third-party skill that happens to share a generic name
 * is never pruned out from under a user.
 */
export const LEGACY_SKILL_SLUGS = [
  // Pre-`eng-` loop family → renamed to eng-harness-1-boot … eng-harness-4-retro.
  'harness-0-setup',
  'harness-1-boot',
  'harness-2-backpressure',
  'harness-3-observe',
  'harness-4-retro',
  // Setup-group slugs since renamed/removed.
  'eng-harness-0-setup', // → eng-harness-0-adopt
  'eng-harness-3-observe', // observe folded into eng-harness-4-retro
  'engineering-harness-orient', // → harnessability-assessment → eng-harness-0-harnessability-assessment
  'engineering-harness-setup', // → eng-harness-0-setup → eng-harness-0-adopt
  'harnessability-assessment', // → eng-harness-0-harnessability-assessment
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

export interface SkillsRemoveOptions {
  /** Skill slugs to remove → POSITIONAL args to `npx skills remove`. Must be non-empty. */
  slugs: string[];
  /** One or more CLI targets → fanned out as repeated `-a <target>`. Must be non-empty. */
  targets: string[];
  /** Remove from the global install (`-g`) vs project-local (omit `-g`). */
  global: boolean;
}
