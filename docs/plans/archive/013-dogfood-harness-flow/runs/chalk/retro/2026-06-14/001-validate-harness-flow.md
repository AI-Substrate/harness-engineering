---
schema_version: "1.0"
retro_id: "2026-06-14T23:59:10Z-github-copilot-validate-flow"
agent: "github-copilot"
plan_id: null
started_at: "2026-06-14T23:52:27Z"
ended_at: "2026-06-14T23:59:10Z"
summary: "Validated the harness onboarding flow against a fresh Chalk clone: confirmed the global CLI, produced a harnessability assessment, initialized the harness nucleus, scaffolded and filled a boot extension, proved `harness boot --json` runs `npm install` plus `npm test`, and recorded the experience."
entries:
  - id: VF-001
    kind: difficulty
    description: "The assessment skill is a long authoring contract rather than a runnable assessment command, so producing its artifact required manually assembling the full JSON/Markdown shape and then fixing schema-specific field names."
    target: skill
    severity: degrading
    workaround: "Invoked the skill, followed its contract, copied the published schema, validated `latest.json`, and corrected optional survey arrays before adoption consumed the sentinel."
    suggested_encoding: "Add a deterministic assessment generator/check command that writes and validates the v0.2 report skeleton from gathered evidence."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T23:55:00Z"
  - id: VF-002
    kind: difficulty
    description: "The adoption skill still describes explicit ask-before-edit conversation, but this validation worker is a single-shot onboarding probe with prior throwaway-clone permission."
    target: skill
    severity: degrading
    workaround: "Treated the prompt as the operator approval for clone-local writes, avoided interactive routers, and recorded the injection map in governance."
    suggested_encoding: "Add a documented non-interactive adoption mode for disposable validation runs."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T23:56:00Z"
  - id: VF-003
    kind: confusion
    description: "`harness doctor --json` reported degraded in a consumer repo because global toolchain checks wanted `biome`, even though the consumer boot extension loaded and later proved the repo."
    target: tooling
    severity: annoying
    workaround: "Parsed the envelope layers independently and treated the extension/boot result as the adoption proof while noting the degraded toolchain layer honestly."
    suggested_encoding: "Scope product-repo toolchain checks out of consumer doctor output or label them as product-only/non-blocking."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T23:56:46Z"
  - id: VF-004
    kind: gift
    description: "`harness init` was available and created the governance doc deterministically, so adoption no longer had to rely on the older graceful fallback."
    target: tooling
    severity: annoying
    workaround: null
    suggested_encoding: "Keep init in the documented happy path and update older skill caveats that imply it may not exist."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-14T23:56:46Z"
---

# Retro — validate harness flow

The biggest cost was turning the assessment skill's prose contract into a valid
machine artifact. Once the sentinel existed, the CLI path itself was smooth:
`harness init`, `harness new boot`, `harness doctor`, `harness help`, and
`harness boot --json` all gave parseable envelopes or clear command output.
