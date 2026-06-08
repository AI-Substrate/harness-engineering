# Execution Log — Plan 006 Add-Extension Skill (Implementation)

**Mode**: Simple, single phase. **Testing**: Hybrid (TDD for code, manual for skill/docs).
**Companion**: `code-review-companion` run `2026-06-08T19-55-47-799Z-3769` (Power-On-Mode).
**Branch**: `feat/harness-cli-core`. **Baseline**: 146 tests green.

## Companion finding disposition

| Finding | From (ackOf) | Severity | Disposition | Fix sha |
|---------|--------------|----------|-------------|---------|
| F001 FakeFs mkdirp not recursive | T001-T004 fb52058 | MEDIUM | Fixed — mkdirp registers parent segments | 7ce7b14 |
| F002 wrap templates don't escape generated JS | T005-T008 93ab4c1 | MEDIUM | Fixed — service rejects unsafe `--wrap` (E108) before writing; v1 keeps simple wraps | 7ce7b14 |
| F003 wrapJs not byte-asserted | T005-T008 93ab4c1 | MEDIUM | Fixed — added byte-exact wrapJs fixture + assertion | 7ce7b14 |
| F004 mkdirp drops leading slash (abs paths) | fix 7ce7b14 | MEDIUM | **False positive** — slice/join preserves the slash (verified). Added abs-path guard test | 009eb39 |

## Pre-build discoveries

- **D-006-01 (minih config sequencing)**: `.minih.json` `skills.include: ["add-extension"]` makes that skill **required for every minih agent at boot** — the `code-review-companion` boot failed with `E211 Could not resolve requested skills` because the skill didn't exist yet. Fix: created `skills/add-extension/SKILL.md` (stub) before booting; T017 fleshes it out. Lesson for the retro: skills referenced in `.minih.json` must exist before any agent boots.

## Task log


### T020 — just fft + built-bin smoke (verify gate)

- `just fft`: 190 tests green, biome clean, **92.88% statements** / 85.71% branches / 94.32% functions.
- Built `dist` (`npm run build`) and smoked the installed bin in a fresh `scripts/new-test-repo.sh` repo:
  - `harness doctor` (empty repo) → `degraded` (honest).
  - `harness new greet` → `ok`, `.harness/extensions/greet.ts`.
  - `harness doctor` → `greet.ts loaded`.
  - `harness greet` → `unconfigured`, **exit 2**, with next_action.
  - `harness new ver --wrap "node --version"` → `wrap-ts`; `harness ver` → `ok` (data.command `node --version`), **exit 0**.
- `harness/cli/dist` is gitignored (not committed).

### T021 — reusable test-repo setup

- `scripts/new-test-repo.sh [dest]` + `just test-repo`: generates a throwaway repo (package.json with `demo` script, README, `git init`, no `.harness/`), prints the path on STDOUT (diagnostics on STDERR). Used by manual smoke + the minih e2e agent.
