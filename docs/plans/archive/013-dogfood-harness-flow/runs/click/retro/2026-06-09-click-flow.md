---
schema_version: "1.0"
retro_id: "2026-06-09T12:56:31Z-github-copilot-vf-click"
agent: "github-copilot"
plan_id: null
started_at: "2026-06-09T12:48:29Z"
ended_at: "2026-06-09T12:56:31Z"
summary: "Validated the harness setup flow on a fresh Click clone: installed the local harness core, produced a harnessability assessment, hand-wrote BIO governance, scaffolded and filled a boot extension, verified boot against pytest, and recorded this retro."
entries:
  - id: VF-001
    kind: difficulty
    description: "The local file install made npx harness callable, but harness doctor reported cli-build degraded because harness/cli/dist/index.js was not present in the consumer clone."
    target: project
    severity: degrading
    workaround: "Treated the degraded doctor layer as friction because core commands still ran, then verified help, doctor, and boot independently."
    suggested_encoding: "Make doctor distinguish installed package mode from source-checkout CLI build checks."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:49:19Z"
  - id: VF-002
    kind: difficulty
    description: "The harnessability assessment skill is a prose skill with a rich schema but no deterministic command, so producing the report required manual report assembly while still following the skill contract."
    target: project
    severity: degrading
    workaround: "Used the skill context and schema templates to write the required assessment files, then read latest.json independently."
    suggested_encoding: "Ship a harnessability assessment CLI writer that performs schema validation and writes latest/report artifacts."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:52:00Z"
  - id: VF-003
    kind: difficulty
    description: "There is no harness init writer, so the governance contract had to be hand-written from the BIO template."
    target: project
    severity: degrading
    workaround: "Created .harness/engineering-harness.md manually with all eight BIO fields grounded in the Click evidence."
    suggested_encoding: "Ship harness init to write the BIO governance skeleton from discovered assessment data."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:54:30Z"
  - id: VF-004
    kind: confusion
    description: "harness new --wrap generated a loadable boot extension with a TODO summary, requiring a manual metadata edit before the verb looked production-ready in help."
    target: project
    severity: annoying
    workaround: "Edited the scaffolded summary to describe the Click pytest health check."
    suggested_encoding: "Let harness new accept --summary or derive a non-TODO summary from the wrapped command."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:55:34Z"
  - id: VF-005
    kind: difficulty
    description: "The successful wrapped boot envelope only reported the command, not stdout, duration, test count, or artifact paths, so independent proof required checking pytest cache side effects."
    target: project
    severity: annoying
    workaround: "Checked .pytest_cache/v/cache/nodeids and found 1697 node IDs after boot."
    suggested_encoding: "Have wrap-generated verbs include stdout/stderr snippets, duration, exit code, and configurable evidence labels in the ok envelope."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:56:03Z"
  - id: VF-006
    kind: difficulty
    description: "The prompt's difficulty ID examples used MH-001 but the Validate Harness Flow rules required VF-001 numbering, creating a small reporting convention conflict."
    target: minih
    severity: annoying
    workaround: "Followed the flow-specific VF-001 numbering required by the validation rules."
    suggested_encoding: "Make minih prompt templates parameterize the difficulty ID prefix for each agent."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:48:29Z"
  - id: MW-001
    kind: magic-wand
    description: "Ship harness init so governance is generated from the assessment instead of hand-written during setup."
    target: project
    suggested_encoding: "Add npx harness init --from-assessment .harness/reports/harnessability/latest.json."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:56:31Z"
---

# Retro - click flow

The flow worked end to end on Click, with the main friction concentrated in
missing deterministic writers and sparse success evidence from wrapped commands.
