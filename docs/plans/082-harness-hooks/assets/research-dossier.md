# Research dossier — a first-class `harness hooks` verb

**Date**: 2026-08-09 · **Author**: `pij-respectable-clam` · **Branch**: `s077/suite-portability`
**Status**: every claim below is either MEASURED on this machine today, READ from git-ai v1.6.21
source, or explicitly labelled UNPROVEN. Nothing here is inferred and presented as fact.

> **Read this before touching the machine.** Five plausible approaches were tried and measured
> dead today (§ 6). Each cost real time. The working mechanism (§ 4) is one of the *last* things
> we tried, not the first.

---

## 1. The question, and the answer in one line

**Question**: a customer's hand-written file was attributed to AI. What is the point of the hooks
if attribution doesn't work?

**Answer**: the hooks were never the problem. **Cursor's sandbox silently eats the one event that
matters**, and git-ai fails closed by design rather than guessing — so the result is not
misattribution but *total attribution loss*. The fix is to emit that event ourselves from the hook
runner, which is **not** sandboxed.

---

## 2. The measured failure chain

All four rows measured 2026-08-09 in `~/temp/attrib-probe`, macOS 15 (Darwin arm64), Cursor with
Auto-Run Network Access at its default (not `Allow All`), git-ai v1.6.21, git 2.51.0.

| # | Fact | Evidence |
|---|---|---|
| 2.1 | Cursor's agent shell runs under seatbelt | `CURSOR_SANDBOX=seatbelt` in the shell's env |
| 2.2 | A unix-socket `connect()` from that shell is **refused** | `REFUSED (PermissionError: [Errno 1] Operation not permitted)` on **both** `control.sock` and `trace2.sock`; the socket files exist and are visible (`exists: True`) — it is EPERM, not ENOENT |
| 2.3 | The **hook runner is NOT sandboxed** | Same minute, same machine: `phase=PRE sandbox=unset ppid=16028 control=OK trace2=OK` |
| 2.4 | Therefore a sandboxed `git commit` produces **no note at all** | commit `42d8f49`, four files, 48 lines, mixed human+AI → `error: no note found` |

**Why a socket is a network operation**: Cursor's macOS sandbox is `sandbox-exec` / Seatbelt, and
Seatbelt treats an AF_UNIX `connect()` as network. Filesystem writes to the workspace are
permitted. That is the precise reason git-ai's *edit* data survives (files) and its *commit* event
does not (socket). Cursor's own forum documents the identical failure for the Docker socket.

**The failure mode is worse than it looks.** The AI lines *were* checkpointed correctly — we
watched `+3 cursor` and `+1 cursor` land in the working log. They are then lost too, because the
note is what persists them. A partially-working capture layer produces a *completely* empty
result.

---

## 3. The proof: a controlled A/B

Two runs, same repo, same Cursor conversation id, minutes apart, **sandbox state measured inside
the same session as the commit** (the probe and the commit are steps 1 and 5 of one prompt).

| | hook | shell state | result |
|---|---|---|---|
| **Run A** `42d8f49` | **disabled** | `seatbelt`, both sockets `REFUSED` | **no note** |
| **Run B** `581f8d5` | **enabled** | `seatbelt`, both sockets `REFUSED` | **note, correct** |

Run B's note, verbatim:

```
AI4.md              s_1b36c35afd9ad7::t_3eac0914616619  1-3   → cursor / gpt-5.6-terra
seed.mjs            s_1b36c35afd9ad7::t_9bda2433444ef9  5     → cursor / gpt-5.6-terra
jordan4.md          h_9e71e8b09f7cf2                    1-11  → HUMAN, Jordan Knight
CURSOR-PROMPT-7.md  s_a76964380084ef::t_53ccb37d7c0a21  1-40  → claude / claude-opus-5
```

**Three-way attribution in one sandboxed agent-made commit, with the human's 11 hand-written lines
correctly separated.** The only variable between A and B was our hook.

Hook log for run B: `[POST] commit 42d8f493 -> 581f8d59 tool=Shell emit=OK sid=…`

**Prior confound, disclosed**: an earlier run (`d372318`) also produced a correct note, but a
`<workspace>/.cursor/sandbox.json` carrying `networkPolicy.default: "allow"` was present at the
time, so the shell may have had network. That result is **discarded**; the file was removed
(`e1590a2`) and the A/B above was run clean. Recorded because a discarded result that goes
unmentioned is how a false claim survives.

---

## 4. The mechanism that works

### 4.1 Why it is possible at all

From git-ai's own `docs/daemon-trace2-ingestion-spec.md`, the **ownership rule**:

> A ref-moving command's transitions are exact **iff** either **(1) pre-command cursor** — the
> daemon held a reflog cursor for the ref from *before* the command; or **(2) immutable argv
> OIDs** — the command line contains full OIDs. Otherwise the command is **not exact**: the
> daemon must **fail closed** (no guessed authorship) and may only use the command as a *future
> baseline*.

Measured corollary: a real `git commit` trace2 stream **carries no sha**. Captured verbatim:

```json
{"event":"start","argv":["git","commit","-q","-m","relay POC: trace2 via ENV VAR to a directory"]}
{"event":"cmd_name","name":"commit","hierarchy":"commit"}
{"event":"exit","code":0}
```

The daemon resolves the transition **entirely from rule 1** — a cursor it already holds. It does
not need the real stream. **It only needs to be told a commit command ran in repo X.**

### 4.2 The emit

Six synthetic events to `trace2.sock`, ~1KB, all sharing one fabricated `sid`:

```
version → start (argv: git commit -q -m <msg>) → def_repo (worktree: <abs repo>)
        → cmd_name (name: commit) → exit (code 0) → atexit (code 0)
```

Proven three times independently:

| commit | before | after | note |
|---|---|---|---|
| `c8217d1` | no note | 6 synthetic events | complete, line-level |
| `fc8ec24` | no note | hook emit | complete, line-level |
| `581f8d5` | no note (run A control) | hook emit | 3-way split, correct |

**Nothing on the machine changes.** No trace2 redirection, no git config edit, no Cursor setting,
no `networkPolicy`, no allowlist, no weakening of the sandbox. The sandboxed shell still cannot
reach the daemon and does not need to.

### 4.3 Detection: HEAD, never the command string

`PRE` records HEAD; `POST` compares. Emit **only** when `HEAD^ == prev` — a genuine single new
commit.

Matching `"git commit"` in the command text is wrong twice: it misses compound chains (Cursor
wrote `git add -A && git commit -m "$(cat <<'EOF' … EOF)" && git rev-parse HEAD && git status`
unprompted) and it fires on any text that merely mentions the phrase.

A checkout, reset, or rebase also moves HEAD. Emitting `commit` for those would make the daemon
consume the **wrong** reflog entry. **A false note is worse than a missing one** — a missing note
is a visible gap; a false one is a confident wrong answer nobody audits.

---

## 5. Why the human file survives (mechanism, corrected)

Initially recorded as unexplained. The explanation is that **git-ai's own `preToolUse` hook is the
human-checkpoint writer, and it runs in the unsandboxed hook context** (§ 2.3), so it *can* reach
`control.sock`:

```
human saves a file in the editor        → file sits dirty
agent's next Shell call fires preToolUse → hook (unsandboxed) reaches control.sock
                                         → CheckpointKind::Human on every dirty file
                                            (orchestrator.rs:507, PreparedPathRole::WillEdit)
commit                                   → those lines resolve to a `humans` entry
```

This also explains an apparent contradiction from earlier in the session: `Jordan.md` got a human
checkpoint because it **already existed and was dirty** when the next Shell hook fired; `HUMAN.md`
did not because it was **created by the command itself** and so was never dirty beforehand. Same
rule, opposite outcomes.

**Consequence for the design**: the human-attribution path depends on the same unsandboxed hook
context our fix uses. It is not independent insurance.

---

## 6. Measured dead ends — do not retry

Each of these was tried today and measured. Recorded so the next person does not spend the
evening we spent.

| # | Approach | Why it fails | Evidence |
|---|---|---|---|
| 6.1 | `trace2.eventTarget` in **repo-local** `.git/config` | trace2 config is resolved **before repo discovery**, so repo-local is ignored | `git config --show-origin` reports it from `.git/config`, yet git still used the socket and produced **zero** event files |
| 6.2 | `includeIf.gitdir` to scope trace2 per repo | same ordering problem | no event files produced |
| 6.3 | Allowlist `git` in `~/.cursor/permissions.json` | the allowlist matches only a **lone** command; agents write `&&` chains by default | `git` **was** already allowlisted and the commit still ran sandboxed |
| 6.4 | `sandbox.json` `networkPolicy.allow` | takes exact hosts / wildcards / CIDR only — **a unix socket has no domain**, so no entry can ever match | Cursor forum, macOS Docker-socket thread: *"can't be lifted via file path permissions alone… `networkPolicy: {default: allow}` would serve as a workaround"* |
| 6.5 | A later unsandboxed `git` command to make the daemon "notice" | fails ownership rule 1 by construction — no pre-command cursor for a command that already ran | commit `c07ec0e`: plain `git status` + `git log` afterwards, notes unchanged, no note ever written |

**The only Cursor setting that works is `Auto-Run Network Access: Allow All`** — measured
(`control=OK trace2=OK` from inside the sandbox). It opens **all** sandbox egress for that
workspace. Cursor's own docs call the file-based form a workaround. **We should not ship this as a
default**; if ever offered it must be an explicit opt-in with the trade stated.

`sandbox.json` lives at `~/.cursor/sandbox.json` **or `<workspace>/.cursor/sandbox.json`** — note
the `.cursor/` subdirectory, which the settings-UI text omits and which cost us a failed attempt.

---

## 7. git-ai inventory (v1.6.21 pin — the raid targets)

> Read from the `~/github/git-ai` checkout, which is at **1.6.22**. Where behaviour matters,
> measure against the **pinned 1.6.21** binary, not the checkout HEAD.

### 7.1 Two different agent matrices

**Parse side** — `src/commands/checkpoint_agent/presets/`: `agent_v1`, `ai_tab`, `amp`, `claude`,
`cline`, `codex`, `continue_cli`, `cursor`, `droid`, `firebender`, `gemini`, `github_copilot/`,
`human`, `known_human`, `mock_ai`, `mock_known_human`, `opencode`, `pi`, `windsurf`.

**Install side** — `src/mdm/agents/`: `amp`, `claude_code`, `cline`, `codex`, `cursor`, `droid`,
`firebender`, `gemini`, `github_copilot`, `jetbrains`, `opencode`, `pi`, `visual_studio`,
`vscode`, `windsurf`.

**They are not the same set.** The install side carries three **IDE-level** targets
(`jetbrains`, `vscode`, `visual_studio`) that have no `~/.<agent>` marker directory. This is the
root of the `agentsMissingHooks` one-directionality we pinned tests around: `covered − detected`
is normal, not a defect.

### 7.2 `classify_tool` — the full matrix (`bash_tool.rs:314`)

| Agent | FileEdit | Bash |
|---|---|---|
| Claude | `Write` `Edit` `MultiEdit` `NotebookEdit` | `Bash` |
| Cursor | `Write` `Delete` `StrReplace` `ApplyPatch` | `Shell` |
| Gemini | `write_file` `replace` `WriteFile` | `shell` `run_shell_command` |
| ContinueCli | `edit` | `terminal` `local_shell_call` |
| Droid | `ApplyPatch` `Edit` `Write` `Create` | `Bash` `Execute` |
| Amp | `Write` `Edit` `create_file` `edit_file` `apply_patch` `undo_edit` | `Bash` `shell_command` |
| OpenCode | `edit` `write` | `bash` `shell` |
| Firebender | `Write` `Edit` `Delete` `RenameSymbol` `DeleteSymbol` | `Bash` |
| Codex † | `apply_patch` | `Bash` `exec_command` `shell` `shell_command` `multi_tool_use.parallel` |
| Pi | `edit` `write` `replace` `rename` | `bash` |
| Windsurf | `code_action` | `run_command` |
| Cline † | `replace_in_file` `write_to_file` `apply_patch` `editor` `edit` `write` | `execute_command` `bash` `shell` `run_commands` `run_command` |

† Codex and Cline call `normalize_tool_name` first (Codex Desktop prefixes `functions.`).
Everything else → `Skip`. **`Read` is Skip**, which is the source of the
`Skipping Cursor hook for unsupported tool_name 'Read'` noise in stderr — expected, not a fault.

### 7.3 Daemon control API — the verbs that exist (`control_api.rs`)

```
ping · checkpoint.run · sync.family · status.family · telemetry.submit · cas.submit
notes.flush · snapshot.watermarks · bash_session.{start,end,query} · bash_snapshot.query
bash_hook_attempt.{start,end} · await · shutdown
```

**There is no "a commit happened" request.** Verified at the pin. This is why the fix has to
speak trace2 rather than ask the daemon politely.

### 7.4 Channel paths (`daemon.rs:300`, `DaemonConfig::from_internal_dir`)

```
unix     <home>/.git-ai/internal/daemon/{trace2,control}.sock
         …if that path is >= 100 chars, relocates to
         <tmpdir>/git-ai-d-<first16 of sha256(internal_dir)>/{trace,control}.sock
windows  \\.\pipe\git-ai-<first16 of sha256(internal_dir)>-{trace2,control}
```

The digest is over `internal_dir`, which derives from `HOME` — so an environment that rewrites
`HOME` (or `TMPDIR` on the long-path branch) makes a client compute a channel that never existed.
**Measured NOT to be the case under Cursor** (same `HOME`, same resolved path inside and out), but
it is a live hazard on Windows and for long usernames, and it is indistinguishable from a
permission denial unless the path is printed.

### 7.5 The bash-class path, and a second unexplained defect

`bash_tool.rs` implements Bash-class attribution as pre/post **stat-snapshot diffs** brokered
through the daemon control socket (`bash_session.start` carries the snapshot;
`bash_snapshot.query` retrieves it). Timeouts: `WALK_TIMEOUT_MS = 1500`, `HOOK_TIMEOUT_MS = 4000`.
Failure returns `MissingPreSnapshot` / `SnapshotFailed` / `HookTimeout`, and the orchestrator
logs at `tracing::debug!` then `return Ok(vec![])` — **silent, exit 0**.

**Separately measured and NOT explained**: on this machine, Claude Code's Bash-class tool calls
record **nothing at all** — no agent checkpoint, no human checkpoint — while its `Write`-class
calls record perfectly. Claude Code's shell is **not** sandboxed and connects to both sockets
fine. Two files created seconds apart in the same repo:

```
Write tool  (FileEdit class)  →  RECORDED   "+1 claude claude-opus-5"
printf >    (Bash class)      →  NOTHING
```

This is a **different defect from the sandbox one**, it is unexplained, and it may be the actual
mechanism behind the original "human work attributed as AI" complaint — because day-to-day agent
commits go through Bash-class tools. **We never reproduced the absorption case**; everything we
reproduced was total loss. Do not let the fix in this plan be described as fixing absorption.

---

## 8. Cross-platform position

| | file/detect half | replay half | hook-runner sandbox state |
|---|---|---|---|
| **macOS** | portable | AF_UNIX — **PROVEN** | **MEASURED unsandboxed** |
| **Linux** | portable | AF_UNIX — expected identical | **UNVERIFIED** |
| **Windows** | portable | **named pipe** — untested | **UNVERIFIED, and the design rests on it** |

**Node is the reason this is tractable**: `net.createConnection({ path })` speaks AF_UNIX on posix
**and** Windows named pipes through one API. `nc -U` (the mechanism our earlier proven route used)
has no Windows equivalent.

The Windows pipe name is **derived from source, never observed**. Two assumptions stack there: the
pipe path, and whether Cursor's hook runner is unsandboxed on Windows. If the second is false the
whole design fails on Windows and needs a different answer.

---

## 9. Open unknowns — risks, not assumptions

| # | Unknown | Why it matters | Failure direction |
|---|---|---|---|
| 9.1 | **Idempotency** — hook fires twice for one commit | double-write or corrupt note | unknown |
| 9.2 | **Staleness ceiling** — how old can the commit be before rule 1 stops resolving | late hooks silently do nothing | safe (fail closed → missing note) |
| 9.3 | **False positives** — emitting `commit` when none happened | daemon may claim an unrelated reflog entry | **DANGEROUS — a false note** |
| 9.4 | **Multi-commit chains** — `git commit && git commit` in one tool call | one emit, two transitions | unknown |
| 9.5 | **Windows** end to end | § 8 | unknown |
| 9.6 | **Concurrency** — several repos/sessions emitting into one socket | interleaving | unknown |

9.3 is the one to design against. The HEAD-parent guard (§ 4.3) is the current mitigation and is
only as good as the cases we thought of; it should be attacked deliberately, not just tested.

---

## 10. POC inventory

Working code, all measured, carried into `assets/poc/` with this dossier:

| file | what it proves |
|---|---|
| `harness-commit-hook.mjs` | **the POC** — PRE/POST HEAD tracking + synthetic emit; drove run B |
| `synth-trace2.mjs` | the minimal synthetic emit, standalone; drove `c8217d1` |
| `trace2-relay.py` / `harness-trace2-hook.mjs` | the *superseded* relay route (replays real event files) — kept because it is the fallback if synthesis proves unsafe |
| `probe-socket.py` / `env-report.py` | the two-socket reachability + path-resolution probe; produced every `REFUSED`/`CONNECTED` reading |
| `hook-probe.py` | the probe that established the hook runner is unsandboxed (§ 2.3) |
| `seed-human.py` | env-scrubbed human-edit simulator |
| `PREDICTION.md` | the four candidate mechanisms, written **before** the run |
| `CURSOR-PROMPT-*.md` | the exact prompts driven into real Cursor, including the negative control |

---

## 11. Prior art — including our own, which we failed to read

**`docs/how/telemetry/sandbox-02-workarounds-proven.md` (2026-08-07)** already contained a proven
answer to this question — the **trace2 file relay** (Route B), with a working commit sha. We spent
an evening re-deriving it. *The record you wrote is not the one you remember: search your own
pushed artifacts first.* That doc now **understates** what we know and should be updated: it
recommends Route A (allowlist — since measured insufficient, § 6.3) and Route B (file relay —
which needs global trace2 redirection, § 6.1/6.2), and the synthesis route (§ 4) beats both.

**Upstream `git-ai-project/git-ai#2067`** — *"Human edits get silently attributed to AI when no
agent hook fires to close the checkpoint boundary"*. OPEN, labelled `bug`, **zero comments, no
assignee**, filed 2026-08-02 by an external user against v1.6.19. Its "Bug 2" describes the
absorption case precisely. **We do not file upstream issues to git-ai** — recorded as context, not
as an action.

Also open and relevant: `#1925` (Claude Code via VS Code extension — hooks never invoked in Agent
SDK "panel" mode), `#1968` (Cursor attribution), `#1845`, `#1770`.

---

## 12. How to re-run any of this

```bash
# reachability, inside vs outside the sandbox — the core measurement
python3 tools/env-report.py <label>

# reproduce total loss WITHOUT Cursor (trace2 sent somewhere the daemon cannot see)
GIT_TRACE2_EVENT=/tmp/discarded git commit -q -m "…"   # → no note

# the fix, standalone
node synth-trace2.mjs "<abs repo path>" "<commit message>"
git-ai await && git notes --ref=ai show HEAD
```

Assert on **note identity per commit**, never on a note *count* — the count moves for unrelated
reasons (any unsandboxed commit in the repo adds one), and a total that moved tells you nothing
about which commit moved it.
