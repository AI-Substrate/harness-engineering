# Validation — session-telemetry-dashboard-plan.md

**Verdict**: ✅ **VALIDATED WITH FIXES** — 0 critical, 2 high, 3 medium (all fixed in-target).
**Target**: `docs/plans/047-session-telemetry-dashboard/session-telemetry-dashboard-plan.md` (Implementation plan, Full / 3 phases)
**Validated**: 2026-07-01
**Proof level reached**: Implementation Ready

## Thesis
The plan turns workshops 001–004 + the research dossier into a buildable, 3-phase, ports-respecting implementation of the export→report→render pipeline. Locally correct **and** purpose-advancing: each phase reuses the frozen OTLP transforms + `computeRollup`, tests against the real fixture corpus, and never touches git's working tree. The two HIGH findings were *overclaims/omissions* (not design errors) — the underlying design holds; the plan now names the net-new work it had folded under "reuse."

## Proof (fresh, this validation)
- **Every cited seam opened and confirmed** (deterministic grep, not rubber-stamped): `computeRollup` `rollup.ts:135` + `IDLE_CAP_S=300` `:17`; `segmentToOtlpLogs` `otlp/logs.ts:292`; `otlpLogsToEvents` `:311`; `rollupToOtlpMetrics` `otlp/metrics.ts:52` (no inverse); `registerTelemetryAct` `acts/telemetry.ts:33` + `get` arg pattern `:109/:113`; `telemetryRefFor` `git-write-port.ts:51` + `TELEMETRY_REF_GLOB` `:35`; spool filters `sync-service.ts:189/205`; PIJ join `session-evidence.ts:91`.
- **AC coverage**: 12/12 ACs mapped; after fixes AC-02→{1.2,1.3,1.7}, AC-04→{2.2,2.3,2.8}.
- **Gate honesty checked against source**: G2/G3 ports claim verified against `architecture.md §2` (services depend on ports; git-read goes through a new `GitReadPort`) and `constitution.md` P2/P3/P4/P9/P12.

## Findings (all CONFIRMED against fresh source; all fixed in-target)

| # | Severity | Finding | Evidence | Fix applied |
|---|----------|---------|----------|-------------|
| F1 | HIGH | Per-dimension time/token **attribution** was presented as `computeRollup` "reuse" and under-rated Low; `computeRollup` exposes only `flow_stage_time_s` + session-total tokens + count histograms — **no** per-skill/tool/bash/harness time or token attribution. Task 2.3's only test asserted **counts**, leaving the load-bearing math untested. | `rollup.ts:172-224`; workshop 002 §attribution (net-new turn-window/timeline-bracket) | Split AC-04 (computeRollup = flow-stage+totals only; per-dimension = net-new algo); reworded task 2.3; **added test-first task 2.8** with a `time_s`/`tokens` mutated-fixture non-vacuity case; added a Medium/High risk row. |
| F2 | HIGH | AC-02 "tolerate v1 without error" was unsatisfiable: `segmentToOtlpLogs` does `seg.event_stream.map` unguarded (`logs.ts:302`) but v1 segments have **no `event_stream`** (`segment.ts:196-197` requires it; workshop 001 L63 says v1 lacks it) → a v1 `<seq>.json` (the exact forward-regen case) throws. No normalizer was tasked. | `otlp/logs.ts:302`, `segment.ts:135-137,196-197`, workshop 001 L63 | **Added task 1.7** (normalize-or-degrade v1 before forward-regen, record in `segment_schema_versions`); scoped AC-02 to "without crashing". |
| F3 | MEDIUM | `session save`'s co-produced HTML had no renderer — only the report-columns template was tasked; workshop 001's session-overview view was silently dropped or implied an untasked file. | tasks 2.5/2.6 vs workshop 001 L152-164 | Resolved explicitly: `session save` HTML = the **N=1 report render** (one template); 001's `gen.py`-style timeline view **deferred** (Non-Goals). Reworded AC-07 + task 2.6. |
| F4 | MEDIUM | The designated deferral (git-ref read, 3.1–3.3) was bundled in Phase 3 with non-deferrable must-ships incl. **3.6 (P12 privacy scrub — a Constitution hard rail)** and 3.5 (AC-12 docs); "defer Phase 3" risked dropping the privacy gate. | Phase 3 tasks 3.1–3.6; constitution P12 | Added an explicit isolation note: only 3.1–3.3 deferrable; 3.4–3.6 ship regardless; run 3.1–3.3 last. |
| F5 | MEDIUM | G2 asserted "telemetry is core … **no deviation**" for P10, but `architecture.md:112` blesses only `doctor`/`help` as core; `telemetry`/`flow`/`record`/`observe` are a de-facto, text-unlisted core-act class. | `acts/telemetry.ts:24-26` vs `architecture.md:112,140` + constitution P10 | Converted G2 to **PASS (1 deviation recorded)** with a one-line Deviation Ledger entry naming the text gap. |

## Consumers / forward-compatibility
- **Plan 046** (`RunRecord.session_export`) references a saved `SessionExport` by path — the P1 envelope (workshop 001) satisfies it; no contract drift. The report (002) is a separate store 046 may *quote*, not depend on.
- The `TelemetryReport` schema is additive (`additionalProperties: true` + pinned `schema_version`) — a future DORA/metrics consumer (noted OOS) reads stable dimension keys without a break.

## Reverification
All five fixes are document-mechanical / uniquely determined by the cited sources + workshops (no invented product intent; the one decision — session HTML = N=1 render — is the minimal choice consistent with the single-template design). Re-read after fixes: AC-02/AC-04/AC-07 corrected, tasks 1.7 + 2.8 present and test-first, coverage map + risks updated, G2 carries the deviation. Gates still resolve **all PASS/N-A** (G2 PASS-with-deviation; G6 stronger via 2.8). `**Status**: READY` stands. `VALIDATED WITH FIXES`.
