# Validation Record — telemetry-otel-standard-plan

**Target**: `docs/plans/038-telemetry-otel-standard/telemetry-otel-standard-plan.md`
**Validated**: 2026-06-27
**Verdict**: ✅ VALIDATED WITH FIXES
**Mode**: adaptive (lead + deterministic proof + 1 independent critic)

## Proof run (deterministic)

| Claim in plan | Check | Result |
|---|---|---|
| `serializeSegment` @ `segment.ts:406`, `serializeEvent` @ 309 | grep | ✓ exact |
| capture write seam = atomic temp+rename | `capture-service.ts:412-419` | ✓ (`.tmp`→`rename`) |
| single-writer-per-ref + push/rollback | `sync-service.ts:26, 293-302` | ✓ |
| 14 event kinds | `events.ts` kind enum | ✓ 14 (prompt…api_error) |
| all named test files exist (16 cited) | find | ✓ all present |
| 4 × `expected-segment.json` fixtures | find | ✓ claude/copilot-cli/copilot-vscode/cursor |
| `scripts/telemetry-fixtures.mjs` | find (repo root) | ✓ (repo-root relative, as cited) |
| Acceptance Coverage Map task ids | cross-ref | ✓ all resolve within T001–T016 |

## Findings applied (all WS-A-pinned, mechanical restorations)

| Sev | Finding | Fix |
|---|---|---|
| HIGH | T001/AC-02 narrowed WS-A's locked **3-way conformance** to a 1-of-2 oracle pick | Restored 3-way (golden-vs-proto-examples · protobuf-JSON round-trip · collector-as-checker); scoped Q-A2 to the devDep choice only |
| MEDIUM | Per-kind severity collapsed to generic "severity map", unsensored (severityNumber ∉ Segment) | Made per-kind severity explicit in T007; AC-02/T003 now assert `severityNumber` for checks/command_exit/api_error |
| MEDIUM | T005 goldens row dropped two e2e/int carriers | Added `real-capture.e2e.test.ts` + `copilot-vscode-sqlite.int.test.ts` to T005 |

## Thesis

Purpose met. The plan faithfully encodes WS-A + WS-B + the dossier into a buildable Simple-mode plan; reconstruction (the load-bearing proof) is correctly a sensor-first RED task (T002) oracled on `expected-segment.json`. Target proof = actual proof after the three fixes closed the only gaps where an authoritative decision was under-encoded.

## Consumers

- **tasks/implement (next phase)** — satisfied: ordered task table with Done-When + paths + AC coverage.
- **eng-thrive scraper (named, lockstep)** — addressed by T013 (read OTLP `.jsonl`); its concrete source path is intentionally unresolved (may live outside this repo) — a known soft spot, not a blocker.

## Residual (non-blocking)

- Telemetry test-file count is 34 on disk vs WS-A's "33-file" figure — a WS-A artifact count, not load-bearing in the plan.
- T013 scraper path unresolved until the scraper's home repo is confirmed.
