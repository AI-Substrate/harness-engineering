# Execution Log — Phase 1: CLI core: record types + provenance stamping

**Plan**: [../../harness-bypass-change-records-plan.md](../../harness-bypass-change-records-plan.md)
**Branch**: `020-harness-bypass-change-records` (off `f47a08a`)
**Companion**: `code-review-companion` (minih) — booting in parallel; reviews every commit
**Started**: 2026-06-16 · **Testing**: Full TDD, fakes over mocks (P2/P3)

---

## T000 — Pre-implement harness seam ✅
- Fired `/eng-harness-flow --event pre-implement --phase "Phase 1…" --plan-dir … --json`.
- This repo is the worked example: **S0** (CLI+doctor), **S2** (governance `.harness/engineering-harness.md`), **S4** (boot = CLI vitest suite) all hold → engineering dispatch, route to **boot --validate**.
- Boot ran the CLI vitest suite — verdict **`healthy`**: 64 files / **617 tests pass**, ~0.9s. Green baseline confirmed before any code.
- Decision: `route` → proceed to tasks.

---

## T001 + T002 — `GitPort.remoteUrl()` (red→green) ✅
- **T001 (RED)**: added `remoteUrl` cases to `fake-git.test.ts` (seeded url / no remote / not-a-repo → null + an `ExecGit` string-or-null smoke). Confirmed RED: `TypeError: …remoteUrl is not a function`.
- **T002 (GREEN)**: `remoteUrl(): string | null` added to `GitPort`; `ExecGit` runs `git remote get-url origin` → null on non-zero exit **or** empty trimmed stdout (mirrors `currentBranch`); `FakeGit` returns `state.remoteUrl ?? null` and records the call. Suite: 5/5 green.
- Decision: `origin`-only is the deliberate Phase-1 contract (a non-`origin` remote → null); base `HEAD` SHA stays OUT (D4).

---

## T003 + T004 — provenance splice + deps wiring (red→green) ✅ *(heaviest task)*
- **T003 (RED)**: added the 8-key coverage test + null-degradation (integration via `createRecord` on `retro` — the collision type) and pure-helper tests (idempotency / in-fence position / YAML-safe). Confirmed RED: 2 integration tests failed (raw template lacks `record_kind`/`branch: null`); the 3 helper tests already passed.
- **T004 (GREEN)**: new pure `services/record/provenance.ts` — `spliceProvenance(template, fields)` splits on the first `---\n` via `indexOf`/`slice` (NOT `split(…,2)`, which would drop the body), **strips any existing top-level decl of the 7 keys then prepends** the stamped block, leaves `schema_version` untouched, idempotent, double-quotes values (`JSON.stringify`), null bare.
- Deps: `git`/`env`/`version` added to `RecordDeps` + `git`/`env` to `RecordActDeps`; `version` threads as a new `registerRecordAct(…, version)` arg (precedent `registerUpdateAct`); `git`/`env` ride in via `VerbActDeps`. Service builds the 7 fields from `git.currentBranch()`/`remoteUrl()`, `clock.nowIso()`, `env.get(HARNESS_AGENT/HARNESS_PLAN_ID)` (→ null when unset), injected `version`.
- 3 test helpers updated (`depsAt` ×2, `depsWith`) so all prior record tests compile + pass.
- **Discovery (decision)**: `RETRO_TEMPLATE` already declares `agent`/`plan_id`; a naive prepend would dup the keys (scanner's YAML parse would read the placeholder). Resolved with **strip-then-prepend** → every written record (incl. retro) carries all 8 keys exactly once, stamped not placeholdered. Satisfies AC-3 + AC-5 + KF-01/02/03.
- Verify: full suite **626 green**; P2 grep clean (no `node:*` in `record-service.ts`/`provenance.ts`); `tsc --noEmit` OK.

---
