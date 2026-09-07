# Builder team lifecycle — intake and bootstrap log

## User authorization

> get a new worktree now from varied-alpaca and we will start the work. interestingly we can dogfood the new approach manually. take a detailed log of work in the plan folder. this 12 steps looks good. remember builder and eng-harness-flow skills need to run tehir full life cycle as well. also lynx/magpie had settings for model choice etc. we will use omp harness, github astra 6 coders and github claude opus 5 high revewiers for this work. you are the pm.

User accepted the 12-step outline below; names of NEW commands are proposed design inputs, not claims of existing implementations.

## Accepted scope

1. Initialize — new `harness builder new`: next ordinal, worktree, branch, plan folder; reuse plan/flow primitives and proven team lifecycle machinery.
2. Research — existing harness instructions/docs and flowspace search; Builder owns synthesis.
3. Product/system plan — existing plan new/validate/ready/render; requirements, scope, ACs, architectural decisions separated from team mechanics.
4. Implementation guide — new impl-guide scaffold/validation: SRP units, contracts, dependencies, ownership, waves, isolation, composition and proof.
5. Decomposition readiness — structural AC coverage, dependency/ownership/contract checks plus explicit architectural review.
6. Contract baseline — baseline commit and required contract/fixture/exemplar proof before dependent coder dispatch.
7. Prepare/dispatch — isolated coder workspaces, scoped packets, pij lifecycle and canary/ack receipts.
8. Implement — Builder discipline plus checked stage advancement, reusing existing flow and fence machinery.
9. Compose — PM-owned dependency-order integration and named end-to-end proof through existing project commands.
10. Review — independent cross-model review bound to a composed SHA; finding dispositions and proof checked before close-out.
11. Close/archive/reclaim — full Builder post-flight and eng-harness-flow lifecycle, archive relocation, authorized shipping, preservation of required artifacts before safe teardown.
12. Skill assets — versioned templates and worked architecture-enabled parallel decomposition exemplars, including good/bad splits, injectable services, waves and integration proof.

## Decisions and constraints

- This seat is the PM; pij-varied-alpaca is the repository prime and requested worktree allocator.
- Coders: OMP, `github-copilot/gpt-6-astra` (exact selector confirmed by `omp models find astra --json`).
- Reviewers: OMP, `github-copilot/claude-opus-5`, effort `high` (selector and high support confirmed by `omp models find claude-opus-5 --json`).
- This run uses native `pij-rs spawn --harness omp --bin omp` from a full local peer clone; the current linked-worktree guard refuses OMP even without a real extension collision. Canary-verify the native file-tool root before work release; never launch on shared main and rely on shell `cd`.
- Authoritative skill source is this repository's `skills/builder/` and `skills/eng-harness-flow/`; deployed home-directory copies are inspection-only. The intake's initial external-SDD source-location assumption was superseded by source verification.
- Harness product source is this repository; Flowspace's team skill/extension are prior art, not an edit target.
- One canonical flow substrate; no hand edits to `.the-flow-state.json`, `the-flow.json`, or `the-flow.md`; mutations use the owning CLI.
- Preserve all 12 accepted capabilities; determine implementation waves through interfaces, not by mechanically assigning one coder per listed step.
- No unstated authorization to push, open PRs, or merge; those actions retain the skills' separate authorization boundaries.

## Bootstrap evidence and friction

- Requested isolated worktree, ordinal, plan path, integration ownership and the stamped PM identity from pij-varied-alpaca via native pij_send; receipt `1acbe2ae-bf0f-4320-aaf7-13d93a59746c` queued.
- Local `node harness/cli/bin/harness.js --help` confirms plan/flow/instructions/docs/checks exist and no builder command family exists yet.
- Plan verbs: new, validate, ready, render, pr-body, fence.
- Flow verbs include create, nav, orient, status, apply, comment, relocate and render; reuse rather than duplicate their persistence and guards.
- `pij spawn --help` confirms OMP runtime selection and exact worktree-rooted launch requirement is achievable through CLI cwd.
- Model discovery friction: `pij models --help` prints generic help; `--bin omp` is rejected; `pij models --harness pi` omits Astra, while OMP's own model catalog returns it, so verify against the actual runtime catalog and a live canary.
- Earlier CLI self-resolution failed E-AMBIG while native pij_send worked; waiting for the prime's stamped sender identity rather than guessing or adopting another seat.
- Loaded Builder guided routing/coach/flight-plan operations and eng-harness-flow routing/boot; all lifecycle attempts must have real evidence, never fabricated hook envelopes.

## Prior-art anchors

- Flowspace `.agents/skills/pij-team/SKILL.md`, `TENETS.md`, templates and `EXPERIENCES.md`.
- Flowspace `.harness/extensions/team/extension.ts` and instructions: existing prototype new/tidy lifecycle.
- Flowspace plan 008 impl-guide/packets/integration proof/review: frozen contracts, four units in two waves, PM composition, and explicit unowned-capability failure.
- Private prior-art research informed architecture-enabled fan-out, isolation policy and preservation-first teardown; source identifiers and traceability remain only in the local research workspace.

## Pending allocation

Move/copy this intake into the assigned plan's assets and maintain the detailed timestamped execution log there; do not turn this scratch copy into a competing plan or flow state.
