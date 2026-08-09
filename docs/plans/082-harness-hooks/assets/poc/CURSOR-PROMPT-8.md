# Cursor prompt 8 — validate the shipped `harness hooks` end to end

> **Status: DRAFT until Phase 3 installs the hooks live.** The prompt body below is final; the
> only thing Phase 3 changes is the repo path in step 0 once the validation repo is created and
> `harness hooks install` has really run. Do not hand this to Cursor before then — a run against
> the POC hook would look identical and prove nothing about the shipped verb.
>
> **What this run is actually testing** (do not put this in the prompt — it would tell Cursor
> what to produce): that a commit made by a *sandboxed* Cursor agent, with only our installed
> hook in place, produces a git-ai note whose agent-authored line ranges match what Cursor
> actually wrote. Before the fix the note did not exist at all — total loss, not misattribution.
>
> **The paired negative control matters more than the positive.** A note appearing proves
> nothing on its own if we never showed it was absent. `assets/poc/PREDICTION.md` holds the
> falsifiable prediction registered before the run; resolve against it, and resolve it even if
> the answer is unflattering.

---

You are working in `/Users/jordanknight/temp/hooks-validate` on branch `main`.

There are changes in this repo that you did **not** make. **Leave every one of them exactly as
they are** — do not reformat, reorder, tidy, review, or "fix" anything you did not write.

Do exactly this, in order:

1. Run this command and keep its **entire** output for your report:

   ```
   python3 tools/env-report.py PROMPT-8-SHIPPED-HOOKS
   ```

2. Create `SHIPPED.md` with exactly four lines describing what this repo is for.

3. Add `export const eight = 8;` to the **end** of `seed.mjs`.

4. Stage **everything**: `git add -A` — this will include changes you did not make, and that is
   intended.

5. Commit with the message: `feat: SHIPPED.md and eight (prompt 8)`

Run `git add` and `git commit` **yourself, in your own terminal**. Use plain commands. Do **not**
pass `--no-verify`. Do **not** set or export any environment variables. Do not modify the script
in step 1, and do not "fix" anything it reports — a failure line there is expected and is part of
the measurement.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check, or
try to fix anything about authorship attribution or git notes — a collector is being observed and
touching it invalidates the run.

When you are done, report back:

- the **complete** output of step 1, verbatim, every line
- the exact shell command(s) you used for the commit, **verbatim**, including any `&&` chaining
  and any wrapper your tooling added
- the resulting commit sha
- **which lines of which files you personally wrote** in this run — this is the ground truth the
  attribution is scored against, so be precise
- whether the run was sandboxed, and paste any sandboxing notice **verbatim**
- anything you noticed that seemed unusual, however minor

---

## Scoring (for the operator, after the run — not part of the prompt)

Read the note and compare against Cursor's own ground-truth report:

```
cd ~/temp/hooks-validate && git notes --ref=git-ai show HEAD
```

| check | pass condition |
|---|---|
| note exists | a note is present on the commit at all — this is the whole fix; before it, there was none |
| agent ranges | `SHIPPED.md` lines 1-4 and the appended `seed.mjs` line are attributed to the Cursor session |
| identity not count | assert on the file + line range + session id. **Never** on a note count — any unsandboxed commit anywhere in the repo moves a count |
| guard held | the `git add -A` swept in files Cursor did not write. Those must **not** be claimed as agent-authored |
| human lines | whatever Jordan wrote by hand is **observed and reported**, never asserted as a pass condition — the absorption case was never reproduced and this plan does not claim to fix it |

**Do not seed a human checkpoint yourself to make the split appear.** That taints the run: the
question is what *Cursor* does, not what we can stage. If a human-authored file is wanted in the
mix, Jordan writes it in his own editor before the run.
