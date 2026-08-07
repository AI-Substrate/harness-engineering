# Cursor run 7 — manufacture fresh missing commits, then isolate the recovery trigger

Your only job in this run is to **create three commits that will lose attribution** (we now know
exactly how: compound commands). Claude will then poke recovery levers one at a time from outside
the sandbox, checking your three SHAs after each lever. Do not read anything new first — run 6
closed the capture question; this run is about the recovery path.

Paste the block between the rules.

---

We are deliberately creating unattributed commits. Make three trivial separate edits to
`calc.mjs` (comments are fine), and commit each one with a **compound** command — that shape is
known to lose attribution, and that is the point:

```
git add calc.mjs && git commit -m "run7-1 deliberate compound"
```

```
git add calc.mjs && git commit -m "run7-2 deliberate compound"
```

```
git add calc.mjs && git commit -m "run7-3 deliberate compound"
```

Then write `reports/run-7.md` containing just: the three SHAs (`git log --oneline -3`), whether
each command ran exactly as written, and anything you noticed (approval prompts, sandbox
messages, rewrites).

Do not run `node commit.mjs`, `relay.mjs`, or any standalone `git commit` — a single attributed
commit from your session would contaminate the baseline.

---

## Outside levers (Claude, after the report lands)

Check the three SHAs after **each** lever; stop at the first one that recovers them.

| # | lever | isolates |
|---|---|---|
| L0 | wait 90s, touch nothing | spontaneous recovery / timer |
| L1 | buffered unrelated commit + `relay.mjs` drain | replayed trace2 events |
| L2 | plain live commit from unsandboxed shell | live commit activity (re-test of lever 1 against fresh misses) |
| L3 | `git-ai bg restart` | daemon restart sweep (the FX009 `1bb008c` recovery followed a restart) |
| L4 | `git-ai await` / checkpoint verbs | explicit CLI-driven sweep |

Also record between levers: daemon log `sweep`/`recovery` lines, and whether the sweep names the
Cursor transcript path. Outstanding facts this closes:

1. **Which lever wakes the recovery sweep** — decides whether `harness doctor telemetry-nudge`
   is a trace2 replay, a daemon poke, or a restart.
2. **The recovery span** — earlier, 2 commits recovered while 8 stayed dead; which window governs.
3. **Whether recovery needs the agent's transcripts on disk** — the sweep line referenced
   `~/.cursor/projects/…`; if that is the source, portability depends on transcript presence,
   not on trace2 at all.
