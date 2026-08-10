# git-ai — data capture surface inventory

**Source**: the `git-ai` checkout @ `7df7e2069`.
**Method**: direct source read, file:line cited throughout.

---

## 1. Persistent stores — 19 of them

| # | Path | Format | Contents | Retention | Size bound |
|---|---|---|---|---|---|
| 1 | `~/.git-ai/internal/metrics-db` | SQLite (WAL) | **all 7 event types** as raw JSON in `metrics.event_json` + delivery queue | **365 d** by event ts, prune ≤ every 24 h (`db.rs:171,173`, logic `:862-924`) | none; delivered rows **kept** as history (`db.rs:3-5`) |
| 2 | `~/.git-ai/internal/transcripts-db` | SQLite | stream cursors/watermarks per (session, kind, path) | **none** — only explicit `remove_stream` (`streams/db.rs:471`) | none |
| 3 | `~/.git-ai/internal/bash-checkpoints-db` | SQLite | `bash_checkpoint_calls` — **full bash command text** + cwd + timing | 30 d (`bash_history_db.rs:9-10`) | none |
| 4 | `~/.git-ai/internal/notes-db` | SQLite | **full serialized authorship note text** per commit + upload queue | **none** | none |
| 5 | `~/.git-ai/internal/db` (legacy) | SQLite | `prompts.messages` = **full prompt/message payload**; `cas_sync_queue.data`; `cas_cache.messages` | **none**. Marked deprecated but present (`internal_db.rs:1-2`) | none |
| 6 | `<git-common-dir>/ai/working_logs/<base_sha>/checkpoints.jsonl` | JSONL | pre-commit working log | archived to `old-<sha>/` at commit; pruned after **7 d** (release only, `repo_storage.rs:145,137`) | **1 GiB**; on exceed the log is **deleted and recreated empty** (`repo_storage.rs:16,612-655`) |
| 7 | `…/working_logs/<base_sha>/blobs/<sha256>` | raw bytes | **verbatim full content of every checkpointed file** (`checkpoint.rs:569-581`) | cleared on reset | per-file cap via content budget |
| 8 | `…/working_logs/<base_sha>/INITIAL` | JSON | `files`, `prompts`, `file_blobs`, `humans`, `sessions` (`repo_storage.rs:21-37`) | removed on reset | none |
| 9 | `<git-dir>/ai/logs/` | files | Sentry event logs | none coded | none |
| 10 | `refs/notes/ai` | text + JSON footer | per-commit attestations + metadata; schema `authorship/3.0.0` | **permanent** (git history) | none |
| 11 | `refs/notes/ai-display` | git notes | rendered note for `git log --notes=ai-display` | permanent | none |
| 12 | `~/.git-ai/internal/checkpoint-debug-logs/<date>.log` | JSONL | **raw agent hook input verbatim** + full `CheckpointRequest`s incl. file contents | 14 d (`orchestrator.rs:286`) | **none** |
| 13 | `~/.git-ai/internal/daemon/logs/<pid>.log` | text | daemon stdout/stderr | none coded | none |
| 14 | `~/.git-ai/internal/distinct_id` | text | **persistent machine UUIDv4** (`config.rs:1516-1560`) | permanent | 36 B |
| 15 | `~/.git-ai/internal/credentials` | file / OS keyring | auth tokens | until logout | — |
| 16 | `~/.git-ai/internal/daemon/daemon.pid.json`, `.lock` | JSON / lock | pid + start ns | process lifetime | — |
| 17 | `~/.git-ai/config.json` | JSON | user config incl. `custom_attributes` | — | — |
| 18 | user-named SQLite (`analyze sessions --db`) | SQLite | **cloud-pulled** `session_events(text, tool_input, tool_output, summary)` etc. | none | 2000 events/pull |
| 19 | `$TMPDIR/git-ai-*-failed` | SQLite | **fallback DBs on init failure** — same fields, world-adjacent temp path, no retention (`db.rs:215-218`, `internal_db.rs:117-123`, `notes/db.rs:72`) | **never pruned** | none |

### `metrics` table columns

Base: `id`, `event_json`.
Delivery queue (`db.rs:383-413`): `delivered_ts`, `attempts`, `last_sync_error`, `last_sync_at`, `next_retry_at`, `processing_started_at`.
Cached metadata (`db.rs:415-465`): `event_ts`, `event_kind`, `trace_id`, `session_id`, `parent_session_id`, `tool`, `external_session_id`, `external_parent_session_id`, `external_event_id`, `external_parent_event_id`, `external_tool_use_id`.

---

## 2. The seven event types

Envelope: `MetricEvent { t: u32, e: u16, v: SparseArray, a: SparseArray }` (`types.rs:42-52`).
Three-state nullability everywhere via `PosField<T> = Option<Option<T>>` (`pos_encoded.rs:16`): absent / explicit-null / value.

### Event 1 — `committed` (`events.rs:11-87`)

| Pos | Field | Type | Note |
|---|---|---|---|
| 0 | `human_additions` | u32 | lines added attributed to a human |
| 1 | `git_diff_deleted_lines` | u32 | raw git diff |
| 2 | `git_diff_added_lines` | u32 | raw git diff |
| 3 | `tool_model_pairs` | Vec\<String\> | idx 0 = `"all"`, 1+ = `tool::model` |
| 4 | *(tombstoned)* `mixed_additions` | — | reserved |
| 5 | `ai_additions` | Vec\<u32\> | parallel to pos 3 |
| 6 | `ai_accepted` | Vec\<u32\> | AI lines surviving into the commit |
| 7 | *(tombstoned)* `total_ai_additions` | — | |
| 8 | *(tombstoned)* `total_ai_deletions` | — | |
| 9 | *(removed)* `time_waiting_for_ai` | — | |
| 10 | `first_checkpoint_ts` | u64 | → time-to-commit |
| 11 | `commit_subject` | String | **full subject** |
| 12 | `commit_body` | String | **full body** |
| 13 | `authorship_note` | String | **entire serialized note** |
| 14 | `hunks` | String | **JSON array of `DiffJsonHunk`** |
| 15 | `author_ts` | u64 | git `%at` |
| 16 | `commit_ts` | u64 | git `%ct` |
| 17 | `patch_id` | String | `git patch-id --stable` |

`DiffJsonHunk` (`diff.rs:140-155`): `commit_sha`, `content_hash`, `hunk_kind`, `original_commit_sha?`, `start_line`, `end_line`, `file_path`, `prompt_id?`, `session_id?`, `human_id?`.

### Event 7 — `rewrite_committed` (`events.rs:366-403`)

Positions aligned with event 1. Adds pos 15 `operation_kind` (e.g. `"rebase"`) and pos 16 `original_commit_shas: Vec<String>` — **links old→new commit identity across a rewrite**. In practice `commit_subject`/`body`/`hunks` are emitted null (`rewrite_metrics.rs:289`); `authorship_note` carries the full raw note (`:285`).

### Event 2 — `agent_usage` (`events.rs:645-680`)
**Zero value fields.** All payload in attributes. Rate limited: 150 s min interval, LRU 10 000 (`checkpoint.rs:53,55`) + persistent throttle table.

### Event 3 — `install_hooks` (`events.rs:684-706`)
`tool_id`, `status` (`not_found|installed|already_installed|failed`), `message`.

### Event 4 — `checkpoint` (`events.rs:782-828`) — one event **per file per checkpoint**

| Pos | Field | Type | Note |
|---|---|---|---|
| 0 | `checkpoint_ts` | u64 | |
| 1 | `kind` | String | `human` \| `ai_agent` \| `ai_tab` \| `known_human` |
| 2 | `file_path` | String | full repo-relative path |
| 3 | `lines_added` | u32 | |
| 4 | `lines_deleted` | u32 | |
| 5 | `lines_added_sloc` | u32 | non-blank/non-comment |
| 6 | `lines_deleted_sloc` | u32 | non-blank/non-comment |
| 7 | `external_tool_use_id` | String | agent's tool-invocation id |
| 8 | `edit_kind` | String | `file_edit` \| `bash` \| `attribution_recovery_*` |
| 9 | `checkpoint_type` | String | `recovered_bash` \| `recovered_session_event_mtime` \| `recovered_commit_metadata` |
| 10 | `attribution_recovery_metadata` | String (JSON) | free-form — see §5 item 9 |

### Event 5 — `session_event` (`events.rs:1739-1874`)
Pos 0 `raw_json` = **the entire raw agent-transcript JSONL record, verbatim** (secret-redacted). Pos 1–3: `external_event_id`, `external_parent_event_id`, `external_tool_use_id`. Emitted `stream_worker.rs:1160-1173`.

### Event 6 — `otel_trace` (`events.rs:1876-2007`)
Same shape; pos 0 = **an OTEL span from Copilot's traces SQLite**, serialized. Spans with no session id are dropped.

---

## 3. Common `EventAttributes` — on every event (`attrs.rs:7-62`)

| Pos | Field | Note |
|---|---|---|
| 0 | `git_ai_version` | required in practice |
| 1 | `repo_url` | normalized remote |
| 2 | `author` | **git identity of the human** |
| 3 | `commit_sha` | |
| 4 | `base_commit_sha` | parent / checkpoint base |
| 5 | `branch` | |
| 20 | `tool` | |
| 21 | `model` | |
| 22 | `prompt_id` | **TOMBSTONED** — read-only for legacy rows |
| 23 | `external_session_id` | agent-native uuid |
| 24 | `session_id` | required; hash(external id + tool) |
| 25 | `trace_id` | links all events of one checkpoint |
| 26 | `parent_session_id` | **subagent lineage** |
| 27 | `external_parent_session_id` | |
| 30 | `custom_attributes` | **arbitrary user/org free-text k/v** |

---

## 4. Working-log record shape

`Checkpoint` (`working_log.rs:118-139`): `kind`, `diff` (actually a combined SHA-256, not a diff), `author`, `entries[]`, `timestamp`, `agent_id{tool,id,model}`, `agent_metadata` (arbitrary k/v), `line_stats{additions, deletions, additions_sloc, deletions_sloc}`, `api_version` (`checkpoint/1.0.0` — mismatches silently skipped, `repo_storage.rs:542-548`), `git_ai_version`, `known_human_metadata{editor, editor_version, extension_version}`, `trace_id`.

`WorkingLogEntry` (`working_log.rs:11-22`): `file`, `blob_sha` (→ full content in `blobs/`), `attributions[]` (**character-level**: `start`, `end`, `author_id`, `ts` ms), `line_attributions[]` (`start_line`, `end_line`, `author_id`, **`overrode: Option<String>`** — the author_id this edit overwrote).

Char-level attributions are pruned from all but the newest checkpoint per file (`repo_storage.rs:660-683`).

---

## 5. Derived locally (`local_stats.rs`) — feeds `git ai usage`, nothing persisted

From events 1, 4, 5 only.

- **Commits**: `total` (AI commits), `ai_lines`, `human_lines`, `diff_added_lines`, `by_tool`, `acceptance_by_tool` = committed_ai×100/checkpoint_ai (sentinel `u32::MAX` when no checkpoint data)
- **Checkpoints**: `total`, `ai_lines_added` (kind ∈ {ai_agent, ai_tab}), `human_lines_added` (kind = known_human), `files_edited`
- **Sessions**: `total` distinct, `by_tool`, **`yield_stats.shipped/.abandoned`** — a commit within `YIELD_WINDOW_SECS = 4 h` of the session's last event
- **Tokens**: input/output/cache_read/cache_creation from `raw_json.message.usage.*`, deduped by `message.id` keeping **field-wise max** across streaming re-emits; separate codex path using cumulative `total_token_usage` per-session max
- **`estimated_cost_usd`**: hard-coded per-million USD table matched by model-name **substring** — opus 15/75/18.75/1.5, sonnet 3/15/3.75/0.3, haiku … (`pricing_for`, `l.592-612`)
- **`by_model`**: sessions, tokens, cost, `cache_hit_ratio`
- **`wow_spend`**: last 7 d vs 7–14 d, only when window ≥ 14 d
- **Buckets** per day/week/month: `ai_lines`, `commit_count`, `diff_added_lines`, `attributed_lines`
- **`hourly[24]`**, **`daily[7]`**, **`calendar[]`** with per-day cost
- **Summary**: `active_days`, `total_days`, `longest_streak`, `current_streak`, `most_active_day`, `longest_session_secs`, `favorite_model`
- **`RepoActivitySummary`** — the same, grouped by `repo_url`

---

## 6. Budgets and caps — exact constants

| Constant | Value | Where | Effect |
|---|---|---|---|
| `DEFAULT_MAX_CHECKPOINT_FILE_SIZE_BYTES` | 3 MiB | `config.rs:21` | oversize files **skipped entirely** |
| `DEFAULT_MAX_CHECKPOINT_TOTAL_SIZE_BYTES` | 32 MiB | `config.rs:22` | per-checkpoint aggregate |
| `DEFAULT_MAX_CHECKPOINT_TOTAL_LINES` | 500 000 | `config.rs:23` | per-checkpoint aggregate |
| `MAX_CHECKPOINT_FILES` | 1000 | `orchestrator.rs:59` | path list **truncated** |
| `MAX_CHECKPOINTS_JSONL_BYTES` | 1 GiB | `repo_storage.rs:16` | log **deleted + recreated empty** |
| `METRICS_RETENTION_SECS` | 365 d | `db.rs:171` | |
| `MAX_METRIC_UPLOAD_ATTEMPTS` | 6 | `db.rs:24` | |
| `MAX_METRICS_PER_ENVELOPE` | 1000 | `observability/mod.rs:9` | |
| bash history | 30 d | `bash_history_db.rs:9-10` | |
| checkpoint debug log | 14 d | `orchestrator.rs:286` | |

The three checkpoint budgets are user-overridable via env or `~/.git-ai/config.json` (`config.rs:1200-1224`).
**No cap on any individual metric event field** — commit body, authorship note, hunks JSON and raw transcript JSON are stored at full length.

---

## 7. Captured, but not what "attribution tool" implies

The 16 items that make this a telemetry system rather than a line-attribution tool:

1. **Full raw agent transcript records, verbatim** — event 5 pos 0: prompts, assistant responses, tool inputs/outputs, thinking blocks. Only a heuristic redactor, which **skips** id/metadata-shaped keys (`transcript_redaction.rs:4-53`). 365-day local retention.
2. **Full OTEL spans** lifted from Copilot's own SQLite and re-uploaded wholesale.
3. **Full commit subject and body** — literal text, not hashes.
4. **The entire authorship note duplicated into telemetry** — every prompt record, model, human identity and line-range map, as one string, on top of already being in git notes.
5. **Per-hunk line-range map** with `file_path`, `start_line`, `end_line`, `content_hash`, `prompt_id`, `session_id`, `human_id`.
6. **`git patch-id --stable` per commit** — a content fingerprint that follows a change across rebases and **across repositories**.
7. **Full bash command text** executed by agents, with invoking cwd, resolved repo, ns timings, session + tool-use ids. 30 days.
8. **Verbatim full file contents on disk** — every checkpointed file up to 3 MiB, uncompressed, in `<git-dir>/ai/working_logs/<sha>/blobs/`. Includes uncommitted and **never-committed** states.
9. **Attribution-recovery metadata blobs** (event 4 pos 10) — includes raw `unknown_lines`, filesystem mtimes, **the selected bash command text**, **absolute local filesystem paths** (`selected_bash_original_cwd`), and **`commit_author_name`/`commit_author_email`** (`attribution_recovery.rs:369-384,484-499,589-597`).
10. **Raw agent hook input** written unredacted to a local log when `checkpoint_debug_log` is on, plus full `CheckpointRequest`s carrying **full source file bodies**. 14 d, no size cap.
11. **Full prompt/message payloads in the legacy internal DB** — `prompts.messages`, no retention policy.
12. **Arbitrary `custom_attributes`** injected into every event — an uncontrolled free-text channel.
13. **A stable machine identifier** — persistent UUIDv4.
14. **Human identity in three places** — `attrs.author`, `HumanRecord.author`, and recovery metadata's author name/email.
15. **Cloud-pulled session bodies** if `analyze sessions` is used — `text`, `tool_input`, `tool_output`, `summary` into a local SQLite.
16. **Fallback DBs in `$TMPDIR`** on init failure — same fields, no retention, world-adjacent path.

> `data-privacy.md:5` says OSS mode sends "no code, prompts, or agent usage data". That is about **upload**. All 16 items above are persisted **locally** regardless of login state; auth gates only the uploaded subset.
