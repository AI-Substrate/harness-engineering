# Original ask — harnessability-survey
**Captured**: 2026-06-08T23:50:20Z  ·  **By**: /the-flow

> next we are working on skills/harnessability-assessment. we have some suggetsions here: ~/substrate/harness-engineering/scratch/paste/20260608T234721.md and here ~/substrate/harness-engineering/scratch/paste/20260608T234735.md. review suggestions then we will kick off to prepare our implementation.

## Source suggestion files (private scratch — sanitize before tracking)
- `scratch/paste/20260608T234721.md` — Handoff: rework `harnessability-assessment` to survey existing engineering flows + deterministic harness opportunities. Changes output contract to `.harness/reports/harnessability/<ordinal>-<slug>/`, bumps schema to `v0.2`, adds A–F assessment matrix, terminal-sized `summary.md`, and many new report sections/JSON arrays (engineering flows, pre-commit gates, CI/local equivalence, deterministic encoding, test mechanisms/fakes/sinks, external dependency pressure, code composition, existing harness concept detection). 20 acceptance questions; concrete file list; validation checklist.
- `scratch/paste/20260608T234735.md` — Addendum: Manual / IDE-Only operation signals scan (`manual_operation_signals[]`, v0.2 optional field), influencing existing A4/A5/A7/A8/A9/B5/B10 dimensions; advisory, don't over-penalise brownfield/desktop/mobile.

## Key integration note
The current skill writes to the OLD path `harness/assessment/`. The suggestions move it to `.harness/reports/harnessability/` with `latest.json`/`latest.md` — which CONVERGES with the sentinel that plan 008's `engineering-harness-setup` skill already pins (`.harness/reports/harnessability/latest.json`). This rework closes that cross-skill contract gap.
