# Plan 098 — decomposition delta and wave-0 contract review

PM: `pij-cooperative-gibbon`. Reviewer: `pij-natural-gant`, OMP `github-copilot/claude-opus-5`, effort `high`.
Nonce: `d15daa94-ed29-45dd-a23c-01cccfc8c4cd`.

The delivery message supplies the exact committed SHA. First verify HEAD equals it and every input digest below matches. The packet deliberately does not embed its own future commit SHA. Read this file and the source inputs through native relative-path file tools in the existing isolated review clone; shell cwd alone is not a root proof.

## Scope

Resolve findings F1–F5 from your prior core decomposition review and review the added final acceptance criterion, evaluator unit `tk-0008`, and the actual common code/schema baseline. This remains a decomposition/contracts review, not a claim the product services or live acceptance already exist. The PM is the integration owner; no coder is released until this review accepts the baseline.

- PreservationReceipt is now an explicit shared close-to-tidy contract: exact source/allocation identity, retiring roots, surviving destination, artifact/WIP/report/observation/telemetry inventory and Git refs. Require independent re-observation, not a success boolean.
- commands.ts supplies one executable Commander grammar for all 13 public operations; skill authors consume it. Importing units is distinct from proving committed PM composition.
- The prime withdrew his additional allocation ratification gate; it was not a user requirement. Harness owns new allocations; adoption never grants teardown ownership. No further vote is pending.
- Guide proof rows use vd-* rather than colliding with backpressure identities. The actual local ddocs validate/links/build --check recipe ran on the authored plan without errors or warnings.
- The existing complete-plan gate has been moved from review exit to post-flight exit, preserving phase task gates and independent review rather than forcing completion before closeout.
- The final blind evaluation has its own source-backed audit, write fence and acceptance criterion. Native Flowspace evidence must preserve unknown telemetry fields. A canned PDF, solo relabelling or process score cannot substitute for actual independent work and a freshly exercised Mermaid-bearing PDF.
- The shared record writer uses the real DD parser, schema resolver and renderer with FsPort atomic publication and explicit compare-and-swap. A saved source plus failed derived face is an explicit failure with repair guidance.
- A root canary's expected answer is not disclosed in Packet; only its path is supplied. Dispatch seed-file digests bind the separately read answer.

## Questions to adjudicate

Are all promised capabilities owned through a visible composed path? Are the six coder units genuinely independent after this baseline, with no private sibling imports or shared mutations? Can close/post-flight/proof progress occur without a temporal cycle or anticipatory checked state? Do the shared types, DD schemas and public grammar suffice for the declared consumers? Reject unsafe ownership, dishonest evidence or meaningful unowned integration work; do not add speculative features.

## First response, then review

Write `scratch/plan-098/decomposition-delta-ack.json` with reviewer ID, nonce, observed HEAD, native relative-read root, shell cwd, input-digest verification and requested-versus-observed runtime configuration. Send the PM the pointer and wait for explicit review release. Do not start implementation. Then, when released, write `scratch/plan-098/decomposition-delta-review.json`: scope and SHA, evidence boundary, verdict (approved / changes-requested / blocked), per-F1–F5 dispositions, additional evidence-backed findings, and the independence answer. Send its pointer.

Read-only apart from your own scratch acknowledgement/report. Skip formatters, linters, builds and every test/validation suite; the PM owns execution. Never touch canonical plan/flow state, main, other peers' files, global settings, or deployed skills. No push, PR or merge. Separate launch configuration from provider-served-model attestation.

## Frozen input digests

| Repository-relative input | SHA-256 |
|---|---|
| `docs/plans/098-builder-team-lifecycle/plan.dd.json` | `3ff1a41e89db62df8617e330efbc0dfb8d135e532e1ffdc25cb6e4d1a71cfb02` |
| `docs/plans/098-builder-team-lifecycle/assets/impl-guide.dd.json` | `387be0f176b5e00dbe793ad8d122a6fe41551158a883f245f67402db9b61307e` |
| `docs/plans/098-builder-team-lifecycle/assets/backpressure.dd.json` | `8c312d7eb557489885c389a4ec50eb7dca56a5d5063e509ad01254a83e6ff695` |
| `docs/plans/098-builder-team-lifecycle/assets/tasks/phase-1/tasks.dd.json` | `ea43a830c229f34eee3febec52088b17772b661bbbc20de05246092f1bcb20cf` |
| `docs/plans/098-builder-team-lifecycle/assets/flow-eval-audit.md` | `d93ab680f843b5692d2fb969b6df2587e16ef58dc10f1b1369fa86c5b4d74f13` |
| `docs/plans/098-builder-team-lifecycle/assets/reviews/decomposition-review.json` | `d4b32fe9496cae59693178da25a6a5d0d8f525789fafa333266d659ca057193e` |
| `harness/cli/src/services/builder/types.ts` | `fce9df2cb8b26d02d2df874318577996a17c365c791a95908304d6ee333da795` |
| `harness/cli/src/services/builder/records.ts` | `43823310f88c7a887191ea5ee7cdcffe01c22d7a8a2bafa937818184f59cf75c` |
| `harness/cli/test/fixtures/builder-contracts.ts` | `75fd6ef2f2870aeab75999c81a7bf37fcec7ce127fe1046b87df0ff133d82863` |
| `harness/cli/test/services/builder-contracts.test.ts` | `de19494f51dcd68865ad40e6e4790e43f4130083d8c5cf3c32b5c66494aec8a9` |
| `.dd/schemas/builder/impl-guide/schema.json` | `fd81192dd40d3a935bfcce2d670437d19b477ff78c6f61f29a752073af6567a2` |
| `.dd/schemas/builder/allocation/schema.json` | `dae10018b49274e92ce52c00dbf91d3b033151be6e2e3a4c9125b5aceed3df71` |
| `.dd/schemas/builder/packet/schema.json` | `33595c9fd3df67cecc9af947d10a2e98f3f5d46e6fcb4b31817fc23442efca6c` |
| `.dd/schemas/builder/team/schema.json` | `15687cce9964b714bd2cba1cc5c09a8fb006bacd8fb9462d474f50640c33d601` |
| `harness/cli/src/services/builder/commands.ts` | `574be337a144a01c09cf17df7df2f55a872bba320151296dbcfbd3b66367a132` |
| `harness/cli/src/output/error-codes.ts` | `a97645060a51f9a115fc6823b2f9cd9ee11076eaed02dc657046244298a19830` |
| `harness/cli/test/output/error-codes.test.ts` | `e8b2ea4b40827461fc52555ad88791d9a4a61ba4df0544c75f84b63ea0cba0f0` |
