# Cursor sandbox verification — run 2

## Step 1 — plain Git commit, sandboxed

`sh -c 'git add lib.mjs && git commit -m "run2-A plain git, sandboxed"'`

Environment: sandboxed.

Verbatim output:

```text
[main 4c42160] run2-A plain git, sandboxed
 1 file changed, 1 insertion(+)
```

`git rev-parse HEAD`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim output:

```text
4c42160a1e603bbd93dd9a88fe9d86e4868ba266
```

## Step 2 — shipped harness commit, sandboxed

`sh -c 'node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js commit "run2-B shipped harness commit, sandboxed" lib.mjs'`

Environment: sandboxed.

Verbatim output:

```text
{"command":"commit","status":"degraded","timestamp":"2026-08-07T05:51:51.677Z","data":{"mode":"harness-buffered","probe":"denied","sha":"0dfceb32757c6f09d3c9fe1682d3e2d4932e239d","sha_unknown":false,"staged":["lib.mjs"],"verify":"skipped","buffer":"/Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/buffer.jsonl","detail":"committed 0dfceb32757c — DEGRADED: the collector ingress was DENIED (a sandbox blocked the socket connect), so this commit's trace2 events were buffered to /Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/buffer.jsonl instead of reaching git-ai. Attribution is DEFERRED, not lost, and not yet proven."},"evidence":[{"label":"commit 0dfceb32757c"}],"next_action":"Run `harness doctor telemetry-nudge` from an UNSANDBOXED shell to replay /Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/buffer.jsonl into the collector. Read `harness instructions commit` for the safe commit shapes and what each one guarantees."}
```

`echo $?`

Environment: sandboxed.

Verbatim output:

```text
0
```

- `mode`: `harness-buffered`
- `probe`: `denied`
- `verify`: `skipped`
- `buffer`: `/Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/buffer.jsonl`
- The message names `harness doctor telemetry-nudge` as the recovery command.

## Step 3 — at-risk status before recovery

`node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor --json`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim requested entries:

```text
{"name":"gitai-collector","ok":false,"detail":"could-not-determine — a git-ai binary exists at /Users/jordanknight/.git-ai/bin/git-ai but harness has no record of installing it — provenance and hook state are unknown","next_action":"Run `harness doctor --install-collector` to (re)place the pinned git-ai binary and record its state, then re-run doctor."}
{"name":"attribution-at-risk","ok":false,"detail":"unattributed — 2 commit(s) in this window carry NO refs/notes/ai entry — harness has no record of who wrote them (this does NOT mean they are AI-authored; it means their authorship was never recorded). Window: no upstream merge-base available — the last 50 commits on HEAD. Newest first: 0dfceb32, 4c42160a","next_action":"If those commits were made through a blocked ingress, run `harness doctor telemetry-nudge` from an UNSANDBOXED shell to replay any buffered trace2 events. Commits made before git-ai was installed will never gain a note and are expected here."}
```

The at-risk list named both commits: `0dfceb32` from step 2 and `4c42160a` from step 1.

## Step 4 — recovery

`node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor telemetry-nudge`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim output:

```text
{"command":"doctor telemetry-nudge","status":"ok","timestamp":"2026-08-07T05:52:06.053Z","data":{"status":"replayed","segment":"/Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/segment-2026-08-07T05-52-05-770Z-a.jsonl","bytes":12466,"recovered":["0dfceb32757c6f09d3c9fe1682d3e2d4932e239d"],"stillMissing":[],"handedOff":[],"retained":[],"detail":"replayed 12466 bytes into /Users/jordanknight/.git-ai/internal/daemon/trace2.sock and CONFIRMED all 1 commit(s) it named for this repository now carry a refs/notes/ai entry — the segment was deleted."},"evidence":[{"label":"trace2 segment /Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/segment-2026-08-07T05-52-05-770Z-a.jsonl"}]}
```

It replayed 12,466 bytes and recovered `0dfceb32757c6f09d3c9fe1682d3e2d4932e239d`; it retained and handed off nothing.

## Step 5 — at-risk status after recovery

`node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor --json`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim `attribution-at-risk` entry:

```text
{"name":"attribution-at-risk","ok":false,"detail":"unattributed — 1 commit(s) in this window carry NO refs/notes/ai entry — harness has no record of who wrote them (this does NOT mean they are AI-authored; it means their authorship was never recorded). Window: no upstream merge-base available — the last 50 commits on HEAD. Newest first: 4c42160a","next_action":"If those commits were made through a blocked ingress, run `harness doctor telemetry-nudge` from an UNSANDBOXED shell to replay any buffered trace2 events. Commits made before git-ai was installed will never gain a note and are expected here."}
```

Only `4c42160a` (the plain Git commit from step 1) still lacks attribution.

## Anything I noticed

- The wrapped `sh -c` commands ran sandboxed exactly as written; neither was unwrapped or rewritten.
- The sandbox blocked the harness commit's collector socket access (`probe: "denied"`). The shipped verb buffered the trace and named the recovery command instead of silently losing it.
- The plain sandboxed Git commit and the buffered harness commit were both initially at risk. Recovery removed only the buffered harness commit from that list.
- `git rev-parse HEAD`, despite being requested as the immediate follow-up to the sandboxed plain commit, was reported outside the sandbox because it matched the user's command allowlist.
- The separate `echo $?` command was sandboxed and returned `0`.
