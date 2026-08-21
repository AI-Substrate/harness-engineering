# Reviewer brief — plan 076, commit guidance convergence

**PM**: `pij-respectable-clam` · **Coder**: `pij-immediate-pennyroyal` (opus-5) · **You**: terra, cross-model by design

## Scope

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block`
- **Branch**: `s076/commit-guidance-block` · **Commit under review**: `8a856921`
- Invoke the CLI as `node harness/cli/bin/harness.js …`. **Do not `just link`** — the global
  `harness` belongs to `main`.

Run it through `/builder`:

    /builder 7 review --plan docs/plans/076-commit-guidance-convergence

## Read first

1. `docs/plans/076-commit-guidance-convergence/original-ask.md` — why this exists
2. `plan.dd.md` — the 7 ACs
3. `assets/tasks/phase-1/tasks.dd.md` — the 6 tasks
4. `assets/tasks/phase-1/execution.log.md` — the coder's own account, incl. its Dim-0 transcript

## What the change is

`harness commit` has four `CommitMode` branches. The managed `AGENTS.md` block promised **two**
outcomes, so a Windows agent was promised an outcome it cannot get and sent to a recovery command
that refuses on that platform. Both guidance surfaces now render from one exported
`Record<CommitMode, CommitOutcomeGuidance>` table, so adding a fifth mode is a **compile error at
the guidance table**.

## Where I want your skepticism, in priority order

**1. ac-0002 is the plan.** I have already re-run the mutation myself: 2 errors, both in
`commit-guidance.ts` (TS1360 `:124`, TS7053 `:139`), `commit-service.ts` clean. **Do not just
repeat it.** Attack the *claim*: is there a way to add a fifth `CommitMode`, or to change what a
mode PROMISES, that does **not** trip the compiler? `as const satisfies` guards that a **key
exists** — does it guard anything about the **value** being correct or non-empty? A table that
compiles with a wrong or empty promise still ships a lie.

**2. Two judgment calls the coder made beyond the letter of its tasks.** It disclosed both; I want
them audited, not rubber-stamped.
   - (a) It went **two-level** (`COMMIT_OUTCOMES` + a mode→outcome map) instead of the flat table
     my task text implied.
   - (b) It **derived away a third hand-maintained enumeration** in the instructions page's
     *"What is and is not guaranteed"* that no task named.

   I think both are right. Tell me if I am wrong — especially (b), which is prose I did not ask
   anyone to touch.

**3. The buffered collapse.** `file-buffered` and `harness-buffered` share one "buffered" outcome;
the renderer joins their conditions with *"or when"*. Is the resulting sentence actually **true for
both**, or does it describe one and quietly imply the other? They differ in a way that matters: a
plain-FILE target must be pointed back at the socket before the nudge helps.

**4. Does the new `AGENTS.md` text tell a Windows agent the right thing?** It says do NOT run
`telemetry-nudge`. Verify that against **what the nudge actually does on win32**, not against what
the block says about it.

**5. Anything the plan CLAIMS that the code does not deliver.** That failure is the entire reason
this family of plans exists, and it has now surfaced one layer up twice.

## Constraints to verify held

- `commit-service.ts` **zero-line diff**
- the two fence markers **byte-exact**
- the `AGENTS.md` diff **confined between the markers**

## Gate state (confirm, don't assume)

`just checks` is green on every hard gate (`tests:ok`). Three report `degraded` — `arch-check`,
`markdown-lint`, `windows-check` — all pre-existing warn-launch. Confirm this diff does not
contribute to them.

## Deliverable

Write to `docs/plans/076-commit-guidance-convergence/assets/reviews/phase-1-review.md`, then
`pij send pij-respectable-clam` a verdict (**APPROVE** / **CHANGES**) with findings ranked.

**Do not fix anything yourself. Do not push.**
