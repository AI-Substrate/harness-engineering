# Cursor sandbox verification — run 1

## Step 1 — shipped `harness commit`

`node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js commit "run1: shipped harness commit from inside Cursor" lib.mjs`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim output:

```text
{"command":"commit","status":"ok","timestamp":"2026-08-07T05:47:58.849Z","data":{"mode":"direct-verified","probe":"connected","sha":"758271d567fb43cc732f30c0e5dd185ad6c06a39","sha_unknown":false,"staged":["lib.mjs"],"verify":"landed","buffer":null,"detail":"committed 758271d567fb and VERIFIED: a refs/notes/ai entry landed, so the collector recorded this commit's authorship."},"evidence":[{"label":"commit 758271d567fb"}]}
```

Exit status command: `echo $?`

Environment: sandboxed.

Verbatim output:

```text
0
```

The command took `mode=direct-verified`, `verify=landed`, and used no buffer.

## Step 2 — collector status

`node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor --json`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim collector/ingress portion:

```text
{"name":"gitai-collector","ok":false,"detail":"could-not-determine — a git-ai binary exists at /Users/jordanknight/.git-ai/bin/git-ai but harness has no record of installing it — provenance and hook state are unknown","next_action":"Run `harness doctor --install-collector` to (re)place the pinned git-ai binary and record its state, then re-run doctor."}
{"name":"attribution-at-risk","ok":true,"detail":"clean — every commit in this window carries a refs/notes/ai entry. Window: no upstream merge-base available — the last 50 commits on HEAD"}
```

The JSON contained no field or layer named `ingress`. Its attribution-at-risk list was clean, rather than listing at-risk or unattributed commits.

## Step 3 — recovery verb

`node /Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/bin/harness.js doctor telemetry-nudge`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim output:

```text
{"command":"doctor telemetry-nudge","status":"degraded","timestamp":"2026-08-07T05:48:08.606Z","data":{"status":"skipped","reason":"no-buffer","segment":null,"bytes":0,"recovered":[],"stillMissing":[],"handedOff":[],"retained":[],"detail":"no buffered trace2 events at /Users/jordanknight/temp/074-sandbox-verify/.harness/temp/trace2/buffer.jsonl — nothing to replay. This is the healthy shape when every commit reached the collector directly."},"evidence":[{"label":"trace2 segment","none":true}],"next_action":"Nothing to recover here; re-run after a commit made through a blocked ingress."}
```

It skipped recovery because there was no buffer; nothing was replayed or retained.

## Step 4 — allowlist prefix probe

`harness --version`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim output:

```text
0.13.0
```

## Step 5 — plain chained Git comparison

`git add lib.mjs && git commit -m "run1: plain chained git for contrast"`

Environment: outside the sandbox (matched the user's command allowlist).

Verbatim output:

```text
[main 0192f7a] run1: plain chained git for contrast
 1 file changed, 1 insertion(+)
```

## Step 6 — report creation

`mkdir reports`

Environment: sandboxed.

Verbatim output:

```text
mkdir: reports: File exists
```

## Anything I noticed

- Every specified executable command was reported as outside the sandbox because it matched the user's command allowlist. This includes the bare `harness --version` probe, which answers Q2 positively for this session.
- The separate `echo $?` command was reported as sandboxed, while its output was `0`.
- Step 1 behaved as the direct, verified path: the commit was created and its `refs/notes/ai` entry landed.
- Step 2 reported a clean attribution-at-risk window even though the `gitai-collector` layer itself was `could-not-determine` because harness had no record of installing the detected `git-ai` binary.
- The recovery command reported `status: "skipped"` and `reason: "no-buffer"`, not a replay or retained event.
- `reports/` already existed even though it was not shown in the initial compact directory listing; `mkdir reports` therefore failed with “File exists.” The report was then written there.
