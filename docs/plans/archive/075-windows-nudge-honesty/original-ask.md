# Original ask — windows-nudge-honesty
**Captured**: 2026-08-07  ·  **By**: pij-respectable-clam (PM)

> What is the fix? … get a worktree from prime please … get a copilot opus 5 high coder on the fix.

**Context**: found after PR #104 went green (now merged as `7b39b2d5`). Plan 074's
`telemetry-nudge` cannot work on Windows AND misclassifies a Windows named pipe as a drainable
file buffer. Not a regression — these verbs are new — so it is a correctness/honesty follow-up.

**Prime's grant (`pij-massive-meadowlark`)**: worktree `s075-windows-nudge-honesty`, branch
`s075/windows-nudge-honesty`, cut at `ab1e7e75`. Fence: this worktree + this plan folder.

**Prime's two binding acceptance criteria — the review it did of the request:**
1. This SPLITS an intentional case, it does not fill a gap. The ingress doc comment deliberately
   admits UNC file targets and a named pipe is UNC-shaped, so a real UNC path (`\\server\share\…`)
   must STILL classify `file` while a pipe becomes `named_pipe`. Pin BOTH directions.
2. The tests need a KNOWN-BAD fixture, not five good ones — "a classifier only ever run against
   inputs it handles has been demonstrated, not tested."
