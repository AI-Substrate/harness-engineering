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

## T003 — fixture-scrub.ts (impl, GREEN) ✅

- Implemented `src/services/telemetry/fixture-scrub.ts` — pure; imports only `../shared/posix-path` (`toPosix`). No `node:*`, no `process` probing.
- Order: repoRoot (most specific) → homeDir → generic `/Users//home//C:\Users` catch-all → secrets (sk-/gh[posru]_/github_pat_/AKIA/xox/Bearer) → emails → configured names → bare username.
- Defense-in-depth: the GENERIC_HOME catch-all neutralizes ANY home-shaped path, not just the configured one (a real transcript can hold unexpected paths) — strengthens the sole-guard (F01).
- Secret sweep is targeted (prefix + Bearer), deliberately NOT a blunt high-entropy sweep, to avoid eating verbatim command content.
- **Evidence**: `vitest run fixture-scrub.test.ts` → 15 passed (15). `grep node: fixture-scrub.ts` → only the comment.

## T004 — capture-fixtures extension skeleton ✅

- `.harness/extensions/telemetry-fixtures/`: `extension.ts` (verb shell / composition root), `capture-logic.ts` (pure orchestration), `capture-logic.test.ts` (8/8), `instructions.md` (stub; full runbook = Phase 3).
- Verb `capture-fixtures` — name confirmed NOT in the reserved set (help/doctor/new/docs/skills/record/instructions/observe/init/flow). Options: `--surface/--instance/--session/--names/--dry-run`.
- **Topology decision (resolves the flagged Workshop Opportunity)**: the privacy-critical SCRUB stays single-source in core telemetry (`fixture-scrub.ts`, imported by the shell in T005); only extension-specific path/config orchestration is vendored locally + tested locally (arch-check style). One source of truth for the security control. `ctx.fs/fsWrite/env` ARE the injected Node ports — no `node:*` in the extension.
- **Evidence**: `vitest capture-logic.test.ts` → 8/8; `harness capture-fixtures --help` resolves; `grep node: .harness/extensions/telemetry-fixtures` → clean.

### Discoveries
| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T004 | Noteworthy | Capture-tool topology (the plan's flagged Workshop Opportunity) | Resolved: scrub single-source in core; extension imports it; only orchestration is local. No vendored copy of the security control. | AC-06; plan § Workshop Opportunities |
