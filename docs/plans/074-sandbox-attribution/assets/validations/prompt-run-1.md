# Cursor run — verify the SHIPPED plan-074 verbs from inside the sandbox

This is the test plan 074 was never given: its own feature, running inside a real Cursor
Seatbelt sandbox. Everything so far was either a prototype (proven in-sandbox) or the shipped
code (proven only from an unsandboxed shell).

Two independent questions, deliberately separated:
  Q1  do the SHIPPED verbs behave correctly in-sandbox?  -> invoked via `node` (already proven allowlisted)
  Q2  does a bare `harness` command get unsandboxed by terminalAllowlist? (U-4, untested)

Baseline: 1 commit, 1 note (the seed, made outside Cursor — proves the daemon is live).

---

Paste the block between the rules into Cursor's agent.

---

You are verifying a shipped feature from inside Cursor's sandbox. Report exactly what happens —
a negative result is as valuable as a positive one. Do not try to fix anything.

Throughout: for EVERY command you run, state whether your execution environment reported it as
sandboxed or outside the sandbox. That labelling is half the experiment.

**Step 1 — make a real change and commit it with the shipped verb.**
Add a `two()` function to `lib.mjs`. Then run this as ONE standalone command and quote its
full output verbatim:

```
node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js commit "run1: shipped harness commit from inside Cursor" lib.mjs
```

Report: the full output, the exit code (`echo $?` as its own command), and which branch it took
(look for `mode=` / `verify=` / any mention of a buffer or the nudge verb).

**Step 2 — ask the collector what it thinks.**

```
node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor --json
```

Quote the collector/ingress portion verbatim — specifically any `ingress` verdict and any
at-risk / unattributed-commit list.

**Step 3 — run the recovery verb.**

```
node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor telemetry-nudge
```

Quote it verbatim, including whether it replayed, retained, skipped, or reported nothing to do.

**Step 4 — Q2, the allowlist prefix probe.** This uses the machine's normal global `harness`
(a DIFFERENT, older build — that is fine; we are testing the command prefix, not the build):

```
harness --version
```

Report the output AND whether your environment reported it sandboxed. This is the whole of Q2.

**Step 5 — one more commit, plain git, for contrast.**
Add a `three()` function, then:

```
git add lib.mjs && git commit -m "run1: plain chained git for contrast"
```

(Chained on purpose — this is the shape known to lose attribution.)

**Step 6 — write your report** to `reports/verify-1.md`: each step's verbatim output, the
sandboxed/unsandboxed label per command, and an **Anything I noticed** section. If any command
behaved differently from how it was written, say so — that has mattered in every previous run.

Do not edit any file outside `lib.mjs` and `reports/`. Do not run git-ai commands.

---

## What the outcomes mean (for the operator, not the agent)

| Step 1 result | Reading |
|---|---|
| `mode=direct-verified`, note landed | `node` ran unsandboxed; the reachable branch works in a real Cursor session |
| buffered + degraded envelope naming the nudge | the sandboxed branch works — the actual sandbox story, proven end to end |
| anything else | the shipped verb behaves differently in-sandbox than in the lab — the reason this test exists |

Step 4 answers U-4 directly: if a bare `harness` is reported outside the sandbox, then a real
`harness commit` install takes the reachable branch and the PR's central claim holds as written.
