# Fix FX002: Honest time/token attribution (report-time only)

**Created**: 2026-07-01
**Status**: Complete — implemented (bundled with FX003) + cross-model reviewed (gpt-5.5, Dim-0 ×6) + live-sniff-verified on a real 8-day session (2026-07-01); see [reviews/fx002-fx003-review.md](../reviews/fx002-fx003-review.md)
**Plan**: [047-session-telemetry-dashboard](../session-telemetry-dashboard-plan.md) — the `TelemetryReport` attribution (Phase 2 T004/T005)
**Source**: Live-data review with the principal — a report over a real long session showed `arch-check` at **22h** and **36.2M tokens** for a 2-second check. Root-caused to two smears: idle time and `cache_read` tokens spread across dimensions by the time-window even-split.
**Domain(s)**: `telemetry` (report only — **capture is untouched**)

---

## Problem

The report's per-dimension `time_s` and `tokens.total` are wildly inflated on real data, because the "timeline-bracket + turn-window even-split" attribution charges **aggregate session resources to commands that did not cause them**:

- **Idle time** — a big gap that ends at a user prompt is the human away; the current per-dimension path attributes it to whatever command ran last (`report.ts` raw `gapAfter`, no idle classification). `totals.time_s` uses raw wall-span; `flow_stage` uses `computeRollup.flow_stage_time_s`, which also adds idle uncapped (`rollup.ts:184`).
- **Cache tokens** — `RollupEntry.tokens.total = in + out + cache_read + cache_create` (`turnTokens`, `report.ts:173`). `cache_read` is the model re-reading its whole context every turn — the cost of the *conversation*, not of a command. Smearing it per-dimension gave `arch-check` 36.2M.

## The token rule (headline — do not lose this)

> **Per-dimension tokens are `input` and `output`, kept as SEPARATE fields, NON-CACHE.**
> **`cache_read` and `cache_create` are NEVER attributed per-dimension** — they live at the **session level only**, clearly labelled "context re-reads". `input = turn.in` (fresh, non-cached input), `output = turn.out`.

`RollupEntry.tokens` changes from `{ output, total }` to `{ input, output }`.

## Agreed attribution spec

Three **report-time** lenses over one lossless timeline (capture stays a dumb OTel stream; every opinion is derived at read time):

| Lens | count | time | tokens (non-cache) |
|------|-------|------|--------------------|
| **command** (`tool` / `bash_command` / `harness_command`) | ✓ exact | ❌ **none** (no honest per-call duration exists in the capture — see Note) | ✓ `{ input, output }` |
| **skill** | ✓ | ✓ **span from this skill call to the NEXT skill call** (skills are the actors that own their window) | ✓ `{ input, output }` over that window |
| **flow_stage** | ✓ | ✓ span **between consecutive `/the-flow` calls** (the SDD phase) | ✓ all non-cache `{ input, output }` between |

Cross-cutting rules:
- **Two lenses at once**: every tool/skill event is aggregated **flat** (session-wide — "arch-check ran 32×") **and** tagged with the **`flow_stage`** it fell in (the enclosing `/the-flow` bracket), so the same data pivots by stage without re-derivation. A command/skill is attributed to a stage **and** just exists in its own flat rollup.
- **flow_stage bracketing is report-time**, keyed off the captured `/the-flow` **digit** (FX001 Facet B — the digit *is* the stage id). No per-event stage tag is baked into the capture; more/overlapping groupings can be added later by changing report rules, never re-capturing.
- **Idle excluded everywhere** — classify each gap like `classifyGap` (a big gap ending at a `prompt` = idle); idle contributes zero. `totals.time_s` = **active** (agent+human), not wall-span; `flow_stage`/`skill` windows exclude idle within them.
- **Token direction (so a "200k dumper" is visible)**: a command's `output` is its share of the **launching** turn's `out`; its `input` is its share of the **following** turn's non-cache `in` (the result it dumped, which lands as the next turn's input). Multi-tool turns → **byte-weighted split when [FX003](./FX003-capture-tool-result-size.md)'s `result_tokens` is present** (the real per-call dump size), else **even-split** (declared estimate). FX003 is built in the same pass; FX002 consumes `result_tokens` when present and falls back to even-split for old data.
- **Capture untouched** — all of FX002 lives in `report.ts` (+ `report.schema.json`). No `SessionExport`/segment/OTLP change.

## Note — command duration is a *capture* follow-up, not this fix

The current data has no honest per-command duration: `span_s` is a burst span (`0` for a single call) and `dur_s` is a turn-gap approximation. A real command time would need the `tool_use → tool_result` timestamp delta, which is **capturable** (privacy-safe — a number) but is a **capture-side** enhancement, deliberately **out of scope** here. That is *why* commands carry no time in FX002.

## Tasks

| Status | ID | Task | Path(s) | Done When |
|--------|-----|------|---------|-----------|
| [ ] | FX002-1 | `RollupEntry.tokens` → `{ input, output }` (non-cache, separate); update `report.schema.json` + the `Rollup` shape; session totals expose `input`/`output` + `cache_read`/`cache_create` **separately** (labelled) | `report.ts`, `report.schema.json` | Schema validates; a report carries per-dimension `{input,output}` and session-level cache separately |
| [ ] | FX002-2 | **Commands** (`tool`/`bash_command`/`harness_command`): drop `time_s` (omit or 0); tokens = even-split of launching-turn `out` (output) + following-turn non-cache `in` (input) over the tools in the window | `report.ts` | A command row shows count + input + output, no time; a fixture with a big-result command shows its input on the row |
| [ ] | FX002-3 | **Skills**: time = this-skill-call → next-skill-call span (idle-excluded); tokens = non-cache in/out summed over that window | `report.ts` | A skill's time spans to the next skill call; two skills split the timeline; mutation flips it |
| [ ] | FX002-4 | **flow_stage** (report-time): bracket by consecutive `/the-flow` calls (digit = stage id, FX001); accumulate all non-cache in/out + active time between; tag each event with its stage | `report.ts` | `flow_stage` totals per bracket; a session with 2 the-flow calls yields 2 stage windows; idle inside a stage excluded |
| [ ] | FX002-5 | **Idle + totals**: `classifyGap` applied everywhere; `totals.time_s` = active (agent+human); no idle in any time figure | `report.ts` | `arch-check` no longer shows hours; totals = active time; mutation (drop idle exclusion) balloons a time assertion → RED |
| [ ] | FX002-6 | **Attribution declaration** + tests: update `report.attribution` (tokens = `input+output non-cache`, `cache = session-only`, time = per-lens rules); non-vacuous fixtures — idle-gap, cache-exclusion, skill-window, command-no-time, the-flow bracketing | `report.ts`, `test/services/telemetry/report.test.ts` | Each rule has a test that flips RED under a deliberate mutation |
| [ ] | FX002-7 | **Live-data validation (the principal's "eyeball real exports" bar)**: regen a report over ≥1 real long session; run the Validation Plan checks below (sniff-test magnitudes, reconciliation, cache/idle byte-scan) into the execution log — runtime proof, not just green fixtures | (scratch only — never the repo) | The Validation Plan's checklist all pass on real data; findings logged; no cache/idle leak into any per-dimension row |

## Acceptance

- [ ] Per-dimension tokens are `{ input, output }`, non-cache — no `cache_read` on any command/skill/stage row (byte-checked).
- [ ] `arch-check` (and every tiny command) shows count + input + output only — **no time**, no 22h, no 36.2M.
- [ ] Skills carry a skill-to-skill window time; flow_stage carries the between-the-flow-calls window; idle excluded from both.
- [ ] `totals.time_s` = active time (idle excluded); cache shown at session level only, labelled.
- [ ] Capture (`SessionExport`) is byte-unchanged; the change is `report.ts` + `report.schema.json` only.
- [ ] Every non-count number is a declared estimate in `report.attribution`.

## Validation Plan — how we prove FX002 is correct

Green fixtures are necessary but **not sufficient** — the whole bug class (22h / 36.2M) was *invisible* in fixtures and only showed on real data. So validation is three layers:

### 1. Fixture / unit (non-vacuity — in the tasks above)
Every rule ships with a test that **flips RED under a deliberate mutation** (drop the idle exclusion → a time assertion balloons; include `cache_read` → a token assertion balloons; collapse the skill window → a skill-time assertion flips; bracket-by-nothing → the flow_stage split flips). No rule is asserted without a mutation that breaks it.

### 2. Reconciliation (arithmetic invariants — assert in tests **and** on live data)
- **No cache anywhere per-dimension**: byte-scan every `RollupEntry` — `cache_read`/`cache_create`/`total` must not appear on any command/skill/stage row; only `{ input, output }`.
- **Token conservation**: `Σ` per-dimension `output` `≤` session `output`; `Σ` per-dimension `input` `≤` session non-cache `input` (≤, because even-split can drop a turn with no active keys; never `>`).
- **Time conservation**: `Σ flow_stage.time_s ≈ active_time` (agent+human), and each `flow_stage` window `≥ Σ` its member skills' windows; **no** time on any command row.
- **Stage partition**: consecutive `/the-flow` brackets tile the timeline without overlap; every event lands in exactly one stage (or the pre-first-call "unstaged" bucket).

### 3. Live-data sniff test (FX002-7 — the real bar)
Regen a report over a real long session (`.harness/temp/telemetry/<id>`), to scratch, and **eyeball** — each must pass:
- **Magnitude sanity**: no tiny command shows hours or tens-of-millions of tokens; `arch-check` reads as count + a few-k in/out, **no time**.
- **Skill windows**: skills show plausible skill-to-skill durations (minutes, not the whole session); two skills split the timeline sensibly.
- **flow_stage**: brackets line up with the real `/the-flow N` calls; "implement"/"review" costs read as believable end-to-end phase totals.
- **Directionality**: a known big-output command (e.g. a `cat`/`report` of a large file) shows a **high `input`** row (the dump landed as the next turn's input) — proving the backward-input rule works.
- **Privacy** (unchanged rail): byte-scan the emitted JSON/HTML for `/Users/`, ids, names — clean (P12).

## Downstream — plan 046 eval runs (after FX002 lands)

FX002's honest attribution is a **prerequisite for the [046 flow-eval loop](../../046-flow-eval-loop/flow-eval-loop-plan.md)**: the eval runs (ledger + hardened scoring + peer-driven test cycle) consume this telemetry to score sessions, so garbage time/token attribution would poison the eval signal. **Sequence**: land + validate FX002 (layers 1–3 above) → **then run eval runs per plan 046** against real sessions, using the now-trustworthy per-stage/per-skill costs as an input. Any attribution smell the eval runs surface loops back as a new FX. *(This is the real-world validation-in-anger beyond FX002's own checks — the eval loop is the first serious consumer of the fixed numbers.)*

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
