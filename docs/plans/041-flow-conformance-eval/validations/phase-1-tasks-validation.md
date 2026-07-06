# Validation Record — Phase 1 tasks dossier

**Validated**: 2026-06-29 · **By**: /the-flow (post-tasks validate) · **Verdict**: ✅ VALIDATED WITH FIXES

- **Target**: `docs/plans/041-flow-conformance-eval/tasks/phase-1-telemetry-session-evidence-read-path/tasks.md`
- **Proof**: deterministic source checks (lead) + one independent critic (Explore).

## Deterministic checks (lead) — all PASS
- All 5 plan tasks (1.1–1.5) map 1:1 to dossier T001–T005; paths resolve.
- `acts/telemetry.ts` registers only `sync` today (`registerTelemetryAct`, line 32) → adding `get` is the right core-verb pattern.
- `pij path <id> --dir` confirmed live (`usage: pij path <id> [--events|--state|--dir]`).
- plan-037 fixture corpus present (claude / copilot-cli / copilot-vscode / cursor).

## Critic findings → resolution (all mechanical, in-target)
| # | Sev | Finding | Verified | Fix applied |
|---|-----|---------|----------|-------------|
| 1 | MED (was CRIT) | Fixture raw format varies; "raw.jsonl per case" inaccurate | ✅ claude=`raw.jsonl`, copilot-cli=`raw.events.jsonl`+`raw.process.log`, copilot-vscode=`raw.rows.json` | Pre-impl table now states per-surface raw formats; pins claude + copilot-cli |
| 2 | HIGH | T002 "pinned to raw.jsonl" misleading | ✅ same root cause | T002 done-when + notes updated to "raw format varies by surface" |
| 3 | HIGH→MED | copilot-vscode fixture lacks `invariants.json` | ✅ confirmed absent | Table marks copilot-vscode "skip"; pinned fixtures (claude+copilot-cli) both carry `invariants.json` |
| 4 | MED→**material** | `files` not derivable from `event_stream` | ✅ no `file` event kind; `segment.files` built at `segment.ts:462-464` from captured field | Briefing/T003/Domain corrected: derive measures from `event_stream`, read `files.{written,edited}` from the segment field |

## Confirmed sound (no change)
- Faithful decomposition: no over/under-scope vs plan Phase 1; SessionEvidence contract reproduced accurately.
- TDD ordering (T002 fails before T003), dogfood (core verb not extension), worktree-safe locator, no-cache — all preserved.

**Thesis**: advanced — the dossier is an implementable, source-accurate decomposition; finding 4 (the one impl-correctness risk) is closed before a single line is written.
