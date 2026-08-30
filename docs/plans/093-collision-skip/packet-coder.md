# packet-coder — s093 extension/core name-collision must not brick the CLI

role: coder · branch s093/collision-skip · worktree: THIS one · prime: pij-massive-meadowlark
Rituals: government/how-we-work.md (prime-governance branch) — numbered ack before
code, /builder 60-implement SIMPLE MODE (no dossier; do not invent one),
receipts-or-not-done, fs3 dogfood (misses are findings; ask answers are leads).

## The defect, LIVE REPRODUCTION AVAILABLE
A repo extension registering a name that collides with a core verb aborts the
ENTIRE CLI: commander throws on the duplicate add, so every verb dies — including
`harness doctor`, which means the tool cannot diagnose its own failure, with an
E100 message naming NEITHER registration. Reproduced today in
/Users/jordanknight/substrate/flowspace/flowspace3 (their .harness/extensions/convo/
vs our new core `convo` verb from #185). They are renaming theirs; OUR defect is
the failure mode. Do not test against their repo — build a fixture repo.

## Required behaviour (frozen)
- Core verbs WIN. A colliding extension is SKIPPED, never loaded, never fatal.
- The skip is LOUD where diagnostics live: doctor/extension-loading surface reports
  a degraded row naming BOTH sides — the core verb and the extension DIRECTORY
  path that lost. An absence observed must name what was inspected.
- Every other extension still loads; every core verb still works.
- Two extensions colliding with EACH OTHER: same policy, first-loaded wins,
  loser skipped-and-named (check current order determinism; if load order is
  nondeterministic, say so in receipts — do not quietly make it deterministic).

## Done-bar
RED first: a fixture repo extension named after a core verb currently kills the
CLI — capture that. GREEN: CLI serves all verbs, skip reported. Mutation: remove
the skip → RED returns. Refusal case per the law: the degraded row must have been
SEEN failing. Full suite + just fix in this worktree. Receipts with tails.

## Forbidden
government/** · the-flow files · push · merge · main checkout · other worktrees ·
flowspace3's repo (read-only reference at most).
