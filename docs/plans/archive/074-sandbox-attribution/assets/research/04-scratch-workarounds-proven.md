# Two working routes around the Cursor sandbox — both proven, neither needs a git-ai change

**Date**: 2026-08-07 · **Seat**: `pij-respectable-clam` · Supersedes the "dead end" framing in
[`07-cursor-sandbox-investigation.md`](./07-cursor-sandbox-investigation.md) § *Still open*.

---

## The question asked

> "Even harness commands run in the sandbox, and harness probably can't break out to fire the
> commit event. Is there any other way to fire that event without having to be a trace2? Does
> git-ai have a non-daemon mode? Can we whitelist some commands to run outside the sandbox?"

## Answers, shortest first

| question | answer |
|---|---|
| Non-trace2 ingress? | **No.** But the *transport* is swappable — see Route B. |
| Non-daemon mode? | **No.** `git-ai bg run` is the same daemon in the foreground. The writer lives only in the daemon. |
| Cursor command allowlist? | **Yes** — documented, and it runs commands genuinely **outside** the sandbox. Route A. |

## Why the socket is what breaks (root cause, now cited)

Cursor's macOS sandbox is `sandbox-exec` / Seatbelt, and **a unix-domain-socket `connect()` is
treated as a network operation**, which the profile blocks by default. Filesystem writes to the
workspace and temp dirs are permitted. That is the precise reason git-ai's edit data survives
(files) and its commit event does not (socket). Cursor's own forum documents the same failure for
the Docker socket. Source: <https://cursor.com/blog/agent-sandboxing>,
<https://forum.cursor.com/t/cursor-agent-is-unable-to-run-terminal-commands-that-connect-to-docker-containers/155407>

## Proof there is no other ingress

- `which -a git` → `/opt/homebrew/bin/git` only. **git-ai installs no `git` shim** despite the
  "git proxy" tagline.
- `~/temp/gitai-cursor-plain/.git/hooks/` is **empty** — `install-hooks` installs *agent* hooks
  (Claude/Cursor/Copilot/…), **not** a git `post-commit` hook.
- Control API (`src/daemon/control_api.rs:10`) still has no "a commit happened" request.
- No CLI verb reaches the writer (`git-ai commit` → `Unknown git-ai command`).

---

## Route A — Cursor command allowlist (the simple fix)

**Cursor Settings → Agents → Run Mode → `Allowlist (with Sandbox)`**, then:

`~/.cursor/permissions.json` (does not exist yet on this machine — create it):

```json
{
  "terminalAllowlist": ["git"]
}
```

Documented semantics: under **Allowlist (with Sandbox)**, a matching command runs **outside the
sandbox**; everything else stays sandboxed. This is not merely "skip the approval prompt" — Cursor's
Terminal Tool reference is explicit that allowlisted commands bypass sandbox restrictions.

- Prefix matching, case-sensitive. `"git"` matches `git commit`, `git status`, not `gitk`.
  Narrow to `"git commit"` if you want only the event-bearing verb unsandboxed.
- Scope: `~/.cursor/permissions.json` (user) and `<workspace>/.cursor/permissions.json` (repo) are
  **concatenated**. If either file defines `terminalAllowlist`, the settings-UI list becomes
  read-only and its entries are **not** merged — so the file is the single writer once created.
- Enterprise admins can disable the `Allowlist (with Sandbox)` mode entirely. Not a factor here.

**Cost**: `git` runs unsandboxed. Given git is the thing being observed, that is a narrow and
honest trade — far narrower than the blunt alternative below.

**Rejected alternative**: `~/.cursor/sandbox.json` → `{"networkPolicy": {"default": "allow"}}`
opens the socket by opening **all** sandbox network egress. Fixes attribution, costs far more.

---

## Route B — the trace2 file relay (**PROVEN**, and it is harness's answer)

This is the direct answer to *"could we fake that with the harness when you run doctor or checks?"*
— **yes**, and it needs no Cursor setting and no upstream change.

The insight: trace2's **mechanism** is fixed but its **transport** is not. `trace2.eventTarget`
(or `GIT_TRACE2_EVENT`) accepts a plain **file path** as well as `af_unix:stream:<sock>`. A
sandboxed shell can write that file. An unsandboxed process can then replay it into the daemon
socket, and **the daemon cannot tell the difference**.

### The experiment (run in `~/temp/gitai-cursor-plain`)

```bash
SOCK=/Users/jordanknight/.git-ai/internal/daemon/trace2.sock

# 1. commit with trace2 pointed at a FILE, not the socket — simulates the sandbox exactly
GIT_TRACE2_EVENT=/tmp/t2relay.jsonl git commit -q -m "relay test"
#    notes: 4 -> 4.  No note for the commit.  Sandbox failure reproduced with no Cursor involved.

# 2. replay those 47 lines into the socket from an unsandboxed shell
nc -U "$SOCK" < /tmp/t2relay.jsonl
#    notes: 4 -> 5.
```

Result — commit `2144a4d3`, a complete, correct note:

```
calc.mjs
  s_a76964380084ef::t_a3a130d3e145e3 28
  tool: "claude"  model: "claude-opus-5"  id: ac636c44-…
  base_commit_sha: 2144a4d3227e1ee170848dd34a379534115eaddf
  schema_version: authorship/3.0.0
```

The writer fired. Line-level attribution, correct session, correct model. **`nc -U` is enough — no
new dependency.**

### Why this matters more than Route A

- It reproduces the sandbox bug **locally, deterministically, without Cursor** — a fixture any CI
  or doctor check can use.
- It is **agent-agnostic**: it fixes every sandboxed agent at once, not just Cursor.
- It puts harness in the role it wanted — **own the commit event** — via a drain, not a repair.

### Untested before harness could ship it

1. **Idempotency** — does replaying the same file twice double-write or corrupt the note?
2. **Staleness** — the daemon needs `head_change(cmd, state.refs)` to resolve. A replay long after
   HEAD moved on may no longer resolve. How stale is too stale?
3. **Ordering / interleaving** — multiple repos or concurrent sessions draining into one socket.
4. **Config placement** — pointing repo-local `trace2.eventTarget` at a file makes the relay
   **mandatory for every commit in that repo**, sandboxed or not. Uniform, but a hard dependency.
   Note Cursor's sandbox **protects `.git/config` and `.git/hooks` from writes**, so the config
   must be set from outside — which is fine, and is arguably a feature (the agent cannot disable
   its own observation).
5. Whether `nc -U` framing holds for very large event files (partial-write / EOF semantics).

---

## Recommendation

Route A to unblock today (one file, three lines, reversible). Route B as the harness feature —
it is the general fix, it is the one that makes `doctor`/`checks` meaningful, and it is now proven
rather than hypothesised. The five unknowns above are the AC list for it.
