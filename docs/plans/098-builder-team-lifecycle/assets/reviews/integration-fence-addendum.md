# Plan 098 — combined contract-review corrections

Previous acknowledged source snapshot: `208fe7a20b0d43b4de4b6ea2ae398914c78706aa`. The exact revised commit is supplied separately, avoiding a self-referential commit hash. Continue the already-completed review through a disposition-only check; do not repeat unchanged code analysis.

Reviewer: `pij-natural-gant`; PM: `pij-cooperative-gibbon`.
Nonce: `4e75ff72-a77b-40f6-96bc-ff64b656d721`.
Native root challenge: `scratch/plan-098/fence-addendum-root.txt` — read it with a repository-relative native file tool, never an absolute-path or shell read. Its answer is deliberately absent here.

## Accepted corrections

- N1: moved all three gate/criteria/human-force instruction paragraphs INTACT from review-1 to post-flight through atomic flow apply. Added the ruled human-skipped/na route and degraded-not-completion distinction. Gate objects and the human override are unchanged; no force was used.
- N2: WorkspaceKind remains exactly worktree|clone. Separate WorkspaceKindSelector adds guide. The dispatch grammar defaults to guide; new still defaults to worktree. Pure resolveBuilderDispatchKind(mode,selector) resolves guide/explicit selection, refuses solo with E471 and malformed values with E470. No repository-kind setting or guide loader was introduced.
- N3: TidyDeps.peerReleased is required. The shared builderFixture supplies a named E473 unavailable-capability failure. No release permission is inferred.
- N4: acceptance_coverage now has the missing ac-0013 row naming phase tk-0008 and plan tk-0003. The canonical backpressure basis was recomputed after link writes, is `fd1790c364a221a75260cf8480c1b4a69175a91ee84490b53944e00678d4bfe2`, and has a new receipted freshness chore. All 19 ACs remain unchecked; no scope or future work is marked complete.
- Integration fence: registry.ts and app.test.ts belong to tk-0007 only. Only the top-level builder name was added to RESERVED_NAMES; no subcommand names were newly reserved. The two distinct new surfaces remain for PM wiring/help proof, not a claim the public act exists yet.

## Evidence and limits

Observed after corrections: 42/42 focused Builder contract tests passed; source TypeScript check passed; five-file Biome check passed; local ddocs validate, links and build --check each exited zero. These are baseline proofs, not product-service, native-delivery or PDF-acceptance proof. No coder has launched or been released. Runtime model/effort metadata remains launch-configuration evidence only, not provider attestation. The retained prior delta report is path-redacted only and names its exact raw source digest `1879133fe6c85a64c4de51c5d5dcc6683d0a95e9ed2c09d50db7334ea6d7f5f1`.

## Verification and permission

Fetch/check out the supplied commit without force and preserve scratch. Verify HEAD, packet digest, nonce, native-root answer and every digest below; any mismatch stops this review. Write the updated acknowledgement with those observations. On a complete match, this packet explicitly releases the READ-ONLY disposition check of N1–N4 and the integration-fence addendum. Preserve prior reports; write `scratch/plan-098/decomposition-combined-review.json`, binding its verdict and independence answer to the revised SHA and this digest set. Do not mutate source/plan/guide/flow/tasks, run tests/build/lint/formatters, alter global/deployed state, push or launch coders. No implementation release is authorized.

The flow JSON is now frozen alongside the original inputs, closing N1's earlier unpinned-evidence caveat. This is the authoritative combined packet, superseding the uncommitted narrow integration addendum.

## Frozen inputs

- `docs/plans/098-builder-team-lifecycle/plan.dd.json`: `fd1790c364a221a75260cf8480c1b4a69175a91ee84490b53944e00678d4bfe2`
- `docs/plans/098-builder-team-lifecycle/assets/impl-guide.dd.json`: `77b1f5c09fee6527c839875c3657e4a9598e0a55df540fced90f7a6c4eda452b`
- `docs/plans/098-builder-team-lifecycle/assets/backpressure.dd.json`: `8dd8bd6780aa94201e1dc49073271cc1dca7f14bf3a50439c617d5bbe4f23716`
- `docs/plans/098-builder-team-lifecycle/assets/tasks/phase-1/tasks.dd.json`: `ea43a830c229f34eee3febec52088b17772b661bbbc20de05246092f1bcb20cf`
- `docs/plans/098-builder-team-lifecycle/assets/flow-eval-audit.md`: `d93ab680f843b5692d2fb969b6df2587e16ef58dc10f1b1369fa86c5b4d74f13`
- `docs/plans/098-builder-team-lifecycle/assets/reviews/decomposition-review.json`: `d4b32fe9496cae59693178da25a6a5d0d8f525789fafa333266d659ca057193e`
- `harness/cli/src/services/builder/types.ts`: `0e818628e6157110aed75aeb5d67ff7927ff6893093ff6460704b5816bfe009f`
- `harness/cli/src/services/builder/records.ts`: `43823310f88c7a887191ea5ee7cdcffe01c22d7a8a2bafa937818184f59cf75c`
- `harness/cli/test/fixtures/builder-contracts.ts`: `c62cded898714e9b1e192ad4971dd777b456dd00798a88e176acac309ed15031`
- `harness/cli/test/services/builder-contracts.test.ts`: `d7169cd25be9e2bbbd88a51fe653f03c769fa80f66a796c4a8de8d0ee228f164`
- `.dd/schemas/builder/impl-guide/schema.json`: `fd81192dd40d3a935bfcce2d670437d19b477ff78c6f61f29a752073af6567a2`
- `.dd/schemas/builder/allocation/schema.json`: `dae10018b49274e92ce52c00dbf91d3b033151be6e2e3a4c9125b5aceed3df71`
- `.dd/schemas/builder/packet/schema.json`: `33595c9fd3df67cecc9af947d10a2e98f3f5d46e6fcb4b31817fc23442efca6c`
- `.dd/schemas/builder/team/schema.json`: `15687cce9964b714bd2cba1cc5c09a8fb006bacd8fb9462d474f50640c33d601`
- `harness/cli/src/services/builder/commands.ts`: `5eaa7d9e0f25f8be170e8def1b580a882afd6e5d2805531a49598290ea619f4b`
- `harness/cli/src/output/error-codes.ts`: `a97645060a51f9a115fc6823b2f9cd9ee11076eaed02dc657046244298a19830`
- `harness/cli/test/output/error-codes.test.ts`: `e8b2ea4b40827461fc52555ad88791d9a4a61ba4df0544c75f84b63ea0cba0f0`
- `docs/plans/098-builder-team-lifecycle/the-flow.json`: `27b83813b4fe25972237d780ebd8a44983610e3fdf97b2395b3b98bce8282d39`
- `harness/cli/src/services/extensions/registry.ts`: `2d0785d180d948efff7e3580e6921ef9d3272bc21cd305c9741a538fe9e685cd`
- `harness/cli/test/app.test.ts`: `ece3277943d5d5b73ba4fabe1d29805cbd67b332e49a919fe6fb18b6e01d74d2`
- `docs/plans/098-builder-team-lifecycle/assets/reviews/decomposition-delta-review.json`: `4420bc39d77c5eb4ff402174204db66657ae97bfad8af7e831e5107e7dbb4e72`
