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
