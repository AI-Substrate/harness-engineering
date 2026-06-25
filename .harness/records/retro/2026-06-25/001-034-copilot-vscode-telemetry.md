---
record_kind: "retro"
harness_version: "0.6.0"
branch: "036-copilot-vscode-telemetry"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-06-25T02:57:53.922Z"
agent: agent
plan_id: "034-copilot-vscode-telemetry"
schema_version: "1.1"
retro_id: "2026-06-25T02:58:10Z-agent-cvsc6"
started_at: "2026-06-24T09:35:54.706Z"
ended_at: "2026-06-25T02:58:10Z"
summary: "Session-end drain before the Phase 6 PR — five entries from running real harness data through capture (plan 034 telemetry + copilot-vscode). The recurring theme: single-window fixtures gave false confidence; real per-session capture is the missing proof layer."
entries:
  - id: DL-001
    kind: difficulty
    target: project-sensor
    severity: degrading
    description: "Copilot command_exit (AC-19) is lost when a tool call's execution_start (command) and execution_complete (success) straddle a capture-window boundary — the adapter joins commandByCall x successByCall only WITHIN one ctx.window, so a straddled pair never emits and segment reassembly can't recover it (it's a derived join, not a raw event). Same straddle yields turn dur_s:0. Found only by running real copilot -p data; all fixtures put start+complete in one window."
    workaround: "none — best-effort; the outcome lands in no segment when straddled"
    suggested_encoding: "correlate command_exit/turn pairs across windows (persist partial-call state by toolCallId across captures) OR emit at the session-end tail flush; add a real-session adapter fixture that spans a window boundary"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-24T09:35:54.706Z"
  - id: INS-001
    kind: insight
    target: project-sensor
    description: "Adapter fixtures gave false confidence: claude/copilot/cursor v2 event tests all passed + the-flow stage-7 review APPROVED, yet running real copilot -p exposed the windowing-straddle that drops command_exit. Fixtures all put paired events in a single window; flow/checks events never fired on real Claude data either (plan-link/piped-output). Real per-harness session capture is the missing proof layer."
    suggested_encoding: "a 'real session smoke' per adapter: drive copilot -p (and a recorded cursor/claude transcript) through capture, assert event_stream+rollup+outcomes against the live source — multi-window, not single-window fixtures"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-24T09:35:54.910Z"
  - id: DL-002
    kind: difficulty
    target: tooling
    severity: degrading
    description: "vitest (esbuild) does not type-check: a tsc-only error (serializeEvent exhaustive-switch default returning the widened union) passed all 1264 vitest tests but broke 'just build'. I declared the phase green on the test suite before the real type gate ran."
    workaround: "ran just build manually at phase end and fixed the cast"
    suggested_encoding: "add a tsc --noEmit gate to 'harness checks' (or fold build into checks) so 'tests pass' cannot mask a type error"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-24T09:35:55.108Z"
  - id: DL-003
    kind: difficulty
    target: project-sensor
    severity: degrading
    description: "branch_changed is plumbed but dead: every adapter hardcodes branch_changed:null and capture-service coerces caps.branch_changed ?? false, so it is NEVER true even when the branch demonstrably switched mid-session. Branch-change detection is a git fact, not a per-harness transcript fact, so it was mis-delegated to adapters that can't know it."
    workaround: "none"
    suggested_encoding: "compute branch_changed in capture-service by persisting the last-seen branch beside the cursor watermark and comparing; emit a 'branch' event into the event_stream on change"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-24T09:35:55.300Z"
        resolved_by: "plan 034 Phase 5 — capture-service computes branch from git + emits a branch event; live copilot-vscode segments carry git-derived branch (036-copilot-vscode-telemetry)"
  - id: INS-002
    kind: insight
    description: "smoke-testing the vscode copilot telemetry adapter — drove real VS Code Copilot session 7fb3a97f through capture (AI_AGENT detection, cwd resolution, turn-anchored stream, tokens null, SQL-boundary privacy) end-to-end."
    suggested_encoding: "fold into the 'real session smoke' per-adapter idea (see INS-001)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T02:55:00.000Z"
---

# Retro — plan 034 telemetry + Copilot-VS-Code (Phase 6)

Session-end drain (`--drain`, keep-all) before the Phase 6 PR. Five entries: four `open` proof/tooling-sensor gaps surfaced by running **real** harness data through capture, plus one already **encoded** (`DL-003` branch_changed, fixed in Phase 5).

The recurring, highest-leverage theme — **single-window fixtures gave false confidence; real per-session capture is the missing proof layer** (INS-001) — wants a per-adapter "real session smoke". `DL-001` (command_exit window-straddle) is the same tail-capture boundary the copilot-vscode work hit live and documented; `DL-002` (vitest doesn't type-check) wants a `tsc --noEmit` gate in `harness checks`.
