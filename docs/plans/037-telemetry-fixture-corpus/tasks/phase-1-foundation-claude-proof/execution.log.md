# Execution Log — Phase 1: Foundation + claude proof

**Plan**: `../../telemetry-fixture-corpus-plan.md` · **Mode**: Full · **Companion**: `code-review-companion` run `2026-06-25T06-58-15-524Z-8621` (Power On Mode)

> Facts + evidence per task. Companion findings logged inline with their `ackOf` review-request mapping.

---

## T001 — fixture-library layout + per-instance convention ✅

- Added `test/services/telemetry/fixtures/real/README.md` — documents `fixtures/real/<surface>/<instance>/` layout (`raw.*` input, `expected-segment.json` golden, `meta.json` with hand-pinned invariants), the per-surface `raw.*` naming for all four surfaces, the two-guard privacy model, and the scratch→scrub→manual-review→promote discipline.
- Scaffolded `fixtures/real/claude/` (`.gitkeep`); additive — existing synthetic fixtures untouched (AC-10).
- **Evidence**: `ls fixtures/real/` → `README.md`, `claude/`.


## T002 — fixture-scrub.test.ts (test-first, RED) ✅

- Wrote `test/services/telemetry/fixture-scrub.test.ts` defining the scrub contract: `scrubText(text, cfg)` + exported placeholders (`HOME_PLACEHOLDER`/`REPO_PLACEHOLDER`/`USER_PLACEHOLDER`) + `ScrubConfig {homeDir, repoRoot, username, names?}`.
- Cases: POSIX home path, repo-root rebase (more-specific-wins), Windows `C:\Users\`, the claude `-Users-<user>-` mangle, bare username, secret shapes (sk-/ghp_/AKIA/Bearer), email, configured name → all scrubbed; **verbatim preservation** of prose/commands/flags; JSONL stays valid JSON post-scrub.
- Config is explicit (P3 — no process.env/platform probing).
- **Evidence**: `vitest run fixture-scrub.test.ts` → 1 failed (module not found) = expected RED.
