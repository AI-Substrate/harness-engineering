---
schema_version: "1.0"
retro_id: "2026-06-10T05:14:00Z-validate-flow-chalk"
agent: "validate-flow"
plan_id: null
started_at: "2026-06-10T05:03:58Z"
ended_at: "2026-06-10T05:14:00Z"
summary: "Installed the local harness CLI into the throwaway Chalk clone, wrote a harnessability assessment, scaffolded and filled a `boot` extension via `harness new`, and proved `harness boot --json` runs `npm test` successfully with coverage evidence."
entries:
  - id: VF-001
    kind: difficulty
    description: "Local-source CLI install first failed because npm ran the harness package prepare script against Chalk's older TypeScript toolchain."
    target: project
    severity: degrading
    workaround: "Copied the harness source inside the target, installed/build it in isolation, then installed the built copy into Chalk with `--ignore-scripts`."
    suggested_encoding: "Document a local-source install path that builds the harness package independently of the consumer repo's dependency graph, or provide a CLI-pack artifact for local dogfood runs."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:07:20.924Z"
  - id: VF-002
    kind: difficulty
    description: "The setup docs say `harness init` can be missing and should be skipped, but the CLI reports a generic root argument error (E108) rather than an init-specific unknown-command fallback."
    target: project
    severity: annoying
    workaround: "Treated the error as the documented missing-init fallback and continued with `harness new`."
    suggested_encoding: "Have the CLI or setup docs expose a clearer `init unavailable` envelope and next action."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:07:32.255Z"
  - id: VF-003
    kind: difficulty
    description: "A `harness observe` capture used backticks inside a double-quoted shell argument, so the shell executed `harness instructions boot` and bloated the observation text before the CLI received it."
    target: project
    severity: annoying
    workaround: "Preserved the friction in this retro and used a concise final-report difficulty rather than relying on the bloated raw buffer entry."
    suggested_encoding: "Examples for `harness observe` should prefer single quotes around descriptions that mention commands with backticks."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:13:23.229Z"
---

# Retro - validate harness flow on Chalk

Worked well: once the CLI was available, `harness new boot --wrap "npm test"` created a loadable extension quickly, and the independent verification path (`doctor`, `help`, `instructions`, `boot`) was clear.

Magic wand: make local-source dogfood install a single deterministic command that builds the harness package outside the consumer repo and installs the built artifact, so the target repo's older dev toolchain cannot break harness setup.
