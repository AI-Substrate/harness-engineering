# Review — FX001: command/skill param signature capture

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → fixed → orchestrator-verified)
**Mode**: flow-pair cross-model review (orchestrator = Claude Opus 4.8 `pij-4s10mb`; **coder** = Copilot **claude-opus-4.8** `pij-106zjvh` (fresh — 3rd stall recovery, core wiring preserved on disk); **reviewer** = Copilot **gpt-5.5** `pij-1nh968q`, ≠ coder)
**Reviewed**: 2026-07-01 · **Target**: FX001 diff — `command-signature.ts` (+`shellSignature`/`skillDigitArg` helpers), `events.ts`, `segment.ts`+schema, `rollup.ts`, `event-builder.ts`, 4 adapters, `otlp/{logs,semconv}.ts`+schema, `report.ts`+schema, new `command-signature-capture.test.ts`, `real-capture.e2e.test.ts`, regenerated claude/cursor goldens

## What FX001 delivers
Two facets, one P12 floor — (A) shell → `ToolsEvent.signature` from the already-computed non-harness `commandSignatures` (`rg`, `git commit`), `(name,signature)` burst keying, threaded through the **OTLP logs round-trip** so it survives on the committed shard; (B) skill → `SkillEvent.arg` = a **leading `^\d+$` token only**. Coder caught + fixed a real gap mid-flight (OTLP threading — the persisted shard IS the OTLP blob, so the in-memory field would be lost on publish; orchestrator approved the `otlp/*` scope expansion).

## Dimension 0 — test non-vacuity (MANDATORY) — PASSED, reviewer-run mutations (all 5)
1. **Golden honesty** (highest value — regenerated goldens hide regressions): HEAD `event_count=30` → current `37` (+7). Old Bash bursts (4+1+5=10) → the signature-keyed bursts sum to the **same 10** (git remote 1, echo 1, gh auth 1, gh api 2, git add 1, git commit 1, sleep 2, gh run 1); `token_grand_total` unchanged (1019867); invariants diff **only** `event_count`; `real-capture.e2e` re-derives the committed golden from `raw.jsonl`. Mutation `rollup.ts:95` (signature-eq → `true`, no split) → RED at `real-capture.e2e.test.ts:119/:124` + `otlp-golden.ts:40`. Reverted → GREEN.
2. **OTLP round-trip**: suppress `A.TOOL_SIG` (`logs.ts:88`) → RED `command-signature-capture.test.ts:318` (git status lost); suppress `A.SKILL_ARG` (`:93`) → RED `:319` (arg 08 lost). Reverted → GREEN.
3. **Facet B P12 byte-scan**: widen `/^\d+$/`→`/^\w+$/` (`command-signature.ts:268`) → RED `:225` (forbidden `specify` serialized). Reverted → GREEN.
4. **`(name,signature)` no double-count**: return `harness[0]` before `bash[0]` (`:253`) → RED `:65/:188/:288` (harness verbs appeared as bash signature). Reverted → GREEN.
5. **`commandSignatures()` unchanged**: git diff shows only additive helpers; the existing body (`:227-235`) untouched — mutation `:232` (`out.push('mutated')`) → RED `command-signature.test.ts:61/:78/:84/:90/:94`. Reverted → GREEN.

## Finding (fixed by orchestrator, RUN_LOCAL)
- **F1 · HIGH · report schema doc drift** (`report.schema.json:58/65/71`): the schema still described the pre-FX001 semantics ("keyed by shell-tool name", "argv unavailable", `rg` renders as `bash`/`shell`) while `report.ts` now emits `bash_command_key:'shell-command-signature-or-tool-name'` + signature-or-tool notes — a public-contract doc drift giving JSON-schema consumers the opposite guidance from the emitted report. **Verified real by the orchestrator against source.**
  - **Fix (orchestrator, RUN_LOCAL — a 3-string, doc-only, mechanical alignment to already-reviewed `report.ts` semantics, no logic)**: updated the `bash_command`, `attribution`, and `bash_command_key` descriptions to the signature-or-tool-fallback story. Verified: JSON valid, biome clean (via telemetry-dir globs), `report.test.ts` 25/25 (schema validation intact), FX001 suite 81/81, diff = exactly 3 description strings (no structural change).

## Orchestrator sanity pass (independent)
- **Golden honesty re-checked myself**: `git diff` on `invariants.json` shows the **only** change is `event_count 30→37` — no token/total change — confirming legit `(name,signature)` burst-splitting, not a blessed regression. Matches the reviewer's evidence.
- Applied + verified the F1 schema fix (above).
- **Full `harness checks` GREEN** post-edit: tests/biome/typecheck/check:docs/flows/telemetry-fixtures/doctrine-parity/skills/windows all ok; arch-check + markdown-lint `degraded` are the pre-existing warn-launch baseline (`sync-service→git-write-port` 034/038; authored docs), not FX001.
- Adapter coverage confirmed honest: `copilot-vscode` is genuinely turns-only (no shell argv / skill args to capture); `copilot-cli` has shell signatures via callId correlation, no skill surface.

## Disposition
APPROVE recorded. FX001 (both facets + the OTLP persisted-form round-trip) is implemented, cross-model-reviewed (Dim-0 ×5, golden honesty proven), one HIGH schema-doc-drift found + fixed + orchestrator-verified, full gate green. Resolves observe `MW-001` (bash-signature magic-wand) — now **encoded**.
