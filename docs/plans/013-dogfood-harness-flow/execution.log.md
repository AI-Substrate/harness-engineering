# Execution Log — 013 dogfood-harness-flow

**Mode**: Simple (single phase, T001–T012) · **Build**: `/plan-6` companion
**Companion**: `code-review-companion` run `2026-06-09T22-19-16-664Z-ef6f` (Power-On-Mode)
**Started**: 2026-06-09

> Dogfooding note (T010, continuous): we use our own harness loop while building —
> `eng-harness-3-observe` for live friction, `harness record retro` at seams. Friction
> captured here as `VF-NNN` and promoted to `.harness/records/retro/*.md` at task/phase seams.
> Retros are **surfaced, never auto-implemented** (Finding 03). The only allowed corrective
> change mid-build is repairing a broken record-write path.

---

## Companion ping log

| When | Task | Sha | Subject | Findings back |
|------|------|-----|---------|---------------|
| (booted) | — | — | briefing sent | ack ok |

---

## Task entries

### T001 — Worker scaffold (agent.json + input-schema.json) — sha 8159581
- Forked *shape* from `install-and-validate-test-extension`; input-schema is **new**: `targetRepo` (required), `harnessSource` (local|github, default local), `keepTarget`. Did **not** inherit the source's `verbName`/`variant`/`keepTempRepo`.
- VF note: `minih list`/`check` won't register an agent until `prompt.md` exists — the T001/T002 Done-Whens (list/check) verified after T003. (VF-001, layer minih, knowledge.)

### T002 — output-schema.json (AC-6 contract) — sha 1d4bc2e
- Carries every `--collect` rollup field: `harnessabilityGrade`, `axisTuple`, `abandoned`/`abandonReason`, `governanceWritten`, `bootAuthored`, `bootRuns`, `retroRecorded`/`retroRecordPaths[]`, `verdict` (PASS|FAIL|ABANDONED), dual-layer `retrospective`.
- Validated a hand-written sample (positive) + missing-`targetRepo` input (negative) via `jsonschema`; re-confirmed with `minih check` after T003 (`ok`).

### T003 — prompt.md (the recipe) — sha 9b2d3ee
- Ordered recipe driven directly: S0 install → S1 assess → S2 abandonment gate → S3 hand-written 8-field BIO governance → S4 boot via add-extension + independent verify → S5 retro → S6 verdict.
- **Decision (logged for review):** abandonment gate encoded as `final_grade ∈ {D,E,F}` (below C) plus `operate_today_grade == F`. The spec/AC-7 literally said `{D,F}` — that skips **E** (25–39%, "hostile to agent operation"), which is strictly worse than D. Abandoning D but not E is incoherent, so E is included. (VF-002, layer project, knowledge.)

### T004 — instructions.md — sha 3bc093a
- Rules mirror `install-and-validate` + add the F01/F02/F03 guardrails and the governance hand-write exception.

### T005 — Wiring gate (PASS)
- `minih skills doctor`: both sources exist; `eng-harness-0-harnessability-assessment`, `eng-harness-0-add-extension`, `eng-harness-4-retro` all discovered + **selected**.
- `minih list` shows `validate-harness-flow` with `requiredParams:["targetRepo"]`, `hasInputSchema/OutputSchema/Instructions: true`. `minih check` (output + input samples) → `ok`. Cleared to build the orchestrator.

### T006 — Orchestrator fire path + manifest — sha 5ec8069
- Fork of `validate-harnessability.ts`. Clones express/click/cobra, fires one detached worker per clone, captures runIds, persists `runs/.last-fire.json`.
- **AC-1 verified**: `harness help` lists it `status: loaded` (installed 2, failed 0, conflicts 0); `--help` renders all options. Extension transpiles + loads via `harness doctor` (extensions aren't in the `biome check harness/cli` scope — same as the sibling).
- Fixed an em-dash typo (`—collect` → `--collect`) in the degraded message before commit.

### T007 — `--collect` mode — sha (this commit)
- `runCollect`: reads `.last-fire.json`, polls each run to terminal (report.json w/ terminal verdict, or `completed.json`/`failed.json`) up to `--wait` seconds (default 120), classifies DONE / TIMED_OUT / MISSING_REPORT / NOT_FIRED, copies each DONE child's `report.json` + `harnessability/latest.{md,json}` + `engineering-harness.md` + `retro/*.md` into `runs/<repo>/`, writes `runs/ROLLUP.md`.
- **Synthetic E2E test** (3 fake runs: done/missing/timeout): counts DONE 1 / TIMED_OUT 1 / MISSING_REPORT 1; ROLLUP table + surfaced magic-wand/difficulty clusters + no-auto-implement banner correct; **idempotent** (re-run identical, no error); **child records untouched** (read-only copy out). AC-8/AC-9.
- Uses `ctx.fs` (read-only) for reads + `ctx.exec` for cp/mkdir + the `printf %s` argv-only writer for ROLLUP — no `node:*`, never throws.

### T008 — Single-worker real smoke (chalk) — PASS
- Fired `--repo chalk.git --keep --out runs/smoke-t008`. Worker ran the FULL recipe autonomously (~6.5 min): install → assess → governance → boot → retro.
- Report (`output/report.json`) **schema-valid** (`minih check` → ok), `verdict: PASS`, `harnessabilityGrade: B`, axisTuple B/B (74.1% / 76.7%), `abandoned:false`, `governanceWritten/bootAuthored/bootRuns/retroRecorded: true`.
- **Independently verified on disk (AC-5)**: harness binary installed in clone; harnessability `latest.{md,json}` present; `engineering-harness.md` has all 8 BIO fields; `boot.ts` loads (`doctor` → loaded) and wraps `npm test` with honest ok/error+next_action; retro `2026-06-09-chalk-flow.md` recorded.
- `--collect` on REAL data → chalk DONE, 5 artifacts copied into `runs/smoke-t008/chalk/`, `ROLLUP.md` surfaces the worker's real magic-wand ("ship `harness init`") + difficulties. AC-8 proven on real data.

### T009 — Culminating 3-parallel smoke (express/click/cobra) — FIRED
- Fired the default pool, 3 detached workers in parallel (runIds 0228/aba7/cc7b), tmpRoot kept. Polling to terminal, then `--collect`. (AC-12)
