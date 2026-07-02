# Review — 049 Phase 1: telemetry ref rollup + migration + buffer prune (T001–T005, T007)

**Verdict**: ✅ **APPROVE** (2 × FIX_REQUIRED rounds → all findings fixed → narrow round-3 verification APPROVE + orchestrator sanity pass)
**Mode**: flow-pair cross-model (orchestrator Claude Fable 5 `pij-4s10mb`; coder Copilot claude-opus-4.8 `pij-e7dlvq`; reviewer Copilot gpt-5.5 `pij-1jgwusx`)
**Reviewed**: 2026-07-03 · **Gates**: full CLI **2018 / 164 files** green (baseline 1978/161, +40/+3) · scoped biome 0 · tsc 0 · no real sync/origin/checks touched by either peer (T006 dogfood is orchestrator-run, post-commit)

## What landed

- **T001 git-port capability**: write port + exec + fake gained `lsRemoteTelemetryRefs`/`fetchRef`/`deleteRemoteRef` (+ round-2: `readRefTree` local tree read); read port gained `listRefHistory`/`readTreeAtCommit` (rev-list/cat-file only — still read-only by construction). Fakes record calls (the AC-03 proof substrate).
- **T002 rolled writer** (TDD, RED-first shown): one ref per session at `refs/harness-telemetry/<start-date>/<session>`; orphan-commit rewrite; **forced `+ref:ref` on every push incl. the idempotent re-push**; rolled tree = `session.logs.jsonl` + `session.metrics.jsonl` (seq-ordered concat, new `rolled-shard.ts`) + `manifest.json`; `.startdate` sidecar → lowest-seq timecode → local ref scan; F-03 fixed (tip tree = whole session).
- **T003 dual-shape reads**: session-export rolled branch (additive to legacy per-seq + temp); sweep needed no key change — start-date keying makes month membership start-month by construction.
- **T004 migration** (TDD): local-only trigger + `.migrated` sentinel (AC-03-safe); ls-remote ∪ local, fetch remote-only; full-history union via `listRefHistory` (recovers clobbered segments) **∪ any existing rolled ref** (straggler can't clobber); verify; **TOCTOU re-check before each delete**; sentinel only on a fully-clean pass.
- **T005 P12 proof + docs**: raw-byte equivalence tests for both OTLP streams with opaque fixtures; docs/how + verb help updated.
- **T007 buffer prune (scope-add, plan v1.1.0)** via **Option A**: writer unions the **local rolled ref tree (flushed truth)** with the **buffer (unflushed delta)** — the design fork T007 exposed (prune vs buffer-only rebuild would have reintroduced F-03) — then prunes seqs ≤ the durable watermark, sidecars last, 14-day age-out, errors swallowed. FsPort gained `deleteFile`/`removeDir`.

## Review rounds

**Round 1 — FIX_REQUIRED.** Dim-0: all 5 mandated mutations RED-verified (pending-only rebuild → AC-02 RED; unforced re-push → AC-04 RED; union-without-rolled-ref → straggler RED; inverted TOCTOU → RED; steady-state ls-remote → AC-03 RED). Findings: **F1 HIGH** — the AC-09 "byte-equivalence" P12 test was laundering-vacuous (reviewer's parse+re-stringify mutation PASSED it); **F2 MED** — `pushed` contract mismatch on the idempotent re-push path; **F3 MED** — stale old-shape comments in three files. Fixed: raw-blob equality + opaque fixtures (laundering mutation now RED, mirrored for metrics); `pushed` pinned as "fresh commit published" with test; comments rewritten.

**Round 2 — FIX_REQUIRED (on the new T007 delta).** F1–F3 verified fixed (reviewer re-ran its own laundering mutation). T007 Dim-0: 5 fresh mutations all RED (union-drop, prune-ordering, unflushed off-by-one, error-propagate, remote-verb injection — plus positive assert that `readRefTree` IS called). Fresh finding: **HIGH — ENOBUFS silent truncation**: `ExecGitWrite.run` had no `maxBuffer` (spawnSync dies ~1 MiB — reviewer verified empirically) and `readRefTree` skipped failed blob reads → a >1 MiB roll could be silently truncated and **force-pushed over the good ref** (the F-03 loss class via ops). Fixed: shared `GIT_MAX_BUFFER` (64 MiB, `exec-git-limits.ts`) across both adapters; `readRefTree` fails closed (null = clean-absent only; every partial-read path throws → sync `ok:false`, ref/buffer/watermark untouched); >1 MiB real-git round-trip test (RED without the cap) + fail-closed service test (RED if partial trees pass through).

**Round 3 — APPROVE (narrow).** Reviewer verified both fixes at source, re-ran both tests, mutation-checked the cap (1 MiB → ENOBUFS RED), confirmed full gate 2018/164.

## Orchestrator sanity pass

Re-read `readRefTree` at source post-approve: fail-closed semantics and comments match the verdict's story exactly. Dim-0 evidence was concrete (file:line + RED assertions) in every round. Mid-phase design decision recorded on the flight plan: **Option A** (union writer) chosen over descoping T007 — it completes the plan's own design item 02 rather than deviating.

## Disposition

APPROVE recorded. Remaining in Phase 1: **T006 live dogfood (orchestrator)** — before-state captured (`scratch/dogfood-049/before-refs.txt`): 36 refs / 28 sessions / 19 multi-commit refs / **390 buried files** to recover.
