# git-ai × Cursor — the sandbox investigation

**Date**: 2026-08-06/07 · **Seat**: `pij-respectable-clam`
**Versions**: git-ai **1.6.21** (pinned, SHA-verified), Cursor **3.8.23**, macOS 26.5.2 arm64
**Status**: root cause **found and proven**. Nothing filed upstream — Jordan's explicit instruction.

---

## The question

Plan 073 makes git-ai the collector. Does it actually capture Cursor work? The previous
Cursor run (the one that produced FX009) was re-run with **both** collectors live.

## The answer

**Cursor's command sandbox silently destroys git-ai attribution.** Not a hook problem, not
a worktree problem, not a payload problem, not a stale-session problem — all four were
eliminated by evidence.

### The controlled A/B that proves it

One repo (`~/temp/gitai-cursor-plain`), one Cursor session, **one setting changed**:

| commits | sandbox | `refs/notes/ai` |
|---|---|---|
| `aeb78eb`, `231930f`, `bd5f3d6` | **on** | **none** |
| `e1d34fe`, `121470f` | **off** ("Run Everything") | **full line-level** |

With the sandbox off, attribution is complete and correct:

```
calc.mjs
  s_bdcfca9a6d6953::t_374c25b240397e 21-24
  tool: "cursor"   model: "gpt-5.6-terra"   id: 1d18815f-4eb8-4e63-9fba-1ca59174bf35
```

Note the **model resolves correctly** for Cursor — better than Copilot CLI, which reads
`"unknown"` even when spawned with an explicit model.

### What survives the sandbox, and what doesn't

This is the crucial distinction, and it is why the failure is invisible.

**Survives** — verified by instrumenting `~/.cursor/hooks.json` with a `tee` shim:
- Cursor's `preToolUse`/`postToolUse` hooks **fire** (Hooks Execution Log: 21–304 ms).
- git-ai receives **complete** payloads — `tool_name: "Write"`, absolute `file_path`, full
  `content`, `model`, `session_id`, `cursor_version`, `transcript_path`.
- git-ai **parses** them; its only stderr was `Skipping Cursor hook for unsupported
  tool_name 'Read'` — it never complained about `Write`.
- The daemon **ingests** them: 26 log lines for the repo, 6 `kind=AiAgent`, **zero errors**.

**Does not survive**: the **commit event**. The sandboxed shell's `git commit` cannot reach
the daemon's `af_unix` trace2 socket.

So git-ai holds the edit data and is never told there is a commit to attach it to.
**"Has the data, never gets the trigger."**

### The code path (cited)

1. trace2 event on the socket → daemon ingress → `NormalizedCommand`
2. `src/daemon/analyzers/history.rs:30` — emits `SemanticEvent::CommitCreated { base, new_head }`,
   **only** if `head_change(cmd, state.refs)` resolves
3. `src/daemon.rs:6181` — the `CommitCreated` side-effect arm
4. `src/daemon.rs:6293` → `crate::authorship::post_commit::post_commit_from_working_log_with_recovery_timestamps(...)`
5. `src/authorship/post_commit.rs:91` — the writer. Signature takes
   `base_commit: Option<String>`, **`commit_sha: String`** — the SHA is an *input*.

**There is no filesystem scan and no reconciliation sweep for un-noted commits.** That is
the structural reason missed commits are unrecoverable rather than merely delayed.

The guards between steps 3 and 5 (`daemon.rs:6227-6262`) are `handled_as_squash_merge`,
`is_completing_rebase || is_pull_rebase`, `handled_revert_commits`, `lite_mode`,
`source_oids.is_empty()`. **None keys on worktree path, branch, HEAD location, or `.git`
being a directory** — confirming from the code what the on-disk evidence showed.

### Backfill is impossible — tested, twice

> ⚠️ **SUPERSEDED 2026-08-09 — the flat claim "backfill is impossible" is FALSIFIED.**
> F-09 demonstrated backfill and H-03 recorded it, but no supersession marker was ever put on
> THIS section, so the original wording kept circulating as settled fact. The measurements
> below are still exactly what was observed; it is the **generalisation** from them that does
> not hold. Read them as "these two operations did not backfill", not as "nothing can".
>
> Note also what the two attempts actually probed: `git checkout` moves a head, and
> `--allow-empty` creates a new commit. Neither gives the daemon a **pre-command reflog
> cursor** for the noteless commits, and per the vendor spec
> (`daemon-trace2-ingestion-spec.md:21-35`) a command without a cursor or immutable argv OIDs
> is *not exact* and **fails closed by design** — see
> [the two-channel model](../../../../how/telemetry/gitai-06-two-channel-model.md). So the
> observed "nothing happened" is the specified behaviour of those two commands, not a
> property of backfill in general.


In `/Users/jordanknight/substrate/harness-engineering-worktrees/cursor-test`, from an
**unsandboxed** shell, against four noteless commits (`7189458e`, `90669bc5`, `62eae5a3`,
`028c7c65`):

| attempt | result |
|---|---|
| `git checkout` (head change) | notes 20 → 20 — **nothing** |
| `git commit --allow-empty` (real commit op) | notes 20 → 21 — **a note for the new commit only** |

The daemon logs `git write op completed op="commit"` — it keys on **commit operations**,
not head movement. And `CommitCreated { base, new_head }` attributes **only `new_head`**,
never the skipped span. (Independently corroborated earlier: my unsandboxed commit
`1bb008c` did not backfill Cursor's preceding `35c1d99`.)

The control socket (`src/daemon/control_api.rs:10`) accepts `ping`, `checkpoint.run`,
`sync.family`, `status.family`, `telemetry.submit`, `cas.submit`, `notes.flush`,
`snapshot.watermarks`, `bash_session.*`. **No "a commit happened" request.** No CLI verb
reaches the writer either (`checkpoint`, `log`, `blame`, `diff`, `stats`, `usage`,
`analyze`, `status`, `show`, `config`, `debug`, `bg`, `install-hooks`, `uninstall-hooks`,
`ci`, `git-path`, `await`). `git-ai` is **not** a transparent git proxy despite its
tagline — `git-ai commit` → `Unknown git-ai command: commit`.

### Known upstream, both OPEN — DO NOT FILE

- **#909** — *Git AI attribution not working in agent sandbox (seatbelt, etc.)*, `bug`, 2026-04-01
- **#1968** — *AI attribution not working properly when using Cursor…*, 2026-07-23
  <https://github.com/git-ai-project/git-ai/issues/1968>

---

## Why this is worse than "no data"

**Unattributed lines are given `h_` KNOWN-HUMAN attestations by the recovery ladder.**
Observed live: after a daemon restart, commit `1bb008c` — lines written by Claude Code via
a bash append — came back as:

```
calc.mjs
  h_9e71e8b09f7cf2 12-15
  "humans": { "h_9e71e8b09f7cf2": { "author": "Jordan Knight <jakkaj@gmail.com>" } }
```

The same session's earlier commit had been correctly recorded as `tool: claude`,
`model: claude-opus-5`. **The only thing that changed was the daemon restart.**

So AI work does not return as *unknown*. It returns as **positively attested human work**.
That is the FX009 shape — *"not a gap, a wrong number"* — and it recurred three times in
one night.

**No health signal detects any of it.** Binary ✅ hooks ✅ daemon ✅ trace2 ✅ checkpoints ✅
zero errors ✅ — and no data. This is exactly the gap `ac-0012` defers, now with a live
reproduction.

---

## Still open — the forward path (UNTESTED)

Retroactive repair is dead. The **forward** path is not, and it is the one worth testing:

> Sandbox **on**. Cursor edits and **stages** but does **not** commit.
> Something **unsandboxed** performs the commit.

The checkpoints demonstrably survive the sandbox, so the working log should hold the
agent's edits when an unsandboxed commit op arrives to fire the writer. **If it credits
`tool: cursor`, the mix works today with no upstream change and no sandbox disabled** —
and harness's role becomes *own the commit*, not repair afterwards. If it mints `h_`
instead, only the upstream fix closes it.

The minimal upstream ask, if that day ever comes: a verb or control request meaning
*"attribute commit `<sha>` from the working log"*. The function already exists and already
takes the SHA — it simply is not exposed.

**Also untested**: whether sandbox-off attribution holds in a **linked worktree** with
`core.hooksPath=.githooks` active (nested git in pre/post-commit, `trace2.eventNesting 0`).
Every real repo here is that shape.

---

## Machine state left behind

- `~/.cursor/hooks.json` is **instrumented** (tees payloads to `/tmp/cursor-hook-{pre,post}.jsonl`
  and stderr to `/tmp/cursor-hook-err.log`, then passes through to git-ai unchanged).
  Original: `~/.cursor/hooks.json.gitai-backup`. **Restore when done.**
- git-ai installed at `~/.git-ai/bin/git-ai` + `~/.local/bin/git-ai`; daemon running.
- Global `trace2.eventTarget` / `eventNesting` set by git-ai. Remove with
  `git config --global --unset trace2.eventTarget` and `…eventNesting`.
- Test repos: `~/temp/gitai-cursor-plain` (plain), and branches `cursor-test-2` /
  `cursor-test-3` in the `cursor-test` worktree.

## Observations recorded

`DL-001` report-vs-gate · `DL-002` concurrent-vitest coverage collision ·
`DL-003`/`DL-004`/`DL-005` superseded Cursor diagnoses · **`DL-006` the root cause**.
