---
record_kind: "retro"
harness_version: "0.13.0"
branch: "s065/deterministic-documents"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-08-04T17:05:00Z"
agent: agent
plan_id: 071-dd-native-builder
schema_version: "1.2"
retro_id: "2026-08-05T03:05Z-agent-p3drain"
started_at: "2026-08-04T12:21:24.764Z"
ended_at: "2026-08-05T03:05:00Z"
summary: "retro --drain phase-3 boundary save (4 entries, bucket agent)"
entries:
  - id: DL-001
    kind: difficulty
    description: "stage-5 step-1 has no verb to birth a phase task file into an EXISTING plan — plan new scaffolds whole plans only, so a JIT phase boundary hand-authors the file + dd build (phase-2 and phase-3 both hit this). Candidate: harness plan add-phase or dd new --schema builder/plan"
    fp: "21ea47624d69"
    disposition: task
    resolved_by: "follow-up: harness plan add-phase / dd new --schema — no verb births a phase file into an existing plan"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T12:21:24.764Z"
  - id: DL-002
    kind: difficulty
    description: "flow-eval scorer: fs-lane assertions (file-created/file-content-matches/command-succeeds globs) matched the 14 INHERITED plan.dd.json corpora shipped in base rather than subject work — A2/A4/A5/A6 false-positive PASSED while the subject authored zero dd documents. Assertions need new-since-base scoping (git status filter) or the runbook's separate-inherited step must be mechanical, not manual."
    fp: "e1faebf3a7b6"
    disposition: task
    resolved_by: "encoded in-scenario (runbook new-since-base note) + prime ledger: assertions must be falsifiable against inherited corpora"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T16:09:38.873Z"
  - id: DL-003
    kind: difficulty
    description: "flow-eval scorer: telemetry lane joined 0 segments for the spawned subject (telemetry.available=false) even though the worktree buffer synced 7 segments incl. its plan — either the pre-score sync FLUSHED the buffer the scorer reads, or the session join key mismatched. Order-of-operations (sync vs score) needs pinning in the runbook; A1/A7/A8/A10 all unknown this run."
    fp: "da3964b93e5b"
    disposition: fixed-now
    resolved_by: "runbook order pinned SCORE->sync->snapshot->close in 3fc4cd5f; root proven (join key existed, buffer flushed pre-score)"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-08-04T16:09:39.274Z"
  - id: DL-004
    kind: difficulty
    description: "eval run1 headline: the blind subject never SAW the dd-native builder — /builder resolved to the ~/.agents deployed copy dated Jul 15 (pre-dd), worktree has no project-level builder skill. The scenario's base-ref pin covers CLI code but NOT the skill surface; evals of branch-built skills must pin skills too (project .claude/skills in the worktree, or deploy-before-run). Same deploy-lag class as check:doctrine-parity."
    fp: "5264861fbcee"
    disposition: task
    resolved_by: "prime-ledgered (owner koala, trigger next eval definition): eval base pins BOTH axes — CLI ref AND skill-surface provenance"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T16:09:39.689Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 071 phase-3 boundary drain (agent bucket)
