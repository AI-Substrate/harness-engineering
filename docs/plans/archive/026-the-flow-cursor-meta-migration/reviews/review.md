# Code Review: the-flow cursor/meta migration — flow CLI primitives (Phase 1, Simple)

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/the-flow-cursor-meta-migration-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/the-flow-cursor-meta-migration-plan.md § Business Specification
**Phase**: Simple Mode (Phase 1 — T001–T014)
**Date**: 2026-06-18
**Reviewer**: Automated (the review verb)
**Testing Approach**: Full TDD (real fixtures, no mocks; golden render fixtures; `check:flows` drift-guard)

---

## A) Verdict

**APPROVE WITH NOTES**

No HIGH or CRITICAL findings. The implementation is sound: clean act → service → pure layering, correct E305 validation on both `now` and `next`, proper null handling, atomic writes with path containment, and the `cursor`→`nav` migration is grep-clean (only the intentional legacy probe and template-DSL seed key remain). All gates green (flow suite 132 in-scope / 790 full; `check:flows` exit 0; `tsc` exit 0). The notes below are MEDIUM/LOW quality items worth addressing — none block.

**Key failure areas** (only where issues found):
- **Implementation**: minor edge cases — no-op `setNow` emits a self-loop audit event; empty-string `now` renders blank; `--next` + `--clear-next` silently conflict (LOW).
- **Reinvention**: `predecessorsOf` was added as the "shared" neighbour scan but `insertNode`'s `--before` branch still carries its own inline reverse-edge scan — the Finding-04 extraction did not actually consolidate the two (MEDIUM).
- **Testing**: AC-5 (`create --agent`) has no act-level end-to-end test (service-level only); plan task paths (T001/T007) list `flow-events.test.ts` but the nav/zone tests landed elsewhere (MEDIUM). RED-run evidence quoted only for C1 (LOW).
- **Doctrine**: stale `cursor` reference in the `registerFlowAct` JSDoc verb list; new flow tests carry no Test Doc blocks (LOW; pre-existing suite pattern).

## B) Summary

Overall this is a clean, well-layered delivery of the `nav`/`rail`/`zone`/`create --agent` primitives in the shared `FlowDoc` core. The breaking `cursor`/`recommended_next` → `nav` shape change was executed in one pass with every live reader migrated and the drift-guard green; the clean break (no `cursor` alias) holds — the only surviving `cursor` tokens are documented domain terms (the `cursor-moved` event kind, the `authority: 'cursor'` value, the `cursor-spine DAG` model name), not the removed verb. Domain compliance is clean given this repo has no `docs/domains/` tree (the flow domain is identified inline); the only manifest gap is under-enumeration of test/contract files, not true orphans. Anti-reinvention surfaced one genuine duplication (`predecessorsOf` vs `insertNode`'s inline scan) where the plan's stated reuse did not fully land. Testing evidence is strong for GREEN (790 passing, drift-guard clean, ACs mapped to concrete assertions) but the RED half of TDD is only quoted for C1, and two coverage/path gaps exist (AC-5 act-level test; manifest test-path accuracy). Doctrine alignment is good; the two LOW items are stale-doc and a pre-existing Test-Doc-block suite exemption.

## C) Checklist

**Testing Approach: Full TDD**

- [x] Core validation tests present (nav mutations, E305, meta merge, neighbours, zone defaults, rail render, provenance)
- [x] Critical paths covered (AC-1–AC-7 all have test evidence)
- [x] Key verification points documented (exec log per-commit)
- [ ] RED-run evidence quoted for every commit (only C1 quoted — C2/C3/C4 GREEN-evidenced, RED not)
- [x] Only in-scope files changed (flow-domain source/tests/docs; 2 tangential uncommitted files noted in §G, not part of phase)
- [x] Linters/type checks clean (`tsc --noEmit` exit 0)
- [x] Domain compliance checks pass (no domains/ tree; manifest under-enumeration only)
- [x] `check:flows` drift-guard green (exit 0)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | harness/cli/src/services/flow/flow-mutations.ts (insertNode --before) | reinvention | `predecessorsOf` added as the "shared" reverse-edge scan (Finding 04) but `insertNode`'s `--before` branch still has its own inline reverse-edge scan — two duplicate walks coexist. | Have `insertNode --before` call `predecessorsOf(...)` then rewrite edges; consolidate to one scan. |
| F002 | MEDIUM | harness/cli/test/acts/flow.test.ts | testing | AC-5 `create --agent` provenance tested at service level only (T011); no act-level end-to-end test (`flow create --agent` → `flow rail` asserts `[agent]`). | Add act test: `flow create … --agent the-flow` then `flow rail` asserting `data.rail` starts with `[the-flow]`. |
| F003 | MEDIUM | docs/plans/026-…/the-flow-cursor-meta-migration-plan.md (T001, T007) | testing | Plan task paths list `flow-events.test.ts` for nav-shape + zone-default tests, but that file still holds only 024 duck-typing tests; nav/zone tests landed in `flow-mutations.test.ts` / `flow-renderer.test.ts`. Manifest paths inaccurate. | Update T001/T007 paths to the actual files (or add the missing assertions to `flow-events.test.ts`). |
| F004 | LOW | harness/cli/src/services/flow/flow-mutations.ts:61-69 | correctness | `setNow` fires `cursor-moved {from,to}` even when `from === to` (no-op move to current node) → misleading self-loop audit entry (observed in dogfood: CUR-006 from=p1,to=p1). | Guard the event: only fire `cursor-moved` when `from !== to` (idempotent position write can remain). |
| F005 | LOW | harness/cli/src/services/flow/flow-renderer.ts:222 | correctness | `nav?.now ?? '—'` uses nullish coalescing; an empty-string `now` (seeded by `navOf` when `nav set --intent/--next/meta set` runs on a doc with no prior position) renders blank instead of the `—` placeholder. Sibling `next`/`intent` guards use `.length > 0`; `now` does not — inconsistent. | Use `nav?.now || '—'` (or `.length > 0` check) so empty `now` falls back to the em-dash. |
| F006 | LOW | harness/cli/src/acts/flow.ts:289-294 | error-handling | `--next <id>` + `--clear-next` together: `--clear-next` wins silently (the `else if` skips `--next`); the conflicting combination is not rejected by the arg-validation block (262-281), so `--next` is dropped without diagnostic. | Reject the combination as `E108`/`INVALID_ARGS` ("pass one of --next or --clear-next, not both"), or document `--clear-next` precedence. |
| F007 | LOW | harness/cli/src/services/flow/flow-schema.ts:299-307 | correctness | `validateFlowDoc` validates `nav.now`/`nav.next` refs only when `nav` is already a non-array object; a malformed `nav` (e.g. `nav: "foo"`, `nav: 42`) silently passes. `nav` is now a first-class core field, not a tolerated extra. | Add a shape check: if `'nav' in d && (nav === null \|\| typeof nav !== 'object' \|\| Array.isArray(nav))` → issue `root: nav must be an object`. Low impact (mutations always produce well-formed nav) but guards hand-edited docs. |
| F008 | LOW | docs/plans/026-…/the-flow-cursor-meta-migration-plan.md § Domain Manifest | domain | Manifest under-enumerates touched flow-domain files: act tests (`test/acts/flow.test.ts`, `test/acts/flow-render.test.ts`), the contract snapshot (`test/contract/__snapshots__/flow-envelope-snapshot.test.ts.snap`), and `schemas/flow.schema.json` are changed but not in the manifest rows. Not true orphans — all unambiguously flow-domain. | Broaden the manifest test row to `harness/cli/test/{acts,contract,services}/flow*` + snapshot; add `schemas/flow.schema.json` to the contract row. |
| F009 | LOW | harness/cli/src/services/flow/flow-mutations.ts | domain | (Layering hygiene) `flow-mutations.ts` (pure/internal) imports `FlowFailure`/`fail` from `./flow-service.js` (service layer) — a pure→service dependency. Predates this plan (verbatim at f863272), documented (`flow-service.ts:51` "exported so flow-mutations reuses it"), and no cycle (service does not import mutations). | Optional: extract `FlowFailure`/`fail` into a tiny `flow-errors.ts` so the pure layer does not depend up. Not required by this plan. |
| F010 | LOW | harness/cli/src/acts/flow.ts (~line 104, registerFlowAct JSDoc) | doctrine | The JSDoc verb list still enumerates `cursor` among the fine-grained mutation verbs. The `cursor` verb was removed this phase; the doc comment is now stale and contradicts the clean-break decision + `harness-flow.md`. (Other `cursor` tokens in the file — `cursor-spine`, `cursor-moved`, `authority: 'cursor'` — are intentional domain terms, correctly retained.) | Update the JSDoc verb list from `cursor`/`status`/… to `nav`/`rail`/`status`/… |
| F011 | LOW | harness/cli/test/services/flow/*.test.ts | doctrine | ~110 new/changed flow tests added this phase carry no `Test Doc:` block (rules §6.3 requires Why/Contract/Usage Notes/Quality Contribution/Worked Example). Pre-existing flow-suite pattern (plan 024 tests never adopted Test Doc blocks) — this phase continues the gap, not introduces it. | Backfill Test Doc blocks on the behaviourally-named new tests (at minimum: nav set ordering, insert-node DAG re-check, rail zone banding), or record a Deviation Ledger entry per rules §9 if the flow suite is intentionally exempt. |
| F012 | LOW | docs/plans/026-…/execution.log.md | testing | Per-commit suite counts (776→782→788) do not match the actual run (790 passing). Green status holds; counts are stale. | Note 790 reflects post-C4 state, or re-run at each commit boundary and update. |
| F013 | LOW | docs/plans/026-…/execution.log.md | testing | RED-run evidence explicitly quoted only for C1 ("10 fail: `navShow is not a function`"). C2/C3/C4 are claimed TDD-first but no RED output quoted (test tasks exist; GREEN is verifiable, RED half is not). | Quote a one-line RED summary per commit (e.g. "C2: N zone tests RED → effectiveZone missing"). |

## E) Detailed Findings

### E.1) Implementation Quality

Four LOW findings (F004–F007), all edge cases:
- F004 — no-op `setNow` self-loop audit event.
- F005 — empty-string `now` renders blank (inconsistent with `next`/`intent` guards).
- F006 — `--next` + `--clear-next` silently conflict.
- F007 — malformed non-object `nav` not shape-checked by `validateFlowDoc`.

No correctness, security, performance, or scope issues of substance. Path handling on writes goes through `toPosix`/`posixJoin`/`isWithin` with `E303` containment (idioms §11). No `vi.mock`/`vi.spyOn` (interface-first, fakes-over-mocks P3). Pure mutations clone before write; renderer is a pure `FlowDoc → string` leaf.

### E.2) Domain Compliance

Repo has no `docs/domains/` tree (flow domain identified inline), so registry/map/circular-dep checks are N/A.

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | every changed source file maps to the flow domain; no cross-domain leakage |
| Contract-only imports | ✅ | no internal file reaches into unrelated services (docs, record-runtime); `flow-events.ts` uses only type-only imports |
| Dependency direction | ⚠️ | F009 — `flow-mutations` (pure) imports `fail`/`FlowFailure` from `flow-service` (service); pre-existing, documented, no cycle. Optional extraction. |
| Domain.md updated | N/A | no domains/ tree |
| Registry current | N/A | no registry.md |
| No orphan files | ⚠️ | F008 — manifest under-enumerates act tests, contract snapshot, `schemas/flow.schema.json`; all are flow-domain, not true orphans |
| Map nodes current | N/A | no domain-map.md |
| Map edges current | N/A | no domain-map.md |
| No circular business deps | N/A | single inline domain |
| Concepts documented | N/A | no domains/ tree |
| Stale readers (T006) | ✅ | grep-clean of live `doc.cursor`/`doc.recommended_next` field reads; remaining hits are the `isLegacyFlow` `'cursor' in doc` probe (intentional legacy-shape detector) and template-descriptor seed key (mapped into `nav.now`) + 2 comments — all legitimate |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `predecessorsOf` / `successorsOf` (reverse-edge neighbour scan) | insertNode `--before` inline reverse-scan | flow | ⚠️ F001 — duplicate coexists; extend (have insertNode call `predecessorsOf`) |
| `renderRailBody` / `renderRailLine` | none — genuinely shared by `render` + `rail` (Finding 05 factored correctly) | flow | ✅ proceed |
| `navShow` neighbour trimming `{id,type,status,label,next}` | none (flow-service `summary` is doc-level) | flow | ✅ proceed |
| `effectiveZone` / `ZONE_BY_TYPE` | none (`STATUS_CLASS`/`HARNESS_TYPES` are unrelated maps) | flow | ✅ proceed |
| `create --agent` provenance | extends existing `FlowProvenance`/`createFlow` writer (not reinvented) | flow | ✅ proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 88%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-1 | 95 | `flow-mutations.test.ts:87-94` E305 on missing ref for BOTH `setNow`/`setNext`; `:67-77` `setNext(null)` clears; `:239-246` `navShow` nav:null when absent; `:216` bag nests under `nav.bag`. Act `flow.test.ts:216-223` `--clear-next`→null; `:249-253` nav show on bare flow → nav:null. `flow-schema.test.ts:244-249` validates nav.now/next refs. |
| AC-2 | 95 | `flow-mutations.test.ts:209-220` setMeta shallow-merge preserves other keys + getMeta. Act `flow.test.ts:236-242` meta set/get round-trip. |
| AC-3 | 85 | `flow-renderer.test.ts:417-438` effectiveZone covers every the-flow overlay type + unknown/undefined/empty→flight + explicit override. `flow-mutations.test.ts:249-270` zone persists through add/insert. Act `flow.test.ts:150-178` `--zone` round-trips + invalid→E108. Gap: harness-loop overlay nodeTypes (boot/backpressure/observe/retro/improve) not explicitly enumerated (rely on unknown→flight). |
| AC-4 | 90 | `flow-renderer.test.ts:454-469` renderRailLine title=provenance.agent → slug fallback → doc.title; `:441-452` renderRailBody bands+pips+labels. Act `flow-render.test.ts:185-192` rail `[demo]` (slug) + Boot name. Gap: no act-level create `--agent`→rail `[agent]` (F002). |
| AC-5 | 80 | `flow-service.test.ts:304-340` (T011) `--agent`+`--plan-id` stamp non-null; `--agent` omitted (no env) → agent:null. Gap: service-level only (F002). |
| AC-6 | 95 | Grep: no live doc.cursor/recommended_next readers. `cursor` verb absent from acts. `flow-schema.test.ts:231-250` cursor dropped from rootRequired, nav added, nav refs validated. `check:flows` exit 0; suite 790 green. |
| AC-7 | 90 | `docs/how/harness-flow.md`: verbs table (nav show/set/meta + rail + create --agent/--plan-id/--title + --zone on add/insert; cursor row removed) + new "Position, intent & the rail" section + clean-break note. Dogfood documented in exec log C4 (live rail `[the-flow-cursor-meta-migration]`, create `--agent the-flow` throwaway → `[the-flow]`, nav show envelope). Dogfood exec-log-claimed, not test-asserted. |

### E.5) Doctrine Compliance

Project-rules consulted: `constitution.md`, `architecture.md`, `rules.md`, `idioms.md` (all exist). Two LOW findings:
- F010 — stale `cursor` in `registerFlowAct` JSDoc verb list.
- F011 — new flow tests lack Test Doc blocks (rules §6.3); pre-existing suite pattern, not a phase regression.

Clean checks: clean break verified (no `.command('cursor')`/`alias('cursor')`); CLI "never routes" boundary held (no `workflow.json`, no `harness flow next` engine, no schema on `bag` — D7); layer boundaries (architecture §2) respected; stable envelopes + E-code diagnostics (E108/E300–E310) with `next_action` on all non-`ok` statuses; interface-first / fakes-over-mocks (P3); POSIX paths (idioms §11); dynamic verbs (constitution P10 — `flow` is a reserved command group, no closed union).

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-1 | nav set/show/meta; E305 now+next; nullable next; null-when-absent; bag nested | flow-mutations + flow-service + flow-schema + act tests | 95% |
| AC-2 | setMeta shallow-merge; bag surfaced | flow-mutations.test.ts:209-220 + act test | 95% |
| AC-3 | zone + --zone + default-by-type + unknown→flight | flow-renderer.test.ts:417-438 + flow-mutations + act | 85% |
| AC-4 | rail `[title]` pips bands; title=agent→slug fallback | flow-renderer.test.ts:441-469 + act render test | 90% |
| AC-5 | create --agent/--plan-id stamps provenance; null when omitted | flow-service.test.ts:304-340 (service only) | 80% |
| AC-6 | cursor/recommended_next removed; renderer+fixtures updated; drift-guard green | grep + flow-schema.test.ts + check:flows exit 0 | 95% |
| AC-7 | docs/how/harness-flow.md updated; dogfooded on flow 026 | doc diff + exec log C4 dogfood | 90% |

**Overall coverage confidence**: 90%

## G) Commands Executed

```bash
# Phase diff (baseline f863272 = pre-phase; phase commits 1eaf50e..c55b12c)
git diff --stat f863272..HEAD
git diff f863272..HEAD > reviews/_computed.diff   # 3158 lines saved

# In-scope flow suite
cd harness/cli && npx vitest run test/services/flow test/acts/flow.test.ts test/acts/flow-render.test.ts
# → 7 files, 132 tests passed

# Drift-guard (run from repo root — no harness/cli/package.json; scripts at root)
npm run check:flows        # gen:flows + git diff --exit-code schemas-content.ts + flow-fixtures --check → exit 0

# Type check
cd harness/cli && npx tsc --noEmit   # exit 0

# Full suite (per exec log + subagent re-verification): 790 passed

# Stale-reader audit (T006)
grep -rn "doc.cursor\|doc.recommended_next\|\.cursor\b\|\.recommended_next\b" harness/cli/src
# → only isLegacyFlow probe + template descriptor seed key + 2 comments (all legitimate)

# Working-tree (uncommitted) — NOT part of this phase:
#   M docs/retros/code-review-companion.md        (companion-stall debrief from 026 build; retro domain)
#   M harness/cli/src/services/docs/docs-content.ts (embedded doc string tweak; docs domain, not flow)
#   ?? docs/plans/023-documentation-updates/        (unrelated plan dir)
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: APPROVE WITH NOTES

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/the-flow-cursor-meta-migration-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/the-flow-cursor-meta-migration-plan.md § Business Specification
**Phase**: Simple Mode (Phase 1 — T001–T014)
**Tasks dossier**: inline in plan § Implementation
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/acts/flow.ts | reviewed | flow | F006 (LOW) — reject `--next`+`--clear-next`; F010 (LOW) — stale `cursor` in JSDoc |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-events.ts | reviewed | flow | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-mutations.ts | reviewed | flow | F001 (MED) — consolidate insertNode scan into predecessorsOf; F004 (LOW) — no-op setNow event; F009 (LOW) — pure→service import |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-renderer.ts | reviewed | flow | F005 (LOW) — empty `now` renders blank |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-schema.ts | reviewed | flow | F007 (LOW) — shape-check non-object nav |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-service.ts | reviewed | flow | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/schemas-content.ts | reviewed | flow | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/schemas/flow.schema.json | reviewed | flow | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/flow/*.test.ts | reviewed | flow | F011 (LOW) — backfill Test Doc blocks |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/test/acts/flow.test.ts | reviewed | flow | F002 (MED) — add create --agent act test |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/test/acts/flow-render.test.ts | reviewed | flow | F002 (MED) — extend with create --agent → rail |
| /Users/jordanknight/substrate/harness-engineering/docs/how/harness-flow.md | reviewed | flow | none |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/026-the-flow-cursor-meta-migration/execution.log.md | reviewed | flow | F012/F013 (LOW) — stale suite counts; quote RED for C2–C4 |

### Required Fixes (if REQUEST_CHANGES)

N/A — verdict is APPROVE WITH NOTES. No blocking fixes. The MEDIUM notes (F001, F002, F003) are recommended, not required; address opportunistically or in a follow-up.

### Domain Artifacts to Update (if any)

N/A — repo has no `docs/domains/` tree. F008 (manifest under-enumeration) is a plan-doc accuracy fix, not a domain artifact.

### Handback

APPROVE WITH NOTES — Phase 1 is implementation-complete and verified green (flow suite + drift-guard + tsc). The 13 findings are all LOW/MEDIUM and non-blocking. Optional polish: the two MEDIUM items worth picking up are F001 (consolidate the duplicate neighbour scan — the plan's stated Finding-04 reuse did not fully land) and F002 (add a `create --agent` → `rail` act-level test to lift AC-5 confidence from service-only to end-to-end). The remaining LOWs are edge-case hardening (no-op event, empty-now render, conflicting-arg diagnostic, nav shape-check), stale-doc (JSDoc verb list), and exec-log evidence hygiene. Since this is the final phase (Simple, single phase), implementation is complete — consider committing. Fixes, if taken, travel back through the implement verb (same flags), then this review re-runs.
