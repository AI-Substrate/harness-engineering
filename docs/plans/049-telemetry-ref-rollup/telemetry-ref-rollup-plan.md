# Telemetry Ref Rollup — one quiet ref per session + old-ref migration
**Mode**: Simple
**Plan Version**: 1.1.0 (T007 buffer prune + AC-10 rolled in 2026-07-03 mid-phase, user request)
**Created**: 2026-07-03
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context

📚 Incorporates findings from research-dossier.md — notably F-03: a live **clobber bug** means every reader sees only each ref's tip tree while each sync's tree carries only that run's segments, so multi-sync refs silently hide earlier segments (recoverable from parent commits). This plan fixes chattiness and that bug in one shape change.

### Summary

Telemetry published to git is too chatty: one ref per (capture-date, session), a commit per sync, two files per segment — a multi-day session leaves a ref-per-day trail (live repo: 36 refs / 28 sessions; one session spans 6 day-refs). Roll publication up to **one ref per session, keyed on the session's start date** (`refs/harness-telemetry/<start-YYYY/MM/DD>/<session>`), holding **one commit** whose tree is a rolled-up logs/metrics pair + manifest covering the whole session. Each sync rewrites the ref (orphan commit + forced single-refspec push). Steady-state append stays **fetch-free** (single-writer local ref). First-run sync that finds old-shape refs **migrates them all — for all users** — unioning each old ref's trees across its full commit history (repairing the clobber losses), then deleting the old refs after verification.

### Goals

- A session costs exactly 1 ref, 1 commit, 1–3 files in git — regardless of days or sync count.
- A multi-day session lives at its **start date** — one file set, one place.
- Reads become correct by construction: tip tree = the whole session (fixes the F-03 data loss).
- Appending more telemetry never requires fetching/pulling existing telemetry (preserved invariant).
- One-time migration patches every old-shape ref (all users' sessions), recovering the segments buried by the clobber bug.

### Non-Goals

- No change to segment content, the frozen segment schema, or what is captured (counts-only payload unchanged — this is a **layout-only** publication change).
- No change to the local buffer format, watermark mechanics' purpose, or the capture path.
- No scraper/central-collector work; readers remain local-ref based.
- No codex adapter, time_quality, or observe-id-collision work (open items from 046/048).

### Target Domains

_No `docs/domains/registry.md` exists; domains are identified informally, consistent with prior plans._

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (harness/cli telemetry services) | existing | **modify** | Sync rework, reader dual-shape branch, sweep start-month semantics, migration pass |
| git-adapters (harness/cli git ports) | existing | **modify** | Additive port capability: ls-remote + fetch (+ history-walk read for migration union) |

### Testing Strategy

- **Approach**: Hybrid — failing-first (TDD) for the sync core, migration union/verify/delete logic, and the idempotency/watermark replacement; lightweight for verb wiring and docs.
- **Rationale**: The sync core and migration are correctness-critical (data loss on error); the repo's fake-port pattern makes failing-first cheap. Verb plumbing follows existing tested patterns.
- **Focus Areas**: rolled-shard write/rewrite semantics · fetch-free proof (fake git records zero fetch calls on steady-state) · full-history union recovers clobbered segments · migration idempotency + concurrency convergence · delete-only-after-superset-verify · dual-shape reads · sweep start-month membership.
- **Excluded**: HTML render layer (untouched) · capture path (untouched).
- **Mock Usage**: Targeted fakes only — the existing `FakeGitWrite`/fake-port fixtures (repo pattern); real-git integration via the existing `exec-git-write.int.test.ts` style for the forced-refspec push and history walk.

### Documentation Strategy

- **Location**: Update existing docs in place — the sync verb's help text, `docs/how` telemetry pages that describe the ref layout, and the `sync-service.ts` header doc-comment (which currently documents the per-date shard rationale).
- **Rationale**: Layout change to an already-documented mechanism; no new page warranted.

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=2, N=0, F=1, T=1
- **Confidence**: 0.85
- **Assumptions**: OTLP JSONL concatenates cleanly in seq order (lines are self-contained events); the manifest blob can carry seq framing where needed.
- **Dependencies**: none new (git plumbing only).
- **Risks**: migration concurrency; old-CLI writers racing migration (see Risks & Assumptions).
- **Phases**: 1 (Simple mode, inline tasks).

### Acceptance Criteria

1. **AC-01 — One ref per session at start date**: after sync, a session's telemetry lives at exactly `refs/harness-telemetry/<start-YYYY/MM/DD>/<session>`; a session whose segments span ≥2 calendar days still produces exactly one ref, dated at the first segment's date.
2. **AC-02 — Tip tree is the whole session**: after N syncs of the same session, the ref's tip tree contains every synced segment's data (proof: a 2-sync test where sync-2's tree still yields sync-1's segments through the reader; the F-03 mutation — drop the prior-content union — flips it RED).
3. **AC-03 — Fetch-free append**: steady-state sync (no old-shape refs present) performs zero fetch/ls-remote calls (proof: fake git port records no such calls across a multi-sync, multi-day session scenario).
4. **AC-04 — Idempotent re-sync**: re-running sync with nothing new pushes the same refspec (re-push retained per H-04) and creates no new commit and no duplicated content; a lost-watermark re-run double-counts nothing.
5. **AC-05 — Migration patches all old refs**: a repo with old-shape refs (per-date keys, multi-commit histories, including sessions this clone never wrote) → first sync rewrites each session to its rolled start-date ref whose content equals the **union of all trees across every old ref's full commit history**, then deletes the old refs; segments reachable only from non-tip commits are present afterwards (the recovery proof).
6. **AC-06 — Migration is safe and re-runnable**: a second migration run is a no-op; two interleaved migration runs converge to the same refs with no data loss; an old ref is deleted only after the new ref verifiably contains its full-history union; refs dated **today** are not migrated (old-CLI writer protection).
7. **AC-07 — Sweep uses start-month**: `telemetry sweep --month M` includes a session iff its ref (start date) is in M; per-session export and report totals over migrated refs are ≥ the pre-migration totals for the same month (recovered segments may only add).
8. **AC-08 — Dual-shape reads during transition**: session export reconstructs correctly from an old-shape (per-seq files) ref and a new-shape (rolled) ref; a mixed repo reads both.
9. **AC-09 — P12 honored**: the publication-boundary change is layout-only — a test asserts the published byte content is the same OTLP JSONL event stream as before (re-serialized), with no new fields captured or published.
10. **AC-10 — Buffer prune is safe and bounded**: after a successful sync, buffer files at or below the flushed watermark are deleted (only once the `.startdate` sidecar is persisted); unflushed segments always survive; a prune failure never fails the sync; fully-flushed session dirs older than 14 days are removed; the local-oracle role is preserved for everything not yet durably pushed.

### Risks & Assumptions

- **Migration races** (two users' first-run syncs; an old-CLI writer appending): mitigated by idempotent content-addressed rewrites, verify-before-delete **with a re-verify at delete time (TOCTOU guard — a racing forced push between verify and delete skips that delete)**, the union always folding in any pre-existing rolled ref (a straggler migration can never clobber already-rolled content), tolerate already-deleted/already-migrated, and the "only refs dated before today" rule. Residual risk accepted: a same-day old-CLI append migrates on a later run.
- **The clobber bug keeps burying data until this ships** — every further sync on a multi-sync ref widens the gap; migration recovers all of it, so shipping order (fixed writer + migration together) closes the exposure.
- **Assumption**: remote deletion of `refs/harness-telemetry/*` is permitted by the hosting config (same namespace we already push to; deletes ride the same `--no-verify` push path).

### Open Questions

None blocking. (Rolled-file internal framing — manifest shape, whether logs/metrics stay one pair or per-seq names inside one cumulative tree — is delegated to T002's implementation with the constraint that AC-08/AC-09 hold.)

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _None_ — the design decisions (one-commit rewrite, start-date key, manifest-based idempotency, migration protocol) are settled in the research dossier § Planning Handoff and this spec | | | |

### Clarifications

#### Session 2026-07-03

- Q: Workflow mode? → A: **Simple** (user: "simple plan").
- Q: Testing strategy? → A: **Hybrid (TDD core / lightweight wiring)** — resolved by orchestrator per standing autonomy, matching 034/047/048 convention.
- Q: Mock usage? → A: **Targeted fakes via ports** — repo's established fake-port pattern.
- Q: Documentation? → A: **Update existing docs in place** — layout change to a documented mechanism.
- User-stated requirements (verbatim intent): roll up to "a single file, that is fixed on start date of session"; "double check there will be no need to pull all telemetry in git to add more telemetry" (confirmed by research F-04 — holds today and under the rollup); "if we run telemetry sync and it finds refs that are old it should patch them all (for all users) on that first run".

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (dossier § Planning Handoff + this spec settle the design).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (F-01..F-10, H-01..H-04) |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No unresolved markers; Round 1 resolved (Simple + repo conventions) |
| G2 | Constitution | PASS | P12 named and honored via AC-09 (layout-only publication change, explicitly reviewed); P2 preserved (sync stays pure over ports; new git capability lands in adapters) |
| G3 | Architecture | PASS | Additive port methods on the existing git adapter seam; no service imports node:* |
| G4 | ADR Compliance | N/A | No docs/adr/ |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | TDD tasks precede implementation for the core (T002a/T004a); measurable criteria throughout |
| G7 | Domain Completeness | PASS | No registry (informal domains, consistent with prior plans); manifest covers all files |

### Summary

Rework `syncTelemetry` to publish one rolled, start-date-keyed ref per session via orphan-commit rewrite + forced single-refspec push, fixing both the ref chattiness and the F-03 tip-tree clobber data loss. Add a one-time, idempotent migration inside the sync verb that patches every old-shape ref (all users) by unioning full commit histories — simultaneously recovering all buried segments — and verify the whole thing on this repo's real 36 refs as the dogfood.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/sync-service.ts` | telemetry | internal | Core rework: per-session start-date shard, rolled tree, rewrite semantics, manifest idempotency, migration orchestration |
| `harness/cli/src/services/telemetry/session-export.ts` | telemetry | internal | Dual-shape read branch (rolled blob alongside per-seq) |
| `harness/cli/src/services/telemetry/sweep.ts` | telemetry | internal | Start-month membership; tolerate both ref shapes |
| `harness/cli/src/services/telemetry/cursor.ts` | telemetry | internal | `<session>.startdate` sidecar helper (beside `.flushed`) |
| `harness/cli/src/acts/telemetry.ts` | telemetry | internal | Sync verb: migration first-run pass wiring; help text |
| `harness/cli/src/adapters/fs/fs-port.ts` (+ exec/fake fs adapters) | git-adapters | contract | Additive: `deleteFile`/`removeDir` for the T007 buffer prune |
| `harness/cli/src/adapters/git/git-write-port.ts` | git-adapters | contract | Additive: ls-remote/fetch/delete-remote surface + new-shape ref helper |
| `harness/cli/src/adapters/git/exec-git-write.ts` | git-adapters | internal | Real impl (forced refspec ride existing push; `--no-verify` retained) |
| `harness/cli/src/adapters/git/git-read-port.ts` | git-adapters | contract | Additive: full-history tree walk for the migration union |
| `harness/cli/src/adapters/git/exec-git-read.ts` | git-adapters | internal | Real impl (rev-list + cat-file, still read-only verbs) |
| `harness/cli/test/services/telemetry/sync-service.test.ts` | telemetry | internal | Core TDD suite rework |
| `harness/cli/test/services/telemetry/sync-migration.test.ts` | telemetry | internal | New: migration union/verify/delete/idempotency/concurrency |
| `harness/cli/test/adapters/git/exec-git-write.int.test.ts` | git-adapters | internal | Real-git: forced refspec, remote delete, ls-remote/fetch |
| `harness/cli/test/adapters/git/fake-git-write.test.ts` | git-adapters | internal | Fake gains the new capabilities + call recording (AC-03 proof) |
| `docs/how/*.md` (telemetry pages naming the ref layout) | telemetry | internal | Layout description update |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | F-03 clobber: readers see only tip trees; each sync's tree holds only that run's segments — multi-sync refs silently lose earlier data (proven empirically; recoverable from parent commits) | One-commit-rewrite shape makes reads correct by construction; migration unions full histories to recover |
| 02 | High | F-04/H-01: append is fetch-free and single-writer by construction — the invariant the user requires | Preserve: rewrite builds from local ref tree + local buffer; AC-03 proves zero fetch on steady state |
| 03 | High | F-05/H-02: `push` passes refspecs verbatim (`+ref:ref` gives force with no port change); `--no-verify` is load-bearing against hook recursion | Use forced refspec at the call site; never strip `--no-verify` |
| 04 | High | F-08/H-04: `refTree === tree` idempotency breaks under rewrite; local-match ≠ remote-received | Manifest-carried max-seq watermark as the new guard; always re-push on match |
| 05 | High | F-10: no fetch/ls-remote on any port — migration needs additive adapter capability (the only sanctioned pull, one-time) | T001 adds it behind the ports (P2 intact) |
| 06 | Medium | F-06: readers key on per-seq filenames | T003 dual-shape branch; old branch retained for unmigrated/interim refs |
| 07 | Medium | F-07/H-03: sweep month from ref date; planned-refs discipline is load-bearing (048 CRITICAL) | Start-month semantics; keep exact-ref reads |

### Implementation

**Objective**: One quiet, complete, start-date-keyed ref per session — with a first-run migration that patches and repairs all existing refs.
**Testing Approach**: Hybrid — failing-first for sync core + migration; lightweight for wiring/docs (see Testing Strategy).

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Additive git-port capability: `lsRemoteTelemetryRefs()`, `fetchRef(ref)`, `deleteRemoteRef(ref)` on the write port; `listRefHistory(ref)` / read-tree-at-commit on the read port; real exec impls + fake-port impls with call recording | git-adapters | git-write-port.ts, exec-git-write.ts, git-read-port.ts, exec-git-read.ts, fake fixtures, exec-git-write.int.test.ts | Real-git int tests green for each verb; fakes record calls (enables AC-03 proof); read port keeps its read-only verb set (`rev-list`/`cat-file` only) | Per findings 05, 03 |
| [x] | T002a | Failing-first tests for the rolled writer: start-date ref key (multi-day → one ref), cumulative content across syncs (AC-02 with the F-03 mutation), fetch-free steady state (AC-03), manifest idempotency + re-push-on-match (AC-04) **including the divergent-remote case (local matches manifest watermark, remote holds a divergent orphan commit → forced re-push succeeds)**, `.startdate` sidecar derivation & persistence | telemetry | sync-service.test.ts, cursor.ts tests | New tests RED against current code for the right reasons | Write before T002 |
| [x] | T002 | Rework `syncTelemetry`: one shard per session keyed `<start-date>/<session>`; rolled tree (`session.logs.jsonl` + `session.metrics.jsonl` concatenated seq-ordered + `manifest.json` carrying format marker, session start date, max published seq); orphan-commit rewrite; **every push in the rolled path — including the idempotent-match re-push (H-04) — uses the forced `+ref:ref` refspec** (under rewrite semantics successive orphan commits are never ancestors, so a plain re-push NFFs against any divergent-sha/equal-content remote, e.g. after another clone's migration); manifest max-seq as idempotency guard; start date from `.startdate` sidecar → lowest-seq timecode → local ref scan; keep partial-spool fallback + watermark contiguity rules | telemetry | sync-service.ts, cursor.ts | T002a suite GREEN (incl. divergent-remote re-push case); full existing sync suite adapted and GREEN; header doc-comment rewritten to the new rationale | Per findings 01–04 |
| [x] | T003 | Dual-shape session reads: session-export reconstructs from a rolled shard (manifest + concatenated JSONL) and from legacy per-seq blobs; sweep gains start-month membership and tolerates both shapes | telemetry | session-export.ts, sweep.ts, their tests | AC-08 fixture pair (one legacy ref, one rolled ref) reads identically through `combineSessionFromRefs`; sweep month test covers a multi-day session (start-month only) | Per findings 06, 07 |
| [x] | T004a | Failing-first migration tests: full-history union recovers buried segments (fixture ref with disjoint parent/tip trees); all-users scope (sessions this clone never wrote); **pre-existing rolled ref containing a segment absent from all old refs → straggler migration preserves it**; verify-before-delete **plus the verify↔delete interleaving (a competing forced push lands between verify and delete → delete is skipped)**; today-refs excluded; re-run no-op; interleaved-runs convergence | telemetry | sync-migration.test.ts | Tests RED for the right reasons | Write before T004 |
| [x] | T004 | Migration pass in the sync verb. **Trigger predicate (local-only, AC-03-compatible)**: fires when a *local* old-shape ref dated < today exists AND no durable completion sentinel is present (`<telDir>/.migrated` sidecar, written after a clean pass); the triggering run does the one sanctioned ls-remote + fetch, so remote-only old refs (from clones that never re-run) are covered by whichever user triggers first. Pass: group fetched old refs by session; **per-session union = all trees across every old ref's full history ∪ the existing rolled start-date ref's full-history trees (when one exists)**; write rolled start-date refs; verify new ⊇ that combined union; **re-read the rolled ref's tip immediately before each old-ref delete and require it still ⊇ that ref's union — skip the delete otherwise (retry next run)**; delete old refs (remote + local); wrap in the existing fail-safe (`ok:false`, never throw); summary line in sync output | telemetry | sync-service.ts, acts/telemetry.ts | T004a GREEN (AC-05, AC-06); steady-state runs (sentinel present or no local old refs) skip the pass entirely — zero ls-remote (AC-03 holds) | The one sanctioned pull |
| [x] | T005 | P12 layout-only proof + docs: test asserting published event-stream bytes are the same OTLP JSONL as the per-seq shape re-serialized (no new fields); update sync verb help text + docs/how ref-layout mentions | telemetry | sync-service.test.ts, acts/telemetry.ts, docs/how | AC-09 test GREEN; docs name the new layout + migration behaviour | Publication boundary named per constitution P12 |
| [x] | T006 | Live dogfood on this repo: run the migration against the real 36 refs; verify one ref per session at start dates, June sweep/report totals ≥ pre-migration (recovered segments), steady-state re-sync fetch-free; record before/after counts | telemetry | (evidence in scratch/ + execution log) | All AC checks pass on real data; before/after ref+segment counts recorded | The proof-of-concept run |
| [x] | T007 | Post-flush buffer prune: after a shard's push succeeds AND the watermark durably advances AND the `.startdate` sidecar is persisted, delete that session's buffer files with seq ≤ the flushed watermark (`<seq>.json` + spool companions); a session dir whose watermark covers every seq and whose newest file is older than 14 days is removed whole (sidecars last). Never touch unflushed seqs; any prune error is swallowed (prune must never fail a sync). Needs additive `FsPort` delete capability (`deleteFile`/`removeDir`) + exec/fake impls | telemetry | sync-service.ts, cursor.ts, fs-port.ts + exec/fake fs adapters, sync-service.test.ts | Failing-first tests: flushed seqs deleted only after push+watermark+sidecar; unflushed seqs survive a partial flush; prune error → sync still `ok:true`; aged-out session dir removed; mutation (prune-before-watermark-advance) flips RED | Fixes the unbounded `.harness/temp/telemetry` growth (live repo: 100 MB / 104 entries) |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T002a, T002, T006 | start-date key tests; live dogfood |
| AC-02 | T002a, T002 | cumulative-content test + F-03 mutation RED |
| AC-03 | T001, T002a, T002, T004 | fake-port call recording: zero fetch/ls-remote steady-state |
| AC-04 | T002a, T002 | manifest max-seq idempotency + re-push tests |
| AC-05 | T004a, T004, T006 | full-history union + recovery fixtures; live migration |
| AC-06 | T004a, T004 | re-run no-op, interleaved convergence, verify-before-delete, today-exclusion tests |
| AC-07 | T003, T006 | sweep start-month test; live June totals comparison |
| AC-08 | T003 | dual-shape fixture pair |
| AC-09 | T005 | byte-equivalence test |
| AC-10 | T007 | prune safety suite (watermark/sidecar ordering mutation RED; unflushed-survival; error-swallow; age-out) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration race (two users' first runs) | Medium | High | Idempotent content-addressed rewrites; verify-before-delete; tolerate already-migrated/already-deleted (AC-06) |
| Old-CLI writer appends during/after migration | Medium | Medium | Only migrate refs dated < today; same-day stragglers migrate on a later run |
| Forced push rejected by hosting rules | Low | Medium | Same namespace already pushed; int test proves `+ref:ref` + remote delete early (T001) |
| Reader regression on legacy refs during transition | Low | High | Dual-shape branch with fixture-pair parity test (AC-08) retained until migration is universal |
| Watermark/idempotency subtle regressions (H-04 class) | Medium | High | Failing-first suite preserves the existing contiguity + re-push contracts before the rework lands (T002a) |
