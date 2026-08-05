# Validation — Phase 6: Copilot-VS-Code surface (Amendment A3 v2 — Cursor-pattern DbPort)

**Target**: `harness-telemetry-collection-plan.md` § Phase 6 (reworked) · **Scope**: narrow (Phase 6 only) · **Date**: 2026-06-25 (supersedes the v1 validation)

## Validation Contract
- **Purpose**: capture VS Code Copilot **Chat** (`copilot-vscode`) by reading the extension's `session-store.db` (SQLite) via the read-only `DbPort`, modeled on `cursor-adapter.ts`; **tokens `null`** honest ceiling (no local token data).
- **Promise**: a real VS Code Chat session yields a `copilot-vscode` segment with a turn-anchored timeline + branch, no fabricated tokens, no message text.
- **Proof target**: Contract (a buildable, invariant-safe plan phase).
- **Sources**: `cursor-adapter.ts` (the pattern), `capture-service.ts` (session-id usage + `deps.db`), `cursor-events.test.ts` (AC-16 w/ null tokens), live `session-store.db` schema.

## ✅ VALIDATED WITH FIXES — 0 critical, 1 high, 3 medium (all folded)

**Re-validation pass (pre-compact):** the three fixes below are confirmed in the plan, and a 4th was caught — `DbPort.query(path, sql, params)` cleanly supports the `sessions`/`turns` reads (best-effort `[]` on missing/locked/corrupt backs AC-21 + the db-lock risk), **but `FakeDb` returns the same rows for every query** while the adapter issues two (`sessions`, then `turns`). Folded into 6.4: extend `FakeDb` to be query-aware. Verdict stands: ready to build.


| Severity | Finding | Evidence | Impact | Fix (applied) |
|---|---|---|---|---|
| HIGH | **Revert scope (6.1) omitted `docs/how/harness-value-measures.md`** — v1 added a token-`scope` dedup clause there (4 refs), plus the `gen:docs` rebuild. | `grep` → `harness-value-measures.md` carries `copilot-vscode`/scope-dedup wording; `gen:docs` embeds `docs/how/*.md` into `docs-content.ts`. | Reverting only `telemetry.md` leaves a dedup contract describing a `scope` field that no longer exists — **actively misleading to the org consumer**. | 6.1 revert list now includes `harness-value-measures.md` + a `just build` (gen:docs) re-embed. |
| MEDIUM | **The cwd-resolver is a NEW detection-time DB read, not a pure Cursor parallel.** Cursor's session id = `CURSOR_CONVERSATION_ID` (env); `capture-service` consumes `detected.sessionId` at `:359/:366/:381/:395` (cursor/branch/flow/buffer paths) **before** the adapter runs. | `cursor-adapter.ts` detects via env chain; `capture-service.ts:359-395` use `detected.sessionId` pre-adapter; `deps.db` is available (`:352`). | Implementer may mis-place the resolver (e.g. inside the adapter's `currentPosition`, which is too late). | 6.3 now states the resolver runs **in/after `detectHarness`, before the cursor/buffer paths**, using `deps.db` (the id is db-derived, unlike Cursor's env id). |
| MEDIUM | **`currentPosition` / windowing source undefined for `copilot-vscode`.** Cursor's `currentPosition` = transcript line count; the db adapter has no analogue specified. | `cursor-adapter.ts:242` `currentPosition` = `nonEmptyLines(transcript).length`. | Without a position, the since-last cursor windowing has no extent → broken incremental capture. | 6.5 now defines `currentPosition` = the session's **turn count** (max `turn_index`+1) as the window source. |

**Confirmed sound (no finding):** tokens-`null` + AC-16 holds — `cursor-events.test.ts:125` asserts `rollup.tokens` is `null` when the adapter supplies `tokens: null`; headline `null` == rollup `null`, so the Phase-5 invariant is satisfied with no `scope` machinery. The revert to `schema_version` 2.0 is clean — the 2.1 fields were **uncommitted on this branch**, no external consumer depends on them.

**Also folded:** the v1 `execution.log.md` (claims Phase 6 DONE with the wrong-store design) is flagged stale in 6.1 — to be reset when the rework builds.

**Thesis**: the reworked design is correct, precedented (Cursor), and honest (tokens-null); the fixes sharpen the revert surface + the two under-specified seams. Ready to build (post-compact).
