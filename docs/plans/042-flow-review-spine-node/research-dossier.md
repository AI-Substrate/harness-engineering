# Research dossier — flow-review-spine-node

**Created**: 2026-06-29 · **By**: /the-flow 1a explore · **Mode target**: Simple

## Intent

the-flow's flight-plan **template** and **plan-complete expander** omit a `review` node
entirely, so a flow driven by `orient`/`nav` (plan 040's whole determinism thesis) never
surfaces code review — it runs `… → phase → ship`. Add a **per-phase review spine node**
(`phase-N → review-N → next`) to the template, the expander, and the worked example so the
rail/orient make review unmissable.

## The core decision the plan must resolve

**Locked this session (Option A): review is a per-phase node ON the spine** — each phase
threads `phase-N → review-N → (phase-N+1 | ship)`. nav lands on Review after each phase;
`orient` prints "next: Review"; it is structurally on the critical path to ship. (Alternatives
considered + rejected: single terminal gate; per-phase off-spine chore.)

The remaining sub-decision the plan locks: the expander stays **byte-stable idempotent** while
now threading the phase chain through review nodes (deterministic `upsert`, not a relocating `mv`).

## Key findings (grounded)

| # | Impact | Finding | Evidence |
|---|--------|---------|----------|
| 01 | Critical | Template spine is `research → plan → phase-1 → ship` — **no `review` node**; `phase-1.next = ["ship"]`. | `~/github/tools/skills/SDD/the-flow/references/flight-plan.template.json` (4 spine + 5 chore nodes) |
| 02 | Critical | The plan-complete expander splices each phase's **boot+observe+drain** trio + two globals — **review appears nowhere**, per-phase or terminal. | `00-routing.md:211`, `:250` |
| 03 | High | Doctrine already calls review spine: *"SPINE = research → plan → phase(s) → review → ship."* The seed is dishonest to its own doctrine. | `flight-plan-ops.md:68`; this repo's twin `skills/eng-harness-flow/references/flight-plan-ops.md:132`,`:139` |
| 04 | High | The routing graph already routes `awaiting-6` clean → **review** per phase and `awaiting-7` review→ship/fix — engine knows review; only the durable seed lacks the node. | `00-routing.md:146`,`:147` |
| 05 | Medium | `review` is a **fully first-class type already** — schema `nodeTypes` + renderer zone `postflight`. So this is **content-only; no CLI code**. | `flight-plan.schema.json:17`; `harness/cli/src/services/flow/flow-renderer.ts:131` |
| 06 | Low | The worked example omits a review spine node too (review carried as per-phase artifacts + a fix-loop); a live companion "supersedes the post-hoc review stage". Node should exist regardless; status reflects companion coverage (D1: nodes always exist, provisioning governs only whether they run). | `flight-plan.example.json:24`,`:76`,`:89` |

## Risk surface / bounding constraints

- **Expander idempotency (H)**: threading review-N into the phase chain must stay a byte-stable
  `upsert` (re-run on a complete spine writes nothing) — the plan-040 AC-03 guard.
- **Cross-repo (H)**: the substantive edits are in `~/github/tools` (on `main`); doctrine twin
  in this repo already lists review on the spine, so **no parity-block rewrite** is needed here.
- **Example + fixtures (M)**: `flight-plan.example.json/.md` must show the review node; regenerate
  any golden render fixture that seeds from the template (this-repo scan found none seeding from
  the template — verify during build).
- **Authored instructions (L)**: the new review node needs pre-authored `instructions[]` (the
  AC-13 "static bone") so `orient` at a review node prints non-empty guidance with no authoring.

## Exact file:line targets for the plan

1. `~/github/tools/skills/SDD/the-flow/references/flight-plan.template.json` — insert `review`
   between `phase-1` and `ship` (`phase-1.next → ["review"]`, `review.next → ["ship"]`),
   authored `instructions[]`, command `/the-flow 7 review`; update the `_comment` node-count.
2. `~/github/tools/.../00-routing.md` — expander (`:211`/`:250`): thread per-phase `review-N` into
   the splice; keep idempotent. Update the reconcile §3 per-phase set to include review.
3. `~/github/tools/.../flight-plan-ops.md` — §4 spine line already correct; reconcile/expander
   prose updated to name review in the per-phase set.
4. `~/github/tools/.../flight-plan.example.json` + `.example.md` — show the review spine node.
5. `docs/how/harness-flow.md` (this repo, current branch) — mention review in the seed/spine if it
   enumerates the spine.

**Clean result**: no blocking unknowns. `review` is already wired end-to-end in the CLI; this is a
seed-honesty fix. Ready to plan (Simple).
