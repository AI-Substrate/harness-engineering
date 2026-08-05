# Validation — cohort-telemetry-insights-plan.md

✅ **VALIDATED WITH FIXES** — 1 HIGH + 3 MEDIUM findings, all applied and re-verified.

- **Target**: `docs/plans/048-cohort-telemetry-insights/cohort-telemetry-insights-plan.md` (Mode: Full, Status: READY, 3 phases / 16 tasks / 13 ACs)
- **Validated**: 2026-07-02 · adaptive default (lead + deterministic proof + 1 independent critic)
- **Proof**: all 5 authoritative link targets resolve (WS001, 047 WS002/WS004, retro drain record, dossier); AC parity 13↔13; gate matrix 6 PASS / 1 N/A (no `docs/adr/`); load-bearing code claims (report.ts:13-14 vs :468-482 lens tension, capture-service.ts:388 plans_touched, `session save --source git-ref`) verified at source same-day during the explore.
- **Thesis**: purpose met — the plan implements WS001 D1–D7 without reopening them; verification-first Phase 1 (tasks 1.1–1.3) correctly gates the substrate assumptions; the per-work-unit table ships before any correlation work (grain before stats).
- **Consumers**: tasks/implement verbs (executable task tables confirmed), future correlation layer (work-unit table + provenance named).

## Findings (critic → adjudicated → applied)

| Severity | Finding | Fix applied |
|---|---|---|
| HIGH | Conditional P12 sync-payload work was narrated in Risks but had no task home — downstream (1.5/2.2/3.3) silently assumed T1.1's happy path | Task **1.7** added (conditional, fires iff 1.1 confirms the gap) with an explicit gate on 3.3 + AC-11 coverage note |
| MEDIUM | AC-05 coverage row omitted tasks 2.3 (discipline panel) and 2.4 (verb/envelope) — both orphaned in the map | AC-05 row → 2.1, 2.2, 2.3, 2.4 |
| MEDIUM | Dossier H-05 (copilot tail-capture time skew — document, don't fix) carried nowhere in the plan | 2.4's provenance requirements gain the declared per-harness skew caveat |
| MEDIUM | Two "works correctly"-class criteria: 3.4 "Loop closed on itself", 2.4 "envelope honest on partial inputs" | Both rewritten to observable conditions (named artifact / asserted partial-input test) |

## Re-verification

Targeted re-check of the four edited sites only (per validate-v2 §9): task 1.7 present with gate language; AC-05 and AC-11 rows updated; 2.4 and 3.4 criteria now testable. No other deterministic check invalidated by the edits.
