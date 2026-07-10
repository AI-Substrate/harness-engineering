---
schema_version: "1.0"
retro_id: "2026-07-10T03:34:49.000Z-agent-057p2"
agent: agent
plan_id: 057-flow-token-efficiency
started_at: "2026-07-09T02:37:48.016Z"
ended_at: "2026-07-10T03:34:49.000Z"
summary: "retro --drain 057 P1+P2 combined save (9 entries; user: save all, route 6 to FX001 fix dossier)"
entries:
  - id: DL-001
    bucket: agent
    kind: difficulty
    description: "Telemetry per-stage token attribution is schema-true but capture-false: the 056 baseline session carries only 2 FlowEvents (both phase-1), so flow_stage reports collapse to unlabeled \u2014 the builder flow never emits stage-transition marks during a real run"
    target: "telemetry"
    first_seen_at: "2026-07-10T01:47:38.387Z"
    system:
      compound:
        status: encoded
        resolved_by: "cbc2d836 (057 P1 read-side flow_log stage lens)"
  - id: CONF-001
    bucket: agent
    kind: confusion
    description: "npm run check:docs prints diff-looking output yet exits 0 pre-commit in some invocations \u2014 the green/red signal is ambiguous unless you probe git diff --exit-code directly; a clearer verdict line would prevent false confidence"
    target: "tooling"
    first_seen_at: "2026-07-10T02:42:59.609Z"
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/057-flow-token-efficiency/fixes/FX001-flow-friction-fixes.md (FX001-1)"
  - id: DL-002
    bucket: agent
    kind: difficulty
    description: "npx vitest run from repo ROOT sweeps scratch/evals/** artifact tests (11 files needing Chromium) and reports failures that look like product breaks; only just test (harness/cli-scoped) is the canonical gate \u2014 a root vitest config exclude for scratch/ would kill the trap"
    target: "tooling"
    first_seen_at: "2026-07-10T02:42:59.795Z"
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/057-flow-token-efficiency/fixes/FX001-flow-friction-fixes.md (FX001-2)"
  - id: DL-003
    bucket: agent
    kind: difficulty
    description: "harness doctor --json returns ~12KB (every extension's full description) when the boot question is just healthy/degraded \u2014 a summary/--quiet form would save ~12KB per boot check"
    first_seen_at: "2026-07-10T03:02:04.168Z"
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/057-flow-token-efficiency/fixes/FX001-flow-friction-fixes.md (FX001-3)"
  - id: CONF-002
    bucket: agent
    kind: confusion
    description: "The worker packet named just flow-pair-test/typecheck/lint recipes, but this repo exposes just test/checks; equivalents required recipe discovery."
    severity: "annoying"
    suggested_encoding: "Generate packet self-check commands from the target repo's discovered just recipes or use harness checks."
    first_seen_at: "2026-07-10T03:22:19.490Z"
    system:
      compound:
        status: suggested
        resolved_by: "flow-pair prompt-lab candidate learn-0001 (upstream pij repo)"
  - id: CONF-003
    bucket: agent
    kind: confusion
    description: "flow-pair worker packet template names just recipes (flow-pair-test/typecheck/lint) that don't exist in the target repo \u2014 coder had to rediscover the authoritative gates (CONF-002); packet template should instruct recipe discovery or take the repo's gates as input"
    first_seen_at: "2026-07-10T03:28:25.655Z"
    system:
      compound:
        status: suggested
        resolved_by: "flow-pair prompt-lab candidate learn-0001 (upstream pij repo)"
  - id: DL-004
    bucket: agent
    kind: difficulty
    description: "builder 00-routing \u00a7 Model-to-task cites rules-of-why via a repo-relative path that dangles when the skill is installed to ~/.claude*/skills \u2014 installed-copy link hygiene has no guard"
    first_seen_at: "2026-07-10T03:28:25.840Z"
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/057-flow-token-efficiency/fixes/FX001-flow-friction-fixes.md (FX001-4)"
  - id: DL-005
    bucket: agent
    kind: difficulty
    description: "flow render --quiet still echoes the full rendered markdown in the ok envelope (~3.5KB/call) \u2014 quiet gates only runMutation's summary; render's payload is the single biggest flow-verb emission left"
    first_seen_at: "2026-07-10T03:29:57.107Z"
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/057-flow-token-efficiency/fixes/FX001-flow-friction-fixes.md (FX001-5)"
  - id: DL-001
    bucket: flow-pair-orchestrator
    kind: difficulty
    description: "Governance doc (.harness/engineering-harness.md) and skill references say 'cd harness/cli && npx vitest' but harness/cli/ has no package.json \u2014 the CLI source layout moved; package.json + build/test scripts are at repo root, and 'just build' is the build+global-relink deploy. Stale doc misled the rebuild step."
    target: "doc"
    severity: "annoying"
    suggested_encoding: "update engineering-harness.md boot/interact paths to the current root layout; or add a docs-drift check that greps governance for dead paths"
    first_seen_at: "2026-07-09T02:37:48.016Z"
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/057-flow-token-efficiency/fixes/FX001-flow-friction-fixes.md (FX001-6)"
system:
  compound:
    bubble_action: "all-save"
---
