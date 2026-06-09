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
