---
schema_version: "1.0"
retro_id: "2026-06-28T12:19:19Z-agent-039drain"
agent: agent
plan_id: 039-flow-reconcile-cli-trigger
started_at: "2026-06-25T10:29:36.451Z"
ended_at: "2026-06-28T12:19:19Z"
summary: "retro --drain session-end save (11 entries: 2 from plan 039 Phase 1 + 9 stranded plan-037 entries finally drained — the buffer-accumulation that 039's observe-chore exists to prevent)"
entries:
  - id: INS-001
    kind: insight
    description: "copilot-vscode/cursor fixture projections must mirror SQLite trim() (space-only), NOT JS trim() — JS strips tabs/newlines so whitespace-only turns drift from TURNS_SQL and break the real-SQL round-trip (companion F002, plan 037 P2)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T10:29:36.451Z"
  - id: DL-001
    kind: difficulty
    description: "code-review-companion inbox delivery to 'minih inbox list' flaked AGAIN this run (3rd time across plan 037); findings recoverable from runs/<id>/inbox/inside/messages.ndjson — read that file directly, don't trust the list surface"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T10:29:36.761Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "Capture-tool privacy gate: when 'promote' RE-CAPTURES (re-resolves live sources + re-scrubs) instead of copying the reviewed staging bytes, the binding manual review MUST be on the promoted/committed bytes — for appendable logs the staged and committed bytes can differ. Consider making the extension copy the reviewed scratch candidate so reviewed==committed. (plan 037 P3, companion F001 HIGH)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T11:12:24.259Z"
  - id: INS-002
    kind: insight
    description: "Drift-guard script shape: when per-fixture input construction (incl. a throwaway node:sqlite build) already lives in golden tests honoring REGEN_GOLDEN=1, the drift-guard should ORCHESTRATE those suites (gen=REGEN_GOLDEN, check=plain run) rather than re-import dist/ and fork the builders — the fork is the exact drift hazard the guard exists to prevent. (plan 037 P3 T001)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T11:12:24.600Z"
  - id: INS-003
    kind: insight
    description: "Review found real local identity (git handle / name / email / home path) committed in plan-037 tests, docs, and execution logs OUTSIDE the fixtures/real byte-scan boundary (F002). The privacy guard only scans the fixture bytes; the surrounding tracked artifacts that DESCRIBE the scrub leaked the very tokens being scrubbed. The scan boundary is narrower than the publication boundary."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T22:41:43.585Z"
  - id: SUGG-002
    kind: improvement-suggestion
    description: "A repo-wide identity-scrub/scan guard (not just fixtures/real) would catch a large pre-existing leak: the same real handle/name/home-path tokens persist in ~30 non-037 tracked files (plans 002-035, .minih.json, guides). Plan 037 only sanitized its own artifacts; the broader sweep is unowned."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T22:41:44.609Z"
  - id: COORD-001
    kind: coordination
    description: "A full-plan review flagged a HIGH (F003) in docs/retros/code-review-companion.md, but that file is a CONCURRENT session's uncommitted change in the shared tree — not part of this plan's diff. The review scans the whole working tree, so a plan-scoped review can surface findings the current plan cannot fix. Scoping review to the plan's own commit range would avoid cross-session false-attribution."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-25T22:41:45.635Z"
  - id: INS-004
    kind: insight
    description: "Test portability bug: fixture-privacy-scan derived banned-identity tokens from runtime $USER/$HOME and matched as SUBSTRINGS, so generic CI/container usernames collided with scrubbed-fixture prose — GitHub runs as 'runner' (8 substring hits), Docker as 'root' (12). Green on the author's machine ('jordanknight'), red on every other env. Lesson: never couple a test's banned-token set to the runtime machine identity; exclude generic system/CI users (root/runner/ubuntu/ci) or the suite is non-portable."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-26T00:32:26.554Z"
  - id: SUGG-003
    kind: improvement-suggestion
    description: "Making CI call the composite 'harness checks' instead of per-tool steps hid the failure cause: the composite captures each sub-gate's stdout, so a failing tests/biome gate showed only a generic note in CI. A composite CI gate MUST surface the failing sub-gate's output tail in its envelope, or every CI failure needs a local repro to diagnose. Fixed by extracting the vitest failure lines into the gate note."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-26T00:32:27.572Z"
  - id: INS-005
    kind: insight
    description: "Plan 039 Phase 1 start: reuse map — applyBatch/upsert/removeNode/mvNode build on materialize+dagIssue+predecessorsOf+the insertNode splice algebra (extract as applyPlacement). Renderer nodeClass keys chore-class on TYPE before the chore flag — the AC-11 bug; fix = reorder decision>chore>harness>status. writeFlowAtomic re-serializes as-is (no top-level modified_at), so byte-stable no-op = no events fired."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-28T11:39:55.820Z"
  - id: COORD-002
    kind: coordination
    description: "Phase 1 gate GREEN. Scope note for the report: I edited harness/cli/test/acts/flow.test.ts (inside harness/cli/ but outside the packet's listed allowed trio) — the AC-11 rail due-callout (⚑ due:) surfaces a cursor chore the pre-existing rail --chores collapse/hide test expected hidden; updated 2 assertions to check the name-lane body while affirming the due-callout (the --chores mode governs the name lane; the due-callout is a separate unconditional surface). Did NOT touch SKILL.md (orchestrator's concurrent T012 change visible in the shared tree)."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-28T12:01:24.779Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro drain — 039 session (incl. plan-037 backlog sweep)

Drained 2026-06-28T12:19:19Z during the 039 overnight orchestration. The 9 plan-037 entries (2026-06-25/26) had sat
un-harvested in the gitignored buffer across multiple sessions — direct evidence for 039's thesis that
without a structural observe→drain anchor, observations accumulate and rot. The 2 plan-039 entries
(INS-005 reuse-map, COORD-002 gate-green + scope-note) are this session's captures.
