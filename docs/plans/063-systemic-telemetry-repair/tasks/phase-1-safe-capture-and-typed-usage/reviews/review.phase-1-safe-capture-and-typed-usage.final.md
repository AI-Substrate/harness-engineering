# Code Review: Phase 1 — Safe Capture and Typed Usage (Final)

**Plan**: `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md`
**Spec**: unified plan, `## Business Specification`
**Phase**: Phase 1 — Safe Capture and Typed Usage
**Date**: 2026-07-23
**Reviewer**: Automated five-axis review fleet plus narrow doctrine adjudication
**Testing Approach**: Full TDD

## A) Verdict

**APPROVE**

Zero HIGH/CRITICAL findings remain. Successive implementation and doctrine rechecks also closed every actionable MEDIUM finding.

## B) Summary

Phase 1 now provides confined/race-safe standard-Claude transcript reads and a closed typed Copilot usage stream. Durable session, ref, report, and fleet readers reduce observations once by chronology and kind precedence; incomplete typed evidence never falls back to stale scalar totals. Loose JSON, OTLP, predecessor/current identities, captured environment, model, token, and event shapes fail closed through shared validation. Domain placement, anti-reinvention, privacy, TDD, and evidence reviews are clean.

## C) Checklist

**Testing Approach: Full TDD**

- [x] Real historical RED evidence retained only as approved opaque hashes/verdicts
- [x] Review-fix RED artifacts discriminate all repaired boundaries
- [x] Confined no-follow reads cover ancestor/final symlinks, unsupported flags, FIFO, and opened-handle races
- [x] Typed usage covers chronology, duplicate source records, partiality, final precedence, and unlike-kind non-addition
- [x] Session/ref/report/fleet readers preserve typed evidence across sync/prune
- [x] Loose and OTLP inputs enforce supported versions, safe identity, exact token equations, canonical time, and current-only usage
- [x] Focused Phase 1 suite: 20 files / 597 tests
- [x] Build and Biome clean
- [x] Composite passes every non-PTY file; accepted PTY proof ceiling unchanged
- [x] Domain compliance and anti-reinvention clean

## D) Findings Table

No remaining findings.

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|---|---|---|---|---|---|
| — | — | — | — | Clean | Proceed |

## E) Detailed Findings

### E.1) Implementation Quality

**Clean.** Final implementation reviewer returned `CLEAN` after narrow rechecks of canonical timestamps and strict loose-segment handling.

### E.2) Domain Compliance

| Check | Status | Details |
|---|---|---|
| File placement | ✅ | Existing harness-cli adapter/telemetry domains extended in place. |
| Contract-only imports | ✅ | Usage vocabulary is owned by `events.ts`; reducer imports inward. |
| Dependency direction | ✅ | Ports contain I/O; services remain pure/port-driven. |
| Domain.md updated | N/A | Repository does not maintain `docs/domains/*`. |
| Registry current | N/A | No domain registry. |
| No orphan files | ✅ | Complete diff includes every new source/test/evidence artifact. |
| Map nodes current | ✅ | Plan Domain Manifest includes every touched production boundary. |
| Map edges current | N/A | No domain map. |
| No circular business deps | ✅ | None introduced. |
| Concepts documented | N/A | No domain Concepts convention in this repository. |

### E.3) Anti-Reinvention

No duplicate capability found. The implementation extends existing Git/Fs ports and centralizes new usage semantics in one reducer/shared strict decoder.

### E.4) Testing & Evidence

**Coverage confidence**: 97%

| AC | Confidence | Evidence |
|---|---:|---|
| AC-01 — bounded Claude lookup | 98% | Root-aware no-follow tests cover final and ancestor symlinks (inside/outside root), unsupported `O_NOFOLLOW`, nonblocking FIFO classification, sparse pre-allocation refusal, and an opened-handle swap race. |
| AC-02 — typed usage | 98% | RED artifacts `490`, `530`, `567`, `578`, `587`, `601`, and `638`; focused 20/597 GREEN covers parser, reducer, rollup, session/ref/fleet/report precedence and partiality. |
| AC-06 — real historical discipline | 94% | Approved packet/runner/result hashes, `RED_EXPECTED`, source count, and exact-prefix status only; private body and values absent. |
| AC-08 — compatibility/privacy | 98% | Strict supported-version decoder, exact current/predecessor pairing, closed tokens/env/models/events, mutation negatives, published-reader coverage, and sanitized tracked artifacts. |

### E.5) Doctrine Compliance

**Clean.** Narrow final adjudication returned `CLEAN` against Constitution P4/P5/P9/P12 and AC-01/AC-02/AC-08 after checking supported 1.1/2.0–2.6 versions, identity, captured environment, token equations, event closure, effort compatibility, and private-value regressions.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|---|---|---|---:|
| AC-01 | Confined selected-root transcript location | Node/Fake Fs, Claude adapter, capture tests | 98% |
| AC-02 | Typed usage without stale fallback/double count | Parser/reducer + session/ref/fleet/report tests | 98% |
| AC-06 | Real-session RED boundary | Opaque authorized evidence receipt | 94% |
| AC-08 | Closed counts-only compatibility | Segment/OTLP/published/loose-decoder negatives | 98% |

**Overall coverage confidence**: 97%

## G) Commands Executed

```bash
npm run fix
npm run build
npm test -- <20 Phase 1 focused files>
HARNESS_NO_TELEMETRY=1 HARNESS_NO_TELEMETRY_AUTOSYNC=1 just checks
```

Definitive receipts: `artifact://641`, `artifact://644`, and `artifact://646`; exact commands, RED transitions, counts, and all supplementary receipts are in `../execution.log.md`.

Composite result: all 222 non-PTY files plus one PTY case passed (3,099 tests); six accepted unchanged real-PTY cases failed. Biome, typecheck, docs, flows, telemetry fixtures, doctrine parity, skills, and Windows checks passed. Architecture/Markdown remain established warn-only baselines.

## H) Handover Brief

**Review result**: APPROVE

**Plan**: `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md`
**Spec**: unified plan
**Phase**: Phase 1 — Safe Capture and Typed Usage
**Tasks dossier**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/tasks.md`
**Execution log**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/execution.log.md`
**Review file**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/reviews/review.phase-1-safe-capture-and-typed-usage.final.md`

### Files Reviewed

The complete reproducible manifest is `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/reviews/_computed.diff`. Key boundaries reviewed: filesystem/Git ports, Claude/Copilot adapters, event/reducer/segment/OTLP contracts, capture/session/ref/report/fleet readers, schemas, focused tests, plan manifest, and execution evidence.

### Required Fixes

None.

### Domain Artifacts to Update

None.

### Handback

Phase 1 is approved. Next phase task expansion may proceed.
