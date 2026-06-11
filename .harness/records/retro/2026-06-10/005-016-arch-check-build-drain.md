---
schema_version: "1.0"
retro_id: "2026-06-10T08:14:03Z-claude-code-016b"
agent: claude-code
plan_id: "016-arch-conformance-extension"
started_at: "2026-06-10T03:28:44.623Z"
ended_at: "2026-06-10T08:14:03Z"
summary: "Phase-seam drain at 016 arch-check build T012 (all-save) — 10 buffered improvement-suggestions spanning the 015 close, FX004-8 smoke harvest, and the 016 spec/roadmap sessions, plus 2 entries from the 016 build itself. SUGG-010 sanitized on materialisation: the gitignored buffer carried a private exemplar identifier; this committed record keeps only the scratch/ path reference (constitution P12)."
entries:
  - id: SUGG-001
    kind: improvement-suggestion
    description: "User note mid-015-close: .harness/extensions/validate-harness-flow checks should validate this whole flow deterministically — that the agent did the work, used records appropriately as guided by skills and built-in help text (drain materialized via record retro data.path, buffer cleared, retros committed, AC evidence present)"
    target: project-sensor
    suggested_encoding: "extend validate-harness-flow extension: assert records/retro entries exist for the plan window, buffer drained, exec-log AC table filled"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:28:44.623Z"
  - id: SUGG-002
    kind: improvement-suggestion
    description: "User direction for validate-harness-flow rework: the test over-briefs the worker — agents should get a goal + entry point and rely on the harness's built-in docs (instructions verb, help, doctor next_actions, installed skills) to find their way; the test is a proxy for new-user onboarding experience"
    target: project
    suggested_encoding: "tiered worker briefing (goal-only Tier 0) + extension-side deterministic grading of the clone instead of worker self-report booleans"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:39:04.252Z"
  - id: SUGG-003
    kind: improvement-suggestion
    description: "FX004-8 smoke (chalk): local-source dogfood install broke because npm ran the harness prepare script inside the consumer repo's dependency graph (older TS toolchain); worker worked around with an isolated build + --ignore-scripts. Worker magic wand: a single deterministic pack-artifact install command for local dogfood."
    target: project
    suggested_encoding: "INSTALL.md / setup skill: document a pack-based local install (npm pack outside the consumer, install the tarball), or ship a harness pack helper"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:19:54.182Z"
  - id: SUGG-004
    kind: improvement-suggestion
    description: "FX004-8 smoke (chalk): harness init returns a generic E108 root-parser error; setup docs promise a graceful init-unavailable fallback. Worker treated E108 as that fallback but flagged the mismatch (VF-002)."
    target: project
    suggested_encoding: "CLI: emit an init-specific unconfigured envelope with next_action until init ships, or align the setup skill's fallback wording with the real E108 shape"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:19:55.223Z"
  - id: SUGG-005
    kind: improvement-suggestion
    description: "FX004-8 smoke (chalk): skills-local probe FAILED for a principled reason — eng-harness-0-setup Step 4 is opt-in ('offer, never force; only with the user's explicit go-ahead'), so a headless onboarding agent can never produce a project-local skills install. Design tension between the clone-stands-alone requirement and the human-gated install step."
    target: project
    suggested_encoding: "Decide: an autonomous-context clause in setup Step 4, a worker param granting install consent, or revisit the probe expectation — user call"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:19:56.221Z"
  - id: SUGG-006
    kind: improvement-suggestion
    description: "FX004-8 smoke (chalk), minor pair: (a) harness instructions <verb> auto-switches to JSON when stdout is non-TTY, surprising for quick piped previews (worker VF-003); (b) observe examples with backticks inside double quotes get shell-executed — docs should prefer single quotes (worker VF-004/retro VF-003)."
    target: project
    suggested_encoding: "instructions: a --text override or doc note; observe docs: single-quote examples"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:19:57.252Z"
  - id: SUGG-007
    kind: improvement-suggestion
    description: "The agent briefing (harness instructions, the AGENTS START HERE doc) never mentions the skills or docs verbs - its self-briefing loop is help/doctor/instructions only, so an agent that obeys it literally never learns harness skills install or harness docs exist. Those affordances appear only in harness help safe_first_actions."
    target: harness/cli instructions briefing
    severity: degrading
    suggested_encoding: "Add one routing sentence to the agent briefing: skills install (self-aware --source default) for pulling the loop skills, and harness docs for the bundled offline docs."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:39:04.836Z"
  - id: SUGG-008
    kind: improvement-suggestion
    description: "The CLI bundles no getting-started doc: harness docs ships extend-the-harness, record-and-record-types, using-harness-docs, authoring-verbs, cli-readme - but nothing covering the new-repo bootstrap choreography (no harness yet? skills install, then drive eng-harness-0-setup: assess, boot, skills). That choreography lives only in the skills, which an agent only gets after the step the briefing never mentions - chicken-and-egg for a bare agent with CLI-only access and no product repo."
    target: harness/cli bundled docs
    severity: degrading
    suggested_encoding: "Bundle a getting-started doc id (harness docs getting-started) or fold a short bootstrap section into the agent briefing, so CLI-only agents can self-start without README/INSTALL.md access."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T05:39:15.528Z"
  - id: SUGG-009
    kind: improvement-suggestion
    description: "User roadmap note (016 Round 2): add a harness core capability to install extensions from other repos — the skills-install analogue for extensions. Becomes the distribution channel for exemplar extensions; chosen over shipping copy-paste starters in examples/extensions/."
    target: project
    system:
      compound:
        status: open
        source: user
        first_seen_at: "2026-06-10T06:58:49.227Z"
  - id: SUGG-010
    kind: improvement-suggestion
    description: "016 roadmap, from a private external deterministic-backpressure exemplar comparison (details stay in gitignored scratch/exampe-of-determistic-backpresure.md per constitution P12): future arch-check enhancements worth separate consideration — (a) 'arch-check explain <rule>' queryable rule contract (print a rule's comment/severity from the config, pairs with future --graph); (b) provenance in the envelope data (depcruise version + config checksum); (c) baseline/compare modes to diff two arch-check reports across a refactor; (d) positive-signal rules via dependency-cruiser 'required' rule type (assert services MUST reach adapters via ports, not just forbid)."
    target: project-sensor
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T07:14:49.984Z"
  - id: GFT-001
    kind: gift
    description: "016 build pattern worth reusing: generate unit-test fixtures from REAL tool output via seed→capture→revert (seed one violation, capture depcruise JSON under both the live warn config and a promoted-severity config, revert, verify tree clean) — fixtures stay pinned to reality instead of guessed shapes, and the one wrong test expectation (112 vs 113 deps) was caught BY the fixture being honest."
    target: project
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T08:14:03Z"
  - id: INS-001
    kind: insight
    description: "dependency-cruiser 17.4.3 exits 0 from --output-type json even with error-severity violations — any caller trusting the exit code has a silently-green sensor. Encoded same-session: parse-first design in the extension, malformed-fixture unit test, gotcha #3 in the how-guide + briefing."
    target: tooling
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-10T08:14:03Z"
        resolved_by: "963ac53 (parse-first tests) + f6b3752 (extension) + 6a0cbf1 (guide)"
system:
  compound:
    bubble_action: "all-save"
---

# Drain — 016 arch-check build seam (2026-06-10)

Phase-seam drain (T012) with the default all-save: the buffer had accumulated
ten improvement-suggestions across three sessions (015 close, FX004-8 smoke
harvest, 016 spec/roadmap) plus this build's own gift + insight. None were
encoded this build except INS-001 (the depcruise exit-code gotcha — encoded
as the parse-first design the moment it was measured). SUGG-001…010 remain
open for human triage; SUGG-009/SUGG-010 are the 016 roadmap items already
echoed in the plan's Clarifications and session notes.

**P12 note**: SUGG-010's buffer text carried a private exemplar identifier;
this committed record replaces it with the gitignored `scratch/` path
reference. The buffer itself is gitignored, so nothing private was ever
tracked.
