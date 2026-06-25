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

---

## T002 — `just`/npm/CI wiring (AC-07)

- `package.json`: added `gen:telemetry-fixtures` (`node scripts/telemetry-fixtures.mjs`) next to `gen:flow-fixtures`, and `check:telemetry-fixtures` (`… --check`) next to `check:flows`.
- `.github/workflows/ci.yml`: added a **"Telemetry fixtures drift guard"** step running `npm run check:telemetry-fixtures`, immediately after the flows drift guard (after the build step). Named, fast (~160ms), with a clear "re-run gen" remediation message on drift — a deliberate explicit gate even though the goldens also run in the full coverage step.
- `justfile`: thin `gen-telemetry-fixtures` + `check-telemetry-fixtures` passthroughs to the npm scripts (matching the repo's recipe-comment style).

**Done-When — proven**: `package.json` valid JSON; `npm run check:telemetry-fixtures` → exit 0 (`checked 2 golden suite(s)`); `just --list` shows both recipes; CI step present (`ci.yml:87`). Mirrors the `check:flows` shape.

**Files**: `package.json`, `.github/workflows/ci.yml`, `justfile`.

---

## T003 — `docs/how/telemetry-fixtures.md` runbook (AC-08/AC-05)

Capture → scrub → gitignored `scratch/` → **non-skippable manual "anything bad" review** → promote → commit, for all four surfaces. Written in the `docs/how/` house style (standalone, the "where docs live" note). Covers:
- The `harness capture-fixtures` verb surface + the **per-surface `--session` table** (claude optional · copilot-cli/cursor required · copilot-vscode cwd-resolved).
- **Cursor's on-disk path** `~/.cursor/projects/<mangle>/agent-transcripts/<conv>/<conv>.jsonl` + the mangle rule + transcript-verbatim vs bubble-projected asymmetry (AC-05).
- The **two-guard model** (scrub + auto-globbing byte-scan) and what each protects.
- The **git-handle lesson** (`--names`) called out as its own warning — the home-derived username misses git handles (the real `jakkaj` leak).
- The manual-review checklist (leak scan targets + content sanity incl. the self-referential-session trap), marked non-skippable in a top banner.
- A regen section pointing at `gen`/`check:telemetry-fixtures`.

**Done-When — proven**: runbook present; manual review explicit + flagged non-skippable; cursor path documented; cross-refs (`README.md`, `instructions.md`, `rules.md` §9) resolve; `markdown-lint` shows **no findings** against the new doc (all 11 repo findings are pre-existing in other files; 24/24 mermaid fences parse incl. the new flow fence).

**Files**: `docs/how/telemetry-fixtures.md` (new).
