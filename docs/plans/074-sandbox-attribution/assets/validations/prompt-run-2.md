# Cursor run 2 — force the BLOCKED branch, then recover it

Run 1 proved the shipped verbs work when the collector is reachable, and proved a bare
`harness` command is exempted by the allowlist. It did NOT test the branch the feature exists
for: what happens when the ingress is genuinely blocked. Every command in run 1 matched the
allowlist and ran outside the sandbox, so nothing was ever blocked.

This run forces it. Commands are wrapped so the first word is `sh` — which your allowlist does
not match — so they should run INSIDE the sandbox, where the collector socket is unreachable.

Baseline: 4 commits, 4 notes.

---

Paste the block between the rules into Cursor's agent.

---

You are testing what happens when a tool CANNOT reach its collector. Some commands below are
deliberately wrapped in `sh -c` so they do not match the command allowlist and therefore run
inside the sandbox. That is the point of the test — do not "fix" it by unwrapping them.

For EVERY command, state whether your environment reported it sandboxed or outside the sandbox.
That labelling is half the experiment. Quote all output verbatim. A failure is a valid result.

**Step 1 — a plain git commit, sandboxed. The failure the feature exists to fix.**
Add a `five()` function to `lib.mjs`, then run exactly:

```
sh -c 'git add lib.mjs && git commit -m "run2-A plain git, sandboxed"'
```

Report the output and the resulting SHA (`git rev-parse HEAD` as its own command).

**Step 2 — the same situation, but through the shipped verb.**
Add a `six()` function to `lib.mjs`, then run exactly:

```
sh -c 'node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js commit "run2-B shipped harness commit, sandboxed" lib.mjs'
```

Quote the FULL output. Report specifically: `mode`, `probe`, `verify`, `buffer`, the exit code
(as its own command), and whether the message names a recovery command.

**Step 3 — what does the tool say is at risk now?**

```
node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor --json
```

Quote the `gitai-collector` and `attribution-at-risk` entries verbatim. Does the at-risk list
name either commit from steps 1 and 2?

**Step 4 — recover.** This one is deliberately NOT wrapped, so it runs outside the sandbox and
can reach the collector — the real-world shape, where recovery runs later from a normal shell:

```
node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor telemetry-nudge
```

Quote it verbatim: what it replayed, recovered, retained, or handed off.

**Step 5 — did it work?**

```
node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor --json
```

Quote the `attribution-at-risk` entry again. Which commits still lack attribution?

**Step 6 — write your report** to `reports/verify-2.md`: every step verbatim, the
sandboxed/unsandboxed label per command, and an **Anything I noticed** section — especially if a
command was rewritten, unwrapped, or ran differently from how it was written.

Do not edit anything outside `lib.mjs` and `reports/`. Do not run git-ai commands. Do not try
to repair attribution by hand.

---

## What the outcomes mean (operator notes)

The result we are looking for is an honest asymmetry within a single session:

| | expected |
|---|---|
| **1A** plain git, sandboxed | commit succeeds, **no note** — silently unattributed |
| **2B** harness commit, sandboxed | commit succeeds, **buffered**, envelope says so and names the nudge |
| **4** nudge, unsandboxed | replays the buffer, **2B recovers** |
| **5** at-risk after | **1A still listed**, 2B gone |

That is the whole thesis in one run: the plain path loses the work silently, the harness path
loses nothing and tells you how to get it back.

If instead everything is attributed, the sandbox did not block `sh` this session — say so
plainly; that is a real finding about non-determinism, not a failed test.
