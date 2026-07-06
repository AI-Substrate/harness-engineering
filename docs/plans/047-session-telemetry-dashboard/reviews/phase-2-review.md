# Review — Phase 2: Reports, Rollups & Render

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → fixed → re-verified)
**Mode**: flow-pair cross-model review (orchestrator = Claude Opus 4.8 `pij-4s10mb`; **coder** = Copilot **claude-opus-4.8** (max) `pij-1ih6gj9`; **reviewer** = Copilot **gpt-5.5** (xhigh) `pij-1nh968q`, deliberately ≠ coder)
**Reviewed**: 2026-07-01 · **Target**: Phase 2 diff — `report.ts` (+ `report.schema.json`), `render/{report-html.ts,template.html,template.ts}`, `acts/telemetry.ts` (`report`/`report-render`/`session save` HTML), 3 test files
**Delegation**: dlg-0001 (build) → review FIX_REQUIRED → fix → APPROVE

## Dimension 0 — test non-vacuity (MANDATORY) — PASSED with reviewer-run mutation evidence
The reviewer independently mutated three load-bearing assertions and ran the suite:
1. `report.ts:317` `Math.min(e.count, coincident)` → `0` (bash no-double-count) → RED at `report.test.ts:151` (bash_command entries length 0 vs 1).
2. `report.ts:426-427` `output/keys.size` → unsplit `output` (token even-split) → RED at `report.test.ts:251` (100 vs 200).
3. `report.ts:502` `for (const exp of included)` → `included.slice(0,1)` (cross-session agg) → RED at `report.test.ts:182` (bash count 10 vs 5).
All reverted → GREEN. **Orchestrator additionally ran its own Dim-0 on the fix** (below).

## Findings (both fixed + regressed)
- **F1 · HIGH · P12 home-path leak** (`acts/telemetry.ts`, `report.ts:524/563`, render/embed): `--filter-repo` values were echoed **raw** into `report.filter.repo` + `provenance.repos` and inline-embedded into the committed HTML/JSON — `source_paths` were sanitized but the repo filter was not, so `--filter-repo /Users/alice/private` would ship a home path into a publishable report (AC-11 hard rail). **Verified real** by the orchestrator against source before dispatch.
  - **Fix**: sanitation moved into the **act** (`filterFromOptions(o,cwd):162` maps each repo value through the existing `sanitizeInputPath`; call site passes `deps.proc.cwd()`); `report.ts` **kept pure** (untouched — P2 preserved). repo stays echo-only (`matchesFilter` never reads it), so inclusion is unchanged.
  - **Regression** (`test/acts/telemetry.test.ts:564`): `report --filter-repo /Users/someone/secret/path` → asserts `filter.repo==['path']`, `provenance.repos==['path']`, and **no `/Users/`** in the report JSON *or* the inline-embed `index.html`.
- **F2 · MEDIUM · schema under-specified attribution**: `report.schema.json` `attribution.required` was `[tokens,time,exact]` — but `buildReport` always emits `bash_command_key`+`notes` (the D1 self-description). A report omitting them would wrongly validate.
  - **Fix**: added `bash_command_key`+`notes` to `attribution.required`. **Regression**: schema-required test (a report omitting them must NOT validate) + a "real emitted report satisfies every required key" test.

## Orchestrator sanity pass (independent — the last gate)
- Re-read the F1 fix: sanitation is in the act, `report.ts` git-clean (pure service boundary intact).
- **Ran my own mutation on the HIGH fix**: reverted `filterFromOptions:162` to `filter.repo = repo` → the P12 regression (`telemetry.test.ts:564`) **failed**; restored → green; mutation fully reverted. The regression genuinely catches the leak — not vacuous.
- Ran the 3 targeted suites: **54 passed**. Coder reports full `just checks` green + `vitest 1724/1724` (+3). The only `degraded` gates are **pre-existing** warn-launch (arch-check on the untouched `sync-service.ts`; markdown-lint in `harness-foundations/`+`harness-presentations/`) — baseline, not Phase 2's.

## Substrate decisions honored (D1/D2/D3)
- **D1**: `bash_command` keyed by shell-tool name (v2 scrubs argv at capture, P12), excludes co-timed `harness` events; **declared in `report.attribution.bash_command_key`+`notes`**. The argv-granularity restoration is tracked as **FX001** (post-P2).
- **D2**: `harness_command` from in-stream `HarnessEvent.verb` (session-export.ts out of scope).
- **D3**: `template.ts` (shipped string) ⇄ `template.html` (authored twin) with a real drift-guard test (`report-html.test.ts:106`).

## Disposition
APPROVE recorded. Phase 2 (T001–T010, incl. the live-smoke) is complete, cross-model-reviewed, fixed, and orchestrator-verified. Advances to Phase 3. FX001 carried as a tracked follow-up.
