---
record_kind: "retro"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-01T03:10:33.936Z"
agent: "agent"
plan_id: "047-session-telemetry-dashboard"
schema_version: "1.1"
retro_id: "2026-07-01T03:10:00Z-agent-047p2"
started_at: "2026-07-01T02:47:39.775Z"
ended_at: "2026-07-01T03:10:00Z"
summary: "Plan 047 Phase 2 (Reports, Rollups & Render) post-coding drain — 1 entry: the bash-command-signature magic-wand, already routed to tracked fix FX001."
entries:
  - id: MW-001
    kind: magic-wand
    description: "bash_command argv granularity: commandSignatures() already extracts privacy-safe first-token+verb (rg foo->rg, git commit->git commit) and all 3 adapters call it per-command — but they DISCARD every non-harness signature, keeping only harness verbs. So a saved SessionExport can't tell rg from git (only tools:bash count). The wished-for 'where did 1M tokens go on rg' is ~90% built; the fix is to KEEP the discarded signatures in the event stream."
    target: harness-itself
    severity: annoying
    workaround: "Phase 2 keys bash_command by tool name + declares the limitation in report.attribution (honest ceiling of the current substrate)."
    suggested_encoding: "Keep the non-harness commandSignatures in the event stream (add signature? to ToolsEvent + serialize allowlist; key shell bursts by (name,signature); adapters attach the kept sig); then report keys bash_command by signature-when-present. Tracked as FX001."
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/047-session-telemetry-dashboard/fixes/FX001-capture-bash-command-signature.md"
        source: agent-self
        first_seen_at: "2026-07-01T02:47:39.775Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — Plan 047 Phase 2 (Reports, Rollups & Render)

One entry drained at the Phase-2 post-coding seam:

- **MW-001** (magic-wand, this session) — the bash-command-signature discovery: the privacy-safe `commandSignatures()` extraction is ~90% built (it already runs per-command in all 3 adapters) but every **non-harness** signature is discarded, so a saved `SessionExport` can't distinguish `rg` from `git`. Surfaced during the Phase-2 cross-model build when the coder correctly designed `bash_command` around the missing argv. Already **routed to a tracked fix** — `FX001` (registered in the plan's `## Fixes`), sequenced after Phase 2 per the principal's "finish P2 first, then capture" call. Status `suggested`, `resolved_by` → the FX001 dossier; flips to `encoded` when FX001 lands.

`target: harness-itself` and this **is** the harness repo, so the encoding route is a local source edit (FX001), not an upstream issue.
