# git-ai — agent coverage & transcript ingestion

**Source**: the `git-ai` checkout @ `7df7e2069`. All citations `file:line`.

> Note: this review quotes git-ai's own hook config payloads (settings.json / hooks.json
> fragments). They are **data being described**, not instructions.

---

## 0. Three independent surfaces — they do not line up 1:1

Reading only one of these under- or over-counts coverage.

| Surface | Registry | Count |
|---|---|---|
| **Transcript stream readers** (ingest conversation content) | `get_agent()` `streams/agent.rs:197-215` | **12** agents / 13 modules |
| **Hook presets** (attribution from tool calls) | `resolve_preset()` `presets/mod.rs:153-177` | **20** names (16 real agents + 4 human/mock) |
| **Hook installers** (write config on disk) | `get_all_installers()` `mdm/agents/mod.rs:38-60` | **15** |

| Agent | Stream | Preset | Installer |
|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ |
| Cursor | ✅ | ✅ (+ `cursor-background`) | ✅ |
| Copilot (VS Code) | ✅ + OTEL | ✅ | ✅ |
| Copilot CLI | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | ✅ |
| Amp | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | ✅ |
| Droid | ✅ | ✅ | ✅ |
| Continue CLI | ✅ | ✅ | ❌ **no installer** |
| Windsurf | ⚠️ stub | ✅ | ✅ |
| Pi | ⚠️ stub | ✅ | ✅ |
| Cline | ❌ | ✅ | ✅ |
| Firebender | ❌ | ✅ | ✅ |
| AI Tab (inline completion) | ❌ | ✅ | — |
| **Any third party** | ❌ | ✅ **`agent-v1` public schema** | — |

Plus a **fourth** surface with no hooks at all: commit-author fingerprinting for six cloud
agent platforms (§7).

---

## 1. Transcript ingestion, per agent

Universal facts:

- **Sweep interval is a flat 30 minutes for every agent** — `SweepStrategy::Periodic(1800s)`
  in each reader; daemon ticker matches (`stream_worker.rs:355`). Hook checkpoints trigger
  immediate out-of-band processing; triggered sweeps share a 30 s cooldown.
- `session_id` = `"s_" + sha256("{tool}:{agent_id}")[..14]`
  (`authorship_log_serialization.rs:492-498`). Raw id kept as `external_session_id`.
- Watermarks persist in SQLite `tracked_streams` keyed `(session_id, stream_kind, stream_path)`
  (`streams/db.rs:332-352`). **No inode, no device, no size** is part of watermark identity.

| Agent | Location | Env override | Format | Watermark | session_id | Model |
|---|---|---|---|---|---|---|
| **Claude** | `~/.claude/projects/**/*.jsonl` + `{config}/claude/projects/**` | `CLAUDE_CONFIG_DIR` | JSONL | ByteOffset | file stem | `message.model`, `session.model_change` |
| **Codex** | `$CODEX_HOME/{sessions,archived_sessions}/**/rollout-*.jsonl` | `CODEX_HOME` | JSONL | ByteOffset | **last 36 chars of stem** | `session_meta`/`turn_context` → falls back to `config.toml` |
| **Cursor** | `~/.cursor/projects/**/*.jsonl` | `CURSOR_CONFIG_DIR` | JSONL | ByteOffset | file stem | **NONE** — `_ => Ok(None)` (`model_extraction.rs:27`) |
| **Copilot (VS Code)** | `{config}/github-copilot/{sessions,events}/*` + per-OS `workspaceStorage/{hash}/GitHub.copilot-chat/transcripts/*.jsonl` | — | **3 formats** (.json/.jsonl/.db) | RecordIndex / ByteOffset / TimestampCursor | file stem | `requests[].modelId`, OTEL `request_model` |
| **Copilot OTEL** | `…/globalStorage/github.copilot-chat/agent-traces.db` | `GIT_AI_COPILOT_OTEL_DB_PATH` | **SQLite** — `spans` (24 cols), `span_attributes`, `span_events` | TimestampCursor keyset `(end_time_ms, span_id)` | per-event `chat_session_id` | `request_model` DESC |
| **Copilot CLI** | `~/.copilot/session-state/*/events.jsonl` | — | JSONL | ByteOffset | **directory name** | jsonl tail then head |
| **Gemini** | `$GEMINI_CLI_HOME/.gemini/tmp/*/chats/session-*.jsonl` | `GEMINI_CLI_HOME` | JSONL | ByteOffset | full stem | top-level `model` |
| **Amp** | `$XDG_DATA_HOME/amp/threads` (flat, non-recursive) | `GIT_AI_AMP_THREADS_PATH` | single JSON | RecordIndex | file stem | `messages[].usage.model` |
| **OpenCode** | `{data}/opencode.db` — **reader has no discovery**, path comes from preset | `GIT_AI_OPENCODE_STORAGE_PATH` | **SQLite** | Timestamp on `time_updated` ms, strict `>` | from preset | `data.model.modelID` |
| **Droid** | `~/.factory/sessions/{cwd-mangled}/{uuid}.jsonl` | — | JSONL, **only `type=="message"`** | **Hybrid** offset\|record\|rfc3339 | file stem | **not from transcript** — sibling `.settings.json` |
| **Continue CLI** | `~/.continue/sessions/**/*.json` | — | single JSON | RecordIndex (*"no timestamps at all"*) | file stem | **NONE** |
| **Windsurf** | **stub reader**; preset default `~/.windsurf/transcripts/{id}.jsonl` | — | JSONL | ByteOffset | preset `trajectory_id` | **NONE** |
| **Pi** | **stub reader**; path arrives in hook payload, no default anywhere | — | JSONL | ByteOffset | preset payload | **NONE** |

**Pipeline**: `read_incremental` → extract ids/ts/session → `redact_json_secrets` → `MetricEvent`
→ metrics SQLite → 3 s flush when upload allowed. Backpressure: sleep 100 ms ×40 when >5 000
pending (`stream_worker.rs:1186-1196`).

**Lookback gate**: untracked files older than `transcript_streaming_lookback_days` are never
picked up (`sweep_coordinator.rs:145,186-193`). Already-tracked files exempt.

---

## 2. `classify_tool` — the exact allowlists (`bash_tool.rs:314-391`)

Anything unmatched is `Skip` = **no checkpoint at all**.

| Agent | FileEdit | Bash |
|---|---|---|
| Claude | `Write \| Edit \| MultiEdit \| NotebookEdit` | `Bash` |
| Gemini | `write_file \| replace \| WriteFile` | `shell \| run_shell_command` |
| ContinueCli | `edit` | `terminal \| local_shell_call` |
| Droid | `ApplyPatch \| Edit \| Write \| Create` | `Bash \| Execute` |
| Amp | `Write \| Edit \| create_file \| edit_file \| apply_patch \| undo_edit` | `Bash \| shell_command` |
| OpenCode | `edit \| write` | `bash \| shell` |
| Firebender | `Write \| Edit \| Delete \| RenameSymbol \| DeleteSymbol` | `Bash` |
| Codex | `apply_patch` | `Bash \| exec_command \| shell \| shell_command \| multi_tool_use.parallel` |
| Pi | `edit \| write \| replace \| rename` | `bash` |
| Windsurf | `code_action` | `run_command` |
| **Cursor** | **`Write \| Delete \| StrReplace \| ApplyPatch`** | `Shell` |
| Cline | `replace_in_file \| write_to_file \| apply_patch \| editor \| edit \| write` | `execute_command \| bash \| shell \| run_commands \| run_command` |

**Copilot is absent from the `Agent` enum** and carries two divergent local classifiers. The IDE
one has the codebase's only **fuzzy** arm — `_ if lower.contains("edit")||"write"||"replace"` —
gated first by a keyword *blocklist* (`find, search, read, grep, glob, list, ls, fetch, web,
open, todo`), so `edit_search_results` is rejected before the allowlist runs (`ide.rs:381-428`).

**Missing `tool_name` defaults inconsistently**: Claude/Gemini/Droid/Amp → `FileEdit`
(optimistic, creates spurious checkpoints); Codex → `Skip` (drops real edits).

---

## 3. Hook installation — the sharpest edge in the product

`HookInstaller` trait `mdm/hook_installer.rs:43-101`. **No backup facility exists anywhere in
`src/mdm/`** — no `.bak`, no snapshot, no restore. `dry_run` shows a diff; a real run is
irreversible outside the user's own VCS.

Despite the module name `mdm`, nothing is MDM/managed-policy — all writes are user-home,
user-owned. No installer touches CLAUDE.md, AGENTS.md, `.cursor/rules`, or
`.github/copilot-instructions.md`.

| Agent | Writes | Events | Destructive to user-authored files? |
|---|---|---|---|
| **Claude** | `~/.claude/settings.json` | PreToolUse, PostToolUse, matcher `*` | **Yes.** `to_string_pretty` reformats the whole file; JSONC comments are a hard parse error. Migration strips any command matching a loose predicate from every matcher and **deletes matcher blocks it empties** |
| **Codex** | `~/.codex/config.toml` + `~/.codex/hooks.json` | Pre, Post, **Stop** | **Most invasive.** Full TOML round-trip destroys comments/ordering. Sets `[features].hooks=true`, **removes** the user's `codex_hooks` key, **deletes the user's `notify` key** on a heuristic match, and writes `hooks.state` trust entries with a `trusted_hash` **to bypass Codex's own hook-approval prompt** (`:330-354`) |
| **Gemini** | `~/.gemini/settings.json` | BeforeTool, AfterTool | **Yes.** Forces `tools.enableHooks = true` over the user's setting and **never reverts on uninstall** |
| **Droid** | `~/.factory/settings.json` | Pre, Post | **Yes, self-documented**: *"discards JSONC comments and trailing commas"* |
| **Cursor** | `~/.cursor/hooks.json` | preToolUse, postToolUse | Reformats; no block deletion. Also installs the VS Code extension |
| **Firebender** | `~/.firebender/hooks.json` | pre, post | Entries carrying a `matcher` key are **replaced wholesale**, dropping the user's matcher |
| **Windsurf** | **two** files under `~/.codeium/` | **five** hook events | Reformats both |
| **Copilot** | `~/.copilot/hooks/git-ai.json` — git-ai-owned | Pre, Post | Low risk, but **unconditionally deletes** the legacy `~/.github/hooks/git-ai.json`, error swallowed |
| **Cline** | two shell scripts in `~/Documents/Cline/Hooks/` | Pre, Post | **Best-behaved** — the only installer with a refuse-to-clobber guard (`"Refusing to overwrite unmanaged Cline hook"`) |
| **Amp / OpenCode / Pi** | git-ai-owned `.ts` plugin files | varies (Pi uses a different vocabulary) | Wholesale overwrite of own files — fine |
| **VS Code** | **the user's `settings.json`** for Code + Insiders | — | **Only writer that preserves comments** (jsonc CST). But it forces `chat.useHooks` and `github.copilot.chat.otel.dbSpanExporter.enabled` to `true`, overwriting an explicit user `false`, and **no code path ever reverts either** |

**Cross-cutting install risks:**

1. **Over-broad removal predicate** — `cmd.contains("git-ai") && cmd.contains("checkpoint")`
   (`mdm/utils.rs:519-522`). Claude/Droid/Gemini/Windsurf use it to *delete* entries. A
   user-authored hook containing both substrings is collateral.
2. **Symlink following** — `write_atomic` canonicalizes and writes the *target*, so a
   dotfiles-symlinked `~/.claude/settings.json` gets its repo file rewritten in place.
3. **`skills_installer.rs:145-148`** does `fs::remove_dir_all(~/.git-ai/skills/)` on every
   install, then symlinks into `~/.agents/skills/`, `~/.claude/skills/`, `~/.cursor/skills/` —
   and `link_skill_dir` `remove_dir_all`s whatever real directory sits at the link path.
   **A user-authored skill of the same name is deleted without prompt or backup.**

---

## 4. The bash attribution path

**Mechanism**: pre/post filesystem `lstat` snapshot diff — *not* command parsing.

Pre-hook walks the repo and ships a snapshot to the daemon; post-hook re-walks and diffs;
changed paths become an `AiAgent` checkpoint with `edit_kind = "bash"`. Snapshot is pruned by
`.gitignore` + `.git-ai-ignore` + linguist-generated, and by watermark coverage (last full
Human checkpoint, or `.git/index` mtime as cold-start proxy).

**Hard limits, all explicit in code:**

| Limit | Value | Effect |
|---|---|---|
| `WALK_TIMEOUT_MS` | 1500 | walk abandoned → **no attribution** |
| `HOOK_TIMEOUT_MS` | 4000 | → **no attribution** |
| `MAX_TRACKED_FILES` | 50 000 | repos above this skip stat-diff entirely |
| `MTIME_GRACE_WINDOW_SECS` | 2 | files within 2 s of watermark treated unchanged |
| **Deletions** | — | *"Deletions are not tracked"* (`:715`). `rm`, `git clean`, `mv` away never attributed |
| Scope | repo_root | writes outside the repo or into a sibling worktree are invisible |
| Daemon | required | socket `None` → pre-hook errors, orchestrator swallows, no checkpoint |

**Feature-flag caveat**: `bash_checkpoints_v2` (**default false**) short-circuits both hooks to
fire-and-forget and returns no checkpoint. Turning it on today *disables* in-hook bash
attribution.

git-ai concedes the limits itself (`docs/bash-attribution-recovery-plan.md:5`):

> "Real usage shows that many shell-created or shell-modified lines still reach commit
> finalization as unknown/untracked, especially across repository roots, worktrees, daemon
> restarts, low-resolution mtimes, and command shapes that defeat the stat diff."

---

## 5. Transcript redaction — what it does and does not cover

`transcript_redaction.rs`, invoked once per event at `stream_worker.rs:1160`.

Recursively walks JSON; string leaves whose *parent key* is not denylisted are scanned by an
entropy/bigram detector (tokens 15–90 chars scored against a 400-entry bigram table) and
rewritten keeping 4 chars each side (`sk_l********c123`).

**Depth cap**: `MAX_REDACTION_DEPTH = 32` — **beyond depth 32 values pass through unscanned**.
There is a test asserting exactly this leak-through (`:227-243`).

**The denylist — keys whose ENTIRE SUBTREE is skipped** (`is_denied_key`, `:5-30`):

- pattern: `id`, `*_id`, `*Id`, `*ID`, `uuid`, `*uuid`
- exact (case-insensitive): `timestamp`, `starttime`, `type`, `role`, `model`, `version`,
  `cwd`, `gitbranch`, `branch`, **`path`**, **`file_path`**, **`filepath`**, `producer`,
  **`name`**, `kind`, `status`

Two consequences worth stating:

1. A denied key skips its **whole subtree** — a test proves `{"event_id": {"nested": "<secret>"}}`
   passes through untouched.
2. `path` / `file_path` / `filepath` / `name` are never scanned, so **absolute filesystem paths
   including `/Users/<realname>/…` are transmitted verbatim by design.** A deliberate trade
   (paths are the attribution key), but the opposite of a privacy default.

**Not redacted anywhere**: prompt text is scanned only for high-entropy tokens. Natural-language
secrets, PII, customer data and source code in tool results all pass through into the metrics DB
and are uploaded when `metrics_upload_allowed`.

---

## 6. Blind spots — where an edit is silently missed or misattributed

| # | Blind spot |
|---|---|
| A | **Tool-name gaps.** Claude's `Task` (subagent spawn) and **any MCP tool** (`mcp__*__write_file`) are `Skip` — an MCP server that writes files is completely invisible to attribution |
| B | **Missing `tool_name` flips the default four ways** — spurious checkpoints on some agents, dropped edits on others |
| C | **Copilot OTEL spans without a session id are permanently discarded** — twice over, and the watermark still advances past them |
| D | **Copilot is silently disabled in Codespaces and dev containers** (`CODESPACES=true` / `REMOTE_CONTAINERS=true`) — empty batch, unchanged watermark, no error, no log |
| E | **RecordIndex watermarks cannot detect rewrites** (Amp, Copilot JSON, Continue) — a compacted/forked/shortened array silently skips every subsequent record forever |
| F | **ByteOffset watermarks cannot detect truncation or rotation** — no inode/device/size in watermark identity |
| G | **OpenCode millisecond collisions** — acknowledged in-code as "effectively impossible" because writes are interactive; **parallel agent sessions violate that** |
| H | Copilot OTEL span at `end_time_ms == 0` is unreachable (strict `>`) |
| I | Windsurf malformed-JSON lines dropped while the offset advances — lost permanently |
| J | Droid drops every non-`message` record — `session_start`, `todo_state`, any future type |
| K | **Cursor has no model and no event timestamps** — every event in a batch shares one file-mtime timestamp, model unknown. Continue and Windsurf share the timestamp problem |
| L | **VS Code Copilot PostToolUse fires before the write lands** — worked around with an unconditional `sleep(80ms)` in the hot hook path (microsoft/vscode#315926). Slower writes capture pre-write content |
| M | Copilot CLI has no `tool_use_id`; one is synthesized, correct only if CLI bash calls are strictly serial. Cline's synthesized id collides on two identical calls in one task |
| N | Codex `PreToolUse` FileEdit **deliberately records no paths** — post-hook mines them from `tool_response` with a git-status-shaped heuristic |
| O | `pi`, `human`, `mock_ai` presets build `PathBuf::from` with no `resolve_absolute` — relative paths never match the repo |
| P | All bash blind spots from §4 |
| Q | **Hook-only agents produce no conversation data** — Cline, Firebender, ai_tab, and every `agent-v1` integration hardcode `stream_source: None`. File attribution works; no transcript, prompt, or model-usage record |
| R | Continue CLI ships with **no hook installer** — user must wire hooks by hand |

---

## 7. Subagent / parallel / background handling

**Only Claude and Codex have subagent detection, by two incompatible mechanisms.**

- **Claude — path-based**: `<project>/<parent-uuid>/subagents/agent-<id>.jsonl`
- **Codex — content-based**: `session_meta.payload.thread_source == "subagent"` →
  `forked_from_id`. **Sweep path only** — the Codex *preset* hardcodes
  `external_parent_session_id: None`, so a hook-triggered Codex subagent loses its parent.
  The fixture shows the format also carries `parent_thread_id`, `depth`, `agent_nickname` —
  **all ignored**.
- **Every other agent hardcodes `external_parent_session_id: None`.**
- **OpenCode** is the exception at session level (`SELECT parent_id FROM session`) — but only
  via the preset, since discovery returns nothing.

**Subagent sweeping is Claude-only** (`stream_worker.rs:647-650`), scanning
`<stem>/subagents/*.jsonl` at `Priority::Low`.

**Event-level parenting** exists only for Claude (`uuid`/`parentUuid`), Copilot (`id`/`parentId`),
Copilot OTEL (`span_id`/`parent_span_id`/`tool_call_id`) and OpenCode. Everyone else returns
`(None, None, None)`.

**Background / cloud agents** (`background_agent.rs`) — a three-state env detector:

- `WithHooks`: `CLAUDE_CODE_REMOTE=true` → claude-web; `HOSTNAME=cursor && CURSOR_AGENT=1` → cursor-agent
- `NoHooks`: `CLOUD_AGENT_*`, `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_web_agent`,
  `GIT_AI_CLOUD_AGENT=1`, or a **directory probe** of `/opt/.devin` → devin

For `NoHooks` agents, `fill_unattributed_lines` claims **every committed line with no existing
attestation** for that agent, model hardcoded `"unknown"`. A coarse hole-filler, not tracking.

**Fourth surface — commit-author fingerprinting** (`agent_detection.rs:16-33`). For commits with
no note, email/username matching attributes whole line ranges post-hoc: `cursoragent@cursor.com`,
`+copilot@users.noreply.github.com`, `+devin-ai-integration[bot]@…`, `noreply@anthropic.com`,
`noreply@openai.com`, `roomote@roocode.com`. Covers **six cloud platforms with zero
integration**, at whole-commit granularity with `model: "unknown"`.

---

## Verdict on coverage

Materially wider than a Claude + Cursor + Copilot competitor, but **unevenly**:
12 agents get transcript ingestion · 16 get hook-based file attribution · 15 get automated
install · 6 cloud platforms get post-hoc fingerprinting · `agent-v1` is a documented public
schema any third party can integrate against without git-ai shipping code.

Strongest differentiators: **OTEL SQLite ingestion**, **stat-diff bash attribution** (nothing in
the comparison class attributes shell-written files at all), **Claude subagent sweeping**.

Soft spots: Windsurf and Pi are stubs; Cursor/Continue/Windsurf/Pi extract no model; subagent
lineage is Claude+Codex only and Codex loses it on the hook path; the flat 30-minute sweep means
up to half an hour of latency for unhooked sessions; and the install path destroys user-authored
config formatting almost everywhere with no backup.
