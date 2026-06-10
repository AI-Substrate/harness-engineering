# Execution Log — 017 windows-cross-platform-fixes

**Plan**: [windows-cross-platform-fixes-plan.md](./windows-cross-platform-fixes-plan.md) (v1.1.0, READY)
**Mode**: Simple — single phase, inline tasks T000–T015
**Started**: 2026-06-10
**Skill**: plan-6-v2-implement-phase-companion (companion: `code-review-companion` via minih — [protocol](https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md))

## Pre-phase

### T000 — Harness boot (pre-implement seam)

| Check | Result | Evidence |
|---|---|---|
| Boot | ✅ healthy | `just test` → **380 passed (380)**, 828ms; coverage 91.69% stmts |
| Interact | ✅ | `npx --no-install harness doctor --json` → `status: ok` |
| Observe | ✅ | JSON envelope returned, parseable |

Verdict: **healthy** → proceed. Harness router installed (`~/.claude/skills/eng-harness-flow`); seam satisfied via the plan's pinned T000 boot commands (Boot→Interact→Observe), logged here.

### Companion boot

`minih run code-review-companion` backgrounded at 09:47 with `GH_TOKEN` exported; companion oriented on the 017 plan directory within ~40s (streamed output confirms it located the plan). Run ID recorded at briefing below.

## Task entries

(appended per task — sha, evidence, companion ping, findings)

### T001 + T002 — helper tests (RED) → helper (GREEN)

- **RED evidence**: `npx vitest run test/services/shared/posix-path.test.ts` → `Test Files 1 failed` (module `src/services/shared/posix-path.js` not yet present). Committed together with the GREEN implementation so every commit stays suite-green; RED state recorded here instead.
- **GREEN evidence**: 37/37 tests pass. Includes the raw-Node hazard pin `posix.normalize('//server/share') === '/server/share'` and the UNC guard counterpart in every normalize-based helper op.
- Helper surface: `toPosix`, `posixNormalize`, `posixJoin`, `posixDirname`, `posixRelative`, `isWithin`, `dedupeKey(p, caseInsensitive = IS_WIN32)` — normalize/join-only, `resolve` forbidden by docstring (Finding 03); case-folding is an explicit parameter (Finding 04, P3).
- `arch-check` → `status: ok` after adding the module.
- **Discovery**: `harness arch-check` must run from the **repo root** — extensions are discovered under `<cwd>/.harness/extensions`, so invoking from `harness/cli` yields E108 `too many arguments` (the verb never registers). Also: the verb takes no `--json` flag — JSON envelope is the default stdout shape. The plan's T002 done-when wrote `arch-check --json`; actual invocation is `npx --no-install harness arch-check` from root.
