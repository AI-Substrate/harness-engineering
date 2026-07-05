---
schema_version: "1.1"
retro_id: "2026-07-05T07:40:00Z-claude-opus-052followons"
agent: "claude-opus"
plan_id: "052-fleet-telemetry-lane-sources"
started_at: "2026-07-05T04:00:00Z"
ended_at: "2026-07-05T07:40:00Z"
summary: "Post-052 follow-ons, all live-verified: SUGG-001 (roster ledger join survives pij close) shipped 7c4a7fe3 + proven on a real torn-down fleet (3/3 measured); apply_patch capture gap fixed fbb0f6cb + proven on live copilot v1.0.69 (files written/edited captured). Two pij-lane bugs surfaced and root-caused by pij-z4bt25 (send-wedge workaround, BUSY_RE bind-promotion one-liner)."
entries:
  - id: DL-001
    kind: difficulty
    description: "pij send transport to copilot peers: fresh copilot peers swallow every send (task + pings) via the focus-OUT submit-wedge (pij#3) — only daemon-injected boot runs. Blocks fleet delegation until worked around."
    target: infra
    severity: blocking
    workaround: "wedge send: tmux send-keys -l <text>; send-keys -H 1b 5b 49 (focus-IN); send-keys Enter; verify pane went Working. Helper: scratchpad/wsend.sh"
    suggested_encoding: "pij-side fix (pij-z4bt25, pij#3); meanwhile encode wsend into a flow-pair send helper"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-05T07:00:00Z"
  - id: DL-002
    kind: difficulty
    description: "F-07 gap: copilot v1.0.69 writes files via the apply_patch tool (arguments is a raw patch STRING; path in *** Add/Update/Delete File: headers), which the create/edit capture missed → files:null → copilot worker lanes artifact-blind in practice."
    target: tooling
    severity: degrading
    workaround: "none — fixed at source"
    suggested_encoding: "copilot adapter parses apply_patch headers"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-05T07:15:00Z"
        resolved_by: "fbb0f6cb (2026-07-05) — parseApplyPatchPaths(); Add→written, Update/Delete→edited, multi-file; real-shape test; live-verified files{written,edited} captured."
  - id: WIN-001
    kind: win
    description: "Both 052 follow-ons live-verified on real copilot sessions, not just unit tests: SUGG-001 recovered a torn-down fleet 3/3 measured; apply_patch fix captured written+edited on a live v1.0.69 peer (same segment that showed files:null pre-fix)."
    target: project
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-05T07:35:00Z"
  - id: COORD-001
    kind: coordination
    description: "pij-z4bt25 root-caused both pij-lane bugs: (1) send-wedge = copilot focus-OUT swallows Enter (pij#3, workaround proven); (2) bind never promotes harnessSessionId because BUSY_RE (readiness.ts:61) doesn't match this copilot's 'Working … esc interrupt' footer (loop.ts:300 firstInferenceSeen gate). One-line fix 'esc (?:to )?interrupt' pending a daemon restart."
    target: infra
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-05T07:30:00Z"
---

# Retro — 052 follow-ons + live validation (2026-07-05)

Two probe-peer `harness observe` calls (INS-001 "reviewed probe phase-1", INS-002 "apply_patch probe")
landed in this repo's shared observe buffer — they are TEST ARTIFACTS from the spawned peers, not
real session friction; drained here for completeness only.

**Shipped + pushed** (PR 49): SUGG-001 `7c4a7fe3`, its live proof `5c4b81bc`, apply_patch `fbb0f6cb`.
**Next** (post-compact): design the `harness telemetry mark` verb — peer self-attestation (see memory
[[harness-telemetry-mark-verb-next]]).
