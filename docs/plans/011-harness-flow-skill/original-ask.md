# Original ask — harness-flow-skill

**Captured**: 2026-06-09  ·  **By**: workshop kickoff (manual)

> Review the flow skill in the tools repo. Look at the skill itself and it's getting started document. Not how it wraps a flow of skills and provides a workflow around the skills. We need this for our harness skills.
> Note how it is re entrant and that it can run at any phase.
> - Run on empty repo then setup harness offer.
> - Run on full repo but no harness seen - set it up.
> - Maybe Offer to run harnessability after that.
>
> If it detects are are in a plan thanks to conversation history then it might detect to run harness boot skill or other skills in the harness loop. Start a new plan folder and start with a workshop that includes mermaid of what a workflow graph for our harness loop would look like of this - the various dynamic entry points and how this skill would assist the Hamess flow. Also this skill could be called at various points along an externally managed spec driven flow, with it called at regular points again and again maybe with some basic parameter prompting from the parent agent. Unlike the flow will probably not store data or Md or have other artefacts that it tracks with (child skills will though etc the harness ability skill).
>
> Skill is at: /Users/jordanknight/github/tools/skills/SDD/the-flow/SKILL.md and readme is : /Users/jordanknight/github/tools/skills/SDD/the-flow/references/getting-started.md.

## Reference material studied

- `the-flow` SKILL.md — the SDD-pipeline co-pilot (stateful, print-then-offer, re-entrant via on-disk state, adoption contract).
- `the-flow` getting-started.md — the visual two-track guide (SDD pipeline + harness loop).
- This repo's harness skills: `eng-harness-0-{setup,harnessability-assessment,add-extension}`, `eng-harness-{1-boot,2-backpressure,3-observe,4-retro}`.
- `harness-foundations/directives.md` — the loop definition (Boot → Backpressure Check → Do Work and Observe → Retro and Magic Wand → Improve).
