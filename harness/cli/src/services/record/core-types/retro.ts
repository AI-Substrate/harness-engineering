import type { HarnessRecordType } from '../contract.js';

/**
 * The core-bundled `retro` record type. Inline TS constant (plan Q-A "lean"):
 * ships cleanly via `npx` with no `package.json#files`/packaging change, mirroring
 * `services/scaffold/templates.ts`.
 *
 * `RETRO_TEMPLATE` is a **deployment echo** of the frozen
 * `skills/eng-harness-loop/eng-harness-4-retro/references/retro.schema.json`: its
 * frontmatter covers the schema's REQUIRED fields (`schema_version`, `retro_id`,
 * `agent`, `started_at`) and uses only the schema's open `system` object. The
 * schema stays the canonical contract; a future `schema?` field can attach it for
 * opt-in validation without changing this type's shape. A unit test
 * (`retro-template.test.ts`) pins the superset so the two can't drift.
 *
 * NOTE: `system.compound.*` below is a documented **convention** inside the
 * schema's open `system` object — NOT a schema-defined field.
 */
export const RETRO_TEMPLATE = `---
schema_version: "1.0"
retro_id: "<ISO8601Z>-<agent>-<hash>"     # e.g. 2026-06-09T09:55:00Z-github-copilot-a8f3
agent: "<your-agent-slug>"                 # lowercase kebab, e.g. github-copilot
plan_id: "<NNN-slug or null>"
started_at: "<ISO8601Z>"
ended_at: "<ISO8601Z>"
summary: "<one paragraph: what happened this session>"
entries:
  # One block per observation. id = <PREFIX>-<3+ digits>. Any uppercase prefix is valid;
  # DL/MW/GFT/INS/COORD/SUGG/CONF are the recommended per-kind defaults, and run-scoped
  # prefixes (e.g. VF- for a flow worker's own numbering) are equally fine.
  # kind in difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion
  - id: DL-001
    kind: difficulty
    description: "<>=10 chars - the friction, concretely>"
    target: tooling                         # project | tooling | plan | skill | doc | infra | minih | ...
    severity: degrading                     # blocking | degrading | annoying  (for kind: difficulty)
    workaround: "<what you did to get past it>"
    suggested_encoding: "<e.g. justfile recipe wrapping ripgrep>"
    system:
      compound:                             # CONVENTION (open 'system' object), not a schema field
        status: open                        # open | suggested | encoded | wontfix | stale | dismissed
        source: agent-self                  # user | agent-self
        first_seen_at: "<ISO8601Z>"
---

# Retro — <plan or session label>

<!-- Optional human narrative. The structured \`entries\` above are the durable signal. -->
`;

/** The core `retro` record type (always present, even under \`--no-extensions\`). */
export const retroRecordType: HarnessRecordType = {
  kind: 'record',
  type: 'retro',
  description: 'Harness loop retrospective — session friction, gifts, magic-wand wishes.',
  template: RETRO_TEMPLATE,
};
