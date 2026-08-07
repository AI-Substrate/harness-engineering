/**
 * The managed `AGENTS.md` block EXACTLY as it shipped before plan 076, captured
 * from `5dae6e9c` — the bytes every already-adopted repo is carrying right now.
 *
 * It is a fixture, not a template: it promises exactly TWO outcomes and routes
 * every reader to `harness doctor telemetry-nudge`, which is why plan 075's
 * fourth commit branch made it wrong on Windows. Migration tests assert against
 * THESE bytes rather than a mutation of today's block, because "a repo in the
 * wild upgrades gracefully" is a claim about this text and no other.
 *
 * Never regenerate it from `commitGuidanceBlock()` — that would make the
 * migration test tautological, which is the failure mode plan 074's F011 named.
 */
export const PRE_075_BLOCK = `<!-- BEGIN harness:commit-guidance -->
## Committing in this repo

Use \`harness commit "<message>" -- <paths>\` rather than a chained
\`git add … && git commit …\`.

A \`harness commit\` is **verified or named**: it probes the collector ingress,
commits, and then either confirms a \`refs/notes/ai\` note landed or names the
buffer holding the events plus the command that drains it
(\`harness doctor telemetry-nudge\`). It never blocks and never rolls back.

A chained or compound \`git commit\` can **silently lose attribution** — agent
command sandboxes block git-ai's socket, git quietly disables trace2, and the
commit's authorship may later be recorded as human.

Neither shape guarantees delivery. What \`harness commit\` guarantees is that the
outcome is never silent. Read \`harness instructions commit\` for the detail.
<!-- END harness:commit-guidance -->`;
