# Execution Log — Phase 1: Foundation + claude proof

**Plan**: `../../telemetry-fixture-corpus-plan.md` · **Mode**: Full · **Companion**: `code-review-companion` run `2026-06-25T06-58-15-524Z-8621` (Power On Mode)

> Facts + evidence per task. Companion findings logged inline with their `ackOf` review-request mapping.

---

## T001 — fixture-library layout + per-instance convention ✅

- Added `test/services/telemetry/fixtures/real/README.md` — documents `fixtures/real/<surface>/<instance>/` layout (`raw.*` input, `expected-segment.json` golden, `meta.json` with hand-pinned invariants), the per-surface `raw.*` naming for all four surfaces, the two-guard privacy model, and the scratch→scrub→manual-review→promote discipline.
- Scaffolded `fixtures/real/claude/` (`.gitkeep`); additive — existing synthetic fixtures untouched (AC-10).
- **Evidence**: `ls fixtures/real/` → `README.md`, `claude/`.

