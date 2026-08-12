# Original ask — plan 083

Jordan, 2026-08-11, after PR #118 merged and the Windows measurement landed:

> get a new plan folder. we wont be running proper builder flow but we will be storing our
> work in the plan folder. mv the windows stuff in there please.

Earlier the same morning, on the scope:

> [from prime, relaying Jordan's call] ADDITION TO s083 SCOPE — fold the architecture checker
> into your work, since you are fixing a batch of Windows issues anyway.

And the standing posture from the night before, which still governs:

> no comitting please, we need to review efore we do that, this is very risky big work and im
> a ltitel uncomfrotable

## What that means procedurally

This folder is a **home for artifacts, not a driven flight plan**. There is no `the-flow.json`
and no `plan.dd.json` — the builder spine is deliberately not being run here, so no rail is
manufactured that nobody intends to walk. The hand-authored plan doc sits alongside this file
under its own name precisely so it is never mistaken for `harness dd build` output.
