# Code Review: Phase 2 — Durable Evidence and Truthful Readers

**Plan**: `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md`
**Phase**: Phase 2 — Durable Evidence and Truthful Readers
**Date**: 2026-07-23
**Testing Approach**: Hybrid

## A) Verdict

**APPROVE**

Zero HIGH/CRITICAL or actionable MEDIUM findings remain after implementation, doctrine, domain, evidence, and anti-reinvention rechecks.

## B) Summary

Phase 2 adds a contract-owned, per-field `TokenEvidence` surface and carries it through live sessions, whole-session refs, fleet lanes, reports, sweep, HTML, and CLI envelopes. Mixed and partial evidence remains explicit; present values survive while absent values remain unavailable. All rostered lanes evaluate live/ref/ledger candidates per field, billing-only headlines remain separate from additive buckets, and predecessor v1 schemas retain optional compatibility. Public commands degrade consistently with closed reasons, `cause: unknown`, and actionable next steps.

## C) Checklist

- [x] Durable `telemetry get` after local prune
- [x] Exact legacy input/output/cache projection
- [x] Partial compaction and mixed missing windows remain partial
- [x] Empty refs cannot mask measured vendor fields
- [x] Measured refs retain deterministic scalar-source precedence
- [x] Billing-only Copilot/Codex records do not fabricate token buckets
- [x] Session/get/get-fleet/report/sweep degraded envelopes
- [x] Report reason/cause histograms and visible HTML coverage
- [x] Session/fleet/report schema compatibility
- [x] P060 remote grammar/envelopes and publication privacy
- [x] Focused 18 files / 340 tests; non-PTY 223 / 3,111 tests

## D) Findings Table

No remaining findings.

## E) Detailed Findings

### E.1) Implementation Quality

**Clean.** Final narrow implementation recheck found no remaining HIGH/MEDIUM code issue. New files are present and are required commit contents.

### E.2) Domain Compliance

**Clean.** `token-evidence.ts` owns the public vocabulary; `usage-observation.ts` owns behavior. The Domain Manifest includes all Phase 2 source/test surfaces.

### E.3) Anti-Reinvention

**Clean.** Legacy scalar adaptation and evidence ranking are centralized; JSON schemas reuse local `$defs`/`$ref`.

### E.4) Testing & Evidence

**Hybrid, clean.** Regression REDs exposed compatibility gaps during implementation; dedicated behavior tests and final repository proof close them. Final evidence: focused 18/340, non-PTY 223/3,111, build/Biome green, composite 3,112 passed plus six accepted PTY failures.

### E.5) Doctrine Compliance

**Clean.** No absent field becomes a measured zero; partial values remain present; reasons and unknown cause propagate; counts-only privacy and additive predecessor compatibility hold.

## F) Coverage Map

| AC | Evidence | Confidence |
|---|---|---:|
| AC-03 | Per-field quality merge across live/ref/ledger, all lanes | 97% |
| AC-04 | Ref-backed post-prune session get/save/fleet paths | 96% |
| AC-05 | Degraded session/get/fleet/report/sweep + HTML/reasons | 97% |
| AC-08 | Schema compatibility, P060 controls, publication privacy | 98% |

**Overall confidence**: 97%

## G) Commands Executed

See `../execution.log.md` for exact commands and receipts. Definitive evidence: build `artifact://868`; focused 18/340; non-PTY 223/3,111; composite `artifact://871` (baseline-only PTY failures).

## H) Handover Brief

**Review result**: APPROVE

**Tasks dossier**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-2-durable-evidence-and-truthful-readers/tasks.md`
**Execution log**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-2-durable-evidence-and-truthful-readers/execution.log.md`

### Required Fixes

None.

### Handback

Phase 2 is approved. Phase 3 real replay and fixture promotion may proceed only under its born-closed private execution authority.
