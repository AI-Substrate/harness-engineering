# packet-coder — s092 ddocs pin bump (single-coder, no PM)

role: coder · branch s092/ddocs-bump · worktree: THIS one · prime: pij-massive-meadowlark
Rituals: government/how-we-work.md on the prime-governance branch — ack-before-code
(numbered), /builder 60-implement SIMPLE MODE (no tasks dossier exists; do not invent
one), receipts-or-not-done, dogfood flowspace3 (misses are findings; ask answers are
LEADS — verify in source).

## Mission
Bump @ai-substrate/dd from a37a20ec to de01b77a (dd main; dajeil-confirmed safe) and
migrate this repo across the breaking changes. Producer's own change list (measured,
worst first) — trust it as a MAP, verify each in OUR tree:
 a) bin rename dd→ddocs (9b8cc8e), HARD break: node_modules/.bin/dd is GONE.
    27 files reference .bin/dd (skills/builder/**, docs/how/**, .harness/**) — sweep
    ALL to node_modules/.bin/ddocs. Deliberate upstream reason: `dd` collides with
    POSIX dd(1).
 b) DdGraphNode is now a UNION (DdDocumentNode | DdFileNode): .sha/.schema reads off
    graph nodes stop compiling until narrowed on the discriminant. Check
    acts/plan/index.ts:645-890 .sha reads — some may be non-graph types; classify
    before touching.
 c) graph edges gained kind; ddocs build output gained file_findings — additive; check
    any output-shape assertions.
 d) validate: absent tally cells no longer report mismatches — E463 count assertions
    move if we have them.
 f) exports frozen: ./plan NOT exported. Pre-verified absent here; assert in your ack.

## Steps
1. Numbered ack to prime FIRST (include: your classification plan for (b), and
   confirmation you found the .bin/dd count yourself rather than trusting mine).
2. package.json pin → github:AI-Substrate/dd#de01b77a67d0... (full sha via
   git -C /Users/jordanknight/substrate/dd rev-parse origin/main), npm ci.
3. RED expected: tsc/tests break per (b)/(d). Capture it — that IS the red.
4. Migrate; sweep (a); rerun `npm run build` + full suite + `just fix`.
5. Receipts: commands + tails, before/after grep counts for (a) (denominator!), the
   compile-break list for (b) and how each was narrowed.

## Forbidden
government/** · the-flow files · pushes · merges · main checkout · any edit outside
this worktree · touching harness/cli/src/services/settings or convo (live sibling
packet s091 — fence line; if your migration NEEDS to touch those, stop-and-ask).
