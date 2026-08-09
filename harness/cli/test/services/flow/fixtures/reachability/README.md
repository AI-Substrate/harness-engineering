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
| future-version-flow | absent | `schema_version: 99` (E306) | plan clause decides; flow reason = future-version |

The valid artifacts were produced by the real CLI (`plan new`, `flow create`), never
hand-written, so schema evolution regenerates rather than rots them.
`future-version-flow/the-flow.json` is a real `flow create flight-plan` output with
its `schema_version` bumped past this CLI's supported major — the one field a
current CLI cannot legitimately emit.

## Why there is no `invalid-plan-doc` fixture here

`plan-validate-e400-merge.test.ts` needs a plan folder holding a `plan.dd.json`
that is **present but not a readable dd document**. That file cannot live in this
directory, and the reason is worth recording so nobody adds one back:

`dd doctor` sweeps `harness/cli` for every `*.dd.json`. Its exclusion rule —
`shouldExcludeFromSweep` in `services/dd/core/walk.ts` — skips `sweep_exclude`
documents and test-fixture paths, but it takes the **parsed document** as an
argument, so it can only run on a file that parsed. A `*.dd.json` that does not
parse as a dd document never reaches the exclusion and is reported by the link
scan as `E436 link-scan-incomplete`, which turns `dd doctor` degraded and fails
`test/acts/dd.test.ts`'s "sweeps this package clean" pin.

So the invalid plan document is built at **runtime in an OS temp dir** instead —
outside any corpus scan. Note also that "invalid" has to mean *not a dd document*
for that test: a plan doc that IS a readable dd document but violates the plan
schema returns a **different** code (`E407` for a bad `meta.status`), not the
`E400` the merge is about.
