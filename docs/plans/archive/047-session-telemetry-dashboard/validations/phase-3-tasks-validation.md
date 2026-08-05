# Validation — Phase 3: Fleet Scale & Docs (tasks dossier)

❌→✅ **VALIDATED WITH FIXES** — 0 critical, 2 high, 1 medium — **all repaired in-target + reverified against source.**

- **Target**: `docs/plans/047-session-telemetry-dashboard/tasks/phase-3-fleet-scale-and-docs/tasks.md`
- **Mode**: adaptive (lead + one independent cross-read critic)
- **Proof**: file:line reuse claims spot-checked against real source (`session-export.ts:173-207`, `sync-service.ts:247-267`, `exec-git-write.ts:80-94`, `git-write-port.ts:27/35/51`, `acts/telemetry.ts:24-31/44-59/380-403`, `app.ts:270`, workshop 004); every claim resolved.
- **Thesis**: purpose advanced — the dossier is the implementable Phase 3 route; the three findings were **honesty/feasibility gaps in the git-ref reuse story**, now corrected so an implementer builds the real thing, not a byte-passthrough that returns empty exports.
- **Consumers**: AC-08 / AC-09 / AC-11 / AC-12 each covered by a task with a measurable Done-When; no orphan, no double-count; the T004–T008 deferral leaves T001–T003 standing alone for AC-09/11/12 (verified).

## Findings (all confirmed at source, then repaired)

| Severity | Finding | Evidence | Repair |
|---|---|---|---|
| **HIGH** | Dossier claimed the committed shard "just needs to present the same bytes" — but the canonical committed shard is `<seq>.logs.jsonl`+`<seq>.metrics.jsonl` with **no `<seq>.json`** (`sync-service.ts:258-267`), while `combineSession` discovers segments **only** via `/^(\d+)\.json$/` (`session-export.ts:175`) and lifts identity from the Segment json (`:203-207`). A `CombineFs` over a real shard → `segment_count:0`, no identity → AC-08 fails. | `sync-service.ts:247-267`, `session-export.ts:173-190/203-207` | Prior Phase Context ⚠️ rewritten; **T007** now specifies **OTLP-logs-rooted segment+identity reconstruction** (reuse `otlpLogsToEvents` + `harness.*` resource attrs) as net-new combine work; **T005** now seeds a logs+metrics-only shard and asserts `segment_count>0`+identity; contract-change flags + read-path diagram updated. |
| **HIGH** | T001's "grep proves no `user.email` read" (the ships-regardless privacy gate) is unscoped and **false-fails** on the legitimate 034 write-path attribution read. | `exec-git-write.ts:87-88` (`git config user.name`/`user.email`), `git-write-port.ts:63-65` | **T001** Done-When scoped to the **047 read/export/render path** (`exec-git-read.ts` issues only `for-each-ref`/`cat-file`); 034 write-path attribution read explicitly carved out. |
| **MEDIUM** | `--source auto` "prefers git-ref then temp" has no single-call seam — `combineSession` enumerates one `sessionDir` (`session-export.ts:277-280`). | `session-export.ts:272-280` | **T007** now specifies a **union `CombineFs`** (git-ref blobs shadow temp by `<seq>` name, one combine call) rather than merging two exports. |

## Non-vacuity + grounding (held)
- T001/T002/T005 each name a real mutation that flips the assertion (planted `/Users/` string; dropped repo dir / mis-dated leaf; corrupted logs blob).
- All reuse constants + line refs resolve; workshop 004's `<root>/<repo>/<YYYY-MM-DD>/<format>/<leaf>` (`{sessions,reports}`, `org__repo`) confirmed.

## Reverification
The three repairs are evidence-pinned, in-target task strengthenings (concrete constraints added; no phase re-decomposition, no invented product intent). Re-read confirms the repaired T001/T005/T007 + Prior Phase Context ⚠️ + contract flags now match source truth. **Verdict stands: VALIDATED WITH FIXES.**

## Open decision (human-gated, not a defect)
The git-ref block's real cost rose once the committed-shard-shape gap surfaced (combine gains logs-rooted reconstruction). This **strengthens** the plan's existing designation of 3.1–3.3 as the deferrable block (plan line 221) — no phase change needed; flagged so the principal weighs it at GO.
