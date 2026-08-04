---
record_kind: "retro"
harness_version: "0.13.0"
branch: "s065/deterministic-documents"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-08-04T12:16:42.429Z"
agent: agent
plan_id: 071-dd-native-builder
schema_version: "1.2"
retro_id: "2026-08-04T12:18Z-agent-p2drain"
started_at: "2026-08-04T10:20:52.308Z"
ended_at: "2026-08-04T12:18:00Z"
summary: "retro --drain phase-2 boundary save (8 entries)"
entries:
  - id: DL-001
    kind: difficulty
    description: "070->071 rename: the-flow.json root title + provenance.plan_id have NO CLI setter (nav meta is the session bag; set-node is node-scoped). Hand-editing is forbidden, so the rename leaves plan_id=070/title stale until a root-meta verb exists — telemetry plan joins and provenance key off it. Candidate: root-meta setter early in phase 2 (flow wiring is in scope)."
    target: tooling
    severity: degrading
    suggested_encoding: "harness flow set-meta --title/--plan-id verb (root-scoped analogue of set-node)"
    fp: "48aad7e4974f"
    disposition: task
    resolved_by: "phase-3 candidate task — flow root-meta setter (prime carries the ledger row; trigger = first root-meta verb)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T10:20:52.308Z"
  - id: DL-002
    kind: difficulty
    description: "dd set/add both refuse to CREATE an absent section ('the document has no section done_when') — a schema-sanctioned optional section cannot be born through the writer verbs, so the evidence->done_when migration needed one python bypass for the section rename. The permissive-tail rule covers fields, not sections."
    target: tooling
    severity: degrading
    workaround: "one documented python bypass, validated by dd build immediately after"
    suggested_encoding: "dd add <file>#<new-section> creates a schema-defined section (validate-before-write as usual); or a dedicated dd mv for section/row renames"
    fp: "18b889094534"
    disposition: task
    resolved_by: "phase-3 candidate task — dd section-birth / dd mv"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T10:25:16.976Z"
  - id: DL-003
    kind: difficulty
    description: "dd address grammar cannot reach id-less list items (numeric segments refused: 'must start with a letter'), so prose fixes in goals[] / planning_seam[] rows needed a bypass. Same class as the section-birth gap: the writer surface stops where ids stop."
    target: tooling
    severity: degrading
    workaround: "minimal perl bypass for 2 prose fixes, validated by dd build"
    suggested_encoding: "index addressing (#goals/9) or auto-row-ids for plain lists"
    fp: "21922c2dcfc2"
    disposition: task
    resolved_by: "phase-3 candidate task — id-less row addressing"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T10:37:57.605Z"
  - id: INS-001
    kind: insight
    description: "Composition proof caught two defects no unit test could: harness plan new birthed task files at tasks/phase-N-<kebab>/ while the flight-plan template gate baked assets/tasks/phase-N/ (ac-7110 bare ordinal), and dd add --mint into a JIT-born map key birthed a bare item instead of a list. Both sides were green in isolation. A phase whose seams are authored separately needs a CLI-as-actor dry-run as its exit, not as a nice-to-have."
    target: plan
    fp: "415286900fb5"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T11:41:41.475Z"
  - id: DL-004
    kind: difficulty
    description: "A control can pass for the wrong reason and hide a defect: plan 070 pinned dd add JIT-birth by passing a whole array literal, which stored correctly by accident, so the natural one-item + --mint call was never exercised and shipped broken. When writing a planted-bad, also ask whether the GOOD twin exercises the shape a caller would actually use."
    target: tooling
    severity: degrading
    fp: "d9b33d104541"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T11:41:59.160Z"
  - id: COORD-001
    kind: coordination
    description: "Concurrent writers in one worktree are now routine (orchestrator edited docs/how/dd/README.md mid-run, and a git index.lock collision failed a telemetry test). Explicit-pathspec commits and measuring the baseline before attributing are what kept the report honest. A shared-worktree protocol note would help future peers."
    target: doc
    fp: "51cf6c43a799"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T11:42:05.679Z"
  - id: DL-005
    kind: difficulty
    description: "copilot CLI (tmux seats) discards injected input while the pane is unfocused: pij send / compact-self Enter never fires, message strands at the composer, /compact silently never runs. Remedy proven: inject focus-in ESC[I (tmux send-keys -H 1b 5b 49) before Enter. pij's typeLiteral/pressKey should do this for copilot panes."
    target: infra
    severity: blocking
    workaround: "manual tmux send-keys -H 1b 5b 49 then Enter after every send; verify the seat's RESPONSE, not text presence"
    suggested_encoding: "pij typeLiteral/pressKey emit focus-in ESC[I before keys when the target is a copilot pane"
    fp: "0ac928e6868e"
    disposition: task
    resolved_by: "upstream — pij repo (~/pi-hacking/pij), not this repo; relayed to Jordan in-session"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T12:08:26.168Z"
  - id: DL-006
    kind: difficulty
    description: "pij compact-self has no --help: unknown flags are treated as the keep-instruction and the pane defaults to $TMUX_PANE, so 'pij compact-self --help' types /compact+Enter into the CALLER'S own window before erroring — a probing invocation self-compacts the orchestrator"
    target: infra
    severity: degrading
    suggested_encoding: "compact-self recognizes -h/--help (print usage, never type into a pane); refuse unknown --flags as instruction text"
    fp: "cc05a635ae92"
    disposition: task
    resolved_by: "upstream — pij repo (~/pi-hacking/pij), not this repo; relayed to Jordan in-session"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T12:09:37.097Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 071 dd-native builder, phase-2 boundary drain

Eight entries drained at the phase-2/phase-3 boundary. Three (DL-001/002/003)
are dd/flow writer-surface gaps already queued as phase-3 candidate tasks.
Two (DL-005/006) are pij-platform defects outside this repo, relayed
upstream to Jordan in-session. INS-001 is the phase's headline insight: the
joint-exit dry-run (CLI-as-actor) caught the two cross-seam defects fixed in
7316d350 that neither side's unit tests could see.
