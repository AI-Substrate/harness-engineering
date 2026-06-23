---
record_kind: "retro"
harness_version: "0.5.0"
branch: "026-flow-nav-rail-zone"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-06-23T04:17:24.254Z"
agent: "github-copilot-cli"
plan_id: "033-flow-chore-anchoring"
schema_version: "1.1"
retro_id: "2026-06-23T04:17:00Z-github-copilot-cli-033f"
started_at: "2026-06-23T00:49:00Z"
ended_at: "2026-06-23T04:17:00Z"
summary: "Dogfooded the-flow + eng-harness-flow to plan, validate, condense, and IMPLEMENT plan 033 (anchor injected loop-chores -> deterministic checks). Shipped the CLI read (chores --at + nav show due_chores), the anchored eng-harness-flow injection recipe (hook->anchor map), docs, and the-flow's due-chore surfacing (cross-repo). 986 tests green. Re-created 033's own flight plan anchored as the exemplar."
entries:
  - id: DL-001
    kind: difficulty
    description: "eng-harness-flow AC-07 chore injection led with bare add-node, which creates ORPHAN chores (anchor:null, no edge, floating off the rail) - reproduced live on plan 033's own the-flow.json (all 4 hooks orphaned). No deterministic point to run them; agents miss them under context loss."
    target: skill
    severity: degrading
    workaround: "Re-injected with insert-node --branch-of to anchor; re-created 033's flight plan as the exemplar."
    suggested_encoding: "Rewrite the AC-07 'Not found -> add' path to LEAD with insert-node --branch-of <anchor> + a total hook->anchor map (DONE in plan 033)."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-23T01:33:23Z"
  - id: DL-002
    kind: difficulty
    description: "The backpressure verb resolves SPEC_FILE as docs/plans/<slug>/<slug>-spec.md, but the-flow now ships a UNIFIED plan doc (no separate -spec.md). The survey works against the plan's ## Business Specification, but the verb's documented resolution + template links assume a standalone spec file."
    target: skill
    severity: annoying
    workaround: "Pointed the survey at the unified plan doc's Business Specification."
    suggested_encoding: "Update backpressure.md SPEC_FILE resolution to accept the unified the-flow plan doc (read ## Business Specification when no -spec.md exists)."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-23T01:33:30Z"
  - id: INS-001
    kind: insight
    description: "harness flow rail interleaves orphan chores with the spine BY ZONE BAND, so disconnected chores render as if sequenced - the rail gives false 'they're wired' confidence while the mermaid graph shows them floating."
    target: doc
    suggested_encoding: "Anchored chores become off-rail branch_of excursions (no longer interleaved) - resolved by plan 033's anchoring; documented as DEF-02."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-23T01:33:35Z"
  - id: INS-002
    kind: insight
    description: "RENDER RICHNESS = flight-plan POPULATION (renderer is constant). Hand-authored legacy flows look rich (genesis bubbles, agents, notes, excursions); CLI-driven flows look lean. Two causes: (A) verb-surface gap - no flow agent verb so agents[]=0 always; (B) terse drive skips the genesis/notes/excursion mutations the cadence prescribes."
    target: harness-itself
    suggested_encoding: "See MW-001 - ship the agent verb + auto-capture."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-23T01:33:40Z"
  - id: MW-001
    kind: magic-wand
    description: "To make deterministic renders as rich as hand-authored ones without relying on drive discipline: (1) ship the v2 harness flow agent verb so companions populate agents[]; (2) auto-capture richness - seed a genesis bubble from nav.intent on create, auto-note on status->done, auto-attach a branch_of excursion when a workshop file lands."
    target: harness-itself
    suggested_encoding: "Add harness flow agent; add auto-capture hooks on create/status. Candidate follow-up plan."
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-23T01:33:45Z"
  - id: DL-003
    kind: difficulty
    description: "The chore-anchoring fix is FORWARD-ONLY: it fixes future injections + adds the read, but does NOT re-anchor chores already injected as orphans. And there's no in-place fix - set-node can't set branch_of (can't re-parent) and there's no remove-node verb - so an existing orphan can only be healed by RE-CREATING the whole flow. Consumers with already-orphaned chores won't auto-heal after adopting the fix."
    target: harness-itself
    severity: degrading
    workaround: "Re-created 033's flight plan to heal its own orphans."
    suggested_encoding: "Add harness flow set-node --branch-of <anchor> (allow re-parent w/ DAG recheck) OR a harness flow reanchor-chores remediation verb."
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-23T04:16:00Z"
---

# Retro — plan 033 flow-chore-anchoring (implement session)

Dogfooded the full the-flow + eng-harness-flow loop to deliver plan 033. Headlines:

- **DL-001 encoded** — the orphan-chore injection bug is fixed at the source (anchored recipe + hook->anchor map + CLI due-chore read). Proven by the T014 fixture + a live demo.
- **Three harness-product items open/suggested** — DL-002 (backpressure vs unified the-flow spec), MW-001 (richer renders: `flow agent` verb + auto-capture), DL-003 (orphan remediation: a re-parent / reanchor verb). Candidate follow-up plans.
- **INS-002 / render richness** — a render's richness is a proxy for capture quality; worth watching as a health signal.
