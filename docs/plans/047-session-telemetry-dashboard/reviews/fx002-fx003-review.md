# Review — FX002 (honest attribution) + FX003 (tool_result-size capture)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 HIGH fixed → re-reviewed → orchestrator-verified)
**Mode**: flow-pair cross-model review (orchestrator = Claude Opus 4.8 `pij-4s10mb`; **coder** = Copilot **claude-opus-4.8** `pij-1ofshod`, healed to fresh `pij-vay442` for the fix; **reviewer** = Copilot **gpt-5.5** `pij-1emk8op`, ≠ coder)
**Reviewed**: 2026-07-01 · **Base**: `057f311b` · **Target**: FX002+FX003 diff — `report.ts` (+388/−161), `events.ts`, `rollup.ts`, `event-builder.ts`, `segment.ts`, `segment.schema.json`, adapters/{claude,copilot}, `otlp/{logs,semconv,harness-otlp.schema}`, `render/template.{ts,html}`, `report.schema.json`, + tests (`report.test.ts`, `report-html.test.ts`, new `fx003-result-tokens.test.ts`, new `segment-schema-nested.test.ts`)

## What landed
- **FX002 (report-time only, capture byte-unchanged)**: `RollupEntry.tokens` → `{input, output}` non-cache separate; `cache_read`/`cache_create` at session level only ("context re-reads"); commands (`tool`/`bash_command`/`harness_command`) = count + in/out, **no time**; skills = this-call→next-skill-call window; **new report-time `flow_stage`** aggregate bracketed by consecutive `/the-flow` SkillEvents (leading-digit arg = stage label, else `unlabeled`) — derived from SkillEvent, NOT the nav-based `flow_stage_time_s` (which stays untouched); idle excluded everywhere (`classifyGap`); `totals.time_s` = active. Command input-split **byte-weighted by FX003 `result_tokens`** when present, else even-split.
- **FX003 (capture add — the only new capture field anywhere)**: `ToolsEvent.result_tokens` (a count, char/4 estimate, no tokenizer per KF-05) summed per `(name,signature)` burst; threaded through the OTLP logs round-trip (`harness.tool.result_tokens`); claude+copilot adapters size the correlated `tool_result` payload; copilot-vscode omits it (honest). Goldens regenerated — only `result_tokens` added (Claude +13, Copilot +1 markers), nothing else.

## Dimension 0 — test non-vacuity (MANDATORY) — PASSED, reviewer-run mutations
Original GREEN: `cd harness/cli && npx vitest run test/services/telemetry` = 47 files / 518 (pre-fix), 48 / 522 (post-fix). Reviewer's own mutations (temp-copy), each named + RED→GREEN:
1. **Idle not excluded** — charge every gap → RED `report.test.ts:390` (3630 vs 30).
2. **Cache leaks per-dim** — add `cache_read` to `turnOutput` → RED `report.test.ts:410` (9000060 vs 60).
3. **Skill window collapsed** — end=si → RED `report.test.ts:428` (0 vs 60).
4. **flow_stage digit-bracket broken** — label→unlabeled → RED `report.test.ts:250` (fs['07'] missing).
5. **FX003 result_tokens** — (a) disable byte-weighting → RED `report.test.ts:338` (200 vs 300); (b) break burst-sum → RED `fx003-result-tokens.test.ts:54` (10 vs 60).
6. **P12 byte-scan** — (a) inject per-row `tokens.total` → RED `report.test.ts:480`; (b) inject `tool_result` sentinel → RED `fx003-result-tokens.test.ts:165` (`sk-RESULT-LEAK-SECRET` appeared).

## Finding (fixed → re-reviewed → orchestrator-verified)
- **F1 · HIGH · segment schema validity** (`segment.schema.json` event_stream.items): FX003 serialized `result_tokens` in `segment.ts` but the schema's `event_stream.items` (`additionalProperties:false`) never declared it — **any emitted segment carrying `result_tokens` was invalid against the published schema**, and the top-level-only segment-schema test missed the nested contract. **Verified real by the orchestrator at source.**
  - **Fix (fresh coder `pij-vay442`, scope-clean)**: `segment.schema.json:198` adds `result_tokens: {type: integer}` (alongside `signature`/`arg`, `additionalProperties:false` kept); new `segment-schema-nested.test.ts` (4 tests) validates a real serialized tools event carrying `result_tokens` via an ajv-free `additionalKeys()` nested guard (house KF-05 convention).
  - **Re-review (reviewer's own mutation)**: dropping `result_tokens` from the schema → RED at `segment-schema-nested.test.ts:57` (direct pin) AND `:106` (nested guard: undeclared key `result_tokens`); restored → 48/522 green.

## Orchestrator sanity pass (independent)
- **Live sniff test (FX002-7) on a real 8-day / 19,342-segment session** (`scratch/sample-telemetry/fx002-sniff/`): the motivating bug is dead — `arch-check` now reads **count=32, in=51,826, out=164,258, NO time** (was "22h / 36.2M"). Cache **1.588B** isolated at `totals.cache`; per-dim tokens `{input,output}` only; **leak scan CLEAN** (no cache/total on any row, no time on any command row); skills carry skill-to-skill windows, commands none; flow_stage brackets the 4 `/the-flow` calls (all `unlabeled` — honest, guided-mode session); conservation holds (Σ skill ≤ session, Σ flow_stage.time ≤ active); attribution declaration honest + complete; P12 clean.
- **F1 fix re-verified at source**: `segment.schema.json:198` present, `additionalProperties:false` intact, guard test derives `ALLOWED_ITEM_KEYS` from the schema.

## Disposition
APPROVE recorded. FX002 + FX003 implemented, cross-model reviewed (Dim-0 ×6, all mutation-proven), one HIGH schema-validity finding found + fixed + re-reviewed + orchestrator-verified, full telemetry gate green (48/522), capture byte-unchanged except `result_tokens`. Resolves the live-data attribution bug (22h / 36.2M). Ready for Ship; unblocks the [046 flow-eval loop](../../046-flow-eval-loop/) eval runs.
