# Phase 1 cross-model review

**Verdict: APPROVE_WITH_NOTES**

The Phase 1 implementation fulfills the read-side stage-attribution and flow-local quiet-output promises. The focused suites pass, both key behaviors are mutation-proven non-vacuous, and no source defect was found in the lookup or quiet paths. Two bounded proof/documentation gaps should be corrected, but neither invalidates the shipped behavior.

## Scope

The packet named `6615e488..HEAD`, but commit `6615e488` itself contains the `report.ts`/schema implementation and most lookup tests. To review the packet's stated claims rather than only its follow-ups, this review inspected `6615e488^..HEAD`.

## Dim-0 — mutation proof

Fresh baseline:

```text
npx vitest run test/services/telemetry/flow-log-stage-lens.test.ts test/acts/flow-quiet.test.ts --coverage=false
13/13 passed
```

1. **`lookup-ignores-marks` proved RED.** Temporarily changed `report.ts:705` to skip the `cursorMarks` branch. `flow-log-stage-lens.test.ts` failed 4/7 tests, including the exact stage-key assertion at `flow-log-stage-lens.test.ts:109`, retroactive attribution at `:136-138`, merged mechanism attribution at `:152-160`, and pre-mark `unlabeled` attribution at `:169-177`.
2. **`quiet-leaks-summary` proved RED.** Temporarily changed `flow.ts:1279` to always return `summary(...)`. `flow-quiet.test.ts` failed at `:92`: the received keys were the full summary rather than `['path']`.

Both mutations were restored. The same focused command then passed 13/13, and the worktree was clean.

## Findings

| Severity | Path:line | Claim | Evidence |
|---|---|---|---|
| MEDIUM | `harness/cli/test/acts/flow-quiet.test.ts:95-109` | The AC-02 regression test does not prove the claimed byte-identical default envelope. | `runFlow` parses stdout with `JSON.parse` at `:63`, and the default assertion checks only sorted `data` keys. It cannot detect field reordering, changed values, or serialization changes outside `data`. Current source behavior is safe because `flow.ts:1279` still calls the same `summary(...)` and `formatOk(...)` path when quiet is absent, but the promised regression guard is weaker than claimed. Smallest fix: retain raw stdout and compare it exactly against a frozen default envelope under the existing fixed clock. |
| MEDIUM | `docs/how/harness-flow.md:132-141` | The guide overstates telemetry coverage by saying every mutation lands in `events[]`. | `flow-mutations.ts:73-107` explicitly makes `nav --next`, `--clear-next`, `--intent`, and `nav meta set` mutations without built-in events. Only real position moves (`setNow`, `flow-mutations.ts:61-69`) emit the `cursor-moved` marker used by this lens. Smallest fix: say that `nav set --now` position transitions land in `events[]` and drive per-stage attribution. |

## Correctness evidence

- **Lookup boundaries and ordering:** cursor marks are extracted before filtering and sorted at `report.ts:395-408`; merged marks are sorted at `:710-722`; `<=` at `:742` gives exact-timestamp at-or-before semantics. A run flushes only when the stage changes at `:746-751`, so consecutive same-stage marks do not split a window.
- **Mechanism attribution:** each run retains the source that started it and increments `flow`/`flow_log`/`unlabeled` at `report.ts:724-737`. Events before the first mark retain the null label/source and flush honestly as `unlabeled`.
- **Retroactivity:** marks before the event window remain available to the lookup; the dedicated assertion at `flow-log-stage-lens.test.ts:122-139` mutation-failed when the lookup was disabled.
- **Regression surface:** when no cursor marks exist, the original FlowEvent and digit branches remain at `report.ts:754-787`. `flow_log` remains excluded from work-time/gap math at `rollup.ts:177-191`. The additive schema property is present at `report.schema.json:124-133`.
- **Quiet blast radius:** all mutation errors exit before the quiet success branch (`flow.ts:1261-1275`); only `runMutation` reads `io.quiet` (`:1279`). Create and read verbs use separate paths. Repository search found no other `CliIo.quiet` consumer.
- **P12/privacy:** the OTLP flow-log mapping carries only closed `op/node/from/to` values, not descriptions or comments. A scan of the committed baseline found no absolute home paths or prompt/content fields.
- **AC-10:** the changed guidance is suggestion-oriented and explicitly says the loop never gates, scores, or blocks; no new gating/scoring/blocking instruction was introduced.

