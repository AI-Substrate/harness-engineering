import type { HarnessRecordType } from '../contract.js';

/**
 * The core `harness-bypass` record type — the **"the paved harness path was NOT
 * used"** signal (the negative-space signal that silently vanishes today). Inline
 * TS constant (plan Q-A "lean"): ships cleanly via `npx` with no packaging change,
 * mirroring `retro.ts`.
 *
 * The template ships only `schema_version` + the agent-filled **body** keys of the
 * Frozen Frontmatter Contract (`cause`/`attempted`/`command`/`severity`). The CLI
 * splices the 7-key provenance header into this frontmatter at write time
 * (`services/record/provenance.ts`), so a written record carries all 8 provenance
 * keys + the 4 body keys. The CLI is schema-agnostic — the body "schema" lives
 * HERE as frontmatter keys + commented enum guidance, never parsed by the CLI.
 */
export const HARNESS_BYPASS_TEMPLATE = `---
schema_version: "1.0"
cause: "<missing-command|command-failed|too-slow|unclear-output|no-coverage|policy|agent-could-not>"
attempted: false                  # did you try the harness path before bypassing?  (true | false)
command: "<the harness command you would have / did run, or empty>"
severity: "<blocking|degrading|annoying>"
---

# Harness bypass — <what you did instead of the paved path>

<!-- One record per time the harness path was abandoned. The structured frontmatter
     above is the durable, scannable signal; this body is optional human narrative. -->
`;

/** The core `harness-bypass` record type (always present, even under \`--no-extensions\`). */
export const harnessBypassRecordType: HarnessRecordType = {
  kind: 'record',
  type: 'harness-bypass',
  description: 'Signal that the paved harness path was not used (bypass) — cause + severity.',
  template: HARNESS_BYPASS_TEMPLATE,
};
