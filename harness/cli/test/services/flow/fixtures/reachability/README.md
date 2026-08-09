# Reachability fixtures (plan 081)

Known-good and known-bad plan-folder shapes for the flow-reachability checks.

**Provenance**: `098-shaped/` and `099-shaped/` model the two real streams from the
pij wave measured in AI-Substrate/pij#227 (s098-daemon-perf: `findings.md` + `SEAT.md`
+ `bench/`, no plan document, no flight plan; s099-send-tool-xor: `assets/` only).
Modelled from the issue's measured table on 2026-08-09 — the original worktrees were
torn down before this plan, so shapes could not be re-verified against disk.

| fixture | plan.dd.json | the-flow.json | expected verdict |
|---|---|---|---|
| 098-shaped | absent | absent | error (no plan) |
| 099-shaped | absent | absent | error (no plan) |
| plan-without-flow | valid (CLI-scaffolded) | absent | degraded warning (E301 reason) |
| both-good | valid (CLI-scaffolded) | valid (CLI-created) | ok |
| legacy-flow | absent | no `provenance` (E308) | plan clause decides; flow reason = legacy |
| malformed-flow | absent | invalid JSON (E300) | plan clause decides; flow reason = malformed |

The valid artifacts were produced by the real CLI (`plan new`, `flow create`), never
hand-written, so schema evolution regenerates rather than rots them.
