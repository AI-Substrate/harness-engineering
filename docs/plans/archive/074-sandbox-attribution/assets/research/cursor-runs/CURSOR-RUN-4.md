# Cursor run 4 — what does *your* git actually see?

Run 1 falsified the sandbox theory: you connected to the collector socket from inside the sandbox.
So the question is no longer "can git reach the collector" but **"does your git even know the
collector exists"**. Read `reports/run-1.md` — including the reply at the bottom — before starting.

Paste the block between the rules.

---

Read `reports/run-1.md` first, including the `## Reply from Claude` section at the bottom, so you
know what has already been ruled out.

We now believe your shell's git may never see the collector's configuration at all. git resolves
its trace2 target from **environment first, then system/global config** — so an inherited
`GIT_TRACE2_EVENT`, or a redirected `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_NOSYSTEM`, would silently
disable collection while leaving git fully working. We know Cursor manipulates git's environment
because your run-1 dump showed it exporting `GIT_HTTP_PROXY` and `GIT_HTTPS_PROXY`.

Run each of these and capture the **exact** output, including empty output (write `(no output)`
rather than omitting it). If a command is rewritten or substituted before it runs, say so.

**Step 1 — every git-related environment variable, unfiltered:**

```
env | grep -i git | sort
```

**Step 2 — what git resolves the trace2 target to, and from where:**

```
git config --get trace2.eventTarget
git config --global --get trace2.eventTarget
git config --list --show-origin | grep -i trace2
```

**Step 3 — which git, and what config files it reads:**

```
which -a git
git --version
git config --list --show-origin --show-scope | head -20
```

**Step 4 — one empty commit with nothing overridden.** This is the clean control:

```
git commit --allow-empty -m "run4: control commit, no overrides"
```

Report the SHA.

**Step 5 — the same, with the target forced explicitly:**

```
GIT_TRACE2_EVENT="af_unix:stream:$HOME/.git-ai/internal/daemon/trace2.sock" git commit --allow-empty -m "run4: forced socket target"
```

Report the SHA, and whether the command printed any error or warning.

**Step 6 — write your report** to `reports/run-4.md`, using the same structure as run 1: what you
did, each step's verbatim output, an **Anything I noticed** section, and questions for Claude.

The "Anything I noticed" section is the most valuable part — in run 1 you caught `rg` being
substituted for `grep`, which is exactly the kind of thing that could make a diagnostic lie to us.
Keep doing that.

Do not edit `relay.mjs`. Do not run git-ai commands. Do not try to fix anything — we are still
diagnosing.

---

## What each outcome means

| observation | conclusion |
|---|---|
| `GIT_TRACE2_EVENT` present in step 1 (empty or otherwise) | **Confirmed** — Cursor disables trace2 for its agent shell. Harness must re-set it. |
| `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_NOSYSTEM` present | git never reads the global config; the collector is invisible to it. Same fix. |
| step 2 returns the `af_unix:` socket, and step 4 still gets no note | git *is* configured and *is* trying — the failure is at the socket write, despite the probe connecting. |
| step 5 produces a note but step 4 does not | decisive: the config is not reaching git, but the socket works. A one-line env fix. |
