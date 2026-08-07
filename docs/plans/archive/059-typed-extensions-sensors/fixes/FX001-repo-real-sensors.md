# Fix FX001: Declare this repo's real sensors + document the two views

**Created**: 2026-07-15
**Status**: Proposed
**Plan**: `../typed-extensions-sensors-plan.md` (plan 059 — dogfood closer)
**Source**: operator directive 2026-07-15 ("now on *real* sensors so we finish up with something that actually helps"; AGENTS.md/readme must detail how users vs agents see them)
**Domain(s)**: harness-cli (extension userland — `.harness/extensions/`), docs

---

## Problem

Plan 059 shipped the sensors engine + TUI, but this repo declares zero sensors — the feature helps nobody here yet, and neither AGENTS.md nor the agent-facing docs explain how a human sees sensors (TUI) vs how an agent consumes them (JSON envelope, `check`).

## Proposed Fix

One new multi-sensor extension wrapping the repo's existing deterministic gates, plus the two-audience documentation.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX001-1 | `.harness/extensions/repo-sensors/extension.ts` (+instructions.md): first-wave sensor set — `tests` (`just test`, full suite ~6s warm), `skills-check`, `typecheck` (tsc --noEmit), `lint` (biome check), `arch-check`, `docs-drift`, `flows-drift`, `doctrine-parity`, `windows-check` (each wrapping its existing npm script/verb, watch globs per source dir), plus score-bearing `coverage-branch` (runs its OWN bounded full-suite into its OWN `--coverage.reportsDirectory` and parses ONLY its own artifact — no read of the `tests` sensor's output; direction higher, threshold 80), `todo-debt` (marker count, lower, threshold 20), `lock-hygiene` (internal registry URLs in lock == 0). All readings author-derived one-liners + bounded `report` (S12); reader posture untouched (S13) | harness-cli | .harness/extensions/repo-sensors/* | `harness doctor` 11 loaded / 0 failed; `harness sensors check` runs all (todo-debt `warn` acceptable); each sensor's wallclock recorded and none exceeds its timeout; windows-check clean on the new extension | the demo's 4 sensors (typecheck/tui-tests/todo-debt/lock-hygiene) are the proven prototypes |
| [ ] | FX001-2 | AGENTS.md: a "Sensors" section detailing BOTH views — **human**: bare `harness sensors` on a TTY = the TUI (keys, glyphs, trend-vs-snapshot, playback); **agent**: `harness sensors --json` (same truth, envelope with `guidance`/`next_action`), `harness sensors check` as the CI-style gate, `sensors watch` headless via spawnDetached; explicit rule: agents never parse TUI output, TTY never gets JSON unless `--json` | docs | AGENTS.md | section present; states the one-truth/two-renderers contract; markdownlint + remark clean on the file | operator ask verbatim: "how a user will see em and how an agent will see em" |
| [ ] | FX001-3 | README + `docs/how/harness-sensors.md`: add the "this repo's own sensors" list (what each measures, watch globs) and cross-link AGENTS.md's two-view section — delta only, T011 content untouched | docs | README.md, docs/how/harness-sensors.md | list matches FX001-1's shipped set exactly; lint clean | |
| [ ] | FX001-4 | Proof pass: fresh `sensors check` output captured; `sensors watch` smoke (touch a watched file → sensor fires, quiescence + dedup observed) via the compiled CLI; TUI eyeball with the real set (operator invited) | harness-cli | (evidence → execution log) | check envelope + watch-trigger evidence in the log; full root suite + checks gate still green | |

## Prime contract clarifications (2026-07-15, binding before implementation)

1. **`coverage-branch` is deterministic and independent** — no hidden run-order dependency on the `tests` sensor: it executes its **own** bounded full-suite run into its **own** `--coverage.reportsDirectory` and parses **only** its own artifact; a missing prior artifact yields `skip`/degrade, never a fabricated score. (See Discovery 2026-07-15 — the shared-coverage-dir collision and its resolution.)
2. **AGENTS.md wording mirrors T005's real branch semantics**: supported TTY + Ink present → TUI; non-TTY or `--json` → JSON; missing Ink / unsupported TERM → the honest degraded fallback path. Never claim a TTY can never receive JSON-shaped output.
3. **Wrappers use installed local scripts/bin/source only** — zero `npx`, zero network, zero npm resolution, zero duplicated gate business logic. If the sensor contract lacks a needed capability, STOP and report; never silently expand engine scope.
4. **Merge-risk recorded**: this branch predates main `0c2c4841`, whose AGENTS.md carries the landed local-source install section — our AGENTS.md edits must be positioned so that section survives convergence **byte-for-byte** (add ours as a distinct section; flag at reconcile time).

## Sensor runtime budget (operator ruling, 2026-07-15 — binding on FX001 and on the authoring docs)

Sensors are **short-feedback instruments, not batch jobs**: target seconds, tolerate up to ~2–3 minutes, never longer. The engine's default 30s hard-kill (S10, E212) is the paved path; raising `timeoutMs` past 180_000 is a design smell — that work belongs in CI or a verb. Consequences:
- Every FX001-1 sensor states its measured wallclock in the extension's instructions.md; none may exceed 3 minutes (the current set is seconds-class; `tests` ~6s warm).
- FX001-2/3 docs carry the budget rule verbatim in the authoring guidance ("if your sensor needs 20 minutes, it isn't a sensor").

## Workshops Consumed

`workshops/003-sensors-tui-design.md` (D1–D9), `workshops/002-sensor-contract-state-schema.md` (S1–S13).

## Acceptance

- [ ] This repo boots with 11 extensions and a working `harness sensors` surface showing ≥12 real sensors.
- [ ] An agent reading AGENTS.md knows to use `--json`/`check` and never the TUI; a human knows the keys.
- [ ] Score-bearing sensors (coverage, todo-debt, lock-hygiene) demonstrate trend-vs-snapshot on real data.

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-07-15 | FX001-1 | Latent bug (surfaced by OP-9 parallel run-all) | `tests` and `coverage-branch` both run the full Vitest suite into the **same** default `coverage.reportsDirectory`, AND both declare the identical `SUITE_WATCH` glob — and the watch scheduler fires matched sensors in **parallel** (`Promise.allSettled`). So a single edit under `SUITE_WATCH` already fired both concurrently in **watch mode today**, and they clobber each other's `coverage/.tmp` (Vitest: "not running multiple Vitests with the same coverage.reportsDirectory"; ENOENT on the per-run coverage json). OP-9's parallel `check`/`a` made the pre-existing collision deterministic. | **Expansion A (orchestrator ruling, prime-accepted 2026-07-15)**: each of the two full-suite sensors owns a **distinct absolute `--coverage.reportsDirectory`** under gitignored `.harness/temp/` (`.harness/temp/sensors/coverage/{tests,coverage-branch}/`); `coverage-branch` parses **only** its own artifact. Standalone human `npm test` unchanged (args injected only for the sensors' own spawns). Rejected: core same-command serialization heuristic (unprincipled, pollutes the generic pool) and `--concurrency 1` default (violates OP-9 acceptance). **Parallel regression test required**: `tests`+`coverage-branch` fire together → their reportsDirectory args differ → neither clobbers → the coverage score derives from the coverage sensor's OWN output; dirs gitignored/cleaned as appropriate. Fence: `.harness/extensions/repo-sensors/{extension.ts,extension.test.ts}` only. |
