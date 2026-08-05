# Validation — flow-reconcile-cli-trigger-plan (Route A, v2.0.0)

**Validated**: 2026-06-28 (regeneration)
**Target**: `docs/plans/039-flow-reconcile-cli-trigger/flow-reconcile-cli-trigger-plan.md`
**Scope**: adaptive — lead deterministic proof + lead adjudication (zero extra workers; direct proof settled the risks)
**Verdict**: ✅ **VALIDATED WITH FIXES** — 2 findings (1 MEDIUM, 1 MEDIUM→HIGH), both addressed in-plan. Open to the peer's consumer-side review next.

> This plan **replaces** the v1 reconcile-on-read design (and `f9a86f1`). The v1 validation findings tied to that mechanism (D1 watch-set, D6 guard, F3/F4, C1/C3) are **retired** with the mechanism. Mechanism-independent invariants carry forward: roster-blind CLI, R-1 create/lifecycle split, **D5** (no terminal resurrection).

## Proof (deterministic, read against current source)

| Claim | Source | Result |
|---|---|---|
| `flow-mutations` are **pure** doc→doc (no disk write) → atomic `apply` is feasible | `flow-mutations.ts` exports `addNode:399`/`setNode:445`/`insertNode:590`; **no `writeFile`/`fs.write` in the file**; the write is in the act (`acts/flow.ts:801` `svc.fs.writeText`) | ✅ confirmed — AC-01 sound |
| `dagIssue` reusable for remove/mv/apply re-check | `flow-mutations.ts:538` `export function dagIssue` | ✅ confirmed — Finding 03 |
| `create --template <path>` BYO seed exists; no `flight-plan` seed today | `acts/flow.ts:151-152`; `schemas-content.ts:67,124` (only adopt/loop) | ✅ confirmed — Findings 01/02, F-09/F-10 |
| No `remove-node`; `set-node` can't re-parent | no remove verb in `acts/flow.ts`; flight-plan-ops.md:88 | ✅ confirmed — the gap this plan fills |
| `insert-node` splices + rewires, `E309` re-check | `acts/flow.ts:553-566`; flight-plan-ops.md:87 | ✅ confirmed — Finding 03 |

## Findings (both addressed)

| # | Sev | Finding | Fix applied |
|---|-----|---------|-------------|
| F1 | MEDIUM | AC-02 forward-ref resolution was under-specified — `insertNode` rewires edges incrementally, so a strictly-sequential apply would fail a forward reference | AC-02 + T007 now specify a **two-phase apply**: materialize all node creates/upserts → wire edge positions → validate final DAG once; ordering within a batch is irrelevant |
| F2 | MED→HIGH | AC-04 D5 had a **batch-laundering loophole** — `remove`-then-re-`add` of the same `done` id in one batch resurrects it (re-add sees it absent → `todo`) | AC-04 + T004 now make the guard **batch-wide**: terminal ids are tracked across the whole batch; a removed terminal id re-added preserves terminal status or the batch is refused |

Sound on direct proof (no fix needed): AC-01 atomicity (mutations are pure), roster-blindness (all new verbs operate on generic ops; AC-07; template/expander are peer-side), AC-09 op-completeness (the agent reads the graph and supplies ids, so "insert N phases between X and ship" is expressible once AC-02's two-phase resolution holds).

## Thesis

Purpose met: the plan delivers a **complete, transactional, idempotent, roster-blind** node-mutation surface (`apply`/`upsert`/`remove`/`mv`) that is the foundation for pre-baked templates + additive expansion — without spawn-on-read. Target proof = actual proof: the atomicity and reuse claims were read against source, and the two correctness edges (forward-ref mechanism, batch D5) are now closed.

## Consumers / forward-compat

Cross-repo: the-flow (peer) ships the `--template` seed + the additive plan-complete expander (which emits an `apply` batch) + `harness-seams.md`. The primitives are **generic** so they don't encode the-flow's shape — drift risk is low. **Open for peer (AC-09 / Q1)**: confirm the additive/stable-anchor template avoids needing `remove`/`mv` at expansion time, or that using them there is deliberate; and confirm the `apply`-batch op vocabulary is sufficient for the expansion the expander wants to emit.
