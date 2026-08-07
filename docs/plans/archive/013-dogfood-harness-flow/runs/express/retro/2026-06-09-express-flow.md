---
schema_version: "1.0"
retro_id: "2026-06-09T12:57:02Z-github-copilot-0f22"
agent: "github-copilot"
plan_id: null
started_at: "2026-06-09T12:48:25Z"
ended_at: "2026-06-09T12:57:02Z"
summary: "Ran the harness setup flow against the Express throwaway clone: installed the harness core, produced a harnessability assessment, hand-wrote the governance BIO contract, scaffolded and filled a boot extension, verified boot, and recorded this retro."
entries:
  - id: VF-001
    kind: difficulty
    description: "The shell did not expose MINIH_PROJECT_ROOT even though the run instructions require starting from it."
    target: minih
    severity: annoying
    workaround: "Used the literal project root from the execution context: ~/substrate/harness-engineering."
    suggested_encoding: "Ensure minih exports MINIH_PROJECT_ROOT into agent tool shells or pass an explicit fallback variable."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:48:51Z"
  - id: VF-002
    kind: difficulty
    description: "There is no shipped harness init writer, so the governance doc had to be hand-written from the BIO template."
    target: project
    severity: degrading
    workaround: "Read the governance template and wrote .harness/engineering-harness.md with all eight BIO fields."
    suggested_encoding: "Ship `harness init` to generate the BIO governance contract from detected repo evidence."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:53:20Z"
  - id: VF-003
    kind: difficulty
    description: "npx harness doctor --json worked but reported cli-build degraded because it looked for harness/cli/dist inside the target clone."
    target: project
    severity: annoying
    workaround: "Treated the working npx harness entrypoint and extension/record-type discovery as sufficient while preserving the degraded doctor status in the report."
    suggested_encoding: "Teach doctor to distinguish installed package mode from source-checkout mode before checking harness/cli/dist."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:49:22Z"
  - id: VF-004
    kind: difficulty
    description: "The first plain `npx harness boot` invocation returned error even though `npx harness boot --json` and direct `npm test` passed immediately afterward."
    target: project
    severity: degrading
    workaround: "Re-ran the boot with --json, direct npm test, HARNESS_JSON=1, NO_COLOR=1, and then plain mode until the extension returned ok; recorded bootRuns true only after a real passing boot."
    suggested_encoding: "Add a regression test for extension ctx.exec output-mode stability across JSON, NO_COLOR, and interactive human output."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:55:45Z"
  - id: VF-005
    kind: gift
    description: "The add-extension skill plus `harness new boot --wrap \"npm test\" --js` produced a loadable extension with very little manual work."
    target: project
    suggested_encoding: "No encoding needed; preserve the scaffold-first workflow."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:55:00Z"
  - id: VF-006
    kind: magic-wand
    description: "A single headless setup command should install the harness, run assessment, apply the abandonment gate, generate governance, scaffold boot, verify it, and scaffold the retro while still exposing each child step for dogfood."
    target: project
    suggested_encoding: "Ship a non-interactive `harness setup --json --repo <path>` orchestrator that delegates to the same child skills and emits step Envelopes."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:57:02Z"
---

# Retro - express flow

The flow completed on the Express clone. The strongest project feedback is to ship the missing `harness init` writer and clarify doctor/source-install mode; the strongest minih feedback is to export `MINIH_PROJECT_ROOT` into tool shells for agents that are explicitly instructed to start there.
