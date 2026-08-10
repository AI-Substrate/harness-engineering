# Cursor prompt 1 of 2 — copy everything below the line

**Run context (NOT part of the prompt):** repo `<REPO_PATH>`, seeded with one
HUMAN commit (`5acdaec`) made by a script with no agent involved. That seed currently carries
**no note**. Cursor config is UNCHANGED and permissive (`git`/`harness`/`node` allowlisted,
`networkPolicy: allow`) — this run establishes the happy path before anything is broken.

---

You are working in `<REPO_PATH>` on branch `main`.

`lib.mjs` currently exports a single `ident` function.

Do exactly this:

1. Add two new functions to `lib.mjs`: `double(x)` returning `x * 2`, and `triple(x)`
   returning `x * 3`. Put them **below** the existing `ident` function and do not modify
   `ident` or `README.md`.
2. Commit **only** `lib.mjs`, with the message: `feat: double and triple (cursor, run 1)`

Use plain `git add` and `git commit`. Do **not** pass `--no-verify`. Do **not** set or export
any environment variables.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check,
or try to fix anything about authorship attribution or git notes — a collector is being
observed and touching it invalidates the run.

When you are done, report back:

- the exact shell command(s) you used to commit, verbatim, including any `&&` chaining
- the resulting commit sha
- whether any command you ran was refused, blocked, or produced a permission error — and if
  so, report the refusal verbatim rather than working around it
- anything you noticed that seemed unusual, however minor
