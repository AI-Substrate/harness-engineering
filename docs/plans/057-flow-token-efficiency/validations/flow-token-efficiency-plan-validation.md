# Validation — flow-token-efficiency-plan.md

- **Validated**: 2026-07-10T12:06:41+10:00
- **Target**: `docs/plans/057-flow-token-efficiency/flow-token-efficiency-plan.md` (`sha256:0511a91f30741588dc5653ec7844c96b99f56a1dffb4604c7a63a56bd788a732`)
- **Contract sources**: `original-ask.md`, `spine.md`, `research-dossier.md`, current CLI/telemetry/builder sources
- **Checks**: unified-plan structure and AC/task coverage; current `flow.ts` mutation path; telemetry capture timing, FlowEvent shape, spool/sync path, and report lens; template/expander instruction carrier; six spawn modules; docs manifest and `check:docs`; targeted git history
- **Verdict**: NEEDS ATTENTION
- **Thesis / proof**: Purpose is well covered, but READY/Implementation proof is not met because the binding FlowEvent task names no viable post-mutation capture seam and three proof/manifest claims exceed current evidence.
- **Consumers**: 3/4 satisfied — skill guidance and quiet-output work are actionable; Phase 2 self-measurement is blocked by the unresolved transition-emission design.

## Findings
| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | AC-01/T1.2 is not implementation-ready: the named capture path runs before `nav set`, while the mutation writes and exits without a post-write telemetry seam. | `harness/cli/src/app.ts:383-417` calls `captureTelemetry` before command parsing; `capture-service.ts:385-397` snapshots the pre-command `nav.now` and omits `from`; `acts/flow.ts:1253-1277` writes then immediately emits/exits. The plan says only “via capture service,” without defining session detection, event-only segment/spool durability, fail-safety, or the invocation point. | Open — choose and specify a post-successful-write transition emitter (or a kernel post-command seam), including `from`/stage/status, `--next` exclusion, non-blocking failure behavior, durable report/sync proof, exact files, and tests. |
| MEDIUM | AC-04's docs proof is vacuous: `docs/how/harness-flow.md` is not guarded by `check:docs`. | `harness/cli/src/services/docs/docs-manifest.json` does not list the file; `package.json:40` only regenerates and diffs `docs-content.ts`. Therefore `npm run check:docs` can pass without checking this guide. | Open — either add the guide to the bundled manifest and include generated surfaces, or name a direct deterministic docs check. |
| MEDIUM | The Domain Manifest does not cover every file named or mutated by phase tasks, contradicting G7 PASS. | Tasks 1.6/1.7 write `execution.log.md`; task 2.6 mutates the plan flight plan to add `tripwire-review`; neither `execution.log.md` nor `the-flow.json` appears in the manifest at lines 141-156. | Open — add the plan-runtime artifacts with classifications and ownership. |
| MEDIUM | The T+3wk “worked / partial / regressed” verdict can overstate attribution across unlike journeys, especially for delegation. | Dossier F-12 and AC-11 admit no subagent-vs-parent attribution; AC-05 compares 056 and P1-era sessions, while AC-09 asks future wild plans to produce an overall verdict from `stageEconomics` deltas. Task size and the three simultaneous interventions remain confounded. | Open — split capture-health proof from directional outcome evidence, label cross-journey deltas as non-normalized, and make delegation explicitly unmeasured/low-confidence unless T1.6 discovers stronger evidence. |
