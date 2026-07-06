# Validation Record — telemetry-ref-rollup-plan.md

**Validated**: 2026-07-03
**Validator**: /validate-v2 (adaptive default: lead + deterministic proof + one independent critic)
**Verdict**: ✅ **VALIDATED WITH FIXES** — 2 HIGH + 3 MEDIUM critic findings; all applied (or already fixed) and re-verified.

- **Target**: `docs/plans/049-telemetry-ref-rollup/telemetry-ref-rollup-plan.md`
- **Proof**: dossier claims verified against live code in-session (clobber proven empirically on `refs/…/2026/06/24/15eaa924…`: parent tree 93 files ∩ tip tree 67 = ∅); critic independently re-verified all seven factual claims at source (`sync-service.ts:358/359-366`, `exec-git-read.ts:54`, `exec-git-write.ts:121`, `git-read-port.ts:35-50`, `git-write-port.ts:83-114`, `session-export.ts:288-318`, `sweep.ts:70-112`) — all hold; task-ID/coverage-map cross-refs grepped clean post-fix.
- **Thesis**: advanced — the plan delivers the user's three contracted promises (one start-dated ref per session; fetch-free append preserved; first-run patch of all old refs for all users) and fixes the F-03 clobber bug the research surfaced.
- **Consumers**: implement stage (inline task table) — coverage map complete AC-01..AC-09 → real task IDs.

## Findings & disposition

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| F1 | HIGH | T004's migration trigger ("local/remote old-shape ref") contradicted AC-03 — remote detection needs ls-remote, which steady state forbids; predicate unspecified | **Applied**: local-only trigger + durable `<telDir>/.migrated` sentinel; the triggering run's one sanctioned ls-remote covers remote-only old refs from clones that never re-run |
| F2 | HIGH | Straggler migration (same-day old-CLI append rolling on a later run) could clobber an already-rolled ref — union was over old refs only, so "new ⊇ union" verified against the wrong baseline | **Applied**: per-session union now folds in the existing rolled ref's full-history trees; verify is against the combined union; T004a gains a pre-existing-rolled-ref fixture |
| F3 | MED | Coverage map referenced nonexistent T007 and misattributed AC-05/AC-06 to T005 | **Already fixed** by the lead's deterministic pass before the critic returned (renumber cleanup); grep confirms no stale IDs |
| F4 | MED | Verify→delete TOCTOU: a racing forced push between verify and delete makes the verified superset stale | **Applied**: re-read rolled tip immediately before each old-ref delete, require it still ⊇ that ref's union, skip-and-retry otherwise; T004a gains the interleaving fixture |
| F5 | MED | Idempotent-match re-push carried forward unforced — under rewrite semantics equal-content/divergent-sha remotes make a plain `ref:ref` re-push NFF, wedging sync | **Applied**: T002 now states every rolled-path push (incl. the H-04 re-push) uses the forced `+ref:ref` refspec; T002a gains the divergent-remote case |

## Re-verification

Post-fix grep: no `T007`/`T005a` stragglers; AC-05/AC-06 map to T004a/T004/T006; T004's trigger, union baseline, and delete guard are stated as testable conditions with named fixtures. Status remains **READY** (all gates PASS/N-A).
