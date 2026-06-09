---
schema_version: "1.0"
retro_id: "2026-06-09T12:45:33Z-github-copilot-a6b1"
agent: "github-copilot"
plan_id: null
started_at: "2026-06-09T12:35:31Z"
ended_at: "2026-06-09T12:45:33Z"
summary: "Ran the full harness setup flow against a fresh Chalk clone: installed the harness core, produced the harnessability assessment, wrote governance from the BIO template, authored and verified a boot extension around npm test, and recorded this retro."
entries:
  - id: GFT-001
    kind: gift
    description: "Chalk had a compact, local, deterministic npm test lane, so the boot command and health check were easy to ground in real evidence."
    target: project
    suggested_encoding: "no encoding needed"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:39:00Z"
  - id: DL-001
    kind: difficulty
    description: "The shell MINIH_PROJECT_ROOT pointed at the run folder even though the task said the harness source lived at MINIH_PROJECT_ROOT; skills only resolved after manually using the repository root from the runtime context."
    target: minih
    severity: degrading
    workaround: "Ran minih skills doctor from /Users/jordanknight/substrate/harness-engineering and used that as the harness source for installation."
    suggested_encoding: "make MINIH_PROJECT_ROOT unambiguously point at the project root or expose a separate MINIH_RUN_ROOT"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:36:00Z"
  - id: DL-002
    kind: difficulty
    description: "npx harness doctor --json in the consumer clone reported cli-build degraded because it looked for harness/cli/dist/index.js in the target repo, even though the installed npx harness binary was callable."
    target: project
    severity: degrading
    workaround: "Parsed the doctor envelope and treated extension loading independently from the unrelated cli-build layer."
    suggested_encoding: "teach doctor to distinguish installed-consumer mode from source-checkout mode"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:37:42Z"
  - id: DL-003
    kind: difficulty
    description: "Installing the local harness core into Chalk mutated package.json by adding a file dependency, which is expected in the throwaway clone but noisy when assessing original repo state."
    target: project
    severity: annoying
    workaround: "Read the original package.json from git HEAD for assessment evidence and kept all writes inside the target clone."
    suggested_encoding: "document that local install mutates package.json or provide a no-save install path in the flow recipe"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:40:00Z"
  - id: DL-004
    kind: difficulty
    description: "A broad file glob after npm install traversed node_modules and timed out, which polluted the assessment with dependency noise until the search was narrowed manually."
    target: minih
    severity: annoying
    workaround: "Used find with node_modules and .git pruned, then read targeted files."
    suggested_encoding: "make validation prompts warn to exclude node_modules after the required install"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:38:30Z"
  - id: DL-005
    kind: difficulty
    description: "harness new boot --wrap accepted the wrapped command but did not accept a description flag, so the generated extension initially had a TODO summary."
    target: project
    severity: annoying
    workaround: "Retried the documented command without --description, then filled the generated summary in the extension."
    suggested_encoding: "add --summary/--description to harness new or document that summaries must be edited after scaffold"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:44:00Z"
  - id: MW-001
    kind: magic-wand
    description: "Ship harness init so governance can be generated from discovered assessment facts instead of hand-written from the BIO template during every setup-flow dogfood run."
    target: project
    suggested_encoding: "harness init command that reads latest harnessability assessment and writes .harness/engineering-harness.md"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:43:00Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro - Chalk harness flow

The flow worked end to end on a well-harnessable library, and the most valuable improvement remains automating governance creation with `harness init`.
