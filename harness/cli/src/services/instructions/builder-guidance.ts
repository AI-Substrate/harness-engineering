export const BUILDER_INSTRUCTIONS = `# Builder — architecture-enabled team delivery

Builder keeps product intent in plan.dd.json and execution architecture in
assets/impl-guide.dd.json. The guide owns responsibilities, read/write fences,
dependencies, shared contracts, acceptance coverage and composition proof.
Separate files alone are not a reason to fan out.

Start with \`harness builder --help\` and \`harness docs harness-builder\`.
Every Builder command has its own \`--help\`; use its real argument contract.

## Operating order

1. \`builder new\` allocates a managed clone/worktree and plan scaffold.
   \`builder adopt\` records an existing workspace's real provenance; adoption
   never turns external or pij-owned work into harness teardown authority.
2. \`builder guide --init\` creates the implementation-guide draft only when
   absent. Complete its architecture and explicit ownership before fanout.
   Bootstrap packets/model settings are editable briefings, not issued receipts.
3. \`builder contracts --seal\` requires committed shared inputs, recorded proof
   and an independent decomposition review. \`builder ready\` must report ready;
   not-ready and cant-tell are not permission to proceed.
4. \`builder settings\` resolves requested role configuration. Requested model
   and effort are not observed runtime facts or provider attestation.
5. \`builder dispatch\` binds an immutable packet to the current sealed source.
   \`builder ack\` checks fresh nonce, packet digest, actual native file-tool root
   and runtime evidence. Packet/ack/dispatch identities use the unit plus the
   full sealed source SHA; nonces stay payload fields. Old records never
   authorize a new attempt. An acknowledgement is not an invented release.
6. \`builder compose\` imports fenced deliveries in guide order, then verifies
   the actual committed composition. Capture full Git OIDs directly; never
   expand an abbreviation by inference. \`builder review\` binds independent
   review to the exact subject and immutable evidence, including historical
   implementation identities when checking reviewer independence.
7. \`builder advance\` follows the one canonical flow. Review exit is not
   whole-plan completion: record closeout evidence first, then satisfy the
   complete-plan gate at post-flight exit.
8. \`builder close\` preserves required artifacts, WIP, reports, observations,
   telemetry and exact Git refs outside every retiring root. Unknown work and
   explicit evidence cannot be waived by a cache-path classification.
9. \`builder tidy\` requires real ownership, a complete surviving preservation
   receipt, released peers and safe Git state. A lexical path or success message
   is not proof that a survivor is outside a retiring root.

Mutate canonical documents through \`node_modules/.bin/ddocs\`; generated
.dd.md siblings are read-only faces. Use typed proof links and actual recorded
outcomes. Keep historical seals, reports, packets and acknowledgements intact.
Do not claim delivery, acceptance, remote publication or teardown before the
corresponding action and its evidence exist.
`;
