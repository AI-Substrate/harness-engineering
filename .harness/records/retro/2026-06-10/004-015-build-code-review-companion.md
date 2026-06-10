---
schema_version: "1.0"
retro_id: "2026-06-10T03:26:00Z-code-review-companion-6236"
agent: code-review-companion
plan_id: null
started_at: "2026-06-10T02:44:41Z"
ended_at: "2026-06-10T03:26:00Z"
summary: "Companion farewell (minihToUniversal mapping) — 015 observe-retro-merge Build, run 2026-06-10T12-44-41-380Z-6236. Reviewed T001-T011 + final range sweep; 3 findings (F002 addressed in-session; F001 HIGH + F003 fixed post-stop in 21bdfcc); verdict at farewell: REQUEST_CHANGES, both opens now closed."
entries:
  - id: GFT-001
    kind: gift
    description: "The coordination inbox made commit-boundary review straightforward: each task carried a focused hazard list, and ackOf links let findings and summaries point back to the exact review request."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
  - id: CONF-001
    kind: confusion
    description: "The prompt said to cd $MINIH_PROJECT_ROOT, but that variable resolved to the run folder rather than the repository root in this session. The final stop also mentioned ff310da after the last final-range review request covered b57d7b1, leaving one stop-mentioned commit outside the reviewed range."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
  - id: MW-001
    kind: magic-wand
    description: "Add a coordination stop guard that compares outside lastReviewedSha with the stop commit and warns or requires an explicit reviewedThrough field before control:stop completes."
    target: coordination
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
  - id: DL-001
    kind: difficulty
    description: "MINIH_PROJECT_ROOT resolved to the run folder instead of the repository root, contradicting the companion prompt's first instruction."
    target: config
    severity: degrading
    workaround: "Used the repository root from the session context for all project-relative file and git operations."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
  - id: DL-002
    kind: difficulty
    description: "The stop message cited commit ff310da after the final review request and final summary had covered b57d7b1, with no separate review request for ff310da before stop."
    target: coordination
    severity: annoying
    workaround: "Recorded the reviewed-through boundary in the report and did not start new review work after control:stop, per stop-wins protocol."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
  - id: DL-003
    kind: difficulty
    description: "A broad grep for retired-skill references hit generated docs/run material and produced oversized output."
    target: debug
    severity: annoying
    workaround: "Narrowed subsequent searches to live surfaces and capped output with rg/view ranges."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
  - id: COORD-001
    kind: coordination
    description: "peerUpdatesSent: 15; unresolvedPeerRequests: 0; statePublished: true. All incoming tasks and stop were acknowledged; the unread inbox was empty before writing the report."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:26:00Z"
system:
  compound:
    bubble_action: "companion-farewell-harvest"
  minih:
    run_dir: "agents/code-review-companion/runs/2026-06-10T12-44-41-380Z-6236"
---

# Companion farewell — 015 Build (code-review-companion)

Findings reconciliation (orchestrator dispositions):

| Finding | Severity | Disposition |
|---|---|---|
| F001 — `--clear` destroyed deviant blocks that `--list` skipped, contradicting D3 | HIGH | **ADDRESSED** in `21bdfcc`: parseBuffer returns raw deviant chunks; clear writes them back, removing only valid entries; tests + skill + docs/how aligned |
| F002 — list/clear landed before their RED tests; FakeFs.readdir blind to mkdirp'd buckets | MEDIUM | **ADDRESSED in-session** at `e4a943a` (acknowledged by the companion as addressed) |
| F003 — "self-heals on every use" overclaim across briefing/docs/setup | MEDIUM | **ADDRESSED** in `21bdfcc`: wording narrowed to the implemented contract (capture + record heal; list/clear read/rewrite) on doctor next_action, briefing, docs/how; setup's D8 line already scoped to "the CLI self-heals" without per-call claims |
| MH-002 — `ff310da` (and later `21bdfcc`) outside the reviewed range | — | **ACCEPTED**: ff310da was docs/bookkeeping only; 21bdfcc is the post-stop findings fix, self-verified by the pinned tests (374/374) — the stop-guard magic wand (seconded in the orchestrator retro) would close this gap properly |
