export const BUILDER_INSTRUCTIONS = `# Builder — architecture-enabled team delivery

Builder keeps product intent in plan.dd.json and execution architecture in
assets/impl-guide.dd.json. The guide owns responsibilities, read/write fences,
dependencies, shared contracts, acceptance coverage and composition proof.
Separate files alone are not a reason to fan out.

Brief workers with owned paths, allowed read paths/owners, the job/interface
and observable done conditions first; then the actual packet pointer/digest.
Receiving a work packet starts that unit without a separate release.

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
5. \`builder dispatch\` sends the work packet bound to the current sealed source
   and records observed transport separately from runtime facts. Optional
   \`harness builder self-check <packet> --sha256 <digest>\` compares packet bytes,
   actual checkout root and HEAD/source SHA with cause/fix warnings only.
   It changes no state and supplies no permission or import prerequisite.
6. \`builder compose\` imports committed deliveries in guide order, then verifies
   the actual committed composition. Import still refuses wrong tree/branch/
   commit, mismatched or forged current packet/dispatch/allocation evidence,
   duplicate peer attribution and rewritten sealed ancestry. Fix the checkout,
   recover original evidence or review/seal new contracts as the cause requires;
   never alter evidence to fit a claim. Startup receipts, transport outcome,
   nonce challenges and clock windows are not import gates.
   PM map deviations remain \`composition.value.warnings\`, not an ownership
   veto; coder-delivery path enforcement is unchanged. Include those warnings
   in independent review. Capture full Git OIDs directly, never by inference.
   \`builder review\` binds the exact subject and immutable evidence, including
   historical implementation identities. Requested independent/cross-model
   review must run separately; solo implementation cannot replace it.
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
outcomes. Keep historical seals, reports, packets and startup receipts intact;
never replay completed work or reclassify old receipts as current prerequisites.
Do not claim delivery, acceptance, remote publication or teardown before the
corresponding action and its evidence exist.
`;
