# Phase 3 Tasks — Real Replay and CI Fixture Promotion

**Plan**: [`systemic-telemetry-repair-plan.md`](../../systemic-telemetry-repair-plan.md)
**Phase**: Phase 3 — Real Replay and CI Fixture Promotion
**Status**: Blocked — renewed born-closed GREEN execution authority/packet required

## Executive Briefing

### Purpose

Prove the repaired token path against immutable authorized real sessions, including teardown and source conflict, before deriving the smallest publication-safe CI fixture substrate.

### What We're Building

A private field-by-field GREEN replay at the frozen historical fence; copied/read-only teardown/conflict proof; then minimal sanitized structural fixtures, mutation regressions, byte/manual privacy review, final gates, and guide reconciliation.

### Goals

- ✅ Reverify every authorized source identity and frozen fence before execution.
- ✅ Prove every applicable opaque case GREEN without changing historical expectations.
- ✅ Prove post-prune reads, vendor-over-empty-ref merge, unknown joins, and unchanged inventories.
- ✅ Derive fixtures only after real GREEN.
- ✅ Promote only manually reviewed, byte-scanned, mutation-defended public bytes.

### Non-Goals

- ❌ No raw corpus or private replay body in tracked/validator context.
- ❌ No fixture derivation before GREEN.
- ❌ No PTY repair, turn duration, broad model/lifecycle/plan-attribution, adopted-seat, or PIJ notice work.

## Prior Phase Context

### A. Deliverables

- Phase 1 froze the RED oracle: packet `64d5f716…`, runner `d34b117f…`, private result `c96cf691…`, `RED_EXPECTED`, 15 sources, exact prefixes.
- Phase 1 delivered bounded Claude capture, typed Copilot observations, strict Segment/OTLP/loose readers, and approved compatibility/privacy proof.
- Phase 2 delivered per-field `TokenEvidence`, durable ref-backed reads, all-lane quality merge, degraded public surfaces, reason/cause histograms, HTML/sweep propagation, and approved guide/schema compatibility.

### B. Dependencies Exported

- Reuse existing observation/reducer/evidence functions; no replay-only arithmetic.
- Reuse `getSessionEvidence`, session export/ref reconstruction, and fleet merge for teardown/conflict scenarios.
- Reuse existing privacy/publication/schema tests and fixture capture/scrub/promotion workflow.
- Final Phase 2 proof: focused 18/340, non-PTY 223/3,111, composite 3,112 passed plus six accepted PTY failures.

### C. Gotchas & Debt

- Phase 1 authority covered RED only; GREEN needs renewed Jordan/prime approval and exact packet.
- Historical transcripts append; frozen prefixes/fence prevent later shutdowns rewriting expectations.
- Measured refs retain scalar compatibility precedence, but measured vendor fields beat empty ref fields.
- Billing sub-buckets overlap headline totals; never double-add.
- Missing joins remain unavailable with `cause: unknown`.
- Private outputs stay opaque; byte scan does not replace manual exact-byte review.

### D. Incomplete Items

- Authorized GREEN replay and copied/read-only teardown/conflict scenarios.
- Minimal fixture derivation, mutation tests, privacy scan, manual review, promotion.
- Final guide reconciliation and gates.

### E. Patterns to Follow

- Required order: authorize → identities/fence → real GREEN → teardown/conflict → minimal sanitize → mutation tests → byte scan → manual review → gates → guides.
- Fail closed on identity, source, fence, or evidence mismatch.
- Tracked evidence: opaque IDs, verdict/counts/hashes only.

## Pre-Implementation Check

| Resource | Ready? | Notes |
|---|---:|---|
| Approved Phase 1 RED receipt | yes | Opaque tracked receipt only. |
| Repaired Phase 1/2 source and tests | yes | Approved reviews and final gates. |
| Authorized real corpus bodies | private/outside tracked tree | Must not be copied into tracked or reviewer context. |
| Born-closed GREEN packet | **no** | Must name exact command, cwd, identities, fence, allowed outputs, and stop conditions. |
| Fixture capture/scrub/promotion harness | yes | Use only after GREEN. |
| Manual publication reviewer | pending | Required for exact promoted bytes. |

## Architecture Map

```mermaid
flowchart LR
  AUTH[Renew GREEN authority] --> ID[Reverify identities + fence]
  ID --> GREEN[Private field-by-field GREEN]
  GREEN --> CONFLICT[Teardown + source conflict]
  CONFLICT --> SAN[Minimal sanitization]
  SAN --> MUT[Mutation regressions]
  MUT --> PRIV[Byte scan + manual review]
  PRIV --> GATE[Focused + composite gates]
  GATE --> DOC[Guide reconciliation]
```

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T001 | Obtain renewed born-closed GREEN execution packet | repo-engineering-substrate | private packet outside tracked tree | Jordan/prime approves exact command/cwd/sources/identities/fence/output allowlist/stop conditions | Accepted packet `1a4fa470…`; accepted runner `c05b2a6d…`; Phase 1 RED authority did not carry |
| [x] | T002 | Reverify authorized identities and frozen historical fence | repo-engineering-substrate | private read-only sources | Every source matches frozen size/hash/type/no-symlink/prefix; mismatch stops | 15 sources exact; fence `25c686b` / `2026-07-19T00:41:43Z` |
| [x] | T003 | Run repaired private field-by-field replay | repo-engineering-substrate | ignored private result artifact | Every applicable opaque case is GREEN; later events do not rewrite historical expectations | GREEN; 5 Copilot + 5 standard-Claude cases; result `d551658a…` |
| [x] | T004 | Run copied/read-only teardown and conflict scenarios | repo-engineering-substrate | ignored replay workspace | Token fields survive prune; vendor measured beats empty ref; unknown join unavailable; inventory unchanged | All five scenarios GREEN; source/ref inventories unchanged |
| [x] | T005 | Derive minimal sanitized fixtures and mutation regressions after GREEN | repo-engineering-substrate | `/repo/harness/cli/test/services/telemetry/fixtures/`, focused tests | Only minimum structural shapes; intended mutations fail; no private values | 1 invented JSON fixture; 3 contracts with mutations; focused GREEN |
| [x] | T006 | Run drift/privacy/publication/manual review and gates | repo-engineering-substrate | fixture guards, execution log | Byte scan and manual exact-byte review pass; focused/non-PTY/composite evidence recorded | Automated gates complete; six accepted PTY failures only; prime manual exact-byte review approved; independent review APPROVE |
| [x] | T007 | Reconcile guides with observed GREEN behavior | repo-engineering-substrate | `/repo/docs/how/{telemetry,telemetry-reports,telemetry-fixtures}.md` | Docs state only replay/test-proven behavior and retain limits/non-goals | Per-field evidence, degraded reporting, and real-before-minimized-fixture policy documented |

## Context Brief

Environment friction is work, not an apology—but private authorization and publication review are hard boundaries, never inferred.

### Stop Conditions

- Identity, mode, symlink, prefix, source inventory, or fence mismatch.
- Missing/ambiguous evidence or any attempt to expose private bodies/values.
- Any tracked fixture derivation before real GREEN.
- Any promoted byte not manually reviewed.

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|---|---|---|---|---|---|

## Directory Layout

```text
docs/plans/063-systemic-telemetry-repair/
  └── tasks/phase-3-real-replay-and-ci-fixture-promotion/
      ├── tasks.md
      └── execution.log.md
```
