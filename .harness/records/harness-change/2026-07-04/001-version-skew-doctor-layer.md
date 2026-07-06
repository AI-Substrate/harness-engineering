---
record_kind: "harness-change"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-04T03:53:06.499Z"
agent: "claude-fable-5 (pij-4s10mb)"
plan_id: null
schema_version: "1.0"
resolves: "pij-5vzfe7 field report (osk scratch/harness-render-stdout-report-for-pij-4s10mb.md) + session observe DL-003"
change_type: "sensor"
target: "harness doctor — new version-skew layer (services/doctor/doctor-service.ts)"
---

# Harness change — doctor detects a stale global harness shadowing the repo build

npm latest (0.6.0) lagged the unpublished repo head (0.7.0), so reinstalls silently
downgraded consumers (osk-split-billing: stale flow renders, old-schema telemetry;
two more peers bitten the same day). `harness doctor` now compares the RUNNING
binary's version against the dev repo's `package.json` and degrades with an
`npm link` next_action on mismatch. Old binaries can't self-report (they lack the
layer) — the remaining structural fix is publishing + lockstep releases, tracked
separately. Machine-global bin re-pointed via `npm link` (auto-refreshed by
`just build`).
