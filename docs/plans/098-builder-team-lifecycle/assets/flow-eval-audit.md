# Flow-eval compatibility and final acceptance contract

## Decision

Extend the existing `.harness/extensions/flow-eval/` evaluator and add a separate versioned `builder-team-md-to-pdf` scenario. Do not replace its engine, reinterpret historical cohorts, fabricate a telemetry session, or turn a process score into artifact acceptance. Unit `tk-0008` owns the evaluator/scenario; the PM owns the live run after committed product composition and independent review.

## Verified starting point

- `resolvers.ts` already contains DD-aware `corpus-floor`, `forbidden-state` and `gate-refused` resolvers. Corpus row counts are not semantic link validation and may otherwise credit an unrelated plan.
- `scenario.ts` and `scorer.ts` distinguish process, capability and safety. Historical `md-to-pdf`, `md-to-pdf-flow` and `dd-native-builder` bundles have different bases and purposes; preserve them.
- Current evidence parsing requires telemetry-shaped `segments`, checks and counters. Native OMP has no harness-side telemetry capture adapter; setting the capture environment variable does not create one.
- The public native path is `harness convo sync --harness omp --session <native-id>`, then `flowspace3 conversation verify --harness omp --session <native-id> --json`. Dispatch is not delivery. Resolve the native ID from `pij-rs list --json` **row.session**, not the peer ID or conversation GUID.
- Retrieve the verified conversation through `flowspace3 get conv:<guid>#t<n> --after 200 --json`. Windows are bounded at 200 on each side. Check continuity and retrieve through the reported final turn; truncated/partial evidence is not complete evidence.
- Flowspace supplies native turns, tool items and per-turn timestamps. It does not supply telemetry segments, token/cost totals, command exits, check results or gate refusals. Preserve those as explicit unknowns. Opaque wrappers and quoted command strings are not proven executions.

## Required new acceptance behavior

1. Bind every document assertion to the explicitly selected **new subject plan** and its Git base. Reject unrelated plan 098 artifacts, legacy facsimiles, missing/invalid DD links and unfulfilled assertions. Use the existing DD/plan semantic validators rather than a second regex validator.
2. Inspect the actual implementation guide and frozen contracts. Require architecture-supported independent units, not padded worker counts or a solo PM relabelled as a team.
3. Bind distinct implementation peers to baseline, packet digest, nonce acknowledgement, native root, requested/observed settings, fenced unit commit and PM composition. Use the shared Builder record contracts. A queued spawn/send is not readiness or delivery.
4. Require independent review of the **committed composition SHA**; subsequent code changes invalidate closure. Configuration consistency is not provider-served model attestation.
5. Independently invoke the delivered Markdown-to-PDF capability on a fresh input containing Mermaid. Inspect the resulting PDF and rendered diagram output. A canned PDF, text-only diagram, static walkthrough or process-only score cannot satisfy this lane.
6. Preserve the run, source/output artifacts, native evidence and grade outside every disposable root before reclamation. Install only the locally packaged skill/product content into the isolated consumer; never mutate global installs or substitute an older deployed skill.

## Controls and proof ceiling

The unit suite must reject an unrelated/old plan, dangling or merely present pressure links, incomplete semantic completion, stale basis/packet/review, missing real implementation peers, reused roots, uncommitted or out-of-fence code, incomplete native retrieval, and a canned/nonfunctional PDF. Missing native-only fields resolve to unknown, not zero or success. Run the existing evaluator suite with zero-test success disabled.

The final prompt may mandate the delivered Builder method, but must not disclose hidden assertions, expected counts, choreography or grades. The task must leave the PM to derive its decomposition. The live run follows product review, not the other way around. Source boundaries: evaluator extension, new scenario, its existing skill entry and public guide only; no core telemetry, pij or Flowspace source changes.
