# Research Dossier: eng-harness-flow mission-first refactor

**Generated**: 2026-06-30
**Query**: "Make eng-harness-flow mission-first, lean, user-legible per the 13-patch brief (scratch/paste/20260630T013710.md): pin which repo owns each file, current SKILL.md structure to make 'lean' concrete, current retro closeout UX, whether an eval surface exists, frozen contracts to preserve."
**Effort**: Deep (3 parallel Explore workers — skill anatomy, cross-repo topology, eval surface)
**Tools**: Standard
**Evidence**: 18 current sources · 0 historical (greenfield refactor of live skill)

## Answer

1. **The brief overstates the gap.** Much of what it asks for **already exists** in the skill — the "advisory ≠ agent silence" sharpening, the plain-words-not-letter-codes retro rule, and concrete observe triggers are all present today. The real work is **reframe + resurface + de-jargon**, not a rewrite.
2. **SKILL.md is already lean (126 lines).** "Lean the hot path" is therefore mostly **reorder so the mission leads**, not aggressive deletion — the first screen today is state-contract mechanics + the parity block, with **no** mission/why statement.
3. **The genuinely-absent deltas are narrow**: (a) a mission-first frontmatter description, (b) a top-of-file "Why this skill exists" + four-beat-loop block, (c) propagating the existing anti-silent-skip clause into the two spots that lack it (frontmatter + opener), (d) cleaning internal jargon out of the **user-facing** retro prompts.
4. **Repo split is the load-bearing planning fact**: 12 of 13 patches land in **this** repo (`skills/eng-harness-flow/`); **Patch 9 (the-flow echo) lands in a different repo** (`~/github/tools`) and brushes a byte-mirrored parity block.
5. **Evals are cheap and in-scope** — a behavioural-eval engine exists; the brief's headline scenario is already an assertion type. New cases = JSON data, not scaffolding.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | `eng-harness-flow` is authored **in this repo**; not present in `~/github/tools`. Deploy via this repo's justfile `install-skills-from-source` → `~/.agents/skills/` → `~/.claude` symlink. | `skills/eng-harness-flow/` tracked here; `find ~/github/tools -iname '*eng-harness-flow*'` → empty; `justfile` recipes | Patches 1–8, 10–13 edit **`skills/eng-harness-flow/`** in harness-engineering. Single repo, single PR. | High |
| F-02 | `the-flow` is authored in **`~/github/tools/skills/SDD/the-flow/`** (repo `jakkaj/tools`); **absent** from harness-engineering. Deploy = raw copy to `~/.agents`. | `tools/skills/SDD/the-flow/...`; `skills/` here has no `the-flow` | **Patch 9 is a cross-repo edit** in a *different* git repo → its own commit/PR, separate from the main work. | High |
| F-03 | `doctrine-parity:039 v2` block is **byte-mirrored** between `eng-harness-flow/SKILL.md:40-55` (here) and `tools/.../harness-seams.md:13-28` (there); currently identical. Gate `check:doctrine-parity` diffs them, SKIPs when `~/.agents` the-flow absent. | `scripts/doctrine-parity.mjs`, `harness/cli/src/services/doctrine-parity/` | Patch 9's echo is **safe only outside lines 13–28** of harness-seams.md. Inside the block ⇒ two-repo, two-commit byte-identical change. **Recommend: echo as a NEW section, not inside the block.** | High |
| F-04 | `SKILL.md` is **126 lines**, all `##` headings, first screen = state-contract mechanics; the longest section is the parity block (L38–55). **No** "why this skill exists" / dual-mandate / loop statement anywhere on the hot path. | `SKILL.md:1-126` (heading map L6/12/26/38/57/74/89/93/119) | "Lean" ≈ **reorder** (mission → loop → registry → contract → references), not delete. Add the missing mission/loop block (Patches 2+4). | High |
| F-05 | Frontmatter `description` is router/mechanism-first ("Stateless harness-loop router… re-derives where the work sits… routes to the SINGLE correct harness skill…"). | `SKILL.md:3-4` | Patch 1 is **real** — the genuine "first thing the model sees is mechanics" defect. | High |
| F-06 | The brief's "advisory ≠ agent may silently skip" sharpening **already exists** in 3 places — but is **missing** from the frontmatter (L4) and the L14 state-contract opener (which say only the unqualified "never gates, scores, or blocks"). | `00-routing.md:18`, `SKILL.md:53`, `coach.md:136` (present); `SKILL.md:4,14` (gap) | Patch 5 collapses to a **narrow propagation** into 2 spots + a reusable "Meaning of advisory" anchor — not a sweep. | High |
| F-07 | Retro UX **already** forbids raw letter codes and maps to plain words (`yes/Enter`, `pick`, `skip`, `tasks/plan/diffs/extension`). | `retro.md:149,180`, `coach.md:129` | Patches 6/8/12 are **partially done**; the residual is the two-decision *ordering* + ensuring no jargon leaks into the prompt. | High |
| F-08 | Internal jargon still appears in **user-facing** retro text: the "magic wand" prompt (`retro.md:50,52,160-163`), `system.compound`, `sensor-shaped`, `.harness/records/retro/` paths. | `retro.md:50,52,13,175,192,262`; `coach.md:124` | Patches 7/8 = targeted de-jargon of the *prompts* (keep the concepts as model-facing prose). | High |
| F-09 | Concrete in-flight observe triggers **already exist** (8 of them) — but only in the retro module, **not** on the SKILL.md hot path. | `retro.md:97-107` (+ calibration 108-115) | Patch 11 = **surface/echo** the existing triggers compactly on the hot path; don't invent new ones. | High |
| F-10 | A behavioural-eval engine exists (`harness flow-eval`, plan 041): blind subject → telemetry/worktree → deterministic score. New case = one `live-testing/scenarios/<slug>/assertions.json`. | `.harness/extensions/flow-eval/`, `docs/how/flow-conformance-eval.md` | Step-9 evals are **data additions**, optional, low-cost. | High |
| F-11 | The brief's headline eval ("spec done → agent fires `--hook pre-coding`") is **already an assertion type** — `flow-seam-fired`, worked example A4. Router `--json`/`--hooks`/hook-chore injection are deterministically unit-tested. | `resolvers.ts:166`, `assertions.json:30-35`; `flow-chore.test.ts`, `flow-orient.test.ts`, envelope snapshot | Behaviour ACs are *checkable*, not aspirational. Reuse, don't build. | High |
| F-12 | All frozen contracts located and intact: 5 hooks (`00-routing.md:221-231`), `--event` alias (`:206-209,233-247`), `--json` envelope (`:278-308`), `--hooks` manifest (`:310-383`), boot-LAST gate (`:112-130`), coding=silent-observe (`SKILL.md:59,65`; `00-routing.md:86-88`), progressive disclosure (`SKILL.md:10,89`), harness-blind modules (`SKILL.md:20,36,91`). | as cited | These are the preservation ACs — touch wording/order around them, never their shape. | High |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Patch 9 cross-repo drift | F-02, F-03 | Editing the-flow harness-seams in `~/github/tools` is a separate repo + separate PR; if the echo lands inside the parity block it's a two-place byte change with a CI/local gate. | Plan it as a **distinct phase/excursion**; place the echo **outside** lines 13–28; verify `check:doctrine-parity` after. |
| "Lean" could regress determinism | F-04, F-12 | Aggressive deletion to "lean the hot path" could move a frozen-contract line off the hot path where a router consumer or a reader relies on it. | Treat lean as **reorder + compress prose**, gate on the contract locations in F-12 staying intact (and the parity block byte-stable). |
| Over-building (the biggest risk) | F-06,F-07,F-09 | The brief reads as a from-scratch rewrite; ~60% is already present. Re-writing what exists risks weakening working doctrine and inflating the diff. | Plan must **diff against current state** patch-by-patch; several patches collapse to one-or-two-line edits or "already satisfied — verify only." |
| Deploy lag after edit | F-01 | In-repo edits don't reach the live skill until `just install-skills-from-source` runs (the `~/.agents` copy is currently stale). | Add an explicit **deploy + re-render verify** step at ship (this repo's recipe), mirroring the earlier deploy-lag lesson. |

## Domain Impact

| Domain / boundary | Relationship | Contract or constraint | Evidence |
|-------------------|--------------|------------------------|----------|
| eng-harness-flow skill (this repo) | **modify** (prose/order) | frozen router contract must survive | F-04,F-05,F-12 |
| the-flow harness-seams (tools repo) | **modify** (additive echo) | parity block byte-mirror; cross-repo | F-02,F-03 |
| doctrine-parity gate | **must stay green** | byte-identical mirror | F-03 |
| flow-eval / live-testing | **optional add** | assertions-as-data | F-10,F-11 |

## Planning Handoff

- **Preserve**: the 5 lifecycle hooks, `--event` alias, `--json` envelope, `--hooks` manifest, boot-LAST adoption order, coding=silent-observe vs the 4 fire hooks, progressive disclosure, harness-blind verb modules, never-gate/score/block, and the `doctrine-parity:039 v2` block byte-for-byte (F-12, F-03).
- **Change carefully**: the parity block (F-03) — don't edit; the frozen-contract lines (F-12) — reorder around, never reshape; the retro *concepts* (keep model-facing, plain only in prompts, F-08).
- **Likely files/symbols**: `skills/eng-harness-flow/SKILL.md` (frontmatter + new mission/loop block + reorder), `references/stages/retro.md` (de-jargon prompts, two-decision ordering), `references/coach.md` (already mostly done — verify/echo), `references/getting-started.md` (cold-agent/deterministic-layer framing), `references/00-routing.md` (advisory clarification — mostly present); **cross-repo**: `~/github/tools/skills/SDD/the-flow/references/harness-seams.md` (additive echo outside the parity block); **optional**: `live-testing/scenarios/<slug>/assertions.json`.
- **Decisions still required**:
  1. **Repo split** — one harness-engineering plan covering Patches 1–8,10–13, with Patch 9 as a separate tools-repo commit/PR? (recommended) Or defer Patch 9?
  2. **Lean posture** — reorder-and-compress (recommended, low risk) vs the brief's implied larger restructure?
  3. **Evals in scope** — author 1–2 `flow-seam-fired` scenarios now, or leave as a documented follow-up?
  4. **Mode** — Simple (this is mostly prose, one repo) vs Full (the cross-repo Patch 9 + optional evals argue for 2 phases).

## External Research
_None material — entirely an in-repo / local-source-repo refactor._
