# Execution Log — eng-harness-flow flight plans (plan 032)

**Plan**: [eng-harness-flow-flight-plans-plan.md](./eng-harness-flow-flight-plans-plan.md) · **Mode**: Simple (single phase, groups A–D) · **Testing**: Lightweight
**Companion**: `code-review-companion` (Power-On-Mode) — live review of each task-group commit.
**Branch**: `026-flow-nav-rail-zone` (no push without explicit ask).

> Log facts + evidence per task. Discoveries tagged `Deferred` (consciously punted) / `Noteworthy` (a call a human might make differently).

---

## Discoveries & Learnings

| ID | Tag | Discovery | Resolution |
|---|---|---|---|
| D-01 | Noteworthy | **`set-node` act has no chore/zone flags** though the `setNode` mutation merges any field generically. AC-07/R-1's "flag an existing the-flow seam node via `set-node --chore-kind command --importance …`" is therefore impossible with the shipped CLI. This is the anticipated "T103 surfaces a CLI limitation". | Group A extends the `set-node` act with `--chore-kind`/`--importance`/`--zone` (+ pre-write `badChore`/`badZone` guards so out-of-repo flight plans, where post-mutation validation is tolerantly skipped, still reject bad input). Verified: flag→chore (□ pip + listed), bad importance/zone→E108. |
| D-02 | Noteworthy | **Companion can't hold live Power-On review on minih 0.2.2** (agent requires `>=0.3.0`): boots, orients, then completes in ~77s instead of idling for inbox pings. | Adapted to **one-shot companion review per task group** over my *uncommitted diff* (the same agent runs validly one-shot). |
| D-03 | Deferred→handled | **Shared dirty branch**: `026-flow-nav-rail-zone` carries extensive uncommitted WIP from other agents (verb.ts, adapters/*, app.ts, docs-content.ts, contract.ts, ci.yml, justfile, many tests). | **No commits this phase** (honors "commit only when asked" + avoids clobbering others' WIP). Companion reviews uncommitted diffs; `git add` would only ever be MY explicit file list. Full `just test` interpreted against pre-existing churn. |
| D-04 | Noteworthy | **AC-02 wording vs template-DSL reality**: AC-02 says the loop *template* "uses a nav block… carries provenance + root identity". But the CLI template contract is `{cursor, nodes[]}` — `create` stamps provenance/nav/events/root identity; a template's own such fields are ignored. | Template authored as the real seed DSL (`cursor`+`nodes`+per-node `zone`/`command`); the "nav block + provenance + root identity" is proven on the *created instance* + the golden fixtures (full flow docs). |

---

| D-05 | Noteworthy | **T104 gitignore needs no change**: `.gitignore` only excludes `.harness/temp/` (scratch); `.harness/` itself + records are tracked. `git check-ignore .harness/loop.flow.json` → not ignored. | Standalone loop file is tracked by default; no `.gitignore` edit. |
| D-06 | Noteworthy | **coach.md § 1a was stale**: detected the retired `.the-flow-state.json` and drew a separate anchored `└─ ⚙ … ↺` harness bar. Post-030/032 the-flow position is in `the-flow.json`/nav, and coexistence = chores ON the-flow's rail (AC-13), not a second bar. | Rewrote § 1a: detect `the-flow.json` nav; render `harness flow rail --chores show`; chores are the loop's visible presence. |
| D-07 | Noteworthy | **Companion runs as one-shot, result `degraded`** on minih 0.2.2 (orient + ready, no Power-On idle). No actionable findings surfaced in report.json (it was stopped before a review task settled). | Treat companion as advisory; rely on vitest + the three eval agents for verification. Re-fired per group over uncommitted diffs. |

## Group A — CLI (T001–T006 + set-node ext) — ✅ DONE
- T001 harness-adopt.schema.json (install/scout/governance/inject/build-boot/decision; todo/skipped). T002 harness-adopt.template.json (spine + branch_of excursions + explicit zones). T003 harness-loop.template.json modernized (7 nodes: retro split, drain-gate, zones, 4 fire-hook commands, improve.next:[]) + schema description. set-node act + setNode guard extended (--zone/--chore-kind/--importance). T004 `gen:flows` (3 schemas + 2 templates). T005 golden fixtures harness-{adopt,loop}.json+.md; `flow-fixtures --check` passes (5). T006 `harness-flows.test.ts` (16 tests).
- **Evidence**: tsc clean; both flows create+render exit 0; rails `[adopt]`/`[harness-loop]`; bridge/drain-gate render `:::decision` rhombus; excursions dotted; set-node flag→chore (□ pip), bad chore/zone→E108; flow suite 205/205 green; biome clean; envelope snapshot updated (node_count 5→7 only).

## Group B — skill (T101–T105) — ✅ DONE
- T102 `flight-plan-ops.md` (NEW — nav model, spine/excursion, verb flags+gotchas, build-order, AC-07 chore shape+dedup key, standalone loop, capability precheck). T101 SKILL.md + 00-routing.md: scoped the stateless→"state contract" (stateless routing, CLI-driven flow position), two-flow section + selection predicate, froze 5-hook/envelope. T103 chore-injection doctrine + the-flow `harness-seams.md` R-1 ownership note (only cross-repo touch). T104 standalone `.harness/loop.flow.json` (tracked). T105 coach.md § 1a rewrite (the-flow.json detection + chores-on-rail AC-13).

## Group C — evals (T201–T204) — scorers ✅ tested; agents ✅ authored; runs in progress
- T201 `validate-harness-flow` adapted: prompt + output-schema gain an `adoptFlow` block (authored/railTitle/spineShape/bootBuiltLast/bridgeIsDecision/navDriven) — drives + verifies the adopt flight plan during onboarding.
- T202 `agents/loop-flow-eval/**` (NEW, faithful-drive, gpt-5.5) + `scripts/score-loop-eval.sh` (5 gates). T203 `agents/flow-coexist-eval/**` (NEW, hybrid) + `scripts/score-flow-coexist.sh` (5 gates incl. AC-13 visibility + idempotency).
- **Scorers tested (deterministic, against CLI-driven flows)**: `score-loop-eval` → ALL 5 PASS on a created+driven standalone loop; `score-flow-coexist` → ALL 5 PASS on a the-flow with 4 chores injected via real `insert-node`. The coexist rail shows the four chores as square pips inline: `◆─▣─□─◆─[ ◇ ]─□─□` (AC-13 proven).
- T204 runs: loop-flow-eval + flow-coexist-eval launched (in-repo skill via `--no-skills --skill-source path:skills/eng-harness-flow --skill eng-harness-flow`).

## Group D — docs (T301) — ✅ DONE
- `docs/how/harness-flow.md`: new "## The bundled flows — harness-adopt & harness-loop" section (overlay table, node types, zones, decision rhombus, fire-hook commands) + "### Chore injection" (insert-node + set-node R-1, dedup key, the rail pip example); set-node row updated for the new flags.

## T204 — eval runs (against the in-repo skill, gpt-5.5)
- **loop-flow-eval** (run `…-ef68`): gpt-5.5 followed the skill's flight-plan-ops guidance, created the standalone loop via real `harness flow create harness-loop` + `nav set`. `score-loop-eval.sh` → **ALL 5 GATES PASS** (rail `[harness-loop]`, 7-node acyclic spine, nav.now=observe, render 0, 4 fire-hook commands).
- **flow-coexist-eval** (run `…-4ab2`): gpt-5.5 built a throwaway the-flow, injected the 4 fire-hook chores via real CLI, re-injected. `score-flow-coexist.sh` → **ALL 5 GATES PASS** (exactly 4 dedup-keyed chores, **byte-identical re-injection** (idempotent), nav.now resolves, no loop.flow.json, rail shows chore pips — AC-13).
  - Scorer-over-self-grade caught a discrepancy: the agent self-reported `idempotent:false`, but the deterministic byte-diff proved the node sets identical → authoritative verdict idempotent. (Both runs `result: degraded` = a minih self-validation note on 0.2.2, not a gate failure.)
  - **Reconciliation (review FT-001, post-commit `3e57753`)**: the agent's `idempotent=false` self-grade was *correct* on the R-1 **set-node found-node re-flag path** — `setNode` unconditionally restamped `modified_at` + emitted `node-updated`, so re-flagging an already-correct chore churned metadata even though the node *set* (insert-node de-dup) was stable. The earlier "byte-identical re-injection" line above was accurate only for the insert-node de-dup snapshot, not the set-node re-flag. **Fixed**: `setNode` now returns the doc unchanged when every requested field already matches (no restamp, no event) — re-flagging is byte-identical. Covered by a new unit test (`harness-flows.test.ts` — "re-flagged with identical fields → byte-identical no-op") and the coexist scorer's Gate 2 byte-diff (supply the second snapshot).
- **validate-harness-flow (T201)**: ADAPTED (adopt-flow `adoptFlow` block added to prompt + output-schema). The adopt-flow path it verifies is independently proven by the CLI dogfood (created+rendered an adopt flow: rail `[adopt]`, `bridge{…}:::decision`, spine install→governance→build-boot→bridge). The full clone-onboarding probe (~30 min, overlaps prior-plan onboarding) was **not run this session** — its only net-new layer (adopt-flow) is already verified. [Deferred — re-run on request.]

## Phase complete — summary
All four task groups landed; **15/16 tasks ✅, T204 = 2/3 evals run + passing, 3rd adapted + adopt-path CLI-verified**. Full CLI vitest **951/951 green**; both new scorers + both feature-eval runs pass all gates; the AC-13 "chores on the-flow's rail" outcome is observable end-to-end.

### Deferred & Noteworthy (this phase)
- **Deferred**: validate-harness-flow full clone-onboarding run (heavy; adopt-flow layer independently verified). No `.gitignore` change for T104 (already tracked).
- **Noteworthy**: (D-01) extended the `set-node` CLI verb with `--chore-kind/--importance/--zone` to make AC-07's R-1 path possible — a CLI surface addition beyond the literal task list, required to implement the validated AC. (D-04) loop template authored as the real `{cursor,nodes}` seed DSL, not a full-doc-with-provenance (create stamps those). (D-02/D-07) companion ran one-shot/degraded on minih 0.2.2 (needs ≥0.3.0 for Power-On). (D-06) coach.md § 1a was stale (detected the retired `.the-flow-state.json`) — rewritten.
- **Cross-repo touch**: `~/github/tools/.../the-flow/references/harness-seams.md` (R-1 ownership note) — uncommitted in the tools repo.

## Companion review — findings ACTED ON (companion mode earned its keep)
The one-shot companion (`code-review-companion`) DID review each group's uncommitted diff and returned substantive findings (I initially mis-read the report path and under-reported them — corrected here). All three confirmed against plan 028 and fixed:

| Sev | Finding (companion) | Fix | Verified |
|---|---|---|---|
| **HIGH** | adopt excursions rejoined BACKWARD (`scout.next:[install]`, `inject.next:[governance]`); 028 §4 (lines 137/139) wants forward rejoin | `scout.next:[governance]`, `inject.next:[build-boot]` in template + fixture | render shows `scout -.-> governance`, `inject -.-> build_boot`; test asserts it |
| **MED** | loop `drain-gate` was a one-exit "decision" (`next:[retro-drain]`); 028 §5 (line 194) defines both outcomes | `drain-gate.next:[retro-drain, retro-harvest]` in template + fixture | render shows both edges; new test `drain-gate is a REAL decision` |
| **MED** | `getting-started.md:250` still asserted "writes no state file" — contradicts the new state contract (T101 listed it, I'd missed it) | rewrote the Key Concepts paragraph to the scoped supersession | — |

Group A verdict was `REQUEST_CHANGES`; after fixes the changes are addressed. Full CLI suite **952/952** green post-fix; fixtures `--check` passes; biome clean.

## Task Log
