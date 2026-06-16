---
record_kind: "retro"
harness_version: "0.3.0"
branch: "020-harness-bypass-change-records"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-06-16T07:45:55.913Z"
agent: "claude-code"
plan_id: "020-harness-bypass-change-records"
schema_version: "1.1"
retro_id: "2026-06-16T07:45:55Z-claude-code-p3dr"
started_at: "2026-06-16T07:17:00Z"
ended_at: "2026-06-16T07:45:00Z"
summary: "Plan 020 Phase 3 — retired .harness/history.md (migrated the one row into a harness-change record, deleted the file, added a grep-guard, swept 7 docs). Implemented with a live code-review-companion (0 findings). Phase-end drain of the observe buffer: one difficulty captured live this phase (git add vs an already-git-rm'd path) plus one stale prior-session insight (kernel formatError drops top-level data on the error path) carried forward from 2026-06-11."
entries:
  - id: DL-001
    kind: difficulty
    description: "git add chokes on an already-git-rm'd path: passing a deleted file (.harness/history.md) to 'git add -- <paths>' alongside new files raised a fatal that aborted the WHOLE add, so the new files never staged and the path-scoped commit failed too. A repo carrying pre-staged deletions (here: 93 presentation deletions) makes this sharp — explicit-pathspec commits are mandatory."
    target: tooling
    severity: degrading
    workaround: "Exclude the deleted path from 'git add'; stage only the modified/new files, then include the deleted path solely in 'git commit -F <msg> -- <pathspec>' (which commits the staged deletion without re-add)."
    suggested_encoding: "A short note in the implement-stage commit guidance (or a 'just commit-scoped <paths>' helper) for path-scoped commits when the index carries unrelated pre-staged deletions: never pass a deleted path to 'git add'; let 'git commit -- <pathspec>' carry it."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-16T07:34:08Z"
  - id: INS-001
    kind: insight
    description: "Kernel formatError drops a verb's top-level data on the error path (verb-context finalize → formatError has no data slot). arch-check's error branch returns data.violations believing it survives — it doesn't; skills-check routes findings via error.details instead. Consider a data slot on the error envelope, or fix arch-check's claim to route via error.details."
    target: tooling
    suggested_encoding: "Add a data slot to the error envelope so verbs can return structured findings on the error path, OR change arch-check to surface violations via error.details (matching skills-check). Either way, add a kernel test asserting top-level data survives formatError."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-11T01:35:16Z"
---

# Retro — Plan 020 Phase 3 (remove history.md) drain

Phase 3 retired `.harness/history.md`; the `harness-change` record ledger is the changelog now. The phase itself was clean (638 tests green, companion 0 findings). The drain carries forward two friction signals:

- **DL-001 (difficulty, this phase)** — the `git add` / already-`git rm`'d-path interaction. Worth a small encoding so future phase work in a pre-staged-deletions tree doesn't re-hit it. Dogfooded into the observe buffer the moment it happened (the discipline Phase 2 missed).
- **INS-001 (insight, carried from 2026-06-11)** — a real kernel error-envelope gap (top-level `data` dropped on the error path). Not in this plan's scope, but preserved here so it isn't lost; a candidate for a future harness improvement.

Both remain `open` (not yet encoded) — surfaced for a later Improve beat, not actioned now.
