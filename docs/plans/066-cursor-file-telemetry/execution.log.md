# Execution log — plan 066 (retrospective, verbatim journey)

Session: 2026-08-04, Claude Code seat `pij-respectable-clam` (session
`ac636c44…`), directed live by Jordan. This log records what actually
happened, in order, including the detours — it is the posterity record the
plan summarizes.

## 1. The preamble — mission, seat, prime

- Jordan's brief: act as a **telemetry documentation agent** — how telemetry
  works here, how to pull it from git "in a nice way" for 1–n members over a
  date range, what reporting exists, and above all the **file-write /
  lines-written feature enabling human-vs-agent attribution**. Test against
  the deterministic-documents work. Process: `/pij ready` first, then ask the
  o-prime.
- Seat adopted (`pij adopt` → verified via `whoami` + `phonehome (bound)`).
- Asked the o-prime (`pij-massive-meadowlark`) about the deterministic
  documents branch. Its corrections shaped everything after:
  - Telemetry does **not** live on branches — `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session-uuid>`,
    date-partitioned by session start; 91 refs at the time (+2 epoch-junk to exclude).
  - "Telemetry from a branch" really means "refs whose **sessions** did that
    branch's work" — join by session id (`pij sessions`), anchor by
    `product_commit`.
  - Segment token fields are **CUMULATIVE** per window — `max_by(.window.to)`,
    never sum.
  - Read-only is safe; `harness telemetry sync` PUSHES; two open defects
    (synchronous post-commit sync; load-dependent per-invocation cost).
  - `docs/how/measuring-ai-contribution.md` (PR #83) already documents the
    attribution method — build on it, don't re-derive.

## 2. Research + method validation on the existing corpus

- Full docs/code sweep (docs/how/telemetry*.md, `harness/cli/src/services/telemetry/`,
  plans 034/037/049/052/054/056/060/063). Key confirmation: plan 056 shipped
  the `file` event (path, written|edited, `{lines_added, lines_removed,
  bytes_added, bytes_removed}`) for claude + copilot-cli adapters;
  **cursor and copilot-vscode emit zero file events** (AC-07 honest null);
  the git join exists only as a method doc — grep-confirmed no tool implements it.
- Implemented the join as a scratch script and ran it over the s065 branch:
  446 file events across 15 August refs; 50 of 86 commits parent-anchored;
  **aggregate agent share 67.4 % raw / 37.6 % clamped**. Method works; the
  raw/clamped gap previews the anchoring lesson in §6.

## 3. The test rig (cursor-test worktree)

- Prime provisioned `harness-engineering-worktrees/cursor-test` (branch
  `cursor-test` off main @ ad4882a0) at Jordan's request; `npm install` built
  the CLI; the post-commit telemetry hook was already live via repo-shared
  `core.hooksPath=.githooks` — so ref-pushing happens "the auto way", nothing
  to wire.
- **CURSOR-PROMPT.md** authored into the worktree: a realistic feature task
  (build `demo/textstat/` — lib, tests, CLI, fixtures, README) with the
  telemetry-critical rhythm expressed as plain engineering discipline:
  *"before EVERY commit … run `harness checks`"* — because capture anchors
  file events to the `product_commit` observed when a harness verb runs, and
  that must be the commit's PARENT. The prompt never mentions telemetry.
- **Human-edit rig** (`scratch/human-edit.py`): simulates Jordan's own edits.
  Insight: adapters read agent transcripts, never the filesystem — a plain
  script's edits are indistinguishable from a human typing. The one leak is
  env: the post-commit hook inherits the committing process's env, so the
  script scrubs the harness-detection chain (`COPILOT_AGENT_SESSION_ID`,
  `CURSOR_CONVERSATION_ID`, `CLAUDE_CODE_SESSION_ID`, `AI_AGENT`, + prefixes)
  at import time. Proven from inside the Claude session (worst case): 9 vars
  scrubbed, subprocess probe CLEAN. Subcommands: `check` / `seed` / `edit` /
  `commit -m … [paths]` (paths added mid-run so a human commit can't sweep in
  the agent's uncommitted work).

## 4. The live Cursor run

- Jordan ran the prompt in cursor-agent. It behaved exactly as designed:
  oriented via `harness doctor`/`instructions`/`boot`, built the toolkit in 4
  conventional commits, ran tests, used the repo's lean-ctx wrapper throughout.
- Human line interleaved live: `seed` (HUMAN-NOTES.md + a hand-written
  fixture) + `edit` (appends to Cursor's README/lib/fixtures, left uncommitted
  to ride into a later mixed commit) + one scrubbed-env human commit
  (`9accd124`). The human commit's hook sync timed out at 2 min under load —
  prime's known synchronous-sync defect, exit ignored by design, commit fine.
- Auto-push verified: the session's ref appeared on origin
  (`refs/harness-telemetry/2026/08/03/1a501a09-…`) without anyone invoking
  telemetry commands.

## 5. Two discoveries in the captured data

- **The specimen**: the session transcript
  (`~/.cursor/projects/…/agent-transcripts/1a501a09-…/1a501a09-….jsonl`, 56
  lines) contained **9 `ApplyPatch` tool_use blocks whose `input` is the raw
  V4A patch string** (`*** Begin Patch` / `*** Add File:` / `*** Update
  File:` with `+`/`-` bodies) — the first Cursor file-edit ever observed in
  this repo's telemetry history. Every prior transcript, the fixture corpus,
  and the IDE bubble store (24 bubbles) were read-only sessions: Shell, Glob,
  Read, Skill only. `files: null` had been honest — and untested.
- **The capture stall**: the session's segment ref held ONE segment (from
  `harness doctor` at transcript line 2); the read-cursor never advanced
  despite `boot`, `instructions`, and 5 post-commit hook syncs. Controlled
  repro — same transcript copied under a fake conversation id, `harness
  doctor` with cursor env — captured the full 56-line window instantly and
  correctly (tools counted `ApplyPatch: 9`; `files: None` pre-fix). So the
  stall is live-session/load-specific, matching prime's open load-dependent
  defect. Reported to prime as an anomaly, per its standing request. The
  stalled window had a silver lining: the 54 unread lines (all 9 ApplyPatch
  calls) remained unconsumed, harvestable post-fix.

## 6. The fix

- `parseApplyPatchDeltas` exported from the copilot adapter (identical
  grammar, plan-056 lineage) and wired into the cursor adapter's tool loop;
  `written`/`edited` path lists populated; event-stream gate widened to emit
  when file events exist even with no bubble timeline; `HarnessContext.capturedAt`
  added and threaded from the capture core (one line) so untimed events carry
  `t_precision: 'interval'` — the schema's existing precision level, used for
  the first time, saying exactly what is true: "within this capture window".
- Validation: fake-session replay → all 9 file events with correct per-file
  deltas and confined paths. `npx vitest run test/services/telemetry` → 88
  files / **1316 tests green**. Committed on `cursor-test` (`bf7f5502`) with
  normal agent env — deliberately, so the commit's own telemetry became part
  of the corpus (a third harness: claude-code, alongside cursor + human).

## 7. The all-zeros table — anchoring made visceral

The attribution join over `cursor-test` returned agent=0 for every commit.
Correct, and diagnostic:

- Cursor's rows are zero because of the **capture stall** (§5) — its edits
  were never captured (yet).
- The Claude adapter-fix commit's row is zero because **post-commit hook
  capture anchors at the NEW head**: the session's file events landed on
  `bf7f5502` itself (manifest `product_commits: [bf7f5502]`), so they credit
  the *next* commit. The cure is the verb-between-edit-and-commit rhythm the
  CURSOR-PROMPT already teaches; the durable cure candidate is a
  **pre-commit capture hook** (deterministic anchoring, zero model
  responsibility) — logged as a follow-up decision.

## 8. Retro flow + branch (this dossier)

- Jordan directed: get the fix onto a main-targeted branch and create this
  retroactive flow record — full journey, no forward-plan ceremony.
- `feat/066-cursor-file-telemetry` cut from origin/main (ad4882a0), the fix
  cherry-picked (`51856350`), this dossier committed alongside. Next streams
  noted in the plan: fixture + unit tests + doc drift for landing;
  copilot-vscode same-pattern fix (Jordan generating the specimen with the
  same prompt); `store.db` protobuf investigation for headless models +
  timestamps.

## Numbers at a glance

| Probe | Result |
|---|---|
| s065 aggregate agent share (claude sessions, pre-existing capture) | 67.4 % raw / 37.6 % clamped over 30,261 git lines |
| Cursor specimen | 56-line transcript, 9 ApplyPatch calls, 6 files written + 2 edited |
| Replay capture post-fix | 9 file events, e.g. lib.mjs +72 lines / 1,809 bytes |
| Telemetry test suite | 1316/1316 green |
| Corpus growth during the session | 91 → 94 refs on origin, all auto-pushed by hooks |
