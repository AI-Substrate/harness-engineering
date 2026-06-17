---
record_kind: "retro"
harness_version: "0.4.0"
branch: "022-eng-harness-skill-consolidation"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-06-17T07:19:31.167Z"
agent: claude-opus-4-8
plan_id: "022-eng-harness-skill-consolidation"
schema_version: "1.1"
retro_id: "2026-06-17T07:19:31Z-claude-opus-4-8-022c"
started_at: "2026-06-17T06:15:38Z"
ended_at: "2026-06-17T07:19:31Z"
summary: "Implement phase of plan 022 (eng-harness skill consolidation, 7 skills → 2: the eng-harness-flow router + the harnessability-assessment peer; 5 verbs became harness-blind modules) run with a live code-review companion. Public hook/event/--hooks/--json contract preserved byte-for-byte; structural proof (L1 de-leak, contract parity, destination-map) and behavioural drive all passed; 2-skill surface deployed globally with the 5 retired slugs pruned. The companion caught 4 real MEDIUM catalog/contract leaks across the run (all fixed). Friction below."
entries:
  - id: DL-001
    kind: difficulty
    description: "zsh does not word-split unquoted vars: a for-loop over a space-joined path string (and a command held in a string var) ran ONCE on the whole string. A destructive prune loop silently pruned nothing while printing a success-looking skip line — a dangerous false-green that recurred twice in one session (the prune, then an observe-write helper)."
    target: tooling
    severity: degrading
    workaround: "Use explicit zsh arrays for path/command lists; call the binary directly rather than via a string var."
    suggested_encoding: "A scratch-shell convention note (or a lint guard) that destructive sweep/prune loops must iterate an array, never an unquoted string var, under zsh."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-17T07:00:00Z"
  - id: DL-002
    kind: difficulty
    description: "The consolidation broke this repo's own dogfood wiring: .minih.json still points minih at the deleted skills/eng-harness-setup and -loop sources plus the 7 retired slugs, so a fresh `minih run code-review-companion` failed with E211 (could not resolve requested skills). The original companion was unaffected only because it booted before the T008 delete."
    target: minih
    severity: degrading
    workaround: "Booted the companion with --no-skills (a code reviewer needs no harness skills loaded), sidestepping the broken wiring without editing the out-of-scope file."
    suggested_encoding: "A skill rename/delete should also update .minih.json (or a doctor check that every .minih.json skill source path + requested slug still resolves). Tracked as the deferred dogfood + CLI slug realignment follow-up."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-17T07:05:00Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "A catalog 'sweep' that greps a hand-listed file set for slug TOKENS misses prose/metadata drift (e.g. 'all seven', 'setup and loop groups', a docs-manifest summary string). The companion caught two such leaks the scoped grep missed."
    target: skill
    suggested_encoding: "A consolidation/sweep step should grep ALL bundled doc sources (the docs-manifest sourcePaths) plus prose patterns (group/count language), not a manually enumerated file list."
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-17T07:18:00Z"
  - id: WIN-001
    kind: win
    description: "The restarted live code-review companion caught 4 real MEDIUM catalog/contract-drift leaks across T002–T009 (verbatim-claim precision, getting-started overstatement, docs-manifest summary, adoption-checklist 'all seven') that the author's own greps missed — concrete validation that --companion mode earns its cost on a docs-heavy refactor."
    target: skill
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-17T07:15:00Z"
---

# Retro — Plan 022 eng-harness skill consolidation (implement phase, with companion)

The contract-preservation invariant held (all four machine surfaces byte-identical; verified twice). The two genuinely encode-worthy difficulties are infrastructural, not in the consolidation itself: the **zsh word-split false-green** (DL-001, a destructive-loop trap that bit twice) and the **`.minih.json` dogfood drift** (DL-002, the repo's own minih wiring breaks when skills are renamed/deleted — already on the deferred follow-up). SUGG-001 captures the process lesson the companion's catches taught: sweep by bundled-source + prose, not a hand file list. WIN-001 records that the companion paid for itself.
