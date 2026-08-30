# How we work — harness-engineering fleet operating manual

<!-- JORDAN'S PREAMBLE — directive; he edits this section himself -->
(awaiting Jordan's preamble)
<!-- END PREAMBLE -->

## The shape (adopted from fs3 pij-team, plan 091, 2026-08-30)

- **Prime** (o-prime, this repo: pij-massive-meadowlark) — product owner. Talks to
  Jordan, writes plans + impl-guides, rules acks, merges. Does not orchestrate coders.
- **PM** — orchestrates a multi-unit plan per its impl-guide; codes solo when no
  fan-out is warranted. Earns its overhead only on genuinely parallel units.
- **Coders** — one unit each, in isolation, behind seams frozen in the impl-guide.
- **Reviewer** — cross-model, after composition, read-only, fed only artifacts.
- Models/harness per role: `government/settings.dd.json` (single-writer: prime).

## The rituals (law, not guidance)

1. **Ack-before-code** — a numbered plan back before any spawn/edit; a restatement
   with "will proceed" gets ruled back.
2. **Verify-then-relay** — cite the command and its output; a worker's measurement
   outranks the brief. [INFERENCE] is quarantined until someone opens the cited file.
3. **Receipts-or-not-done** — exact commands + tails; mutation-checked tests (the
   fix's test fails without the fix — stated, not assumed).
4. **Canary-before-trust** — identity echo (id/cwd/model) before a fresh spawn's
   first real message is trusted.
5. **Worktree-per-packet**, cut from current origin/main. Prime merges, never
   coders; on API collision the later-lander adapts.
6. **Teardown**: before any tidy — `git -C <wt> status --short` + sweep dossier
   paths (scratch/, assets/), copy live material out, THEN tidy.
7. **Status cards** at unit edges (`pij report now`); parked states declared, not
   refreshed.

## Single-writer

`government/**` is prime-writable only. A settings/ruling want from any other seat
is a MESSAGE to prime, never an edit. Every packet fence enumerates government/**
as forbidden paths.
