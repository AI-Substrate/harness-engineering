# The sandbox attribution gap — root cause, and two proven routes through it

**Date**: 2026-08-06/07 · **Versions**: git-ai **1.6.21**, Cursor **3.8.23**, macOS 26.5.2 arm64
**Status**: root cause proven; **both workarounds proven**; nothing filed upstream (standing instruction).

Plan 073 makes git-ai the collector. This is the one case where it silently collects nothing —
and, worse, returns a confident wrong answer. It is also, as of this document, **solved twice over
without an upstream change**.

---

## 1. The finding in three lines

An agent running under a **command sandbox** (Cursor's, and by the same mechanism Codex's and any
other Seatbelt-based one) produces commits with **no attribution note at all**. Every health
signal stays green throughout. The unattributed lines are then given **known-human attestations**,
so AI work returns as *positively attested human work* — not a gap, a wrong number.

## 2. Root cause

git-ai's daemon has exactly **one** ingress: git's trace2 event stream over a unix socket
(`trace2.eventTarget = af_unix:stream:~/.git-ai/internal/daemon/trace2.sock`, set globally at install).

On macOS, Cursor's sandbox is `sandbox-exec` / Seatbelt, and **a unix-domain-socket `connect()` is
classified as a network operation**, which the generated profile denies by default. Filesystem
writes to the workspace and temp directories are permitted.

That asymmetry is the whole bug:

| | sandboxed? | reaches git-ai? |
|---|---|---|
| Agent hooks fire (`preToolUse`/`postToolUse`) | — | ✅ yes |
| Full `Write` payloads (path, content, model, session id) | — | ✅ yes |
| git-ai parses them, daemon ingests, checkpoints created | — | ✅ yes, **zero errors** |
| **The commit event** | **yes** | ❌ **socket denied** |

**git-ai holds the edit data and is never told there is a commit to attach it to.**
Cursor documents the same failure mode against the Docker socket
([forum](https://forum.cursor.com/t/cursor-agent-is-unable-to-run-terminal-commands-that-connect-to-docker-containers/155407),
[sandboxing blog](https://cursor.com/blog/agent-sandboxing)).

### The controlled A/B

One repo (`~/temp/gitai-cursor-plain`), one Cursor session, **one setting changed**:

| commits | sandbox | `refs/notes/ai` |
|---|---|---|
| `aeb78eb`, `231930f`, `bd5f3d6` | **on** | **none** |
| `e1d34fe`, `121470f` | **off** ("Run Everything") | **full line-level, model correct** |

### The code path

1. trace2 event on the socket → daemon ingress → `NormalizedCommand`
2. `src/daemon/analyzers/history.rs:30` — emits `SemanticEvent::CommitCreated { base, new_head }`,
   **only** if `head_change(cmd, state.refs)` resolves
3. `src/daemon.rs:6181` → `:6293` → `src/authorship/post_commit.rs:91`, whose signature takes
   **`commit_sha: String` as an input**

**There is no filesystem scan and no reconciliation sweep for un-noted commits** — the structural
reason a missed commit is unrecoverable rather than merely delayed.

### Backfill is impossible — tested twice

From an unsandboxed shell against four noteless commits:

| attempt | result |
|---|---|
| `git checkout` (head change) | notes 20 → 20 — **nothing** |
| `git commit --allow-empty` (real commit op) | notes 20 → 21 — **a note for the new commit only** |

The daemon keys on `op="commit"`, and `CommitCreated` attributes **only `new_head`**, never the
skipped span.

### There is no second ingress

Checked directly, not assumed:

- `which -a git` → homebrew git only. **No `git` shim is installed**, despite the "git proxy" tagline.
- `.git/hooks/` is **empty** after install — `install-hooks` installs *agent* hooks, not a git
  `post-commit` hook.
- The control API (`src/daemon/control_api.rs:10`) accepts `ping`, `checkpoint.run`, `sync.family`,
  `status.family`, `telemetry.submit`, `cas.submit`, `notes.flush`, `snapshot.watermarks`,
  `bash_session.*` — **no "a commit happened" request**.
- No CLI verb reaches the writer (`git-ai commit` → `Unknown git-ai command`).
- **No non-daemon mode**: `git-ai bg run` is the same daemon in the foreground.

Known upstream, both **OPEN**: **#909** (agent sandbox / seatbelt) and
[**#1968**](https://github.com/git-ai-project/git-ai/issues/1968) (Cursor).

### Why it is worse than "no data"

Observed live on commit `1bb008c` — lines written by an agent came back as:

```
calc.mjs
  h_9e71e8b09f7cf2 12-15
  "humans": { "h_9e71e8b09f7cf2": { "author": "Jordan Knight <jakkaj@gmail.com>" } }
```

The recovery ladder mints **known-human** attestations for unattributed lines when a commit carries
no AI attestation (`attribution_recovery.rs:661-674`). Binary ✅ hooks ✅ daemon ✅ trace2 ✅
checkpoints ✅ zero errors ✅ — and a wrong answer. This is the live reproduction of the gap
`ac-0012` defers.

---

## 3. Route A — Cursor command allowlist (unblocks today)

**Cursor Settings → Agents → Run Mode → `Allowlist (with Sandbox)`**, then create
`~/.cursor/permissions.json`:

```json
{
  "terminalAllowlist": ["git"]
}
```

Under that run mode a matching command runs **outside the sandbox** — Cursor's Terminal Tool
reference is explicit that this bypasses sandbox restrictions, not merely the approval prompt.

- Prefix-matched, case-sensitive: `"git"` matches `git commit` and `git status`, not `gitk`.
  Narrow to `"git commit"` to unsandbox only the event-bearing verb.
- `~/.cursor/permissions.json` and `<workspace>/.cursor/permissions.json` are **concatenated**;
  once either defines `terminalAllowlist`, the settings-UI list becomes read-only and is **not**
  merged. The file becomes the single writer.
- Enterprise policy can disable this run mode centrally.

**Cost**: `git` runs unsandboxed. Since git is the thing being observed, that is a narrow trade.

**Rejected alternative**: `~/.cursor/sandbox.json` → `{"networkPolicy": {"default": "allow"}}`
also fixes it, by opening **all** sandbox network egress. Much broader, for the same benefit.

**Limits**: Cursor-only, per-machine, and it depends on a setting a user can silently revert —
which is precisely why Route B is the one worth building.

---

## 4. Route B — the trace2 file relay (**proven**; the harness-shaped fix)

The mechanism is fixed but **the transport is not**. `trace2.eventTarget` (and `GIT_TRACE2_EVENT`)
accepts a plain **file path** as well as `af_unix:stream:<sock>`. A sandboxed shell **can** write
that file. Anything unsandboxed can then replay it into the daemon socket — and the daemon cannot
tell the difference.

### The experiment

```bash
SOCK=~/.git-ai/internal/daemon/trace2.sock

# 1. commit with trace2 aimed at a FILE, not the socket.
#    Reproduces the sandbox failure exactly, with no Cursor involved.
GIT_TRACE2_EVENT=/tmp/t2relay.jsonl git commit -q -m "relay test"
#    notes 4 -> 4.  No note for the commit.

# 2. replay those 47 lines into the socket from an unsandboxed shell.
nc -U "$SOCK" < /tmp/t2relay.jsonl
#    notes 4 -> 5.
```

Commit `2144a4d3` then carried a complete, correct note:

```
calc.mjs
  s_a76964380084ef::t_a3a130d3e145e3 28
  tool: "claude"   model: "claude-opus-5"
  base_commit_sha: 2144a4d3227e1ee170848dd34a379534115eaddf
  schema_version: authorship/3.0.0
```

The writer fired. Line-level attribution, correct session, correct model, **`nc -U` sufficient —
no new dependency**.

### Why this is the one to build

- **Agent-agnostic** — fixes every sandboxed agent at once, not just Cursor.
- **Nothing to revert** — no per-user IDE setting in the trust path.
- **It hands harness the role it should have**: *own the commit event*, as a drain rather than a
  repair after the fact.
- It yields a **deterministic local reproduction of the sandbox bug that needs no Cursor at all** —
  usable as a CI fixture and as the basis for a real doctor check.

### Open questions — the AC list before this ships

1. **Idempotency** — does replaying the same file twice double-write or corrupt the note?
2. **Staleness** — the daemon must resolve `head_change(cmd, state.refs)`. How long after HEAD has
   moved on does a replay stop resolving?
3. **Concurrency** — multiple repos and sessions draining into one socket; ordering and interleaving.
4. **Config placement** — pointing repo-local `trace2.eventTarget` at a file makes the relay
   **mandatory for every commit in that repo**, sandboxed or not. Uniform, but a hard dependency.
   Note the sandbox **protects `.git/config` and `.git/hooks` from writes**, so it must be set from
   outside — arguably a feature: an agent cannot disable its own observation.
5. **Framing** — whether `nc -U` stream semantics hold for very large event files.

### Related open defect

`doctor-service.ts:25,755` — the `capture-liveness` check is **ungated**. Green means *"nothing is
owed anywhere"*, and nothing can be owed when nothing captures, so it reports green forever having
proven nothing. Whatever check comes out of Route B should replace that verdict rather than sit
beside it.

---

## 5. Recommendation

Route A to unblock immediately — one file, three lines, reversible. Route B as the harness feature:
it is the general fix, it makes `doctor`/`checks` mean something, and it is proven rather than
hypothesised. The five questions above are its acceptance criteria.
