# Original ask — eng-harness-flow-flight-plans
**Captured**: 2026-06-19  ·  **By**: /the-flow

> next up, the eng-harness-flow is a progress disclosure skill like the-flow. It has two main modes, the onboarding/adoption flow and the main harness loop flow.
>
> we need to create the same first class "harness flow" concept complete with navigation and schema as "the-flow" unlike "the-flow" however we have two completely distinct flows here. one is onboarding/adopt and the other is the main harness loop. They are separate, and never run together, its one or the other. This means we could run either flow depending on the state the eng-harness-flow detects.
>
> no it must use real harness flow nav commands, the full dice. this is DOGFOODING and providing an exemplar on how to use these features. During the main flow - it may or may not be running along side "the-flow". If it is running along side "the-flow" then it will integrate its own nodes in there as "chores" which the flow system allows, so that we the main flow tracks them for us too and we dont miss things. we keep missing things. the [chores] should say "run /eng-harness-flow --blah" etc.
>
> much like how we use agents to test things with agents/flow-skill-eval we have agents/validate-harness-flow. we will need to adapt that for this, and add another one that checks the the-flow and eng-harness-flow work together as described.

## Scoping decisions locked during playback (2026-06-19)

- **Loop state home (alongside the-flow)**: chores-only in the-flow's `the-flow.json` — no separate harness plan while the-flow is active. Standalone (no the-flow) → eng-harness-flow authors its own `.harness/loop.flow.json`.
- **Chore set**: the 4 fire hooks — `run /eng-harness-flow --hook pre-flight | pre-coding | post-coding | post-flight`. `coding`/observe stays silent (no chore); `improve` follows a retro (no chore).
- **Verification**: three agents + three deterministic scorers —
  - `agents/validate-harness-flow` (adapt) → the **adopt** flow,
  - `agents/loop-flow-eval` (new) → the **standalone loop** flow,
  - `agents/flow-coexist-eval` (new) → loop **+ the-flow** chore integration.
- Cross-repo split (per plans 027/030): skill source edits land in the **tools** repo (`skills/eng-harness-flow/`); eval harnesses + scorers live **here** in harness-engineering.
