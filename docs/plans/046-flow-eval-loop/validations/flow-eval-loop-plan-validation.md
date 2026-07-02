# Validation — flow-eval-loop-plan.md

**Verdict**: ✅ **VALIDATED WITH FIXES** — 0 critical, 0 high, 1 medium (fixed in-target).
**Target**: `docs/plans/046-flow-eval-loop/flow-eval-loop-plan.md` (Implementation plan, CS-4 / 4 phases)
**Validated**: 2026-07-01
**Proof level reached**: Implementation Ready

## Thesis
The plan advances its purpose: it turns the workshop-locked design (003–006) into a buildable, phased, peer-loop-validated implementation. Locally correct **and** purpose-advancing — every phase moves the eval from single-run scorer toward the looping, comparison-ready instrument the Promise names.

## Proof (fresh, this validation)
- **Every cited hook point opened and confirmed** (not rubber-stamped):
  - `scorer.ts` — `passWeight`/`failWeight`/`requiredFailed` accumulators (L93–98) + `score = passWeight/(passWeight+failWeight)` (L129) + cap (L123) — the two-axis seam is exactly where the plan says.
  - `resolvers.ts` — `skillSequence` binary `ordered` flag (L190) is the `match_mode` target; `SessionEvidence` re-declared (L40) → F13 lock-step confirmed.
  - `scenario.ts` — `ASSERTION_TYPES: Record<string, AssertionSource[]>` (L66) proves the plan's premise that **axis is orthogonal to proof-source** (it's a *new* classification, not the existing lane). `Assertion` interface (L19).
  - `report.ts` — `writeReport` (L141) writes under `…/<scenario>/<run_id>/` (L153).
  - `extension.ts` — single action-dispatched verb (the `ledger` action attaches to the existing switch).
  - `session-evidence.ts` — `fold` (L176) + `SessionEvidence` (L41) — the F13 span lands here, mirrored in resolvers.ts.
  - `README.md` — `## The loop` (L82) / `## The layers` (L98) exist (the new section's anchor).
- **AC coverage**: 12/12 ACs mapped to tasks in the Acceptance Coverage Map; each task carries a verifiable success criterion + the file hook.
- **Build facts confirmed**: extension `.ts` runs live without rebuild; F13 (core CLI) needs `just build` — the plan flags this in task 2.3.

## Findings

| Severity | Finding | Evidence | Fix |
|---|---|---|---|
| MEDIUM | Task 2.2 located the ledger append "in `writeReport` (L153–160)", but `writeReport`'s `dir` (L153) includes the per-run `run_id` subdir — the ledger is **scenario-level** (`…/<slug>/ledger.jsonl`), so a naive append into `dir` would scatter per-run ledgers. | `report.ts:153` `join(cwd,'.harness','live-testing',scenario,run_id)` vs workshop 004's `…/<slug>/ledger.jsonl` | **FIXED in-target**: task 2.2 now states the scenario-level parent path explicitly and contrasts it with `dir`. |

## Consumers
- The `tasks`/`implement` stages of this plan (downstream) — satisfied: each phase has concrete file hooks + ACs to build to.
- The `flow-eval` extension + `session-evidence` service — the plan respects their lock-step invariants (dual `SessionEvidence`, `ASSERTION_TYPES`↔`RESOLVERS`), called out in Risks.

## Open (carried, not blocking)
- **Orchestrator-confound (003 Q1)** — are we measuring the subject or the orchestration? Flagged in plan Risks; gates cross-model *claims*, not the build. Correct to defer.
- **`pass^k` K** — needs a pilot via the ledger before model-vs-model ranking. Noted (Q4).

## Reverification
The one MEDIUM was a document-mechanical fix (path clarity), uniquely determined by `report.ts:153`. Re-read after fix: task 2.2 now names the scenario-level path and contrasts `dir`. `VALIDATED WITH FIXES` stands.
