# packet-pm — plan 091 proving packet (settings machinery + convo sync)

role: pm · seat: (assigned at spawn) · model: github-copilot/claude-opus-5 medium
branch: s091/ways-of-working · worktree: harness-engineering-worktrees/s091-ways-of-working
tenets: pij-team TENETS.md · rituals: government/how-we-work.md (prime-governance branch)

## Mission
Deliver plan 091 phase 2 per impl-guide.md (BESIDE THIS FILE — read it first):
U1 services/settings (pure resolver + loader), U2 services/convo (port + fake),
U3 wiring (act + commit seam + boot drain). Waves: U1 alone, then U2+U3.

## Current state, falsifiable
- Branch cut from origin/main @ 197540ee; only docs/plans/091-* is new on it.
- NO settings machinery exists anywhere in harness/cli/src (grep schema_version
  in services/ to confirm — config/load-config.ts is the VERB REGISTRY, not this).
- flowspace3 end is live: `flowspace3 conversation ingest --harness claude
  --session <id> --folder <path>`; verify with --help yourself, never from this packet.
- The hook payload's transcript_path is NEVER journalled (hook-payload.ts:60) —
  that contract binds every error path you write.

## Fan-out decision — yours, bounded
U1 must land before U2/U3 (frozen port). One coder serially, or one coder U1 then
a second for U2+U3 — your call in the numbered ack. A third seat is over-cut.
Coder config: github-copilot/gpt-5.6-sol-fast-1m --effort high (NEVER :high suffix).

## Done-bar (mechanical, from impl-guide)
vitest green in the worktree · just fix clean · receipts (commands + tails) ·
mutation-checked · U1 refusal tests REFUSE (governance-key-in-local, malformed,
unknown major) · U2/U3 smoke proves the INCREMENTAL contract: two fires against a
grown session; run 2 ingests ONLY new turns, same conversation identity.

## Forbidden
government/** (message prime instead) · .the-flow-state.json, the-flow.json,
the-flow.md · main checkout's working tree · any git push · merging (prime merges)
· starting/stopping the fs3 daemon · writing ~/.config/flowspace3/** · testing
against :7373 (sandbox via `flowspace3 daemon --sandbox` + --daemon-url; if your
harness SIGTERMs the sandbox the minted DB leaks — drop it by hand).

## Protocol
Numbered ack BEFORE any spawn/edit (units, order, seats+models, risks,
stop-and-ask points). Product questions → prime (pij-massive-meadowlark).
Report at unit edges. Receipts or it is not done.
