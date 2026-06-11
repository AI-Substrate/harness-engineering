---
schema_version: "1.0"
retro_id: "2026-06-09T13:21:06Z-github-copilot-a4f9c2"
agent: "github-copilot"
run_id: "2026-06-09T23-13-52-588Z-bb00"
plan_id: null
started_at: "2026-06-09T13:13:52Z"
ended_at: "2026-06-09T13:21:30Z"
summary: "Validated the harness setup flow on a fresh Chalk clone: installed the local harness core, produced a harnessability assessment, wrote the BIO governance doc, scaffolded and filled a boot verb around npm test, verified boot, and recorded this retro."
entries:
  - id: DL-001
    kind: difficulty
    description: "VF-001 [project] `harness doctor` in a consumer clone reported degraded `cli-build` because it looked for `harness/cli/dist` in the consumer tree even though the installed CLI worked."
    target: project
    severity: degrading
    workaround: "Treated it as the documented consumer-mode wart and independently verified install, extension loading, help, boot, and record paths."
    suggested_encoding: "Make doctor distinguish package-consumer mode"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T13:15:02Z"
  - id: DL-002
    kind: difficulty
    description: "VF-002 [minih] A broad file glob after installing dependencies traversed `node_modules` and timed out with a huge partial result."
    target: minih
    severity: annoying
    workaround: "Switched to `git ls-files` and narrow file reads for tracked source evidence."
    suggested_encoding: "Exclude node_modules in validation file scans"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T13:16:05Z"
  - id: DL-003
    kind: difficulty
    description: "VF-003 [project] Governance had to be hand-written because `harness init` is not shipped, even though the rest of the flow is skill-driven."
    target: project
    severity: degrading
    workaround: "Used the BIO governance template and verified all eight required headings manually."
    suggested_encoding: "Ship `harness init` from the BIO template"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T13:18:40Z"
  - id: DL-004
    kind: difficulty
    description: "VF-004 [project] `harness new boot --wrap \"npm test\"` produced a loadable extension, but the generated summary was a TODO and the success Envelope lacked useful evidence."
    target: project
    severity: annoying
    workaround: "Kept the scaffolded handler and edited it to include a real summary, description, command, exit code, proof lane, and output tails."
    suggested_encoding: "Improve `harness new --wrap` summaries and evidence"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T13:20:15Z"
  - id: GFT-001
    kind: gift
    description: "`harness record retro --slug chalk-flow --json` returned a deterministic path and scaffolded the core retro record without extra configuration."
    target: project
    suggested_encoding: "No encoding needed"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T13:21:06Z"
  - id: MW-001
    kind: magic-wand
    description: "Ship `harness init` so the governance doc can be generated from repo evidence and the BIO template instead of hand-written during setup."
    target: project
    suggested_encoding: "`harness init` writer"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T13:21:20Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — chalk harness flow

The structured entries above are the durable signal from this validation run.
