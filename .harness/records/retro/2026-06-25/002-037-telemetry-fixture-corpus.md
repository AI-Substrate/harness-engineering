---
record_kind: "retro"
harness_version: "0.6.0"
branch: "037-telemetry-fixture-corpus"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-06-25T09:48:46.817Z"
agent: "agent"
plan_id: "037-telemetry-fixture-corpus"
schema_version: "1.1"
retro_id: "2026-06-25T09:48:46Z-agent-copilotcli"
started_at: "2026-06-25T08:06:11.780Z"
ended_at: "2026-06-25T09:48:46Z"
summary: "copilot-cli telemetry-fixture surface (Phase 2, T001-T004) landed and committed; 5 observations captured during the build. INS-001/INS-002/DL-001 are forward-looking and steer T005-T011."
entries:
  - id: INS-001
    kind: insight
    description: "Cursor's on-disk transcript is untimed, so cursor events serialize with t_precision:'anchored' (NOT exact like claude's per-line stamps). Phase-2 T011's golden/invariants must assert 'anchored' — mirroring the same AC-01 mis-derivation that bit claude in Phase 1."
    target: tooling
    suggested_encoding: "Add an adapter-timestamp-precision note to the fixtures README so each surface's expected t_precision is documented up front."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T08:06:11.780Z"
  - id: GFT-001
    kind: gift
    description: "Phase-1's byte-scan auto-globs any new fixtures/real/<surface>/<instance>/ dir AND is already artifact-kind-aware (plain-text single-backslash vs JSON doubled). So copilot-cli's plain-text raw.process.log is privacy-scanned for free in Phase 2 — the F003 fix paid forward."
    target: project-sensor
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T08:06:12.042Z"
  - id: INS-002
    kind: insight
    description: "Fixture selection is load-bearing: a self-referential/meta session trips the strict byte-scan with zero real leaks, and the home-derived username misses git handles (manual review caught 'jakkaj'). Phase-2 copilot-cli + cursor captures must pick substantive non-meta convos and pass --names."
    target: tooling
    severity: annoying
    workaround: "Profile candidate sessions; pass git handles + display names via --names at capture."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T08:06:12.289Z"
  - id: DL-001
    kind: difficulty
    description: "Extension VerbContext (services/extensions/contract.ts) exposes fs/fsWrite/exec/env/clock but NO db port, and ctx.fs has no stat/mtime. Plan 037 assumed the run() root injects NodeDb. Resolution: compose the core NodeDb adapter directly at run() for copilot-vscode/cursor capture (node:* stays inside the sanctioned core adapter, not the extension source); copilot-cli session selection must use explicit --session/env (no mtime auto-pick)."
    target: tooling
    severity: degrading
    workaround: "Import core NodeDb at the extension composition root; require --session for copilot-cli capture."
    suggested_encoding: "Consider adding an optional ctx.db DbPort to the extension contract so capture verbs don't reach into core adapters."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T08:18:51.549Z"
  - id: INS-003
    kind: insight
    description: "copilot-cli process-*.log files are per-PROCESS verbose debug logs (lines up to 28KB, embedded payloads), each hosting one-or-more sessions; the adapter reads ONLY assistant_usage JSON objects filtered by inner session_id. Committing one verbatim is huge + leaks other sessions. Fixture must capture events.jsonl verbatim + ONLY this session's assistant_usage records (filtered). Reuse a session already on refs/harness-telemetry/* (b67cd3ce) so the live-produced segment cross-checks the golden."
    target: tooling
    suggested_encoding: "Document in the runbook: copilot-cli capture filters the process log to the session's assistant_usage records; never commit a raw process-*.log."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T08:29:35.885Z"
---

# Retro — copilot-cli surface (plan 037, Phase 2, T001–T004)

Drained at the `post-coding` seam after the copilot-cli telemetry-fixture surface
landed and committed (2ac6b5f, ec6daa2, 97fd60e). Five observations captured during
the build; INS-001, INS-002, and DL-001 are forward-looking and steer T005–T011.
