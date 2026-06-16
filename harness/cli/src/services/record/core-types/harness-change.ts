import type { HarnessRecordType } from '../contract.js';

/**
 * The core `harness-change` record type — the **encoded-improvement ledger** that
 * replaces the hand-maintained `.harness/history.md` (which had zero code writers).
 * Inline TS constant, mirroring `retro.ts`.
 *
 * The template ships only `schema_version` + the agent-filled **body** keys of the
 * Frozen Frontmatter Contract (`resolves`/`change_type`/`target`). The CLI splices
 * the 7-key provenance header into this frontmatter at write time. The CLI is
 * schema-agnostic — the body "schema" lives HERE (frontmatter keys + commented
 * enum guidance), never parsed by the CLI.
 */
export const HARNESS_CHANGE_TEMPLATE = `---
schema_version: "1.0"
resolves: "<free-form ref <=200 chars: a record path, issues/123, org/repo#45, or <retro_id>:<entry_id>>"
change_type: "<new-command|sensor|fixture|template|doc|skill-edit|routing>"
target: "<what the change touches — e.g. a justfile recipe, a skill slug, a CI step>"
---

# Harness change — <one line: what improved>

<!-- One record per encoded harness improvement (this ledger replaces history.md).
     The structured frontmatter above is the durable, scannable signal. -->
`;

/** The core `harness-change` record type (always present, even under \`--no-extensions\`). */
export const harnessChangeRecordType: HarnessRecordType = {
  kind: 'record',
  type: 'harness-change',
  description:
    'Encoded harness-improvement ledger entry (replaces history.md) — what changed + why.',
  template: HARNESS_CHANGE_TEMPLATE,
};
