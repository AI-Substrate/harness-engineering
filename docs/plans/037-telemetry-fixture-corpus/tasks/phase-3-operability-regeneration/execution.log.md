# Phase 3 — Execution Log

**Plan**: `telemetry-fixture-corpus-plan.md` · **Phase**: 3 (Operability + regeneration) · **Mode**: Full · **Companion**: `code-review-companion` run `2026-06-25T10-52-23-999Z-aa6f`

---

## T001 — `scripts/telemetry-fixtures.mjs` regen + `--check` drift guard (AC-07)

**Decision (the dossier's flagged fork — resolved)**: the script **orchestrates the existing golden suites** rather than re-importing `dist/` and duplicating the 4 per-surface segment builders.
- The raw→segment construction (FakeFs/FakeEnv/FakeDb wiring + the throwaway `node:sqlite` rebuild that proves the copilot-vscode SQL round-trip) lives **once**, in `real-capture.e2e.test.ts` (claude/copilot-cli/cursor) + `copilot-vscode-sqlite.int.test.ts` (copilot-vscode). Both mint golden + `invariants.json` under `REGEN_GOLDEN=1`.
- Duplicating those builders in a `.mjs` (esp. the sqlite dance) is the exact drift hazard AC-07 exists to prevent. The script reuses them: `gen` runs the suites with `REGEN_GOLDEN=1`; `--check` runs them plainly (their deep-equal golden/invariants assertions exit non-zero on drift).
- **Deviation from plan 3.1's literal "import the built `dist/` modules" wording** — flagged to the companion in the briefing. AC-07's substance (a `--check` drift guard that fails on divergence + a CI gate) is fully met. Single source of truth honored over the literal mechanism.
- Mechanics mirror `flow-fixtures.mjs`: repo-root via `fileURLToPath`; runs the repo-hoisted `node_modules/vitest/vitest.mjs` directly via `process.execPath` (no `.bin` shim — cross-platform, deterministic across npm majors), cwd = `harness/cli` so `vitest.config.ts` resolves. No prior `npm run build` needed (suites import from `src/` via vitest's TS pipeline).

**Done-When — all proven**:
- `--check` clean on HEAD → `Test Files 2 passed (14)`, exit 0.
- Perturbed the claude golden (`"command":"flow"`→`"DRIFTED"`) → `--check` exit **1** (drift caught); `git checkout` restored → exit 0; tree clean.
- `gen` (default) → rewrote all goldens with **no `git diff`** (machine-independent / deterministic, per the plan's cross-machine-determinism risk).

**Evidence**:
```
$ node scripts/telemetry-fixtures.mjs --check   →  Test Files 2 passed (2) · Tests 14 passed · exit 0
$ (perturb golden) node scripts/telemetry-fixtures.mjs --check  →  exit 1
$ (git checkout) node scripts/telemetry-fixtures.mjs --check    →  exit 0
$ node scripts/telemetry-fixtures.mjs           →  exit 0, git status fixtures/ = clean
```

**Files**: `scripts/telemetry-fixtures.mjs` (new).
