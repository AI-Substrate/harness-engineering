---
record_kind: "harness-change"
harness_version: "0.3.0"
branch: "020-harness-bypass-change-records"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-06-16T07:21:03.979Z"
agent: "claude-code"
plan_id: "020-harness-bypass-change-records"
schema_version: "1.0"
resolves: "plan-014 orchestrator retro OH-001/OH-003"
change_type: "fixture"
target: "harness/cli test suite — cwd-independent path resolution (import.meta.url) in arch guards + NodeFs real-tree probes"
---

# Harness change — test suite made cwd-independent

<!-- One record per encoded harness improvement (this ledger replaces history.md).
     The structured frontmatter above is the durable, scannable signal. -->

**Original date:** 2026-06-10

**Improvement:** Test suite made cwd-independent — architecture guards + NodeFs
real-tree probes resolve from their own file location (`import.meta.url`), not
`process.cwd()`; the docs byte-compare failure now names its fix ("stale dist —
run `npm run build`").

**Trigger:** Plan 014 orchestrator magic wand (retro OH-001/OH-003: 4 false-alarm
failures + one undiagnosable stale-dist red across the build session).

**Evidence:** suite 317/317 green from BOTH `harness/cli` and the repo root.

> Migrated from the retired `.harness/history.md` ledger (its only row). The
> `harness-change` record ledger is now the harness changelog/trajectory.
