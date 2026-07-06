---
record_kind: "retro"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-02T03:20:39.475Z"
agent: agent
plan_id: 046-flow-eval-loop
schema_version: "1.1"
retro_id: "2026-07-02T03:20:39Z-agent-046p1"
started_at: "2026-07-01T05:14:12Z"
ended_at: "2026-07-02T03:20:39Z"
summary: "Drain at the 046 P1 phase seam during the flow-pair fleet run (coder copilot/opus-4.8, reviewer copilot/gpt-5.5). Three carried-over FX002/FX003-session frictions + two P1 coder findings."
entries:
  - id: DL-001
    kind: difficulty
    description: "flow-pair control-plane compact is unreliable on idle copilot peers: 'pij send <id> /compact' delivered but never executed on pij-1ih6gj9, so the coder carried a saturated P2+P3 context into Phase 3 and stalled mid-write, forcing a full close+fresh-spawn heal cycle. A deterministic 'compact executed:true' confirmation (or a copilot-native compact path) would prevent the saturated-context stall."
    target: tooling
    severity: degrading
    workaround: "close + fresh-spawn the peer (on-disk progress preserved)"
    suggested_encoding: "pij: deterministic compact-executed confirmation, or a copilot-native compact path"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-01T05:14:12.145Z"
  - id: MW-001
    kind: magic-wand
    description: "Telemetry argv fidelity (extends FX001): capture UNQUOTED skill/command params (flag names like --json, bare enums/positionals) while dropping QUOTED free-form strings — BUT the naive quoted/unquoted split leaks '--token abc123'/'--password hunter2' (unquoted AND sensitive). Safe rule: keep flag NAMES + short bare enums, drop flag VALUES, quoted strings, path-like, and high-entropy tokens. Needs its own P12 decision; flow stages already come from nav-derived FlowEvent, not arg-parsing."
    target: project
    suggested_encoding: "a P12-reviewed argv-capture rule in the telemetry adapters"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-01T05:14:12.727Z"
  - id: DL-002
    kind: difficulty
    description: "FX001 Facet B (skill leading-digit capture) is proven in unit/e2e fixtures (reviewer verified /the-flow 08->08 with mutation) and the dist emits harness.skill.arg — but it is UNCONFIRMED on a LIVE user-typed slash command: a live /the-flow 7 did not surface a skill.arg in the captured segments (only harness.skill.name + skill.status appear). The live transcript's representation of a user-typed slash-command's args may differ from the adapter fixture path, OR skill events lag a flush cycle behind bash events. Needs a flushed digit-bearing live invocation to confirm the fixture path == the live path."
    target: project
    severity: degrading
    workaround: "none yet — flow_stage labels read 'unlabeled' on live guided sessions"
    suggested_encoding: "one flushed digit-bearing live /the-flow invocation, then compare captured segments to the fixture path"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-01T07:15:09.850Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: ".harness/extensions/** is covered by neither biome nor any tsconfig — extension type-safety rests on vitest/esbuild type-stripping; needs a small extensions tsconfig + biome include"
    target: infra
    workaround: "P1 coder hand-ran tsc --noEmit over the extension"
    suggested_encoding: "extensions tsconfig + biome include, wired into harness checks"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-01T23:33:44.297Z"
  - id: CONF-001
    kind: confusion
    description: "flow-pair skill text tells workers to run 'harness checks --quick' but no --quick flag exists on the CLI — worker had to guess; fix skill text or add the flag"
    target: skill
    workaround: "coder ran full harness checks (strictly stronger)"
    suggested_encoding: "fix ~/.claude/skills/flow-pair (user-global) or add a --quick flag to harness checks"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-01T23:33:44.941Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — 046-flow-eval-loop P1 fleet seam

Drained during the flow-pair fleet run (orchestrator pij-4s10mb; coder copilot/claude-opus-4.8; reviewer copilot/gpt-5.5). DL-001/MW-001/DL-002 carried over from the FX002/FX003 session; SUGG-001/CONF-001 surfaced by the P1 coder's deviations report.
