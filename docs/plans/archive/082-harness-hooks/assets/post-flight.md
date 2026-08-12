# Post-flight — 082-harness-hooks

**Closed out**: 2026-08-11T08:06:56
**Archived to**: docs/plans/archive/082-harness-hooks/
**Shipped**: yes — the hooks verb family landed in `a26e663c` (#108 / PR #118); `harness hooks status`
returns a real envelope on `main`, verified after the post-merge rebuild

## Completion

| Check | Result |
|-------|--------|
| Phases run | phase-1 … phase-5 — **five**, each with an execution log |
| Reviews | phase-1 brief + verdict (`APPROVE_WITH_NOTES`), phase-2 brief |
| Flight plan | **out of sync with reality — see below** |
| Flow relocate | not applicable — no dd-native flow registered |

## Open / deferred items

_Carried into the archive on the product owner's ruling that every plan but 083 be closed out._

| Kind | Item | Where | Note |
|------|------|-------|------|
| Flight-plan drift | `phase-2` and `phase-3` read `known` (designed, never run) | `the-flow.json` | Both shipped in #118. The nodes were never advanced. |
| Flight-plan drift | `phase-4` and `phase-5` have **no flight-plan nodes at all** | `assets/tasks/phase-4,5/` | Both have execution logs, so both ran. Phase 4 (`harness validate-attribution`) was not in the original plan; phase 5 covers F005, found in the wild by the product owner. **The flight plan under-reports what this plan actually did.** |
| Successor | ~78 of 112 Windows failures at `scope=all` | `docs/plans/083-windows-portability/` | Surfaced by measurement after this plan was written. Carried forward, not lost. |
| Successor | `arch-check` (2) and `windows-check` (7), both warn-launch | `docs/plans/083-windows-portability/` | Folded into 083 on 2026-08-11. |

## A caution for whoever reads this archive

Do not reconstruct what plan 082 did from `the-flow.json`. It is the **least** accurate artifact in
this folder: it shows three phases, two of them un-run, when five phases ran. The execution logs
under `assets/tasks/phase-*/` are the reliable record. This mismatch is why the close-out states it
explicitly — archiving freezes the drift, and a future reader has no other way to notice it.
