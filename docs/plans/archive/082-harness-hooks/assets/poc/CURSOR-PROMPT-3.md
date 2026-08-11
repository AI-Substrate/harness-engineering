# Cursor prompt 3 of 3

You are working in `/Users/jordanknight/temp/attrib-probe` on branch `main`.

There are changes in this repo that you did **not** make. **Leave every one of them exactly
as it is** — do not reformat, reorder, tidy, review, or "fix" anything you did not write,
including anything that looks unfinished or oddly styled. Do not open `HUMAN.md` to edit it.

Do exactly this:

1. Stage **everything**: `git add -A` — this will include changes you did not make, and
   that is intended.
2. Commit with the message: `feat: AI.md and two (cursor — mixed commit with human file)`

Run `git add` and `git commit` **yourself, in your own terminal**. Use plain commands. Do
**not** pass `--no-verify`. Do **not** set or export any environment variables.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check,
or try to fix anything about authorship attribution or git notes — a collector is being
observed and touching it invalidates the run.

When you are done, report back:

- the exact shell command(s) you used, **verbatim**, including any `&&` chaining and any
  wrapper your tooling added
- the resulting commit sha
- **which lines of which files you personally wrote** across all three prompts — this is
  the ground truth the attribution is scored against, so be precise
- whether any command was refused, blocked, sandboxed, or produced a permission error —
  reported **verbatim** rather than worked around
- anything you noticed that seemed unusual, however minor
