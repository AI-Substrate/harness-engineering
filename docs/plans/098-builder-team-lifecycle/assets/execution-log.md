# Execution log — plan 098

> Historical bootstrap snapshot, not a current delivery-status report. The user authorized dogfood deployment with canonical ownership/lineage acceptance and the private PDF evaluation still open; detailed later runtime receipts remain in the local retained workspace.

| ts (UTC) | actor | what |
|---|---|---|
| 2026-09-04T23:37:38Z | pij-varied-alpaca (prime) | allocated worktree `harness-engineering-worktrees/s098-builder-team-lifecycle`, branch s098/builder-team-lifecycle from origin/main 7933f5fb; scaffolded plan.dd.json via harness plan new; copied scratch intake to assets/intake.md; PM = pij-cooperative-gibbon |
| 2026-09-04T23:40:01Z | PM | Accepted scope preserved in assets/intake.md: all 12 lifecycle capabilities, separate plan/impl-guide, full Builder and eng-harness-flow lifecycles, detailed log, isolated OMP coders and cross-model reviewers. |
| 2026-09-04T23:40:01Z | PM | Verified exact runtime models with `omp models find astra --json` and `omp models find claude-opus-5 --json`: github-copilot/gpt-6-astra coders; github-copilot/claude-opus-5 reviewers with high effort. No model was inferred from a marketing alias. |
| 2026-09-04T23:40:01Z | PM | Initial native pij_send calls returned queued receipts but did not reach the rs peer; CLI `pij send` reached rs and returned delivered receipt be628ea444377096-0000000000000030. Prime's allocation packet establishes this PM as pij-cooperative-gibbon at pane %3449. |
| 2026-09-04T23:40:01Z | PM | Delivery friction: legacy `pij tail` could not find the rs peer; the session join lacked this native OMP session; `pij report --json` refused its schema projection after rs served the mutation; a later wrapper call failed on a missing minih package in the concurrently changing pij checkout. No shared tooling or registrations were altered to work around this. |
| 2026-09-04T23:40:01Z | PM | Switched to supported native `pij-rs` with explicit verified seat assertion; PM status receipt spine 6950 succeeded and allocation acknowledgement msg 01a06ecb-1df3-7b12-bdc4-573af78490ff was delivered. |
| 2026-09-04T23:40:01Z | PM | Corrected stale source-location premise: the allocated tree contains tracked skills/builder and skills/eng-harness-flow; this plan is single-repo, not a change to the former tools/skills/SDD source. Deployed skills are inspection-only and machine-global installation remains prime/human-owned. |
| 2026-09-04T23:40:01Z | PM | Read current CLI/help/plan/flow contracts, project constitution, Builder routing/flow operations and harness routing/boot; live code supersedes outdated guidance about command availability. Existing flow persistence, plan semantics and ports are reuse targets. |
| 2026-09-04T23:40:01Z | PM | Read-only scout mapped plan/scaffold/readiness, flow departure/DD gates and relocation, filesystem/exec/Git seams, behavior-test patterns, and both TS/Rust pij allocation surfaces; no code edited or validation run by the scout. |
| 2026-09-04T23:40:01Z | PM | Key design risk: Flowspace team new scans max ordinal without reservation and tidy advertises reuse, whereas pij's TS stream authority retains tombstones and preserves WIP before removal; do not copy the prototype's competing authority or ordinal-reuse claim. This repo currently has no pij project row; creating one requires notifying prime. |
| 2026-09-04T23:40:01Z | PM | `just build` in the allocated worktree succeeded: gen:docs, gen:flows and tsc completed; only that worktree's built CLI will be used for this run. |
| 2026-09-04T23:40:01Z | PM | First local doctor returned degraded, not failed: local dist/version correct; PATH biome missing; extension instructions/transient-scratch warnings need precise classification during pre-flight; no green boot claimed yet. |

## Operating invariants

- PM owns this log, the plan/implementation guide, flow transitions, integration and final evidence; coders own only their packet fences in their own worktrees.
- Every shell call names its absolute working directory; every coder is spawned from its own tree and uses absolute file paths.
- No hand-written deterministic plan/flow state or generated Markdown siblings; use ddocs and harness flow writers.
- The 12-step outline is capability scope, not a mechanical one-coder-per-step split; architecture and AC-to-observable-path coverage determine the units.
- No machine-global skill install, arbitrary project-row creation, shared database mutation, or changes to Flowspace/pij source; request any required governance action first.
- Push, PR-open and merge permissions are not inferred from implementation permission; post-flight/archive and artifact preservation remain required even if shipping waits.
- Each subsequent entry records command/decision, scope, evidence, outcome and what remains open; timestamps use observed UTC, not estimated durations.

## Planning and isolated OMP canary

- The native linked-worktree spawn refused before creating a peer. Prime verified an overbroad Git-directory shape check, recommended full clones and filed the upstream defect; no bypass, `.git` rewrite, shared-root launch or global extension change was attempted.
- The reviewer clone was created locally from the PM branch without a remote push. Root `npm ci` built through `prepare`; a redundant `--prefix harness/cli ci` failed because that directory has no package manifest/lockfile. Future clone bootstrap uses the root install only. The actual cloned CLI help then returned `status: ok`.
- `pij-natural-gant` registered in the full clone with OMP, requested Opus 5 and high effort. Relative file-tool access to the clone-only sentinel, shell cwd and the returned nonce passed the positive control. The response reached the PM through scout forwarding; launch argv/registry were observed, not provider-served model identity. No review or product work was released.
- The guide now has a declared `builder/impl-guide` schema, seven units in three waves, five disjoint coder responsibilities, ten executable check rows and 17 explicit AC-to-public-path ownership records. The baseline remains unsealed; authoring is not acceptance proof.
- Prime pinned the structured survey contract to `assets/backpressure.dd.json`, with plan/AC links and phase assertion links using that source; no `backpressure-coverage` or Markdown-only alternate is created. Certainty remains `Partial` until the new contracts are actually proved.
- The companion deterministic execution log records these controls as `lg-0005`–`lg-0009`. Its timestamps are recording timestamps; command receipts retain their own observed times.

## Proof ceiling at bootstrap

The baseline build and explicitly fast test scope passed before implementation. Doctor was degraded, not healthy. The pinned OMP reviewer canary proves root/registration/message/launch controls; it does not prove product behavior or independent provider identity. Allocator ownership remains pending human ratification, and no coder has been dispatched.
