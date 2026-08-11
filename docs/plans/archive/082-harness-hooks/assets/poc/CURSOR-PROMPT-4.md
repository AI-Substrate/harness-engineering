# Cursor prompt 4 — connectivity re-check only

You are working in `/Users/jordanknight/temp/attrib-probe` on branch `main`.

Run this one command in your terminal and paste its **entire** output back, verbatim:

```
python3 tools/env-report.py AFTER-CHANGE
```

That is the whole task. Do not edit any file. Do not stage anything. Do not commit.

The script only reads environment variables and attempts two local connections; it writes
nothing and changes nothing.

Do **not** set or export any environment variables before running it, do **not** modify the
script, and do **not** "fix" anything it reports — the output is the measurement, whatever it
says. A failure line is a valid and useful result; do not retry it, work around it, wrap it in
a different shell, or substitute another command.

Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check, or
try to fix anything about authorship attribution or git notes — a collector is being observed
and touching it invalidates the run.

When you are done, report back:

- the **complete** output, verbatim, every line
- the exact command you ran, verbatim, including any wrapper your tooling added around it
- whether the run was sandboxed, and paste any sandboxing notice **verbatim**
- anything you noticed that seemed unusual, however minor
