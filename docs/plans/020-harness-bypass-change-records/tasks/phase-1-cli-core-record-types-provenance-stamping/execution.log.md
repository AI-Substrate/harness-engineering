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

## T005 + T006 — the two new core types (red→green) ✅
- **T005 (RED)**: scaffold + frozen-body-keys tests via the `CORE` registry (`harness-bypass` → cause/attempted/command/severity; `harness-change` → resolves/change_type/target; each body excludes the other's keys; locked enums pinned). 3 RED (types absent).
- **T006 (GREEN)**: created `core-types/harness-bypass.ts` + `core-types/harness-change.ts` (mirror `retro.ts`: `*_TEMPLATE` + 4-field `HarnessRecordType`, body keys + commented enums, no provenance keys in the template — those are spliced). Registered both at `registry.ts:40` → `coreRecordTypes = [retro, harness-bypass, harness-change]`. 24/24 green.

## T007 — list/doctor enumeration + end-to-end VERIFY ✅
- **Assertion-only** (KF-07, no production change): updated the doctor `record-types` test (2→4 available, 1→3 core, ordered `[retro, harness-bypass, harness-change, dev-survey]`, text rows for both new types); added a registry test (both new types `source: core`, no `entryPath`); extended the act `--list` test.
- **VERIFY (real CLI smoke)**: built dist, ran `harness record harness-bypass` in a throwaway git repo with env set → written record carried all 8 provenance keys exactly once (`repo` from **real `ExecGit.remoteUrl()`** = `git@github.com:acme/smoke.git`, `harness_version` = real `readVersion` `0.3.0`, `agent`/`plan_id` from env, `branch: null` = correct null-degradation on an unborn branch, `schema_version` template-owned at the tail) + the 4 body keys. `record --list` shows all 3 core types.
- Full suite **633 green**; biome clean (auto-wrapped one long description); typecheck OK.

---
