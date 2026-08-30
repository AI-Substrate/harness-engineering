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
3. **Builder discipline by invocation** — coders load /builder and follow the
   implement stage explicitly (RED → GREEN → production-path mutation → receipts);
   plans for CODE go through /builder planning; close-out uses /builder
   post-flight. The packet cites the discipline; the seat follows the maintained
   stage doc, never a re-derivation from packet prose. (Jordan, 2026-08-30.)
   SCOPING (coral, 2026-08-30, standing in every coder brief): for packet-shaped
   plans, follow 60-implement.md in SIMPLE MODE — domain mode OFF, no tasks
   dossier exists and none may be INVENTED (invented compliance is the dangerous
   failure), no dd state verbs, no `harness plan validate`; what DOES apply:
   the testing discipline, an execution log under the plan's assets/, the
   discoveries table, the step-5 output contract. A seat pulled toward creating
   a missing artifact stops-and-asks — that is the doc outrunning the packet.
4. **Receipts-or-not-done** — exact commands + tails; mutation-checked tests (the
   fix's test fails without the fix — stated, not assumed).
5. **Canary-before-trust** — identity echo (id/cwd/model) before a fresh spawn's
   first real message is trusted. NOTE: a spawned seat INHERITS THE SPAWNER'S CWD
   (coral, 2026-08-30) — and the FIX IS MECHANICAL, not a warning: spawn as
   `cd <target-worktree> && pij spawn ...` (the pane takes the spawning shell's
   cwd; there is no --cwd flag and none is needed). The canary still PROVES it.

   THE PINNED SPAWN FORM (paste verbatim, never paraphrase — a packet saying
   'per settings' instead of the literal command is a recorded scar):
   ```
   cd <target-worktree> && pij spawn --harness pi --bin omp \
     --model github-copilot/gpt-5.6-sol-fast-1m --effort high \
     --layout window --plan-id <plan> --task "<brief>"
   ```
   --bin omp is MANDATORY for any -1m selector; --layout window still needs an
   explicit rename after spawn (window indexes get reused). omp seats are
   pij-native at boot: never `pij adopt`/`inbox register`, no wait loops. — identity echo (id/cwd/model) before a fresh spawn's
   first real message is trusted.
6. **Worktree-per-packet**, cut from current origin/main. Prime merges, never
   coders; on API collision the later-lander adapts.
7. **Teardown**: before any tidy — `git -C <wt> status --short` + sweep dossier
   paths (scratch/, assets/), copy live material out, THEN tidy.
8. **Named windows** — every spawned worker is moved to its own well-named tmux
   window immediately at spawn (`tmux break-pane -s <pane> -n <role-plan-topic>`);
   a worker pane never lives inside the prime's window. (Jordan, 2026-08-30.)
9. **Dogfood flowspace3** — every seat (prime, PM, coders, reviewers) uses
   fs3 as a working tool: `flowspace3 search "<meaning-shaped question>"` before
   grep where meaning beats text, `ask` for assembled answers (budget ~1min),
   `--source conversation` for the why behind past decisions. Every miss,
   substitution, or confusing envelope is REPORTED (to prime → lynx), not shrugged
   at — misses are worth more than hits. (Jordan, 2026-08-30, standing.)
10. **Status cards** at unit edges (`pij report now`); parked states declared, not
   refreshed.

## The packet's law (091's real finding — coral, five instances in one packet)

**Dispatch is not delivery; exit 0 is not evidence.** A thing REQUESTED is not a
thing DONE, at every layer: a RED that fails for an assertion (not a missing
module) · a green never seen failing proves nothing · a pane footer shows the
CONFIGURED value, not the running one · a status may only say "fired", never
"delivered", when delivery was not observed · a ping that proves "the process
ran" has not proved "the daemon answered". Whenever a surface reports success,
ask WHICH claim it actually proves; name statuses for the claim proved, not the
claim wished for.

## Single-writer

`government/**` is prime-writable only. A settings/ruling want from any other seat
is a MESSAGE to prime, never an edit. Every packet fence enumerates government/**
as forbidden paths.
