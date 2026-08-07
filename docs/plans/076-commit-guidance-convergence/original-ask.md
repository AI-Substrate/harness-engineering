# Original ask — commit-guidance-convergence

**Captured**: 2026-08-07  ·  **By**: pij-respectable-clam (PM)

> **Prime (`pij-massive-meadowlark`), batch-queue ruling (c), position 3:**
> "commit-guidance-block managed-block convergence — YOURS, file it now. It is small,
> independent, and touches nothing turkey is in. Do not wait on #108; queue position 3 means
> ordering of MERGE, not of filing. File the plan, run the phase, and come to me at the merge
> gate so I can sequence it against turkey's PR if they collide on AGENTS.md."

## Where this came from

Raised by me during plan 075 as a known follow-up, not found by review. Plan 075 gave
`harness commit` a fourth branch (`ingress-unverified` — the Windows named pipe) and updated
`COMMIT_INSTRUCTIONS` to describe it. The managed `AGENTS.md` block was left behind.

Prime ruled option (c) at the time: **ship it separately, batched** with anything else queued
for that block, rather than widening 075's diff. This plan is that separate ship.

## The defect, stated honestly

Verified in source at `5dae6e9c` before this plan was written:

- `CommitMode` is a **four**-member union (`direct-verified`, `file-buffered`,
  `harness-buffered`, `ingress-unverified`) — `commit-service.ts:133`.
- `COMMIT_INSTRUCTIONS` describes **three** paths and the Windows refusal — correct.
- `commitGuidanceBlock()` promises **two**: *"either confirms a `refs/notes/ai` note landed or
  names the buffer … plus the command that drains it"* — `commit-guidance.ts`.

So on Windows an agent reading `AGENTS.md` is promised an outcome set it cannot get, and is
pointed at `harness doctor telemetry-nudge`, which on a win32 host refuses by design.

**The text fix is one paragraph. The defect is the absence of a convergence mechanism** — the
outcome contract exists as two hand-maintained prose copies with nothing forcing agreement. It
drifted once and will drift again at the next branch change. Fixing only the words leaves the
drift intact.

## Why the type system, not a test

This is DL-007 from plan 074's retro: *a guarantee about future code needs the type system, not
a test.* The house pattern is already proven twice in this codebase —
`TRACE2_TARGET_POLICY` (`ingress.ts`) and `RETAINED_FIELD_RENDERING` (`nudge.ts`). Both make an
omission a compile error rather than a review catch. This plan applies the same shape a third
time, keyed on `CommitMode`.

The F011 rider applies: the contract must live in `src`. Typecheck `include` is `["src"]`, so a
contract parked in a test file compiles nowhere CI looks.

## Scope fence

The worktree `s076-commit-guidance-block` (branch `s076/commit-guidance-block`, cut at
`5dae6e9c`) and this plan folder. **No commit behaviour changes** — not one branch of
`commit-service.ts` moves.

## Known collision to watch

Issue #108's PM (`pij-spiritual-turkey`, worktree `win-path-family`) may touch `AGENTS.md`.
Prime holds merge sequencing between the two PRs; that is why this plan comes to prime at the
merge gate rather than merging on green.

## Deliberately NOT in scope

- **Windows replay support** — still blocked on the unverified transport premise. Nobody has
  yet run `git config --global --get trace2.eventTarget` on a Windows box, so we do not know
  whether the `named_pipe` branch shipped in 075 is real or theoretical. Prime has routed that
  question to #108's PM.
- **A `windows-latest` CI leg** — approved by prime, but bound to #108's PR under that ruling's
  same-PR-and-green condition.
