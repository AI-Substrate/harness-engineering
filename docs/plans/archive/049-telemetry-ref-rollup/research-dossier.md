# Research Dossier: Telemetry ref rollup — one quiet ref per session + old-ref migration

**Generated**: 2026-07-03T07:15:00Z
**Query**: "telemetry committed to git is too chatty — roll up local telemetry to a single file per session keyed on session START date (multi-day session = one file at start date); double-check appending never needs to pull all telemetry; and first-run sync should patch all old refs (for all users)."
**Effort**: Standard
**Tools**: Standard
**Evidence**: 10 current sources · 4 historical sources

## Answer

1. Today sync publishes one ref per **(capture-date, session)** with a commit per sync and two files per segment — a multi-day session leaves a ref-per-day trail (this repo: 36 refs / 28 sessions; one session spans 6 day-refs with 28–67 files each). That is the chattiness.
2. **A live data-loss bug makes the rollup more urgent than cosmetics**: each sync's commit tree contains *only that run's* segments (clobber, not append), while every reader reads *only the tip tree* — so on any ref synced more than once, all earlier syncs' segments are invisible to report/sweep/insights. Empirically proven: one ref's parent commit holds 93 files, none of which appear in the 67-file tip. The data is still reachable in parent commits — recoverable, not gone.
3. The **fetch-free append invariant already holds and survives the rollup**: sync builds on the *local* ref tip, and shards are single-writer by construction (a session's buffer lives in the clone's gitignored `.harness/temp`, so the same clone is always the writer). Rolling up needs previous file content — readable from the local ref tree via `cat-file`, no network.
4. The quietest correct shape is **one ref, one commit, one rolled-up file (or logs+metrics pair) per session**, keyed `refs/harness-telemetry/<start-YYYY/MM/DD>/<session>`: each sync rewrites the ref with a fresh orphan commit and force-pushes the single refspec (`+ref:ref` — the existing `push` verb passes refspecs verbatim, so no port change). Tip tree = everything, always; reads become correct by construction.
5. The **migration is the only pull, once per repo**: first-run sync detects old-shape refs (or any ref dated before today), `ls-remote`s the namespace, fetches old refs, unions each ref's trees **across its full commit history** (simultaneously repairing the clobber losses), rewrites to start-date-keyed rolled-up refs, verifies, then deletes the old remote refs. Neither git port has fetch/ls-remote today — a small additive port capability.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | Ref key is per (capture-date, session): `refs/harness-telemetry/<YYYY/MM/DD>/<session>` | `harness/cli/src/adapters/git/git-write-port.ts:51` | Multi-day session → one ref per day; the key must become the session **start** date | High |
| F-02 | Measured chattiness: 36 refs for 28 sessions; session `15eaa924…` spans 6 day-refs; sampled refs carry 28/67/93 files and up to 6 commits | `git for-each-ref refs/harness-telemetry/**` (live repo, 2026-07-03) | Quantifies the problem; target shape is 1 ref / 1 commit / 1–2 files per session | High |
| F-03 | **CRITICAL clobber bug**: each sync's tree is built from only that run's blobs (`mktree(shard.blobs)`, no parent merge); readers peel only `<ref>^{tree}` — earlier syncs' segments are invisible | `sync-service.ts:358` · `exec-git-read.ts:54` · proof: `refs/…/2026/06/24/15eaa924…` parent tree (93 files) ∩ tip tree (67 files) = ∅ | Rollup must union full history; June dogfood undercounted multi-sync sessions; every further sync buries more | High |
| F-04 | Append is fetch-free and single-writer: `flushShard` builds on local `refTip`; session buffer lives in the clone's gitignored temp dir | `sync-service.ts:340-373` · `sync-service.ts:27-33` (WHY SHARD) | The user's no-pull invariant holds today and under the rollup (previous content read from local ref tree) | High |
| F-05 | `push` is `git push --no-verify origin <refspec>` — refspec passed verbatim, so `+ref:ref` (forced) works with no port change; `--no-verify` is load-bearing (recursion hazard) | `exec-git-write.ts` push() | One-commit-rewrite semantics need only a `+` prefix at the call site; never remove `--no-verify` | High |
| F-06 | Readers key on per-seq filenames (`<seq>.json` / `<seq>.logs.jsonl`) when reconstructing sessions | `session-export.ts:282-318` | Rolled-up blob needs a new read branch (or preserve per-seq names inside the rolled file); old branch must stay for unmigrated refs during transition | High |
| F-07 | Sweep month membership is parsed from the ref's date path; export cache fingerprints the planned ref set | `sweep.ts:78-90` · `acts/telemetry.ts:1150-1157` | Start-date keying = a session belongs to its **start month** (semantic decision, matches the ask); one-ref-per-session simplifies `combineSessionFromRefs` | High |
| F-08 | Idempotency guard H5 is `refTree(ref) === tree` (skip duplicate commit, re-push) | `sync-service.ts:359-366` | Breaks under rewrite semantics (tree changes every sync by design) — replace with a seq-watermark equality check (e.g. max published seq in commit message or a manifest blob) | High |
| F-09 | Buffer seq files are never pruned locally; the `.flushed` watermark sidecar pattern exists | no unlink/remove in `cursor.ts`/`capture-service.ts` · `sync-service.ts:74-91` | Session start date is derivable (lowest-seq timecode) and should be persisted as a `<session>.startdate` sidecar beside `.flushed`; fallback: local ref scan `*/<session>` | High |
| F-10 | Neither git port has fetch/ls-remote (read port is deliberately local-only: for-each-ref + cat-file) | `git-read-port.ts:9-16` · `git-write-port.ts` surface | Migration needs additive port capability: `ls-remote` (names, cheap) + fetch of old-shape refs — the one sanctioned pull, once | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Sharding chose per-(date,session) refs precisely to make every push single-writer/contention-free (Gerrit/GitHub pattern) | `sync-service.ts:23-34` (034 Phase 4 rationale) | Direct | Per-session start-date keying **keeps** the single-writer property (a session is written by one clone); the rationale survives the rollup |
| H-02 | Push-triggered checks gate recursed (load avg 175) → telemetry pushes are hook-immune by design | `exec-git-write.ts` push() comment · prepush-checks-recursion memory | Direct | Migration pushes/deletes must also go through the `--no-verify` path |
| H-03 | 048 P1 CRITICAL: month sweep leaked cross-month data by re-globbing all of a session's refs; fixed by reading exactly the planned ref set | `docs/plans/048-cohort-telemetry-insights/reviews/p1-measures-foundation-review.md` | Direct | One-ref-per-session eliminates this class; sweep's planned-refs discipline must be preserved through the change |
| H-04 | Companion HIGH (run 0d3a): local ref-tree match ≠ remote received it — re-push even on idempotent no-op | `sync-service.ts:350-357` (H5 comment) | Direct | Whatever replaces H5 must keep the always-re-push-on-match behaviour |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Migration concurrency: two users' first-run syncs race on the same old refs | F-10 (multi-clone team scale is the design premise, H-01) | Racing rewrites/deletes could drop a ref | Idempotent design: content-addressed rewrites converge; delete an old ref only after verifying the new ref's tree ⊇ old ref's full-history union; tolerate already-deleted |
| Old-CLI writer appending to an old-shape ref mid-migration | F-01/F-04 | A patched-then-deleted ref could lose a concurrent append | Only migrate refs whose date is **before today** ("old refs" per the ask); today's refs migrate on a later run |
| The clobber bug keeps losing data until this ships | F-03 | Every sync on a multi-sync ref buries more segments (recoverable but invisible) | Phase 1 ships the fixed write path first; consider a fast interim fix if ship slips |
| Ref-shape change is a publication-surface change | P12 (constitution) — payload content is unchanged (same counts-only JSONL), but layout/naming changes | Publication-boundary changes require explicit named review | Name P12 explicitly in the plan; content unchanged, layout only |
| Rolled-file format vs per-seq filenames | F-06 | Readers reconstruct by seq; a naive concat loses seq boundaries | Keep per-seq framing inside the rolled file (JSONL lines already carry structure) or a manifest; decide at plan time |

## Planning Handoff

- **Preserve**: fetch-free append (F-04) · single-writer-per-ref (H-01) · `--no-verify` push path (H-02) · always-re-push on idempotent match (H-04) · sweep's planned-refs discipline (H-03) · frozen segment schema + local buffer as reconstruction oracle.
- **Change carefully**: `sync-service.ts` (whole shard/flush/watermark core) · `session-export.ts` seq-keyed read branch (must stay dual-shape during transition) · H5 idempotency replacement (F-08).
- **Likely files/symbols**: `sync-service.ts` (rework) · `git-write-port.ts`/`exec-git-write.ts` (+ls-remote/fetch, forced refspec at call site) · `git-read-port.ts`/`exec-git-read.ts` (possibly history-walk for migration union) · `session-export.ts` (rolled-blob branch) · `sweep.ts` (start-month semantics) · `acts/telemetry.ts` (sync verb: migration first-run pass) · tests: `sync-service.test.ts`, `exec-git-write.int.test.ts`, `fake-git-write.test.ts`, `git-read.test.ts`, `sweep*.test.ts`, `telemetry.test.ts`.
- **Decisions still required**: one-commit-rewrite (recommended) vs parent-chained append · rolled-file internal framing (per-seq-named blobs in one tree vs single concatenated JSONL) · migration trigger ("first run that sees an old-shape ref" — detection marker for new-shape refs) · whether migrated-away old refs are deleted remotely or left tombstoned.
