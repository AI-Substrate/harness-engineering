# Flow-eval Loop — ledger, hardened scoring & the peer-driven test cycle

**Plan**: 046-flow-eval-loop · **Branch**: `feat/041-flow-conformance-eval` (same branch / same PR)
**Status**: PLANNED · **Complexity**: CS-4 (Full, 4 phases)
**Created**: 2026-07-01
**Design inputs (authoritative)**: workshops [003](../041-flow-conformance-eval/workshops/003-eval-hardening-applied-decisions.md) · [004](../041-flow-conformance-eval/workshops/004-run-storage-and-comparison.md) · [005](../041-flow-conformance-eval/workshops/005-the-eval-improve-loop.md) · [006](../041-flow-conformance-eval/workshops/006-telling-the-story-docs-how.md) · [research](../041-flow-conformance-eval/research/eval-methodology-perplexity-2026-07-01.md) · [dossier](./research-dossier.md)

---

## ▶ RESUMED 2026-07-02 — 047 return contract satisfied

**Was paused at P1 pending [plan 047](../047-session-telemetry-dashboard/).** 047's substrate landed on this same branch (`9473ddec`): `harness telemetry session save` (schema-versioned export), the HTML render, and **honest attribution** (FX002 — active time, non-cache `{input,output}`; FX003 — per-call `result_tokens`). The consumption contract below is now satisfiable; P1 is underway.

**What 046 returns to do (the consumption contract — the only coupling):**
- **P2's `RunRecord` reserves a `session_export: string | null` field** (a path/ref to the 047 export) — a forward-compatible, additive reservation that does **not** break historical records. See task 2.1.
- **On return**: wire `flow-eval score` to call 047's `harness telemetry session save` and populate `session_export`, so the eval outputs (report + ledger) carry their own session-telemetry provenance.
- **Dashboard (047)**: 046's runs become rows the 047 dashboard pivots/compares (quality score × tokens × time × model, with agent-harness as a *selectable* dimension to include or exclude).

**Resume at**: `/the-flow 6 implement --plan "docs/plans/046-flow-eval-loop/flow-eval-loop-plan.md"` (P1), once 047's export is available.

---

## Business Specification

### Purpose

Turn the flow-conformance eval (plan 041) from a **single-run scorer** into a **looping, comparison-ready, regression-catching instrument** — by hardening how it scores (two axes, not one capped number), giving it durable memory (an append-only run ledger), and making model-vs-model comparison first-class — then proving the whole thing by **running the peer-eval loop against it, back and forth** (workshop 005's dogfood loop is both the thing we build and the way we validate it).

### Why now

Runs 001–003 + a research pass established the core design is sound (it's the tau-bench/WebArena SOTA pattern) but has three validity gaps and no longitudinal memory: it scores a stochastic subject from one run, conflates process-conformance with engineering-capability in one capped verdict, and its occurrence-based lanes + same-family judge are gameable. Workshops 003–006 locked the fixes. This plan builds them.

### Promise (what must become true)

- A run reports **two scores** (process + capability), and the FAIL cap fires **only** from deterministic capability + safety lanes — so a good-artifact/non-prescribed-path run isn't punished and a right-ritual/broken-artifact run isn't rewarded.
- Every scored run is **recorded** to an append-only ledger, so drift is readable over time and **two models can be compared** (e.g. gpt-5.5 vs sonnet-5).
- The eval's judgement lane is **hardened** (decomposed, different-family, artifact-only, never required).
- A newcomer can read **one `docs/how` page** + a README section and understand how we evaluate the harness.
- The system is **proven by a real peer-loop dogfood** that produces the first cross-model comparison.

### Users

- **The harness team** — runs the loop to spot regressions and compare models.
- **The orchestrator agent** (the next eval driver) — reads two-axis reports + the ledger.
- **A newcomer / stakeholder** — reads the `docs/how` story to understand the methodology.

### Scope / non-goals

- **In**: the scorer two-axis split, match-modes, forbidden-state lane, the run ledger + `--compare`, `pass^k`/CIs at read, F13 duration, judge decomposition + scaffolding, the docs/how page + README section, a dogfood validation run, **an eval-runner skill** (a thin pointer skill that makes running the loop one command — routes to `/flow-pair` for peer orchestration + the extension's own docs; a map, not a manual).
- **Out (deferred, named)**: outcome-anchored process lanes (003 D6, high effort — telemetry↔diff correlation); task-family/holdout parameterization (003 D7, publish-triggered); a full human-gold judge calibration set (D4 — scaffolding only here); an automated observation-harvest verb (005 Q2). The orchestrator-confound question (003 Q1) is a risk to flag, not solve.

### Acceptance Criteria

| AC | Criterion |
|----|-----------|
| AC-01 | The report emits `axis_scores: {process, capability}` (unknown-excluded per axis) |
| AC-02 | The required-fail cap fires **only** from capability + safety lanes; process/judged never cap |
| AC-03 | Sequence assertions accept `match_mode` (strict/superset/subset/unordered) + per-arg overrides; default SUPERSET |
| AC-04 | A `forbidden-state` required safety-axis assertion exists (e.g. no out-of-scope edits / report-contract present) and can cap a run |
| AC-05 | Every `flow-eval score` appends one `RunRecord` to `.harness/live-testing/<slug>/ledger.jsonl`; prior lines byte-stable |
| AC-06 | `flow-eval ledger --scenario <slug>` lists runs over time with per-lane verdict history (flips marked) |
| AC-07 | `flow-eval ledger --compare <A> --compare <B>` renders a model-vs-model board (`pass^k` + Wilson CIs + McNemar), computed only when `scenario_hash`+`base_ref` match across groups |
| AC-08 | `SessionEvidence` carries a run duration/span (F13), recorded into the `RunRecord` |
| AC-09 | The `judged` lane is decomposed into named pass/fail/unknown sub-criteria; judge config (different-family, artifact-only, temp-0, version-pinned) is recorded; `judged` is never `required` |
| AC-10 | A `docs/how` page tells the four-beat story (run peers → watch two ways → evaluate → feed back) per workshop 006 |
| AC-11 | The main `README.md` has a small "How we evaluate this system" section |
| AC-12 | A real peer-loop dogfood run produces the first cross-model ledger comparison (end-to-end proof) |

### Workshop Opportunities

All major design is already workshopped (003–006). No new workshops required; this plan implements them.

---

## Implementation Plan

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Hardened scoring | flow-eval | Two-axis split + match-modes + forbidden-state lane (the cheap, high-validity scorer changes) | None |
| 2 | The run ledger + comparison | flow-eval | Append-only ledger on every score + `flow-eval ledger` read/`--compare` + `pass^k`/CIs + F13 duration | Phase 1 |
| 3 | Judge hardening | flow-eval | Decompose `judged` into sub-criteria; different-family/artifact-only scaffolding; never required | Phase 1 |
| 4 | Docs + dogfood | flow-eval / docs | The `docs/how` story page + README section + a real peer-loop cross-model dogfood | Phases 1–3 |

#### Phase 1: Hardened scoring
**Objective**: Make a run report two scores and cap only on what's deterministic — the highest value-per-effort validity fix (workshop 003 D1/D2/D8). Extension `.ts` only → runs live without rebuild.
**Domain**: flow-eval
**Delivers**: the two-axis scorer, `match_mode` on sequence assertions, the `forbidden-state` lane; unit tests incl. mutated-fixture non-vacuity.
**Depends on**: None
**Key risks**: axis is an *orthogonal* classification (not the proof-source "lane") — don't conflate; `ASSERTION_TYPES`↔`RESOLVERS` lock-step.
**Proven by**: a peer-loop run whose report now shows `{process, capability}` and whose match-modes resolve A1–A11 per workshop 003 §D2.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.0 | Create the **eval-runner skill** — a thin, simple pointer skill that makes running an eval loop one command: it routes the orchestrator to **`/flow-pair`** (the main skill for orchestrating the coder/reviewer/subject peers) and to the extension + its existing docs (`.harness/extensions/flow-eval/instructions.md`); a **map, not a manual** — link, don't duplicate; iterate it with each real run | flow-eval / skills | A fresh session can start a peer-loop eval run from the skill alone (no tribal archaeology); it references `/flow-pair` + the extension docs and duplicates neither | Enabler for every phase's loop-layer proof + 4.3; skill location decided at implementation (repo-local `.claude/skills/` default — it points at in-repo paths) |
| 1.1 | Add an **axis** classification (`process`\|`capability`\|`safety`) per assertion type, alongside `ASSERTION_TYPES` (`scenario.ts` L66–84); extend the `Assertion` interface | flow-eval | Each type resolves to exactly one axis; lock-step test updated | AC-01; D1 |
| 1.2 | Failing tests then implement the **two-axis scorer** (`scorer.ts` L100–132): partition `pass/fail/requiredFailed` by axis; emit `axis_scores`; cap consults only capability+safety | flow-eval | Two scores; required-fail on a process lane does NOT cap; mutated fixture flips | AC-01, AC-02; D1 |
| 1.3 | Add the **mimicry alarm** (process ≥ .8 AND capability ≤ .4 → flag) to the report | flow-eval | Flag set on a high-process/low-capability fixture | D1 |
| 1.4 | Failing tests then implement **`match_mode`** in `skillSequence` (`resolvers.ts` L181–201): strict/superset/subset/unordered + per-arg overrides; default SUPERSET; validate in `validateAssertion` | flow-eval | Each mode has a passing + a flipping test; default is SUPERSET | AC-03; D2 |
| 1.5 | Add the **`forbidden-state`** assertion type + resolver (safety axis, required-capable): e.g. no edits outside allowed paths / report-contract file present | flow-eval | Type+resolver registered (lock-step); caps a violating fixture | AC-04; D8 |

#### Phase 2: The run ledger + comparison
**Objective**: Give the eval durable memory + first-class model-vs-model comparison (workshop 004), plus the F13 duration the ledger records.
**Domain**: flow-eval (+ telemetry for F13)
**Delivers**: the `RunRecord` schema, append-only `ledger.jsonl` on `score`, the `flow-eval ledger` verb (list + `--compare`), `pass^k`+Wilson at read, and a run-duration span in `SessionEvidence`.
**Depends on**: Phase 1 (axis scores go into the record).
**Key risks**: `ReportFsWrite` has no append (read-then-write, keep prior lines byte-stable); dual `SessionEvidence` lock-step for F13; a comparison across mismatched `scenario_hash`/`base_ref` must be refused, not computed.
**Proven by**: two peer runs of different models → `flow-eval ledger --compare` renders a board.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Define the **`RunRecord`** schema (TS + JSON Schema) per workshop 004 — seed tuple, per-lane outcomes w/ axis, `axis_scores`, verdict, telemetry_available, schema_version, **+ a `session_export: string \| null` ref** (populated from `harness telemetry session save` — 047 landed) **+ a denormalized `telemetry_summary: { active_time_s, tokens: {input, output}, cache: {read, create}, turns } \| null`** (counts-only, copied from the export's `totals` at score time; `null` honestly when no export — so the ledger answers cost questions without opening N exports) | flow-eval | A scored run round-trips into a valid record; `session_export`/`telemetry_summary` accept null without breaking the schema; a run with an export carries real totals | AC-05; 047 return contract |
| 2.2 | Append a record to **`.harness/live-testing/<slug>/ledger.jsonl`** from `writeReport` (`report.ts` L141–160) — **note**: the ledger is the **scenario-level parent**, NOT `writeReport`'s `dir` (L153 `join(cwd,'.harness','live-testing',scenario,run_id)` includes the per-run subdir); append to `join(cwd,'.harness','live-testing',scenario,'ledger.jsonl')`. Append-only; failing test asserts N runs→N byte-stable lines | flow-eval | N runs → N lines at the scenario-level path; prior lines unchanged | AC-05 |
| 2.3 | **F13**: track run span (min/max `ev.t`) in `fold` (`session-evidence.ts` L176–252); add a duration field to **both** `SessionEvidence` decls (CLI + resolvers.ts); record it in `RunRecord` | telemetry/flow-eval | `telemetry get` exposes a span; ledger record carries it; lock-step test passes | AC-08; F13. Needs `just build` (core change) |
| 2.4 | Add the **`ledger`** verb (`extension.ts` switch L292–300): `--scenario <slug>` lists runs + per-lane verdict history (flips marked) | flow-eval | Lists all recorded runs; surfaces a flipped lane | AC-06 |
| 2.5 | **`--compare <A> --compare <B>`**: group by model, compute `pass^k` + Wilson CIs per axis + McNemar per binary lane (paired, shared-seed); **refuse** when `scenario_hash`/`base_ref` differ across groups; **+ cost columns** from `telemetry_summary` (avg active time + avg non-cache in/out per model; cache shown but never ranked — cross-harness cache economics differ; rows lacking a summary counted + excluded, never zero-filled) | flow-eval | Renders a model-vs-model board (score × time × tokens) on matched groups; flags mismatch; honest-absence for missing summaries | AC-07; D3/D5/004 |

#### Phase 3: Judge hardening
**Objective**: Make the subjective lane trustworthy (workshop 003 D4) without yak-shaving — decomposition + decoupling scaffolding now, full calibration set later.
**Domain**: flow-eval
**Delivers**: the `judged` lane decomposed into named sub-criteria with CoT-before-score + reference anchor; judge config (different family than subject, identity-stripped, artifact-only, temp-0, version-pinned) recorded in provenance; `judged` stays non-required.
**Depends on**: Phase 1.
**Key risks**: self-preference (judge≠subject family is an actor/config decision, not a prompt tweak); keep it subordinate (never caps).
**Proven by**: a peer run whose report shows decomposed judged sub-criteria + the recorded judge config, and whose deterministic FAIL is unaffected by the judge.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Decompose `judged` into named pass/fail/unknown **sub-criteria** (plan-coherence, report-contract-coverage, explanation-matches-telemetry) surfaced as `JudgedField`s | flow-eval | Judged emits per-criterion fields, not one score | AC-09; D4 |
| 3.2 | Record **judge config** in provenance (model+version, different-family assertion vs subject, artifact-only, temp-0, anti-verbosity criterion); feed verified artifacts not subject prose | flow-eval | Config recorded; a test asserts judged never sets `required`/never caps | AC-09; D4 |
| 3.3 | Reference-anchored prompt scaffolding (CoT-before-score + a canonical good-flow anchor slot) — calibration set deferred, slot present | flow-eval | Prompt structure in place; calibration noted as follow-up | AC-09; D4/Q2 |

#### Phase 4: Docs + dogfood
**Objective**: Tell the story + prove the whole loop end-to-end with a real cross-model run (workshops 005/006 + the user's README ask).
**Domain**: docs / flow-eval
**Delivers**: the `docs/how` story page, the README section, and a dogfood run producing the first ledger cross-model comparison.
**Depends on**: Phases 1–3.
**Key risks**: keep the doc a *map not a manual* (link to workshops, don't duplicate); the dogfood needs the F12 teardown discipline (kill e2e processes before worktree removal).
**Proven by**: itself — the dogfood IS the proof; the ledger holds the comparison.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 4.1 | Write the **`docs/how` story page** per workshop 006's outline (Why → Run a peer → Watch two ways → Evaluate → Feed it back → See it run); link out, don't duplicate | docs | Page exists; hits the four beats; run-003 as the worked example | AC-10; WS006 |
| 4.2 | Add a small **"How we evaluate this system"** section to `README.md` (after `## The loop`/`## The layers`) linking to the docs/how page | docs | Section present + linked | AC-11 |
| 4.3 | **Dogfood**: run the peer-eval loop on md→PDF with **two models** (e.g. sonnet-5 + gpt-5.5), score with the new code, confirm two-axis report + ledger append + `--compare` board | flow-eval | A real cross-model ledger comparison exists; both actors' observations harvested | AC-12; WS005 |
| 4.4 | Harvest the dogfood's findings (orchestrator + subject observations) → encode any quick wins or log as follow-ups (the loop closing on itself) | flow-eval | Findings captured; ≥1 encoded or explicitly deferred | WS005; loop |
| 4.5 | **Fix round from dogfood run-1** (codex/gpt-5.5, run `20260702-041431Z-asw2rn`): (a) `score` records the ACTUAL run subject — add `--subject-harness/--subject-model/--subject-effort/--base-ref` overrides (scenario.json stays the default) and warn when the worktree HEAD ≠ the scenario's pinned `base.ref`; (b) report.md renders a null axis as **unmeasured** (`—`), never `0.00`; (c) a re-render path so a filled judged verdict reaches report.md (e.g. `flow-eval render --scenario <slug> --run <id>` regenerating report.md from report.json; ledger stays append-only, out of scope) | flow-eval | Run-1's three defects reproduced as failing tests first, then green; a re-scored run-1 record carries the true `codex/gpt-5.5` seed tuple | dogfood findings SUGG-001/SUGG-002/CONF-001 (2026-07-02 buffer) |
| 4.6 | **Comparability round from dogfood run-1 drain** (retro record `002-046-dogfood-run1-drain`): (a) **per-run assertion resolution** (SUGG-003) — `score` accepts per-run A7/A8 command resolution (e.g. repeatable `--resolve <id>=<cmd>` or a run-dir overlay file); `live-testing/scenarios/` is never mutated at run time; the e2e placeholder expectation stays stable; (b) **ledger supersede** (SUGG-004) — a re-score can mark the prior record superseded WITHOUT mutating existing lines (append-only preserved: an annotation line or a `supersedes` field on the new record); `ledger`/`--compare` exclude superseded records; retro-fit the mis-stamped run-1 line; (c) **worktree pre-creation** (INS-001) — orchestrator runbook step-0: pre-create the subject worktree at `base.ref` and hand the subject its path (blind to method preserved); note A2/A5 observability limits for autonomous subjects | flow-eval | All three encoded with tests + mutations; scenario dir stays clean through a full scored run; a `--compare` ignores the superseded claude/opus run-1 line | SUGG-003/SUGG-004/INS-001; unblocks 4.3's cross-model board |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.1, 1.2 | two-axis scores in report |
| AC-02 | 1.2 | required-fail cap only on capability+safety |
| AC-03 | 1.4 | match_mode modes + default SUPERSET |
| AC-04 | 1.5 | forbidden-state caps a violating fixture |
| AC-05 | 2.1, 2.2 | append-only ledger, byte-stable |
| AC-06 | 2.4 | ledger list + flips |
| AC-07 | 2.5 | --compare board + mismatch refusal |
| AC-08 | 2.3 | duration in SessionEvidence + record |
| AC-09 | 3.1, 3.2, 3.3 | judged decomposed + config + non-required |
| AC-10 | 4.1 | docs/how four-beat page |
| AC-11 | 4.2 | README section |
| AC-12 | 4.3 | real cross-model ledger comparison |

### Validation Strategy — the peer loop, woven through (the design north star)

Per workshop 005, this plan is validated **back and forth through the peer system**, not only by unit tests:

- **Unit layer** (every task): vitest over changed resolver/scorer/report/telemetry code, each with a **mutated-fixture non-vacuity** case (the 041 discipline — a green test that can't fail is no test).
- **Loop layer** (each phase): after a phase lands, spawn a blind peer, drive md→PDF, score with the new code, and confirm the new capability surfaces in the report/ledger. The orchestrator AND the subject both observe (`harness observe` + findings).
- **Regression layer** (Pattern 21): re-running the loop after each phase must not flip a previously-passing lane within the same `seed_tuple`; the ledger makes regression readable. Quiet sensors are suspect.
- **Comparison layer** (Phase 4): ≥2 models through the same `scenario_hash`+`base_ref` to exercise `--compare` for real.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Two-axis conflated with proof-source "lane" | Medium | High | Axis is a NEW orthogonal field (dossier §5.6); tests assert the partition |
| Dual `SessionEvidence` drifts on F13 | Medium | High | Add the span field in both decls; lock-step test (2.3) |
| Ledger append corrupts prior lines | Low | High | Append-only read-then-write; byte-stable test (2.2) |
| Self-preference confounds the judge | Medium | Medium | judge≠subject family (config, 3.2); judged never required |
| Orchestrator confounds the measurement (003 Q1) | Medium | Medium (claims only) | Flag in reports; gates cross-model *claims*, not the build; pilot before ranking |
| Peer e2e leaves a process holding the worktree | Medium | Medium | F12+ teardown: kill processes referencing the worktree before removal (run-003 wrinkle) |
| `pass^k` K unknown for our task | Medium | Low | Pilot via the ledger before any model-vs-model claim (Q4) |
