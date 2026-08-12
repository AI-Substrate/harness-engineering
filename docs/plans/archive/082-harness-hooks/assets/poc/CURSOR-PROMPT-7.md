# Cursor prompt 7 — connectivity AND commit, in one run

You are working in `/Users/jordanknight/temp/attrib-probe` on branch `main`.

There are changes in this repo that you did **not** make. **Leave every one of them exactly
as it is** — do not reformat, reorder, tidy, review, or "fix" anything you did not write.

Do exactly this, in order:

1. Run this command and keep its **entire** output for your report:

   ```
   python3 tools/env-report.py DURING-COMMIT-RUN-B
   ```

2. Create `AI4.md` — three or four lines about what this repo is for.
3. Add `export const five = 5;` to the **end** of `seed.mjs`.
4. Stage **everything**: `git add -A` — this will include changes you did not make, and that
   is intended.
5. Commit with the message: `feat: AI4.md and five (controlled run B)`

Run `git add` and `git commit` **yourself, in your own terminal**. Use plain commands. Do
**not** pass `--no-verify`. Do **not** set or export any environment variables. Do not modify
the script in step 1, and do not "fix" anything it reports — a failure line there is expected
and is part of the measurement.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check,
or try to fix anything about authorship attribution or git notes — a collector is being
observed and touching it invalidates the run.

When you are done, report back:

- the **complete** output of step 1, verbatim, every line
- the exact shell command(s) you used for the commit, **verbatim**, including any `&&`
  chaining and any wrapper your tooling added
- the resulting commit sha
- **which lines of which files you personally wrote** in this run — this is the ground truth
  the attribution is scored against, so be precise
- whether the run was sandboxed, and paste any sandboxing notice **verbatim**
- anything you noticed that seemed unusual, however minor
