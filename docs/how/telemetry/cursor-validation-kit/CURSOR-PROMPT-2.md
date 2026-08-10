# Cursor prompt 2 of 2 — copy everything below the line

**Run context (NOT part of the prompt):** run only AFTER the script step has been applied.
At that point `lib.mjs` contains committed human lines AND **uncommitted** human lines. This
prompt produces the MIXED COMMIT — the whole point of the exercise. Cursor's new lines and the
human's uncommitted lines land in one commit, one author, one timestamp, one session, and the
note must separate them.

---

You are working in `<REPO_PATH>` on branch `main`.

`lib.mjs` has been edited since your last commit. **Leave every existing line exactly as it
is** — do not reformat, reorder, tidy, or "fix" anything already in the file, including
anything that looks unfinished.

Do exactly this:

1. Append one new function to the **end** of `lib.mjs`: `quadruple(x)` returning `x * 4`.
2. Stage the **whole file** with `git add lib.mjs` — this will include changes you did not
   make, and that is intended.
3. Commit with the message: `feat: quadruple (cursor, run 2 — mixed commit)`

Use plain `git add` and `git commit`. Do **not** pass `--no-verify`. Do **not** set or export
any environment variables.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check,
or try to fix anything about authorship attribution or git notes — a collector is being
observed and touching it invalidates the run.

When you are done, report back:

- the exact shell command(s) you used, verbatim, including any `&&` chaining
- the resulting commit sha
- **which line numbers of `lib.mjs` you personally wrote** in this run — this is the ground
  truth we compare the note against, so be precise
- whether any command was refused, blocked, or produced a permission error — reported verbatim
  rather than worked around
- anything you noticed that seemed unusual, however minor
