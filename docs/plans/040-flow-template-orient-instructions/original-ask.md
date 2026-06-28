# Original ask — flow-template-orient-instructions
**Captured**: 2026-06-29  ·  **By**: /the-flow

> Refine the OOTB flight-plan starter so it "just works" without inference, especially on
> cheaper models. This is a summary of a design pre-amble (full decisions in
> `design-backlog.md` (this folder), D1–D6). Work on the current 039 branch and fold into
> PR #45 — it's refinement of that work.
>
> **D1 — Chores live in the TEMPLATE, deterministically.** The shipped seed becomes the full
> starter (research → plan → [phase-1] → ship + the 5 chores) in one `create --template` call.
> **Delete** the bare-spine + create-time conditional `apply` + the router/provisioned **gate**
> + the §3b canonical batch that currently lives **in the the-flow skill**. The skill carries
> **zero weight for basic setup**. No-harness repos still get all 9 nodes (chores are skippable).
> The multi-phase expander stays but sources its chore shape from the template (one source of truth).
>
> **D2 — `harness flow orient`** (new first-class CLI verb): one dead-simple command that prints,
> for `nav.now`: rail + current node (label / command / instructions) + due chores. "What's next"
> becomes a read, not an inference.
>
> **D3 — "orient every turn" becomes a hard SKILL.md invariant** (positional, survives /compact),
> not diffuse coach.md prose. Honest caveat: guaranteed enforcement on adversarially-weak models
> needs a harness-side per-turn hook — note it, don't block on it.
>
> **D4 — Per-node `instructions: string[]`** (mirrors `artifacts`): plain text for the LLM to read.
> Template-seeded AND runtime-authorable via first-class `harness flow` (`set-node --add-instruction`
> append + `--instructions` replace + `--clear-instructions`). Agent can enrich an existing node and
> create new nodes with instructions. NOT rendered verbatim in the md — an icon badge (`📝N`) marks
> presence. orient prints them in full. Distinct from `comment` (history log) and `note`.
>
> **D5 — Colour by TYPE always; importance/chore = icons or mermaid first-class visual modifiers**
> (shapes / stroke / dasharray), reversing 039 AC-11's flag-driven chore colouring. A harness-seam
> node renders `:::harness` again regardless of the chore flag.
>
> **D6 — orient shows the current node's chores WITH status pips** (`■` done ✓ / `▨` skipped /
> `□` todo) so a weak model sees the checklist completing, not items vanishing. orient-render only;
> `due_chores` stays outstanding-only.
>
> Cross-repo (like 039): tools-repo the-flow skill (`~/github/tools/skills/SDD/the-flow/`) +
> `harness/cli/`. Process: run explore, consider workshops, report READY.
