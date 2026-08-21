# git-ai — what it pushes to a git ref, and what you can filter

**Question**: can git-ai push telemetry into a git ref, and can we filter what goes
to a remote for central dashboard tracking?

**Answer**: yes to the ref, but the payload is split across two channels and **only
the thin one is a git ref**.

---

## Channel A — `refs/notes/ai` (a real git ref, auto-pushed)

**Trigger**: the daemon observes your `git push` via trace2 and runs
`push_authorship_notes` as a side effect (`daemon.rs:1273-1305`). No git hook.

**Refspec**: `refs/notes/ai:refs/notes/ai` (`git/refs.rs:15`), **non-force**.
Push is a fetch-merge-push cycle with `PUSH_NOTES_MAX_ATTEMPTS = 3`, retrying the
whole cycle on non-fast-forward — explicitly because "on busy monorepos, concurrent
pushers can cause non-fast-forward rejections even after a successful merge"
(`sync_authorship.rs:327-377`).

**Skipped** when the push is `--dry-run`, `-d`/`--delete`, or `--mirror`
(`daemon.rs:1288-1297`), and entirely when the HTTP notes backend is active
(`sync_authorship.rs:336-339`).

**Pull side**: `git ai fetch-notes [--remote <r>] [--json]`
(`commands/fetch_notes.rs`) — fetches `+refs/notes/ai:refs/notes/ai-remote/<r>`
then merges into local `refs/notes/ai` (`sync_authorship.rs:378-400`).

So **a central dashboard off pure git is viable**: clone, `fetch-notes`, parse.
No server required.

### What is actually in the note

| Present | Absent |
|---|---|
| per-file line ranges per session key | tokens |
| `sessions{agent_id{tool,id,model}, human_author, custom_attributes}` | cost |
| `humans{h_*: {author}}` — name + email | prompts / transcripts |
| three-way AI / known-human / untracked | acceptance rate (needs checkpoint data) |
| `base_commit_sha`, `schema_version`, `git_ai_version` | session yield, timing, tool histograms |
| survives rewrites via note migration | |

The v3 spec is explicit that a `SessionRecord`
**"MUST NOT contain `messages`, `messages_url`, or stats fields
(`total_additions`, etc.)"**. Only the *legacy* `prompts{}` map carried
`total_additions` / `total_deletions` / `accepted_lines` / `overriden_lines`.

**Derivable from the ref alone**: % AI per commit / file / line, broken down by
tool, by model, and **by person**.
**Not derivable**: anything token-, cost-, prompt- or timing-shaped.

---

## Channel B — everything else is HTTP-only

The seven metric events (§02) — including raw transcripts, token counts and the
cost inputs — go over HTTP to `api_base_url` (default `https://usegitai.com`,
self-hostable via `api_base_url` + `api_key`), gated on login or API key.

**There is no git-ref path for any of it.** This is the structural difference from
harness, where the entire payload rides `refs/harness-telemetry/*`.

---

## What you can filter

| Control | Scope | Works? |
|---|---|---|
| `exclude_repositories` / `allow_repositories` | glob on **remote URL** | **Yes for the ref** — enforced at checkpoint CLI entry with `exit(0)` before any checkpoint is written (`git_ai_handlers.rs:507-524`), so no checkpoints → no note. **Partial on upload**: only filters `SessionEvent` (`telemetry_worker.rs:920-930`); `Committed`, `Checkpoint`, `OtelTrace`, `RewriteCommitted` bypass it |
| `.git-ai-ignore` at repo root | file / glob | **Yes** — loaded from HEAD or worktree (`ignore.rs:168-204`), stacked with `.gitignore`, default patterns and linguist-generated |
| `notes_backend.kind = "http"` + `backend_url` | whole channel | Redirects notes to **your own server instead of the ref**; the git push is then skipped entirely |
| `custom_attributes` | additive | Arbitrary k/v injected into every session record and every event |
| **Field-level filtering of note content** | — | **No.** You cannot strip `human_author`, model, or file paths from the note |
| `prompt_storage`, `default_prompt_storage`, `include/exclude_prompts_in_repositories` | — | **INERT.** Settable, displayed by `config show`, validated — and `effective_prompt_storage()` / `should_exclude_prompts()` have **zero production call sites**. A team setting these believing they protect a sensitive repo would be wrong |

---

## Two consequences worth weighing

1. **The note is in-repo and readable by anyone with repo access**, and carries
   `human_author` as name + email. **Per-person AI ratios become computable by any
   contractor, auditor or fork holder with read access.** git-ai documents this
   (`data-privacy.md:15-21`); it is a materially different exposure model from an
   out-of-tree ref namespace, and a plausible works-council problem in some
   jurisdictions.

2. **`refs/notes/ai` is a single shared ref with real merge semantics** — hence the
   fetch-merge-push-retry loop. The harness design of one ref per
   `<date>/<session>` has a single writer per ref and no merge problem at all. This
   is a genuine architectural advantage of the harness model that is easy to
   overlook.
