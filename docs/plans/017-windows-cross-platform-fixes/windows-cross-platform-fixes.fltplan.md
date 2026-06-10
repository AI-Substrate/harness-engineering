# Flight Plan — windows-cross-platform-fixes (017)

**Status**: Landed — build complete (T000–T015 all done; CI fully green incl. package-smoke first green); next: /plan-8 merge (typed PROCEED only)
**Plan**: [windows-cross-platform-fixes-plan.md](./windows-cross-platform-fixes-plan.md)
**Mode**: Simple
**Spec**: [windows-cross-platform-fixes-spec.md](./windows-cross-platform-fixes-spec.md)

## Journey Map

```mermaid
flowchart LR
  classDef done fill:#C8E6C9,stroke:#2E7D32;
  classDef active fill:#FFE0B2,stroke:#EF6C00;
  classDef pending fill:#ECEFF1,stroke:#90A4AE;

  R["Research (external dossier)"]:::done --> S["Spec /plan-1b ✅ validated"]:::done --> BP["Backpressure /plan-2d ✅ Partial"]:::done --> P["Plan /plan-3 ✅ READY"]:::done --> B["Build /plan-6 ✅ companion"]:::done --> M["Merge /plan-8"]:::active
```

## Phases Overview

| Phase | Title | Status |
|-------|-------|--------|
| 1 | POSIX logical paths + Windows-shape sensors + package-smoke repair (T000–T015) | **Complete** |

## Flight Log

### 2026-06-10 — Spec drafted
Spec written from `scratch/cross-system-failure.md` (5 categories, 40 Windows test failures, none logic defects) + the flow-start discovery that `package-smoke` is red on all branch runs (gen-docs stdout pollutes `npm pack` capture). 10 ACs; headline sensors: a `windows-latest` CI leg (AC-8) and a green `package-smoke` (AC-9) — the deterministic backpressure the user mandated. Round 1 adopted on recommended defaults (Simple / Hybrid / targeted mocks / convention-in-idioms docs) per the user's run-through directive.

### 2026-06-10 — Spec validated (VALIDATED WITH FIXES)
validate-v2, 3 agents (evidence / contract-testability / adversarial-risk). Key fixes applied: Cat A scope extended to `doctor-service.ts` + `instructions-service.ts` (native path math on `entryPath`, masked by POSIX-keyed fakes); package-smoke found double-broken (`npm pack --json` promoted to primary capture; the `E143` greps are unsatisfiable today — flat fixture never created, restored in AC-9); POSIX-space edge cases pinned (drive-letter case, literal `'../'`, dedupe keys, all unit-mandated); Windows leg pinned as a minimal job (no `check:docs`, `.gitattributes eol=lf`, `ci-required` gate update). Non-Goaled with rationale: `NodeExec` extensionless-bin resolution (`skills` npx, arch-check depcruise).

### 2026-06-10 — Backpressure survey (Certainty: Partial)
`/plan-2d` (eng-harness-2-backpressure) → `backpressure-coverage.md`. 9 existing sensors inventoried — **all ubuntu-only** (`grep -ri windows .github/workflows` → 0 hits): the single fact behind the invisible 40 failures. First pass recommended a minimal `windows-latest` leg as the keystone Phase-0 sensor.

### 2026-06-10 — Amendment: no Windows CI executor (user decision)
User (verbatim): *"we will not have a windows server in ci... remove anyting that needs that..."* Spec + survey regenerated. AC-8 rewritten from the CI leg to **Windows-shaped-input unit tests on ubuntu** — `FakeProcess.cwd()` seeded with `C:\repo`-style backslash paths across the five fixed services; native `join` leaks a backslash into an envelope assertion and fails deterministically on Linux. Residual real-Windows rows (AC-5 assertion forms, jiti, shell spawns) honestly ABSENT by decision → one-off manual re-port (`verify-port.ps1`), recorded in the execution log. Phase 0 now: pure POSIX-helper tests · Windows-shaped cwd fixture set · package-smoke repair (`npm pack --json` + flat fixture) · `.gitattributes eol=lf`. Certainty stays Partial.

### 2026-06-10 — Plan written (/plan-3-v3-architect → READY, v1.1.0)
Single-phase Simple plan, 16 task rows (T000 boot · T001–T014 working tasks · T015 retro drain); all gates PASS (G4 N/A — no ADRs). Backpressure Phase 0 folded in as the leading sensor tasks (helper tests RED → helper GREEN → FakeFs tolerance → Windows-shape fixture set). Research subagents contributed two empirical corrections before validation even ran: **`npm pack --json` is NOT immune to lifecycle stdout** (verified live on npm 11.10.0 — the gen-docs `console.log` interleaves into the JSON stream, so the stderr move T010 is the load-bearing fix and `--json`+`jq`+`*.tgz`-assert is the loud guard), and **`posix.resolve()` corrupts drive-letter paths** (treats `C:/repo` as relative — helper is normalize/join-only). E143 fixture shape confirmed from `discovery.ts:66-71` (flat `legacy.ts`); `.gitattributes` zero-churn verified. validate-v2 (3 agents) then confirmed all 22 factual claims and tightened four task specs: UNC leading-`//` collapse under `posix.normalize` pinned (guard/reattach), T008's FakeFs seeding form + revert-proof made explicit, doctor `:291` both-sides-POSIX comparison clause, CI fixture placement pinned between `ci.yml:161` and `:167`. Next: `/plan-6` (companion variant recommended).

### 2026-06-10 — Build complete (/plan-6 companion, single phase T000–T015) ✅

All 16 tasks landed; suite grew 380 → **434 tests, green throughout** (every commit suite-clean); `arch-check` ok (67 modules, 0 violations). Delivered: `services/shared/posix-path.ts` (normalize/join-only, UNC-guarded, explicit `caseInsensitive` — 37 tests incl. the raw `posix.normalize('//server/share')` collapse pin) · separator-tolerant FakeFs · five services converted with **discovery as the single POSIX origin** · path-safe assertions · the **Windows-shape sensor** (11 tests, `FakeProcess.cwd()='C:\repo'`, **revert-proven**: native-join boundary reversion fails it — drive-letter normalization is unique to `toPosix`) · shell-free EPIPE test + Windows-safe npm guard · gen-docs stderr + `process.execPath` biome · package-smoke repair (`npm pack --json`+`jq`+`*.tgz` assert; flat `legacy.ts` fixture restored) · `.gitattributes` (zero churn) · idioms §11.

**CI: fully green at `b789ddf` (run 27269892006) — build-test (22) + (24) AND package-smoke (its first green), ci-required ✓.** Getting there surfaced an unplanned defect class: `package.json#bin` pointed at untracked 644 tsc output, and `npx --no-install` resolution of the root package's own bin proved **nondeterministic across npm majors** (green→red on identical trees/versions; wrapper fixed npm 10 only). Fixed in-theme: committed `harness/cli/bin/harness.js` at git mode **100755** + CI invokes the verb node-direct. Retro drain (T015) materialized 5 buffer entries → `.harness/records/retro/2026-06-10/008-017-windows-build-drain.md`. Companion reviewed every commit (16 pings); its farewell carried **4 MEDIUM findings** (inbox never surfaced them mid-phase — DL-001 channel asymmetry recurrence), **all addressed inline post-farewell**: UNC root-kind guard in `isWithin` (+3 tests), AC-2 source guard banning `node:path` in the five services (+5 tests), idiom §11 scope fix, self-repo invocation docs (`node harness/cli/bin/harness.js` in AGENTS.md / AGENTS_README.md). Final suite **442/442**; companion retro → `009-017-companion-farewell.md`. Next: `/plan-8` merge (typed PROCEED only).
