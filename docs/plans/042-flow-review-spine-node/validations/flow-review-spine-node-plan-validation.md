# Validation — flow-review-spine-node-plan

**Verdict**: ✅ VALIDATED WITH FIXES — 1 MEDIUM folded into the plan, re-verified.
**Target**: `docs/plans/042-flow-review-spine-node/flow-review-spine-node-plan.md` (Simple, CS-2, READY)
**Validated**: 2026-06-29 · `/validate-v2` (adaptive — lead + deterministic proof; CS-2, no critic warranted)

## Proof (fresh reads by the lead)

| Claim | Evidence read this pass | Result |
|---|---|---|
| Template omits review; `phase-1.next=["ship"]` | `flight-plan.template.json` parsed — 9 nodes, no review | ✅ confirmed |
| Doctrine treats review as spine | `flight-plan-ops.md:68` = "research → plan → phase(s) → review → ship" | ✅ confirmed (seed↔doctrine mismatch real) |
| Expander per-phase set = boot/observe/drain, no review | `00-routing.md:211` | ✅ confirmed |
| `review` first-class type | `flight-plan.schema.json:17`, `flow-renderer.ts:131` (zone postflight) | ✅ confirmed — content-only fix valid |
| Source==deployed template today | `diff -q` IDENTICAL | ✅ confirmed (deploy-to-test risk framing correct) |

## Finding folded (MEDIUM → fixed in-plan)

**05 — Rail bands by zone; per-phase review would bunch in postflight.** The rail buckets the
topo-spine into `pre─[flight]─post` (`flow-renderer.ts:628-637`); `review` defaults to **postflight**
(`flight-plan-ops.md §5`). Per-phase review nodes sitting mid-spine would therefore render
`[P1·P2]·review-1·review-2·ship` (bunched), **not** the interleaved `[P1·review-1·P2·review-2]·ship`
the locked Option-A preview showed. *Uniquely-determined fix* (grounded in the renderer + the locked
interleave intent): per-phase review nodes carry an explicit **`--zone flight`**. Folded in as
**AC-07** + Key Finding 05 + T001/T002 done-when + a Risk row. No product judgment invented.

## Thesis & consumers

- **Thesis** — advanced. The plan makes the seed honest to its own already-shipped doctrine (review *is*
  spine per `flight-plan-ops.md:68`); it adds no new mechanics (review type already wired end-to-end).
- **Consumers** — the the-flow guided engine consumes the template/expander/example; all internal to the
  skill. No external public contract changes. `harness flow` CLI is consume-only (verified, not modified).
- **Scope honesty** — substantive edits in `~/github/tools` (main); this repo carries the plan + the one
  doc edit on the current branch; this repo's twin doctrine already lists review on the spine → no parity rewrite.

## Residual (non-blocking)

- T002 is the crux: threading `review-N` re-asserts spine edges via `upsert` (last review→ship, mid
  reviews→next phase) — the worked idempotency example must be updated and a re-run must write nothing.
  Captured in T002 + the idempotency risk; flagged here as the one task to implement exactly.
