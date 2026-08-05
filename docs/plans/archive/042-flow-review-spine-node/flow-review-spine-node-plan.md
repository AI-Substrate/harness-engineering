# Flow review spine node — surface code review per phase

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-29
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from `research-dossier.md`. Follow-on remediation to plan 040
(flow-template-orient-instructions) — closes the review-node gap that plan shipped with.

---

## Business Specification

### Research Context

Plan 040 baked the SDD spine into the flight-plan **template** so a weak model *reads* the next
step via `orient`/`nav` instead of inferring it. But the shipped template (and the plan-complete
expander) emit `research → plan → phase → ship` with **no `review` node** — even though the
doctrine (`flight-plan-ops.md:68`) and the routing graph (`00-routing.md:146`) both treat review
as a spine stage. Net: the one stage the determinism was meant to make unmissable is the one left
out of the seed, so a flow driven by orient silently skips code review. `review` is already a
fully-supported node type (schema + renderer), so this is a **seed-honesty fix, not new mechanics**.

### Summary

Add a **per-phase `review` node on the spine** (`phase-N → review-N → next`) to the-flow's
flight-plan template, the plan-complete additive expander, and the worked example — with
pre-authored `instructions[]` — so `orient`/rail surface code review after every phase with zero
inference. Topology decision (locked this session): **Option A, per-phase spine node**.

### Goals

- A fresh `harness flow create --template` seeds `research → plan → phase-1 → review-1 → ship`.
- The plan-complete expander threads each new phase as `phase-N → review-N → next`, staying
  byte-stable idempotent.
- `orient` at a review node prints non-empty **authored** guidance (the AC-13 "static bone").
- The worked example + this repo's CLI doc reflect review on the spine.

### Non-Goals

- No CLI code change — `review` is already first-class (schema `nodeTypes`, renderer zone). Verified, not modified.
- No fix-loop redesign (the existing `fix-loop` excursion off a phase is unchanged).
- No change to the harness **chore shape** (review is an SDD stage, not a harness chore). _(Correction, discovered in review: the `doctrine-parity:039` block ALSO describes the **seed spine** — "9-node … phase-1 → ship" — so its seed-description **was** updated byte-identically in both `harness-seams.md` (tools) and `eng-harness-flow/SKILL.md` (this repo). The chore-shape part of the block is unchanged.)_
- No migration of existing in-flight flows (additive; the every-entry reconcile pass backfills them).

### Target Domains

> No `docs/domains/registry.md` — informal area mapping. No NEW domains.

| Domain (area) | Status | Relationship | Role in This Feature |
|---|---|---|---|
| skill-the-flow (`~/github/tools/skills/SDD/the-flow/references`) | existing | **modify** | template + expander + flight-plan-ops + example |
| docs (`docs/how/harness-flow.md`, this repo) | existing | **modify** | seed/spine mention, if it enumerates the spine |
| cli-flow (`harness/cli/.../flow-renderer.ts`, schema) | existing | **consume** | review type already supported — verify only, no edit |

### Testing Strategy

- **Approach**: Lightweight / manual — render-and-eyeball + a real `create → orient → render`
  round-trip (matches plan 040's strategy for skill-markdown; the template/expander are skill
  content, not CLI code, so they carry no unit test).
- **Focus**: review node round-trips through `create`; `orient` prints authored instructions;
  expander threads `review-N` and re-run writes nothing (idempotency); no unintended golden-fixture churn.
- **Excluded**: unit tests for `.json`/`.md` skill edits.

### Documentation Strategy

- **Location**: the the-flow skill references **are** the spec (template/expander/ops/example), plus
  `docs/how/harness-flow.md` (this repo) for the CLI-facing seed/spine mention.

### Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1 (cross-repo: tools + this repo), D=1 (one spine node + edge rewire in the expander), N=0 (reuses an existing type), F=0, T=1
- **Confidence**: 0.85
- **Assumptions**: per-phase spine node (Option A, locked); deploy topology = edit tools source, redeploy to `~/.agents`/`~/.claude` to test the live create.
- **Phases**: 1 (Simple).

### Acceptance Criteria

- **AC-01** — The template seeds `research → plan → phase-1 → review-1 → ship`: `phase-1.next == ["review-1"]`, `review-1.next == ["ship"]`, type `review`, command `/the-flow 7 review`.
- **AC-02** — `review-1` carries pre-authored `instructions[]`; a fresh `create --template` → `orient` (with nav at the review node) prints non-empty guidance with no manual authoring.
- **AC-03** — The plan-complete expander threads each phase as `phase-N → review-N → next` (deterministic-id `upsert`); a 2-phase expand yields `… → phase-1 → review-1 → phase-2 → review-2 → ship`, and **re-running on the complete spine writes nothing** (byte-stable idempotent).
- **AC-04** — The reconcile §3 per-phase set and `flight-plan-ops.md` prose name `review-N` alongside the boot/observe/drain trio; `flight-plan-ops.md:68`'s spine line stays correct.
- **AC-05** — `flight-plan.example.json` + `.example.md` show review on the spine; `docs/how/harness-flow.md` (this repo) names review in the seed spine where it enumerates it.
- **AC-06** — No CLI change; any golden render fixture touched is regenerated **intentionally** (reviewed diff) and `harness checks --quick` is green for anything edited in this repo.
- **AC-07** — Per-phase review nodes carry an explicit **`--zone flight`** (overriding the `review`→postflight default) so the rail/orient **interleave** them in spine order — single phase `research·plan·[ P1·review-1 ]·ship`, two phases `…·[ P1·review-1·P2·review-2 ]·ship` — never bunched into the postflight band. (Validation finding 05.)

### Risks & Assumptions

- **Expander idempotency** (H): threading `review-N` must stay an `upsert` (no relocating `mv`); re-run on a complete spine writes nothing — re-assert via the worked idempotency example.
- **Cross-repo** (M): substantive edits in `~/github/tools` (on `main`); this repo's twin doctrine already lists review on the spine → no parity rewrite. Plan + the doc edit land here on the current branch.
- **Deploy-to-test** (M): editing tools source doesn't change the live `~/.claude` template until redeployed — verify the round-trip against the redeployed copy, not the source.

### Open Questions

- None blocking. Topology (per-phase spine node) locked this session.

### Workshop Opportunities

| Topic | Type | Why Workshop | Status |
|---|---|---|---|
| — | — | none — single locked decision, CS-2 | n/a |

### Clarifications

#### Session 2026-06-29
- **Workflow Mode**: Simple (`--simple`).
- **Testing Strategy**: Lightweight/manual — assumed from plan 040's established strategy for skill-content (user asked for "no ceremony"; not re-prompted).
- **Mock Usage**: Avoid mocks — real flow JSON + real create/orient/render.
- **Documentation Strategy**: skill references as spec + `docs/how/harness-flow.md`.
- **Topology**: per-phase review as a spine node (Option A), locked via the prior AskUserQuestion.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none.

| Artifact | Present? | Effect on the plan |
|---|---|---|
| research-dossier.md | y | Key Findings, exact file:line targets, locked decision |
| workshops/*.md | n | — |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|---|---|---|---|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]`; strategy defaulted per "no ceremony" + plan-040 precedent |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md`; change stays in skill content + one doc |
| G4 | ADR Compliance | N/A | No `docs/adr/*.md` |
| G5 | Structure | PASS | All required Simple-mode sections present |
| G6 | Testing Alignment | PASS | Lightweight — each task carries a render/round-trip validation |
| G7 | Domain Completeness | PASS | Informal areas; no NEW domains; manifest covers referenced files |

### Summary

Insert a per-phase `review` node onto the flight-plan spine in three the-flow artifacts (template,
expander, example) plus this repo's CLI doc. `review` is already a supported type, so no CLI code
changes — the work is making the seed honest to the doctrine. Verified by a real
`create → orient → render` round-trip and an idempotent 2-phase expander check.

### Domain Manifest

| File | Domain (area) | Classification | Rationale |
|---|---|---|---|
| `~/github/tools/skills/SDD/the-flow/references/flight-plan.template.json` | skill-the-flow | contract | add `review-1` spine node + authored instructions (T001) |
| `~/github/tools/.../references/00-routing.md` | skill-the-flow | contract | expander + reconcile §3 thread `review-N` (T002) |
| `~/github/tools/.../references/flight-plan-ops.md` | skill-the-flow | contract | per-phase-set prose names review (T002) |
| `~/github/tools/.../references/flight-plan.example.json` + `.example.md` | skill-the-flow | contract | worked example shows review on spine (T003) |
| `~/github/tools/.../references/harness-seams.md` | skill-the-flow | contract | **(added in review)** doctrine-parity:039 seed-spine description 9→10/review |
| `skills/eng-harness-flow/SKILL.md` | skill-eng-harness-flow | contract | **(added in review)** byte-identical doctrine-parity twin (parity guard) |
| `docs/how/harness-flow.md` | docs | contract | seed/spine mention (T004, this repo) |
| `harness/cli/src/services/flow/flow-renderer.ts`, `flight-plan.schema.json` | cli-flow | consume | verify review type already supported — no edit (T005) |

### Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | Template + expander omit `review`; spine runs `… → phase → ship` (`flight-plan.template.json`; `00-routing.md:211`,`:250`). | T001/T002 add `review-N` on the spine |
| 02 | High | Doctrine + routing already treat review as spine (`flight-plan-ops.md:68`; `00-routing.md:146`). | Seed-honesty fix; no doctrine change needed |
| 03 | Medium | `review` already first-class (`schema:17`, `renderer:131`). | T005 verify only — no CLI edit |
| 04 | Medium | Expander is byte-stable idempotent (plan-040 AC-03); threading review must preserve it. | T002 keep `upsert`, update the worked idempotency example |
| 05 | Medium | The rail bands strictly by zone (`flow-renderer.ts:628-637` buckets the spine into `pre─[flight]─post`); `review` defaults to **postflight** (`flight-plan-ops.md §5`), so per-phase review nodes mid-spine would **bunch in the postflight band**, breaking the locked interleave. | T001/T002 set per-phase review `--zone flight` (AC-07) |

### Implementation

**Objective**: Add a per-phase `review` spine node to the-flow's template/expander/example (+ this repo's doc) so orient/rail surface code review per phase.
**Testing Approach**: Lightweight — real `create → orient → render` round-trip + an idempotent 2-phase expander check; intentional fixture regen only if touched.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T001 | Insert `review-1` spine node between `phase-1` and `ship` (`phase-1.next→["review-1"]`, `review-1.next→["ship"]`, type `review`, **`zone: "flight"`**, command `/the-flow 7 review`, authored `instructions[]`); bump `_comment` node count 9→10. | skill-the-flow | `~/github/tools/skills/SDD/the-flow/references/flight-plan.template.json` | Round-trip create→render rail reads `research·plan·[ P1·review-1 ]·ship`; AC-01/AC-07 hold | static bone; flight-zoned |
| [ ] | T002 | Thread `review-N` (each **`zone: flight`**) into the plan-complete expander (`phase-N→review-N→next`) and the reconcile §3 per-phase set; keep `upsert` + update the worked idempotency example to include `review-N`. | skill-the-flow | `~/github/tools/.../00-routing.md`, `.../flight-plan-ops.md` | 2-phase expand rail interleaves `[ P1·review-1·P2·review-2 ]·ship`; re-run writes nothing; AC-03/AC-04/AC-07 | no `mv`; flight-zoned |
| [ ] | T003 | Update `flight-plan.example.json` + `.example.md` to show review on the spine. | skill-the-flow | `~/github/tools/.../flight-plan.example.{json,md}` | example renders review on the spine; AC-05 | keep example honest |
| [ ] | T004 | Add a review mention to the seed/spine description in this repo's CLI doc (where it enumerates the spine). | docs | `docs/how/harness-flow.md` | doc names review in the seed spine; AC-05 | lands on current branch |
| [ ] | T005 | Redeploy the-flow skill (tools→`~/.agents`/`~/.claude`), then verify: fresh `create --template`→`orient` at the review node prints authored instructions; render clean; verify `review` type needs no CLI edit; regen any touched golden fixture intentionally + `harness checks --quick` green. | cli-flow | (verify) `harness/cli/...`, deployed skill | AC-02/AC-06 green; no CLI edit needed; fixture diff (if any) reviewed | deploy-to-test |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|---|---|---|
| AC-01 | T001 | create→render round-trip |
| AC-02 | T001, T005 | orient prints authored instructions |
| AC-03 | T002 | 2-phase expand + re-run no-op |
| AC-04 | T002 | reconcile/ops prose names review-N |
| AC-05 | T003, T004 | example + doc show review on spine |
| AC-06 | T005 | no CLI edit; checks --quick green; fixture diff reviewed |
| AC-07 | T001, T002 | rail interleaves review per phase (`--zone flight`) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Expander loses byte-stable idempotency when threading review | Medium | High | T002 keeps deterministic `upsert`; worked idempotency example re-asserts no-op on re-run |
| Editing tools source but testing stale `~/.claude` copy | Medium | Medium | T005 redeploys before the live round-trip |
| Unintended golden-fixture churn in this repo | Low | Medium | T005 reviews any diff; no CLI edit expected |
| Review nodes bunch in the postflight rail band (zone default) instead of interleaving | Medium | Medium | AC-07: per-phase review nodes `--zone flight`; verified by the rail round-trip in T001/T005 |
