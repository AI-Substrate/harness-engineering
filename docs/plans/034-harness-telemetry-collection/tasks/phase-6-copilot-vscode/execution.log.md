# Execution log — Phase 6: Copilot-VS-Code telemetry surface (Amendment A3 — reworked)

**Plan**: `../../harness-telemetry-collection-plan.md` § Phase 6 · **Mode**: Full · **Date**: 2026-06-25 · **Branch**: `036-copilot-vscode-telemetry`

Reworked to the **Cursor-pattern DbPort** design (tokens-null honest ceiling) after the v1 (wrong-store / `session.shutdown` token-fallback) attempt was reverted. Built with a live `code-review-companion` (run `2026-06-25T02-31-32-691Z-ddc2`).

| Task | Status | Evidence |
|---|---|---|
| 6.1 Revert v1 machinery | ✅ | `git checkout HEAD --` the 13 v1 code+doc files (all uncommitted on this branch); `SEGMENT_SCHEMA_VERSION` back to `2.0`; 232 telemetry tests green pre-rework |
| 6.2 Detection + cwd-resolution tests | ✅ | `capture-service.test.ts` — AC-20 (AI_AGENT marker; `TERM_PROGRAM=vscode`-alone negative control; copilot-cli unaffected) + AC-21 (cwd resolve writes under the id; no-row → no-op; no-db → no-op) |
| 6.3 Detection + cwd resolver impl | ✅ | `detectHarness` returns `{harness:'copilot-vscode', sessionId:''}` on `AI_AGENT`; `captureUnsafe` resolves the id from `session-store.db` by cwd **before** the cursor/branch/buffer paths, via `resolveCopilotVscodeSessionId(deps.db, …)` |
| 6.4 Adapter + privacy tests | ✅ | `copilot-vscode-events.test.ts` — anchored timeline from `turns.timestamp`; tokens/models null; `currentPosition`=turn count; AC-23 planted-secret + abs-path never serialize; query-aware `FakeDb` distinguishes the `sessions`/`turns` reads |
| 6.5 `copilot-vscode` adapter | ✅ | `copilot-vscode-adapter.ts` — peer of `cursor-adapter.ts`; `DbPort` reads `sessions`+`turns`; `currentPosition` = turn count (`max(turn_index)+1`); prompt/turn events anchored, tokens/models/effort null |
| 6.6 Docs | ✅ | `docs/how/telemetry.md` § Per-harness ceilings — `copilot-vscode` documented as a distinct surface (SQLite store, cwd resolution, tokens-null timeline-only ceiling) |

## Decisions & discoveries

- **Three distinct Copilot/agent stores.** `copilot-cli` → `~/.copilot/session-state` JSONL (has tokens); `copilot-vscode` → the **extension's** `session-store.db` SQLite (NO token columns); Cursor → `state.vscdb`. The v1 attempt conflated the first two — the rework keys on the right store.
- **`session.shutdown` is structurally unreachable live** (user's catch): it fires at session END, after our mid-session command runs, so a live capture can never read it. Dropped entirely; the store-read design needs no shutdown summary.
- **No session-id env var → cwd resolution.** Unlike `copilot-cli`/Cursor, the VS Code extension sets no session-id env var (only `AI_AGENT`). `detectHarness` returns an empty-`sessionId` marker; the id is resolved from `sessions` by cwd (latest `updated_at`) in a single detection-time `DbPort` read, before the buffer/cursor paths consume it.
- **tokens-null is the honest ceiling** (exactly as Cursor): the store carries no token/model columns, so `tokens`/`models` stay `null` — never estimated. AC-16 holds (rollup.tokens null == headline null).
- **`FakeDb` made query-aware.** The adapter issues two reads (`sessions` then `turns`); the old `FakeDb` returned the same rows for every query. Extended to accept a `(sql, params) => rows` resolver — array mode preserved (back-compat for the cursor tests).
- **Privacy (AC-23).** `readTurns` reads `user_message`/`assistant_response` only to compute a word-count / presence and discards the text; a planted-secret + abs-path control proves neither reaches the serialized segment.

## AC status
AC-20 ✅ (AI_AGENT detection + `TERM_PROGRAM` negative control) · AC-21 ✅ (cwd resolution; no-match → clean no-op) · AC-22 ✅ (turn-anchored timeline; tokens/models null) · AC-23 ✅ (planted-secret control; counts+timestamps only) · AC-revert ✅ (`segment-schema.test.ts` pins `schema_version` 2.0 + the frozen field set — shutdown/scope/premium_requests/code_changes v1 fields gone).

## Companion debrief (`code-review-companion`, run `2026-06-25T02-31-32-691Z-ddc2`)

Live companion (`--companion`) reviewed all three commits. Final verdict **REQUEST_CHANGES** → both findings **ADDRESSED INLINE** in `7cf0b25`:

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F001 | HIGH | AC-23 is a **read-side** contract; the SQL `SELECT`ed `user_message`/`assistant_response` and computed `wordCount` in-process — text entered the process even though never serialized. | **Fixed** (`7cf0b25`): word-count + presence computed **at the SQL boundary** (raw columns only inside `length()`/`CASE`); only `turn_index`/`words`/`has_response`/`timestamp` cross the `DbPort`. Test pins it (planted raw secrets on fixture rows are ignored; SQL projects `AS words`/`AS has_response`). |
| F002 | MED | Docs/records published the stronger privacy guarantee while the code enforced only non-serialization (the F001 drift). | **Fixed** (`7cf0b25`): `telemetry.md` + adapter doc reworded to the SQL-boundary guarantee, which the code now actually enforces. |

- *magicWand* (companion follow-up candidate, surfaced not actioned): "a companion helper that turns the coordination ledger into the final report skeleton (task counts, ackOf ids, findings prefilled)." Tooling for minih itself — out of scope for this plan; not filed.

## Deferred & Noteworthy
- *Noteworthy*: the adapter re-resolves the session id by cwd (a second `DbPort` read), mirroring how the Cursor adapter independently re-reads its env session id — keeps `HarnessSource` unchanged (no threaded session id). Cheap, best-effort.
- *Noteworthy*: `words` is now an approximate **space-delimited** count (computed in SQL) rather than `/\s+/` in-process — a deliberate, documented trade for the read-side privacy guarantee. Coarse measure; exactness irrelevant. Live counts shifted 127→124 on turn 0 accordingly.
- No deferrals, no skipped tasks, no new TODO/FIXME/HACK.
