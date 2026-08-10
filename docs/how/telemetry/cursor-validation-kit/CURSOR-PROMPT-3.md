# Cursor prompt 3 of 3 — copy everything below the line

**Run context (NOT part of the prompt):** the human-simulating edit is ALREADY DONE — a plain
python script (`human_edit.py`) appended `clamp()` at lines 36-50 of `lib.mjs`, python file IO
only, no agent Write tool, no shell heredoc. This mirrors the prior corpus method for
simulating a hook-less human edit and removes run 2's confound (run 2's "human" lines went
through Claude Code's Bash tool, which may itself be observed). Ground truth before the run:
lines 36-50 = human-simulated, uncommitted. Cursor should add `halve()` below them.

---

You are working in `<REPO_PATH>` on branch `main`.

`lib.mjs` has been edited since the last commit. **Leave every existing line exactly as it is**
— do not reformat, reorder, tidy, or "fix" anything already in the file, including anything
that looks unfinished or oddly styled.

Do exactly this:

1. Append one new function to the **end** of `lib.mjs`: `halve(x)` returning `x / 2`.
2. Stage the **whole file** with `git add lib.mjs` — this will include changes you did not
   make, and that is intended.
3. Commit with the message: `feat: halve (cursor, run 3 — true human mixed commit)`

Use plain `git add` and `git commit`. Do **not** pass `--no-verify`. Do **not** set or export
any environment variables.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check, or
try to fix anything about authorship attribution or git notes — a collector is being observed
and touching it invalidates the run.

When you are done, report back:

- the exact shell command(s) you used, verbatim, including any `&&` chaining
- the resulting commit sha
- **which line numbers of `lib.mjs` you personally wrote** in this run — this is the ground
  truth we score the attribution against, so be precise
- whether any command was refused, blocked, or produced a permission error — reported verbatim
  rather than worked around
- anything you noticed that seemed unusual, however minor
