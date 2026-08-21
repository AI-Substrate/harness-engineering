# In-sandbox validation — the shipped verbs, under a real Seatbelt block

**Date**: 2026-08-07 · **Environment**: Cursor 3.8.23 (Seatbelt), macOS 26.5.2 arm64, git-ai 1.6.21
**Repo**: `~/temp/074-sandbox-verify` (throwaway; 1 seed commit made outside Cursor)
**Harness**: the shipped worktree build (`s073/gitai-collector-v1` @ `c575823a`), invoked directly —
the global `harness` link was **not** touched (it belongs to `main`).

## Why this exists

Every prior proof was either a **prototype** (`commit.mjs`, proven in-sandbox) or the **shipped
code** (proven only from an unsandboxed shell). The feature built to survive a sandbox had never
itself run inside one. These two runs close that, and the second one is the load-bearing evidence:
it is the only test in the plan where the collector socket was **genuinely denied** to shipped code.

Raw agent reports (verbatim, unedited): [`cursor-run-1-reachable.md`](./cursor-run-1-reachable.md),
[`cursor-run-2-blocked.md`](./cursor-run-2-blocked.md). Prompts as issued:
[`prompt-run-1.md`](./prompt-run-1.md), [`prompt-run-2.md`](./prompt-run-2.md).

## Run 1 — reachable ingress (allowlisted commands)

All target commands matched the user's `terminalAllowlist` and ran **outside** the sandbox; the
sandbox was demonstrably live (un-allowlisted `echo $?` and `mkdir` were reported sandboxed).

| Observation | Evidence |
|---|---|
| Shipped `harness commit` takes the reachable branch and **verifies** | `{"mode":"direct-verified","probe":"connected","verify":"landed"}` |
| `telemetry-nudge` no-ops honestly when there is nothing to do | `{"status":"skipped","reason":"no-buffer"}` + "healthy shape when every commit reached the collector directly" |
| **U-4 CLOSED** — a bare `harness` command IS allowlist-exempt | `harness --version` → *"outside the sandbox (matched the user's command allowlist)"* |

## Run 2 — blocked ingress (`sh -c` wrapper defeats the allowlist)

Commands wrapped so the first word is `sh`, which the allowlist does not match. Both wrapped
commands were reported **sandboxed** and ran exactly as written (no unwrapping, no rewrite).
A control run of the identical `sh -c` shape from an unsandboxed shell returns
`direct-verified` — so the wrapper is innocent and the block is real.

**The asymmetry, in one session, same repo, minutes apart:**

| # | Command shape | Sandboxed? | Commit | Attributed? |
|---|---|---|---|---|
| A | `sh -c 'git add … && git commit …'` | yes | `4c42160a` | ❌ **no note — silently lost** |
| B | `sh -c '… harness.js commit …'` | yes | `0dfceb32` | ✅ recovered (below) |

**B's envelope — the block is proven, not assumed:**

```json
{"status":"degraded","data":{"mode":"harness-buffered","probe":"denied","verify":"skipped",
 "buffer":".harness/temp/trace2/buffer.jsonl",
 "detail":"committed 0dfceb32757c — DEGRADED: the collector ingress was DENIED (a sandbox blocked
 the socket connect) … Attribution is DEFERRED, not lost, and not yet proven."}}
```

**Doctor before recovery** named both, with the honest wording intact:

> `unattributed — 2 commit(s) … carry NO refs/notes/ai entry — harness has no record of who wrote
> them (this does NOT mean they are AI-authored…). Window: no upstream merge-base available — the
> last 50 commits on HEAD. Newest first: 0dfceb32, 4c42160a`

**Nudge (unsandboxed — the real-world shape):**

```json
{"status":"replayed","bytes":12466,"recovered":["0dfceb32757c…"],
 "stillMissing":[],"handedOff":[],"retained":[],
 "detail":"… CONFIRMED all 1 commit(s) it named for this repository now carry a refs/notes/ai
 entry — the segment was deleted."}
```

**Doctor after recovery** — only the plain-git commit remains:

> `unattributed — 1 commit(s) … Newest first: 4c42160a`

## What this validates, per acceptance criterion

| AC | Claim | In-sandbox evidence | Verdict |
|---|---|---|---|
| ac-0001 | Probe classifies ingress from ground truth | `probe:"connected"` (run 1) and `probe:"denied"` (run 2) — both real, neither simulated | ✅ proven |
| ac-0002 | Blocked ingress is detected, warns, never blocks | run 2 committed successfully with exit 0 while reporting `degraded` | ✅ proven |
| ac-0003 | At-risk list is honest and bounded | named both commits, stated the fallback window rule, carried the never-claims-AI wording | ✅ proven |
| ac-0004 | capture-liveness / collector verdicts stay honest | `gitai-collector: could-not-determine` (binary present, no install record) — refused to claim health it could not prove | ✅ proven |
| ac-0005 | Exhaustive branch partition; commit never silently lost | `direct-verified` and `harness-buffered` both exercised live; buffer named; recovery command named | ✅ **both branches proven in-sandbox** |
| ac-0006 | Nudge rotates → replays → confirms → deletes only what it proved | 12,466 bytes replayed, 1 confirmed, segment deleted, nothing retained or handed off | ✅ proven |
| ac-0007 | Doctor/checks read-only; nudge explicit | `doctor --json` mutated nothing; recovery happened only on the explicit `telemetry-nudge` call | ✅ proven |
| ac-0008 | Guidance reachable from the failure | `next_action` named `harness doctor telemetry-nudge` **and** `harness instructions commit` | ✅ proven |
| ac-0009 | Documentation matches behaviour | envelope wording matches `docs/how/gitai-collector.md` | ✅ consistent |
| ac-000a | Constraints held | shipped build invoked directly; global `harness` link untouched; no new deps exercised | ✅ held |

## Findings recorded from these runs

1. **U-4 resolved (was a known gap)** — a bare `harness` command is exempted by
   `terminalAllowlist`, so a normally-installed harness takes the reachable branch. Removed from
   the PR's known-gaps list.
2. **Compound-command sandboxing is NOT reproducible** — run 1's chained
   `git add … && git commit …` ran *outside* the sandbox and was attributed, contradicting the
   earlier investigation's run 6 where the identical shape was sandboxed. Configuration was
   unchanged between them. This **strengthens** the plan's premise: neither configuration nor
   command shape is a reliable defence, which is precisely why the behaviour belongs in harness.
3. **`doctor` surfaces no positive `ingress` signal** when the probe succeeds — correct under
   ac-0002 (which only requires the blocked verdict), but an operator cannot see
   "ingress: connected" as reassurance. Recorded as a candidate improvement, not a defect.

## What these runs do NOT establish

- **Multi-repo hand-off and retained-segment lifecycles** were not exercised live — run 2's segment
  confirmed cleanly and was deleted. The `handedOff` / `retained` / unknown-provenance arms remain
  proven by unit tests and the local spike only.
- **Idempotent re-replay** was not re-exercised here (established in the plan's earlier live spike).
- One session, one machine, one Cursor version. Given finding 2 above, sandbox placement is known
  to vary between sessions — these results show what the code does when blocked, not how often
  a block occurs.
