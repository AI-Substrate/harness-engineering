# Coder brief — plan 076, commit guidance convergence

**PM**: `pij-respectable-clam` · **Prime**: `pij-massive-meadowlark` · **Filed**: 2026-08-07

## Use /builder

Run this through `/builder` (dd-native, plan 071). The plan **is** the state — there is no
`the-flow.json` here, exactly as plan 075 shipped. Gates are driven by document state.

    /builder 6 implement --plan docs/plans/076-commit-guidance-convergence

## Your workspace

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s076-commit-guidance-block`
- **Branch**: `s076/commit-guidance-block`, cut at `5dae6e9c`
- **Invoke the CLI as** `node harness/cli/bin/harness.js …` from the worktree root.
  **Do NOT `just link`** — the global `harness` belongs to `main` alone.
- `just build` is safe (it no longer touches the global link). `just checks` is the gate.

## Read these first, in order

1. `docs/plans/076-commit-guidance-convergence/original-ask.md` — why this exists, stated honestly
2. `docs/plans/076-commit-guidance-convergence/plan.dd.md` — 7 ACs
3. `docs/plans/076-commit-guidance-convergence/assets/tasks/phase-1/tasks.dd.md` — 6 tasks
4. `harness/cli/src/services/instructions/commit-guidance.ts` — the file you are changing
5. `harness/cli/src/services/doctor/collector/ingress.ts` § `TRACE2_TARGET_POLICY` — **the pattern to copy**
6. `harness/cli/src/services/doctor/collector/nudge.ts` § `RETAINED_FIELD_RENDERING` — the same pattern again

## The job in one paragraph

`CommitMode` has four members. `COMMIT_INSTRUCTIONS` describes three paths (correct — it collapses
the two buffered modes into one prose outcome). `commitGuidanceBlock()` promises **two**, so on
Windows an agent is told to expect an outcome it cannot get and is sent to a recovery command that
refuses on that platform. Fix the words **and** remove the drift mechanism: both surfaces render
from one exported `Record<CommitMode, …>` table, so a fifth mode cannot be added without the
guidance failing to compile.

## Hard constraints

- **No commit behaviour changes.** Not one branch of `commit-service.ts` moves. If you find
  yourself editing it beyond exporting a type, stop and ask me.
- **The contract lives in `src`.** Typecheck `include` is `["src"]` — a contract in a test file
  compiles nowhere CI looks. This is the F011 lesson and it is not negotiable.
- **The two fence markers stay byte-exact.** `AGENTS_BLOCK_BEGIN` / `AGENTS_BLOCK_END` are what
  idempotency and stale-detection hang off. Changing them orphans every block already in the wild.
- **Nothing outside the markers is ever touched** — in this repo's `AGENTS.md` or anyone else's.
- **Never `git add -A`.** Explicit pathspecs only.
- **Never `git stash`** — the stash stack is shared across worktrees in this repo.
- Commit with `HARNESS_NO_TELEMETRY=1` and `timeout 30 git commit --no-verify`.
- Do **not** push and do **not** open a PR. Tell me when the phase is green; prime holds the
  merge gate because #108's PM may collide with us on `AGENTS.md`.

## The one thing I care most about

**ac-0002 is the point of the plan.** After your change, adding a fifth member to `CommitMode`
must fail `tsc` **at the guidance table**. If it only fails inside `commit-service.ts`, the
guarantee does not exist and the plan has not landed — you will have fixed today's words and left
tomorrow's drift in place. Prove it by actually adding a fake fifth member, running `tsc`,
capturing the error, and reverting. Put that transcript in the execution log.

A test that asserts today's text is not the deliverable. The compile error is.

## What "done" looks like

- `just checks` green
- `node harness/cli/bin/harness.js doctor` from the worktree reports `commit-guidance: ok`
- the `AGENTS.md` diff is confined to the region between the markers (verify by eye, in the diff)
- the Dim-0 transcript for ac-0002 is in the execution log
- every AC's `state` flipped to `checked` with a real receipt, via `harness dd set` — never by hand

## Report back

`pij send pij-respectable-clam "<one-line status> — <pointer to a file>"`. Pointer delivery:
persist the detail to disk, send a path. If you get stuck or the plan looks wrong, say so early —
a plan that is wrong is my mistake to fix, not yours to work around.
