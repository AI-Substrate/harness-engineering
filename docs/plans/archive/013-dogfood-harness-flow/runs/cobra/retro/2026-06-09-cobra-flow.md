---
schema_version: "1.0"
retro_id: "2026-06-09T12:56:40Z-github-copilot-c0b4a1"
agent: "github-copilot"
plan_id: null
started_at: "2026-06-09T12:48:33Z"
ended_at: "2026-06-09T12:56:40Z"
summary: "Validated the harness setup flow on a fresh Cobra clone: installed the local harness core, produced a harnessability assessment, hand-wrote governance from the BIO template, scaffolded and filled a boot extension, verified boot against go test ./..., and recorded this retro."
entries:
  - id: VF-001
    kind: difficulty
    description: "The documented local install command `npm install $MINIH_PROJECT_ROOT` is unsafe in a Go repo with no package.json because npm chose /tmp as the prefix and tried to write /private/tmp/node_modules instead of the target clone."
    target: project
    severity: degrading
    workaround: "Used `npm install --prefix . ~/substrate/harness-engineering --no-audit --no-fund` so node_modules stayed inside the target clone."
    suggested_encoding: "Document or encode `npm install --prefix . <harnessSource>` for non-Node target repos."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:49:14Z"
  - id: VF-002
    kind: difficulty
    description: "`harness doctor --json` stayed degraded after installation because the local file install pointed at a harness source tree whose `harness/cli/dist/index.js` was not built, even though the npx harness command itself worked."
    target: project
    severity: annoying
    workaround: "Treated the parseable doctor Envelope and working CLI as sufficient for the install sanity check, while recording the degraded cli-build layer in the final report."
    suggested_encoding: "Make local install prepare/build expectations produce a clearer doctor status or next_action for file-installed consumers."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:49:50Z"
  - id: VF-003
    kind: difficulty
    description: "The harnessability assessment skill is guidance-only in this CLI context; it does not expose a single command that writes the required report, so the agent had to manually produce the skill's report artifacts while following the skill contract."
    target: project
    severity: degrading
    workaround: "Used the skill's schema/template instructions and wrote `.harness/reports/harnessability/*` directly, then independently read `latest.json`."
    suggested_encoding: "Ship an executable assessment command or skill runner entrypoint that writes the v0.2 reports from gathered evidence."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:52:00Z"
  - id: VF-004
    kind: difficulty
    description: "The flow requires governance to be hand-written because no `harness init` writer is shipped yet, which forces agents to copy the BIO contract manually."
    target: project
    severity: degrading
    workaround: "Read the governance template and hand-wrote `.harness/engineering-harness.md` with all eight BIO fields."
    suggested_encoding: "Ship `harness init` to generate `.harness/engineering-harness.md` from discovered repo commands and prompts."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:54:00Z"
  - id: VF-005
    kind: difficulty
    description: "`harness new boot --wrap` produced a loadable stub with a placeholder summary and hard error behavior on wrapped command failure, so it was not yet an honest boot Envelope for degraded test failures."
    target: project
    severity: annoying
    workaround: "Edited the scaffolded file to add a real summary, include command/exit/duration/stdout/stderr data, and return `ctx.degraded` with a next_action when tests fail."
    suggested_encoding: "Let `harness new --wrap` accept summary and failure-mode options, or scaffold degraded-by-default wrappers for boot-like verbs."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:55:45Z"
  - id: VF-006
    kind: difficulty
    description: "The required output instructions say difficulty IDs should be VF-NNN, while the generic schema example says MH-NNN, creating conflicting numbering guidance."
    target: minih
    severity: annoying
    workaround: "Used VF-NNN as the task-specific rule because it was explicit for this validate-harness-flow run."
    suggested_encoding: "Parameterize the minih output instructions so the example difficulty prefix matches the agent/run type."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:48:33Z"
  - id: MW-001
    kind: magic-wand
    description: "Ship a single headless `harness setup --repo <path> --boot 'go test ./...' --json` command that installs the core in the repo-local prefix, writes the assessment, generates governance, scaffolds boot, verifies it, and records paths in one Envelope."
    target: project
    suggested_encoding: "Add a headless setup orchestrator command with repo-local npm prefix handling."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:56:40Z"
  - id: GFT-001
    kind: gift
    description: "Once scaffolded and filled, the boot extension loaded cleanly and `harness boot --json` exercised the Cobra Go test suite successfully."
    target: project
    suggested_encoding: "No encoding needed."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:56:20Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — cobra flow

The setup flow reached a working boot harness on Cobra, with the major friction concentrated in missing headless setup writers and npm prefix behavior for non-Node target repos.
