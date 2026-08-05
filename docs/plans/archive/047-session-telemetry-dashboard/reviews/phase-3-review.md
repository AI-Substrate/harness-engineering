# Review — Phase 3: Fleet Scale & Docs

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → fixed → orchestrator-verified)
**Mode**: flow-pair cross-model review (orchestrator = Claude Opus 4.8 `pij-4s10mb`; **coder** = Copilot **claude-opus-4.8** `pij-lf4lay` (fresh — replaced the stalled `pij-1ih6gj9`); **reviewer** = Copilot **gpt-5.5** `pij-1nh968q`, deliberately ≠ coder)
**Reviewed**: 2026-07-01 · **Target**: Phase 3 diff — the read-only git-ref source (`git-read-port.ts`/`exec-git-read.ts`/`fake-git-read.ts`), `combineSession` logs-rooted reconstruction + `session save --source git-ref|auto` (`session-export.ts`, `acts/telemetry.ts`, `app.ts`), central-layout + docs (`central-layout.test.ts`, `docs/how/telemetry-reports.md`), the P12 publication-boundary scan, 3 new test files + act tests
**Delegation**: dlg-0002 (build, recovered from a mid-run coder stall) → review FIX_REQUIRED → fix → APPROVE

## Dimension 0 — test non-vacuity (MANDATORY) — PASSED with reviewer-run mutation evidence
The reviewer independently mutated **all four** load-bearing assertions and ran the suite:
1. **Logs-rooted reconstruction** — `session-export.ts:297` logs-jsonl discovery → `const l = null` → RED at `git-read.test.ts:116` (`segment_count` 1→0; identity collapsed at `:136`). Reverted → GREEN.
2. **Read-only invariant** — injected `git checkout --orphan …` into `exec-git-read.ts:54` `readShardTree` → RED at `git-read.test.ts:282` (porcelain `A README.md`, not byte-identical). Reverted → GREEN.
3. **Publication-boundary scan** — planted `/Users/alice/secret` into a central fixture → RED at `publication-boundary.test.ts:112`; the scoped `user.email` carve-out tests stayed green (no false-fail on the 034 write-path read). Reverted → GREEN.
4. **Central-layout sweep** — moved the `acme-org__api-svc` fixture repo outside the root → RED at `central-layout.test.ts:99` (org sessions 4→2). Restored → GREEN.

## Finding (fixed + regressed + orchestrator-verified)
- **F1 · HIGH · `--source auto` did not shadow temp at the SEQ level** (`acts/telemetry.ts` `shardCombineFs`, `session-export.ts:298-306` json-branch, `git-read.test.ts` auto test): `shardCombineFs` shadowed temp by **exact filename**, but a canonical git shard is `<seq>.logs.jsonl`+`<seq>.metrics.jsonl` while temp is `<seq>.json` — different names, so nothing shadowed. `readSessionSeqs` took the **json branch whenever `<seq>.json` existed**, so for a seq present in both sources `auto` read the **temp** json for identity/tokens while stamping `source.kind:'git-ref'` → silent temp contamination. **Verified real by the orchestrator against source** (reviewer probe: temp `0.json` `temp-harness` + git shard → auto returned `temp-harness`, not `copilot-cli`).
  - **Fix**: `seqOfShardName()` + a `gitRefSeqs` set; `readdir` drops every temp `<seq>.{json,logs.jsonl,metrics.jsonl}` whose seq git-ref owns, and `readText` returns the git-ref blob-or-`null` for a shadowed temp file — never temp bytes. **git-ref wins any seq it has; temp fills only gaps.** `report.ts`/services untouched (pure boundary preserved).
  - **Regression** (`git-read.test.ts` — "auto shadows temp at SEQ granularity"): temp `0.json` (identity `temp-harness`, `leaked-temp-model`, 999_999_999 tokens) + a git-ref shard for the **same seq 0** (`copilot-cli`) + a temp-**only** seq 1 → asserts identity comes from git-ref, **no** temp leak, and the temp-only seq still contributes (`segment_count=2`).

## Orchestrator sanity pass (independent — the last gate)
- Re-read the F1 fix (`shardCombineFs` seq-shadow): correct — `readdir` drops shadowed temp seqs, `readText` refuses temp bytes for a git-ref seq.
- **Ran my own mutation on the HIGH fix**: neutralized `tempShadowed` (`&& false`) → the auto regression **failed** at `git-read.test.ts:329` (`identity.harness` = `temp-harness` leak); restored → GREEN; mutation fully reverted (0 residue). The regression genuinely catches the contamination — not vacuous.
- Ran the git-read suite: **11 passed**. Coder reports full `just checks` green + `vitest 1753/1753`.
- **Gate honesty verified**: `harness arch-check` shows the sole violation is the **pre-existing** `sync-service.ts → git-write-port.ts` (034/038) — Phase 3's new `adapters/git/*` + `session-export.ts` change added **no** new violation. markdown-lint degraded is the pre-existing `first-principles.md` baseline; `telemetry-reports.md` lints clean.

## Substrate decisions honored
- **AC-08**: `session save --source git-ref` reconstructs from the committed OTLP-logs-only shard (no `<seq>.json`) → non-empty `SessionExport` + identity from `harness.*` resource attrs; `git status --porcelain` byte-identical (read-only port: only `for-each-ref`/`cat-file`). `auto` = git-ref-shadows-temp union in one combine (now seq-correct).
- **AC-09**: central layout `<root>/<repo>/<YYYY-MM-DD>/<format>/<leaf>` + sweep-granularity test (session/repo/org).
- **AC-11**: publication-boundary scan (non-vacuous) — no `/Users/`/session-id/name leak in tracked 047 artifacts; `user.email` assertion scoped to the read/export path, 034 write-path read carved out.
- **AC-12**: `docs/how/telemetry-reports.md` — three verbs, JSON shapes, central layout.

## Disposition
APPROVE recorded. Phase 3 (T001–T008) is complete, cross-model-reviewed, one HIGH temp-contamination bug found + fixed + orchestrator-verified. This is the terminal phase — advances to **Ship**. FX001 (bash-signature capture) + the case-3 unquoted-param-capture idea remain tracked follow-ups.
