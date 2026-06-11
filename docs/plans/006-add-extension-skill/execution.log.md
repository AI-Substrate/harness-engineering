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
| MH-003 wrap next_action says "implement run()" | minih e2e run | LOW | Fixed — variant-aware next_action in the `new` act | (see T023) |

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

### T022 — minih e2e agent run (install-and-validate-test-extension)

- Run `2026-06-08T20-22-14-091Z-4ed2`, **verdict PASS** (`validated: true`, 0 validation errors, 25 tool calls, ~228s).
- Confirmed the `add-extension` skill is invoked through minih (`🧩 skill invoked: add-extension`) — the `.minih.json` `path:skills` wiring works.
- Agent summary: "In a throwaway repo, installed the local harness package, used the add-extension skill flow to scaffold the wrap-style greet verb with `harness new`, and independently verified doctor listed it loaded, help listed the verb, `greet --help` rendered usage, and invoking greet returned an ok envelope with exit 0."
- Prior **manual** e2e (me): `npm install <root>` → `npx harness new greet --wrap "npm run demo"` → doctor loaded → help lists greet → `harness greet` ok exit 0. Plus `node dist/index.js` smoke (minimal greet → unconfigured exit 2).

### T023 — feedback + magic wand disposition (per AGENTS.md)

**Magic wand** (target: minih): "minih should export MINIH_PROJECT_ROOT and MINIH_OUTPUT_PATH into SDK shell sessions, and `minih check` should mention the literal fallback path when either is absent." → **route upstream to minih** (not our code).

| ID | Layer | Severity | Finding | Disposition |
|----|-------|----------|---------|-------------|
| MH-001 | minih | degrading | `MINIH_PROJECT_ROOT` empty in the shell; initial `cd "$MINIH_PROJECT_ROOT"` went to `$HOME`, `minih skills doctor` first reported skills disabled. | **Route to minih** (runtime issue, not our project). Agent worked around it. |
| MH-002 | project | degrading | `npx harness doctor` in a *consumer* repo exits 0 but reports `degraded` because the cli-build layer looks for `harness/cli/dist/index.js` in the consumer cwd (a source-tree check). | **Deferred follow-up (FU-006-01)** — real UX bug but pre-existing doctor behavior (plan 004), separate scope. See Follow-ups. |
| MH-003 | project | annoying | `harness new --wrap` left the `next_action` as "implement run()" even though the wrap body already works. | **Fixed** — variant-aware next_action (wrap → "Run `harness <verb>` to try it…"). Commit below. |

## Follow-ups (self-improving loop backlog)

- **FU-006-01 (from MH-002, HIGH-value UX)**: `harness doctor` should distinguish *source-tree* checks (is `harness/cli/dist` built?) from *installed-package consumer* checks. Today a perfectly healthy consumer install reports `degraded`, which undermines trust in a freshly-installed harness. Mitigation: detect the harness source tree (e.g. a marker) and skip/relabel the cli-build layer when running as an installed package. Candidate for a small follow-up plan touching `services/doctor/`.

### Companion debrief (farewell)

- Run `2026-06-08T19-55-47-799Z-3769`, exit `idle_budget`, **4 findings sent** (F001–F004), all dispositioned.
- Companion summary: "Reviewed seven plan 006 commit pings… found three real medium issues in the early FsPort/template work, all resolved by follow-up commits, and withdrew one false-positive follow-up after empirical verification. The last reviewed integration commit passed focused testing."
- Companion **magicWand** (target: minih): "Provide a minih env/status helper that exposes the canonical project root and output path to the agent shell, and have the boot prompt fail fast if MINIH_PROJECT_ROOT does not match the repository root." — **converges with the e2e agent's MH-001**; route upstream to minih.

### Phase outcome

All 23 tasks (T001–T023) complete. 191 tests green, biome+tsc clean, **92.88%** statement coverage. Built-bin smoke + minih e2e both PASS. Companion review clean (no open findings). The companion review supersedes `/plan-7`.
