---
record_kind: "retro"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-02T05:16:33.823Z"
agent: agent
plan_id: 046-flow-eval-loop
schema_version: "1.1"
retro_id: "2026-07-02T05:16:33Z-agent-046dogfood1"
started_at: "2026-07-02T04:03:00Z"
ended_at: "2026-07-02T05:16:33Z"
summary: "Drain after dogfood run-1 (task 4.3: codex/gpt-5.5 blind subject on md-to-pdf, runs 20260702-041431Z + corrected re-score 20260702-044948Z) and the 4.5 fix round (commit a33e3b5b). Seven observations: two already ENCODED by 4.5, one partially encoded, four open follow-ups. This drain is the capture half of task 4.4."
entries:
  - id: DL-001
    kind: difficulty
    description: "Codex harness has NO telemetry correlation — 0 segments, telemetry.available=false, so the ENTIRE process axis (A1-A5, A9, A10) resolved unknown on dogfood run-1. Capability axis measured fine via the fs lane. Codex needs a session-id/transcript correlation adapter (analogue of COPILOT_AGENT_SESSION_ID) or codex subjects stay capability-only evals."
    target: project
    severity: degrading
    workaround: "accepted honest unknowns; ledger recorded process:null correctly"
    suggested_encoding: "a codex telemetry correlation adapter (session id → rollout transcript), sized as its own plan follow-up"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-02T04:16:54.536Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "flow-eval score stamped RunRecord.subject/base_ref from scenario.json defaults, not the actual run: the codex/gpt-5.5 run was recorded as claude/opus/high with base_ref v0.6.0 while the worktree branched from e27e4c69 — a wrong seed tuple that would mis-bucket --compare."
    target: project
    workaround: "run-1 re-scored with the new overrides → truthful record 20260702-044948Z-asw2rn"
    suggested_encoding: "DONE in 4.5 (commit a33e3b5b): --subject-harness/--subject-model/--subject-effort/--base-ref, lock-step into RunRecord+seed_tuple+header, plus a visible worktree-HEAD≠base_ref warning. Remaining slice OPEN: auto-detect subject from the pij session instead of manual flags."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T04:16:55.184Z"
  - id: SUGG-002
    kind: improvement-suggestion
    description: "report.md rendered 'process 0.00' when axis_scores.process was null (all-unknown axis) — 0.00 reads as 'failed every process check'; ledger.jsonl was honest (null)."
    target: project
    workaround: "read the ledger, not the report header"
    suggested_encoding: "DONE in 4.5 (commit a33e3b5b): axisCell renders 'unmeasured' for an unscorable axis; measured zero still 0.00; mutation-proven both directions."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T04:16:55.819Z"
  - id: CONF-001
    kind: confusion
    description: "Judged fill happens AFTER report.md is rendered and nothing re-rendered it: report.json carried the filled A11 PARTIAL verdict while report.md said '_pending_' forever."
    target: project
    workaround: "none needed post-fix"
    suggested_encoding: "DONE in 4.5 (commit a33e3b5b): `flow-eval render --scenario <slug> --run <id>` regenerates report.md from report.json (write-set exactly [report.md]); score next_action points at it."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T04:16:56.449Z"
  - id: INS-001
    kind: insight
    description: "A blind packet cannot carry base.ref pinning (scenario said v0.6.0; the subject branched from current HEAD), and a fully autonomous subject never pauses for orchestrator cadence nudges — so the Simple-planning and compact-before-implement choreography (A2/A5) was both unenforceable and unobservable in one run. Scenario design fork: orchestrator pre-creates the worktree at the pinned ref (task-scope, not method leakage), or base_ref comparability stays aspirational."
    target: plan
    suggested_encoding: "orchestrator.md step-0: pre-create the subject worktree at base.ref and hand the subject its path (still blind to method); revisit whether A2/A5 belong in an autonomous-subject scenario"
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-07-02T04:16:57.074Z"
  - id: SUGG-003
    kind: improvement-suggestion
    description: "Runbook step-7 (resolve A7/A8) edits the COMMITTED scenario assertions.json in place — dirtied a shared fixture and broke the core e2e test that scripts the placeholder tokens (2 full-suite failures until reverted)."
    target: project
    workaround: "reverted assertions.json after archiving the run (reports/ledger preserve the resolved commands)"
    suggested_encoding: "per-run assertion resolution: score reads an overlay from the run dir (or --resolve A7='<cmd>' flags); live-testing/scenarios/ stays immutable per run"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-02T04:45:32.503Z"
  - id: SUGG-004
    kind: improvement-suggestion
    description: "Append-only ledger now holds run-1 twice: the mis-stamped original (claude/opus, 20260702-041431Z) and the corrected re-score (codex/gpt-5.5, 20260702-044948Z). A --compare including opus would ingest the bogus line."
    target: project
    workaround: "none — both lines stand; comparisons must currently be read with this in mind"
    suggested_encoding: "supersede/tombstone convention: re-score writes superseded_by into a NEW annotation line (append-only preserved) and --compare excludes superseded records"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-02T04:50:31.381Z"
---

# Retro — 046 dogfood run-1 drain (task 4.4 capture)

Drained after the first real eval run (codex/gpt-5.5 blind subject, md→PDF) and its same-day fix round (task 4.5, commit a33e3b5b, cross-model reviewed). Three of seven findings were encoded within the hour the dogfood surfaced them — the loop closing on itself. Open follow-ups, by leverage: codex telemetry adapter (DL-001) > per-run assertion overlay (SUGG-003) > ledger supersede (SUGG-004) > worktree pre-creation (INS-001).
