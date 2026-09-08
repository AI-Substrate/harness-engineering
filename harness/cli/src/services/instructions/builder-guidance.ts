export const BUILDER_INSTRUCTIONS = `# Builder — architecture-enabled team delivery

Builder keeps product intent in plan.dd.json and execution architecture in
assets/impl-guide.dd.json. The guide owns responsibilities, read/write maps,
dependencies, shared contracts, acceptance coverage and composition proof.
Separate files alone are not a reason to fan out.

Brief workers with owned paths, mapped read paths/owners, the job/interface
and observable done conditions first; then the actual packet pointer/digest.
Receiving a new work packet starts that unit without a separate release.
Maps guide coders and PM; out-of-map work needs no approval or justification.

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
   \`builder dispatch --adopt-peer <id>\` instead binds an already-running native
   worker at the supplied existing workspace, retaining \`--parent\` and kind/role
   controls. Preserve original adopted ownership, authority, sealed source,
   progressed HEAD and WIP. Seed only missing metadata; no spawn, replay, reset
   or new work grant. Native observations are not provider identity attestation.
   Current native OMP requires a full clone. A matching allocation binding may
   be reused, but an existing durable dispatch is not resent: inspect its
   original peer/packet/evidence rather than respawning.
6. \`builder compose\` imports committed deliveries in guide order, then verifies
   the actual committed composition. Import still refuses wrong tree/branch/
   commit, mismatched or forged current packet/dispatch/allocation evidence,
   duplicate peer attribution and rewritten sealed ancestry. Fix the checkout,
   recover original evidence or review/seal new contracts as the cause requires;
   never alter evidence to fit a claim. Startup receipts, transport outcome,
   nonce challenges and clock windows are not import gates.
   \`builder compose --import <path> --already-integrated\` proves every supplied
   unit's frozen map projection equals the current committed PM HEAD, using
   delivery-touched paths only when no concrete mapped paths exist. Empty scope
   is missing proof. Compare modes/types/Git object IDs and absence, not working
   text. Write the receipt without replaying changes; preserve original worker
   SHAs. Missing evidence and digest/tree mismatch remain failures. This flag
   requires --import and conflicts with --verify; it is not product proof.
   Still run \`builder compose --verify <sha>\` and independent composition review.
   Guide, coder delivery and PM map deviations are visible warnings, not an
   ownership veto. Retain file/owning_unit/stage rows in independent review,
   including when a real Git, structural or executable-check failure occurs.
   Capture full Git OIDs directly, never by inference.
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

## Advisory on-track inspection

\`harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]\`
needs no readiness, seal, review or receipt and writes no state, even on main.
It exits 0; show compared, warnings, actionable issues and the selected basis.
Unavailable comparison returns compared:false plus issues, not a command failure.
Named-unit maps use delivery-stage warnings and all committed touched paths,
including reverted writes; no unit selects all PM maps and the endpoint delta.
Default work includes HEAD plus tracked staged/unstaged changes; --untracked
explicitly adds new paths. Explicit --to is committed-only, excluding all worktree
changes even with --untracked. --from selects an explicit basis; otherwise PM
uses imported integration_sha, then sealed source_sha, then HEAD; a named unit
uses the sealed source or HEAD. Malformed basis evidence is an issue, not fallback.
The report exposes measured full from/to SHAs and includes_worktree/includes_untracked.
This is the automatic ownership comparison, not a second policy engine or proof.

Ownership-only guide warnings do not block readiness, sealing, dispatch or advance.
Keep canonical lifecycle writes with the PM and independent review read-only.
Maps never authorize global/deployed changes, unrelated workspaces, changes on
main, pushes, PRs, merges or destructive actions; obtain the user's authorization.

Mutate canonical documents through \`node_modules/.bin/ddocs\`; generated
.dd.md siblings are read-only faces. Use typed proof links and actual recorded
outcomes. Keep historical seals, reports, packets and startup receipts intact;
never replay completed work or reclassify old receipts as current prerequisites.
Do not claim delivery, acceptance, remote publication or teardown before the
corresponding action and its evidence exist.
`;
