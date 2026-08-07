# eng-harness-flow — Mission-First, Lean, User-Legible

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-30
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from `research-dossier.md` (12 findings, 4 risks). Source brief: `scratch/paste/20260630T013710.md` (13 patches).

---

## Business Specification

### Research Context

The dossier flipped the brief's premise: the skill is **already ~60% aligned** with the request. The "advisory ≠ agent silence" sharpening exists in three places (`00-routing.md:18`, `SKILL.md:53`, `coach.md:136`); the "plain words, no letter codes" retro rule exists (`retro.md:149,180`, `coach.md:129`); 8 concrete observe triggers exist (`retro.md:97-107`). `SKILL.md` is already lean (126 lines). So the work is **reframe + resurface + de-jargon**, not a rewrite — and the biggest risk is **over-building** (rewriting working doctrine, inflating the diff, nudging a frozen-contract line off the hot path, or breaking the byte-mirrored parity block).

### Summary

Make `eng-harness-flow` announce its **dual mandate** — finish the task **and** shift repeated friction into deterministic substrate — so the first screen *installs that behaviour* instead of explaining the router. Lead `SKILL.md` with a mission + four-beat-loop block, propagate the existing advisory-clause into the two first-impression spots, echo the existing observe triggers onto the hot path, and de-jargon the **user-facing** retro prompts. Add a small additive "why the seams exist" echo to `the-flow`'s `harness-seams.md` (a different repo). Preserve every frozen contract and the parity mirror byte-for-byte.

### Goals

- A fresh/weak/compacted agent reading the **first screen** of `SKILL.md` can state: *"I have two jobs — do the work, and improve the deterministic environment; before work I boot/check backpressure, during work I observe friction, after work I drain/harvest, at closeout I offer to encode the best lesson."*
- "Advisory" is unmistakably **user-control, not agent-silence** at the points that set first impressions (frontmatter + opener), not only buried mid-file.
- The **user-facing** retro closeout reads in plain words (save notes → turn into fixes), free of internal jargon and storage paths.
- `the-flow` readers see *why* the harness seams interrupt the race to "done."
- Every frozen contract and the `doctrine-parity:039` block survive **unchanged**.

### Non-Goals

- **No rewrite** of doctrine that already works; several patches collapse to one-or-two-line edits or verify-only.
- **No behaviour/contract change**: the 5 hooks, `--event`/`--json`/`--hooks`, boot-LAST gate, coding=silent-observe, progressive disclosure, harness-blind modules, never-gate posture are all preserved.
- **No new `docs/how` page**; the change *is* the skill prose.
- **No behavioural eval cases this round** — documented follow-up (the `flow-eval` engine exists; new cases = `assertions.json` data).
- **No edit inside** the `doctrine-parity:039` block; the `the-flow` echo lands *outside* it.

### Target Domains

> Informal areas; no NEW domains; no domain registry consulted (prose refactor).

| Domain (area) | Status | Relationship | Role in This Feature |
|---|---|---|---|
| eng-harness-flow skill — `skills/eng-harness-flow/` (this repo) | existing | **modify** | the mission reframe, reorder, observe-trigger echo, retro de-jargon |
| the-flow harness-seams — `~/github/tools/skills/SDD/the-flow/references/harness-seams.md` (repo `jakkaj/tools`) | existing | **modify** | additive "why the seams exist" echo, outside the parity block |
| doctrine-parity gate — `scripts/doctrine-parity.mjs` + `harness/cli/src/services/doctrine-parity/` | existing | **consume** | must stay green; the `:039` block stays byte-identical |

### Testing Strategy

- **Approach**: **Lightweight + deterministic gates**. Proof surfaces: `check:doctrine-parity` green; existing router/flow tests stay green (`flow.test.ts`, `flow-orient.test.ts`, `flow-envelope-snapshot.test.ts`, `flow-chore.test.ts`); a frozen-contract grep at the F-12 locations stays intact; golden render fixtures unaffected; one **manual legibility read** ("fresh agent reads the first screen → states the dual mandate").
- **Focus**: preservation (contracts + parity byte-stability) and legibility (mission visible on screen one).
- **Excluded**: behavioural eval authoring (follow-up); any new application logic (there is none).

### Mock Usage

N/A — documentation/prose only; no application logic, so no mocks apply.

### Documentation Strategy

No new `docs/how` page. The edits *are* the documentation (skill `SKILL.md` + `references/*` prose). Per brief Patch 3, the module-level prose updates in place.

### Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1 (several files, all prose), I=0, D=0, N=1 (mission/dual-mandate reframe), F=1 (legibility/UX), T=1 (gates + manual read)
- **Confidence**: 0.85
- **Assumptions**: the dossier's current-state diffs are accurate (file:line verified this pass); the parity block stays untouched; deploy is via this repo's `just install-skills-from-source`.
- **Dependencies**: `~/github/tools` checkout writable on `main` (Patch 9); `check:doctrine-parity` resolvable locally (`~/.agents` the-flow present, else it SKIPs — non-blocking).
- **Risks**: over-building; deploy-lag; accidental parity-block / frozen-contract drift (see Risks).
- **Phases**: 1 (Simple).

### Acceptance Criteria

- **AC-01** — `SKILL.md`'s **frontmatter `description`** leads with the dual mandate (purpose), not router mechanics; the **first body section** is a "Why this skill exists" block, placed before any state/routing mechanics.
- **AC-02** — `SKILL.md` states the loop in plain canonical form on the hot path: **before** (boot + backpressure) · **during** (observe friction) · **after** (drain/harvest) · **closeout** (encode the best lesson).
- **AC-03** — "Advisory = user-control, not agent-silence" appears at **both** first-impression spots — the frontmatter description **and** the opening state-contract sentence (today `SKILL.md:4` + the `:14` opener carry only the unqualified "never gates, scores, or blocks") — plus a reusable "Meaning of advisory" anchor.
- **AC-04** — Concrete in-flight observe triggers are **echoed compactly onto the `SKILL.md` hot path** (sourced from the existing `retro.md:97-107` list — not newly invented), so the trigger→`harness observe` mapping is visible without opening a reference.
- **AC-05** — The **user-facing** retro closeout: (a) is split into two sequential decisions — *save notes* (yes/pick/skip) then *turn into fixes* (task cards / patches / harness command-check); (b) contains **no** internal jargon in the prompts (`system.compound`, `sensor-shaped`, raw `[s/t/p/e/d/a]`/`[r/w/s]` codes, `.harness/records/retro/` paths) and the "magic wand" wording is replaced as the **primary** prompt by plain language; (c) **names the top improvement and offers an encode/fix path at `post-flight` — the offer is never silently skipped** (declining is a real `--to skipped`, honest).
- **AC-06** — `getting-started.md` carries the cold-agent / deterministic-layer framing (every session starts cold; encode-the-fix once you'd infer it twice), and the retro heading reads as "Retro and Improve" (or similar) rather than "magic wand" as the primary label.
- **AC-07** — `~/github/tools/.../harness-seams.md` gains a "Why the harness seams exist" section, **outside** the `doctrine-parity:039` block (current lines 13–28), committed on `main` in the tools repo.
- **AC-08** (preservation) — All frozen contracts intact at their F-12 locations: 5 lifecycle hooks, `--event` alias, `--json` envelope, `--hooks` manifest, boot-LAST adoption order, coding=silent-observe vs the 4 fire hooks, progressive disclosure, harness-blind verb modules, never-gate/score/block.
- **AC-09** (preservation) — The `doctrine-parity:039 v2` block is **byte-identical** to its tools-repo partner; `npm run check:doctrine-parity` is green (or SKIPs) after deploy.
- **AC-10** — Existing router/flow tests stay green; `SKILL.md` stays lean (hot path reordered mission→loop→registry→contract→references); no token bloat (every added line changes agent behaviour or routes to a precise reference — brief Patch 13).

### Risks & Assumptions

- **Over-building** (H): the brief reads as a from-scratch rewrite though ~60% exists → every task **diffs against current state first**; several are verify-only or one-line edits (Key Findings 02/03/04).
- **Parity-block / frozen-contract drift** (H): an edit could reshape a frozen line or the mirrored block → the `the-flow` echo is **additive and outside** the block; preservation is gated by AC-08/AC-09 (grep + `check:doctrine-parity`).
- **Deploy-lag** (M): in-repo edits don't reach the live skill until `just install-skills-from-source`; the `~/.agents` copy is currently stale → explicit deploy + re-verify task.
- **Cross-repo coordination** (M): Patch 9 is a separate repo on `main` → its own commit, verified independently; not entangled with this repo's branch/PR.

### Open Questions

- None blocking. All four planning forks resolved (Patch 9 included / Simple / evals-deferred / reframe-posture).

### Workshop Opportunities

| Topic | Type | Why | Status |
|---|---|---|---|
| — | — | none — single locked posture, CS-2, doctrine mostly present | n/a |

### Clarifications

#### Session 2026-06-30
- **Workflow Mode**: Simple (locked pre-plan).
- **Testing**: Lightweight + deterministic gates (parity + existing tests + manual legibility read).
- **Mock Usage**: N/A — no code.
- **Documentation**: No new `docs/how` page — edits are the skill prose.
- **Patch 9**: included, additive, `main` in `~/github/tools`, outside the parity block.
- **Evals**: documented follow-up.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none.

| Artifact | Present? | Effect on the plan |
|---|---|---|
| research-dossier.md | y | 12 findings, file:line targets, the current-state diff per patch, the repo-split decision |
| workshops/*.md | n | — |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|---|---|---|---|
| G1 | Clarify | PASS | no `[NEEDS CLARIFICATION]`; all forks resolved |
| G2 | Constitution | N/A | no `docs/project-rules/constitution.md` |
| G3 | Architecture | PASS | stays in the skill-prose layer; no new deps, no logic |
| G4 | ADR Compliance | N/A | no `docs/adr/` constraints engaged |
| G5 | Structure | PASS | required Simple sections present |
| G6 | Testing Alignment | PASS | Lightweight — each task carries a validation/Done-When; preservation gated deterministically |
| G7 | Domain Completeness | PASS | informal; no NEW domains; manifest covers all touched files |

### Summary

A surgical, diff-against-current refactor of the `eng-harness-flow` skill prose: lead with the mission + four-beat loop, propagate the existing advisory-clause to the first-impression spots, echo existing observe triggers onto the hot path, de-jargon the user-facing retro prompts, and add a small `the-flow` echo in a separate repo. Proven by the doctrine-parity gate + existing router tests staying green and a manual first-screen legibility read. No behaviour or contract changes.

### Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `skills/eng-harness-flow/SKILL.md` | eng-harness-flow | internal | frontmatter + mission/loop block + reorder + observe-trigger echo + advisory anchor (T001–T004) |
| `skills/eng-harness-flow/references/stages/retro.md` | eng-harness-flow | internal | user-facing prompt de-jargon + two-decision ordering + non-skippable closeout (T005) |
| `skills/eng-harness-flow/references/coach.md` | eng-harness-flow | internal | verify/echo advisory + plain-retro (mostly present) (T006) |
| `skills/eng-harness-flow/references/getting-started.md` | eng-harness-flow | internal | cold-agent/deterministic-layer framing + heading (T007) |
| `skills/eng-harness-flow/references/00-routing.md` | eng-harness-flow | internal | advisory clarification — verify, minor (T006) |
| `~/github/tools/skills/SDD/the-flow/references/harness-seams.md` | the-flow (tools repo) | cross-domain | additive "why the seams exist" echo, outside parity block (T008) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Real gap: frontmatter + first screen are router-mechanics-first; no mission statement (`SKILL.md:3-4`, heading map). | T001/T002 — mission-first frontmatter + top block |
| 02 | High | Advisory-not-silence clause already exists 3×, missing only from frontmatter + `:14` opener. | T003 — narrow propagation, not a sweep |
| 03 | High | Plain-words retro rule + 8 observe triggers already exist; jargon persists only in user-facing prompts (`retro.md:50,52,13,175,192`). | T004 echo triggers; T005 de-jargon prompts (targeted) |
| 04 | High | `SKILL.md` is 126 lines — "lean" = reorder, not delete; frozen contracts at fixed locations (F-12). | T003 reorder; AC-08 grep-guards them |
| 05 | High | Patch 9 file is in a different repo and contains the byte-mirrored parity block (L13–28). | T008 — additive, outside the block, on `main` |
| 06 | Medium | Live skill is a stale deploy; edits need `just install-skills-from-source` to take effect. | T009 deploy + re-verify |

### Implementation

**Objective**: Reframe `eng-harness-flow` mission-first and de-jargon its retro UX (surgical, diff-against-current), add the `the-flow` echo, preserving every frozen contract and the parity mirror.
**Testing Approach**: Lightweight + deterministic gates (parity + existing router/flow tests + frozen-contract grep + manual legibility read). Every task diffs against current state before editing.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T001 | Replace the frontmatter `description` with mission-first wording (dual mandate + the four-beat loop in brief; fold in the advisory-not-silence qualifier). Keep required metadata fields. | eng-harness-flow | `skills/eng-harness-flow/SKILL.md` | First thing the model sees is purpose, not route mechanics; advisory qualifier present (AC-01, AC-03) | Patch 1 + 5a |
| [x] | T002 | Add a top-of-body `## Why this skill exists` block (dual mandate + the 4-step loop: before/during/after/encode) **immediately after the H1**, before any state/routing mechanics. Short, explicit, impossible to miss. | eng-harness-flow | `skills/eng-harness-flow/SKILL.md` | Block present at top; states both jobs + the loop (AC-01, AC-02) | Patch 2 + 4 |
| [x] | T003 | Reorder the hot path (mission → loop → registry → router-contract short form → progressive disclosure → references); compress surplus mechanism into existing references **without deleting frozen-contract lines** (verify they remain present at F-12 locations). Add a reusable "Meaning of advisory" anchor and propagate the clause into the `:14` opener. | eng-harness-flow | `skills/eng-harness-flow/SKILL.md` | Hot path leads with mission; AC-08 grep intact; advisory anchor present (AC-03, AC-10) | Patch 3 + 5b |
| [x] | T004 | Echo the existing 8 observe triggers (from `retro.md:97-107`) compactly onto the `SKILL.md` hot path as a trigger→`harness observe` mapping — surface, don't reinvent. | eng-harness-flow | `skills/eng-harness-flow/SKILL.md` | Concrete triggers visible on the hot path (AC-04) | Patch 11 |
| [x] | T005 | De-jargon the **user-facing** retro prompts: replace the "magic wand" wording as the primary prompt with plain language; enforce the two-decision ordering (save notes → turn into fixes) with plain choices (task cards / patches / harness command-check); strip `system.compound`, `sensor-shaped`, raw letter codes, and `.harness/records/retro/` paths from prompts (keep concepts as model-facing prose); make the `post-flight` closeout name the top improvement + offer an encode/fix path (never silently skipped). | eng-harness-flow | `skills/eng-harness-flow/references/stages/retro.md` | User-facing prompts jargon-free, two-decision, non-skippable closeout offer (AC-05) | Patch 6+7+8+12 |
| [x] | T006 | Verify/echo: confirm `coach.md` plain-retro + advisory wording is consistent with T001–T005 (mostly present — touch only what drifts); confirm/clarify `00-routing.md`'s advisory section reads user-control-not-agent-silence. Verify-first; minimal edits. | eng-harness-flow | `skills/eng-harness-flow/references/coach.md`, `references/00-routing.md` | Consistent advisory + plain-retro language; no contradiction with SKILL.md (AC-03, AC-05) | Patch 5 (verify-heavy) |
| [x] | T007 | Add the cold-agent / deterministic-layer framing to `getting-started.md` near "The Big Picture" (every session starts cold; encode-the-fix once you'd infer twice); retitle the retro section to "Retro and Improve" (magic-wand demoted from primary label). | eng-harness-flow | `skills/eng-harness-flow/references/getting-started.md` | Cold-agent framing present; heading updated (AC-06) | Patch 10 |
| [x] | T008 | In `~/github/tools` on `main`: add a `## Why the harness seams exist` section to `the-flow`'s `harness-seams.md`, placed **outside** the `doctrine-parity:039` block (after the intro blockquotes, before line 11). Additive only; commit on `main`. | the-flow (tools) | `~/github/tools/skills/SDD/the-flow/references/harness-seams.md` | Echo present outside the block; parity block untouched (AC-07) | Patch 9 — cross-repo |
| [x] | T009 | Token-discipline + preservation sweep: confirm every added `SKILL.md` line changes behaviour or routes to a reference (brief Patch 13); deploy this repo's skill (`just install-skills-from-source`); run `npm run check:doctrine-parity` (green/SKIP), the existing router/flow tests, and the frozen-contract grep; do the manual "fresh agent reads first screen → states the dual mandate" legibility read. | eng-harness-flow | `skills/eng-harness-flow/**`, repo scripts | AC-08/AC-09/AC-10 all green; legibility read passes | Patch 13 + deploy-lag mitigation |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T001, T002 | frontmatter + top-block present |
| AC-02 | T002 | four-beat loop on hot path |
| AC-03 | T001, T003, T006 | advisory clause at frontmatter + opener + anchor |
| AC-04 | T004 | observe triggers on hot path |
| AC-05 | T005, T006 | retro prompt de-jargon + two-decision + closeout |
| AC-06 | T007 | getting-started framing + heading |
| AC-07 | T008 | tools-repo echo outside parity block |
| AC-08 | T003, T009 | frozen-contract grep |
| AC-09 | T009 | `check:doctrine-parity` green/SKIP |
| AC-10 | T003, T009 | existing tests green + lean hot path + token sweep |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Over-building — rewriting working doctrine | Medium | High | Every task diffs current state first; T002/T006 are add/verify, not rewrite; Key Findings 02/03 flag what's already present |
| Frozen-contract or parity-block drift | Low | High | Echo is additive + outside the block; AC-08 grep + AC-09 `check:doctrine-parity` gate T009 |
| Deploy-lag hides the change | Medium | Medium | T009 deploys + re-verifies; the live `~/.agents` copy is refreshed explicitly |
| Cross-repo Patch 9 entangles the PR | Low | Medium | T008 is a standalone `main` commit in tools, verified independently of this repo's branch/PR |
