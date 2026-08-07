# Fix task — `harness flow` forward-ref / dangling-edge validation gap

**Plan**: 024-first-class-flow-system · **Type**: fix (follow-up to the shipped CLI — not a new plan)
**Found**: 2026-06-19, via agent feedback on `the-flow` flight plans · **Branch**: stay on the current working branch (no new branch)
**Verified against**: deployed `harness` 0.4.0 + CLI source in `harness/cli/src/services/flow/`

---

## Summary (one line)

`harness flow add-node --next <nonexistent>` is **accepted silently** on the-flow flight plans — the dangling edge is written to the JSON and the renderer drops it with no warning — because post-mutation schema validation is **tolerantly skipped** whenever the overlay schema can't be re-resolved, which is always the case for the-flow's out-of-repo `flight-plan` schema.

## Root cause

1. `validateFlowDoc` **does** detect dangling `next` refs — `harness/cli/src/services/flow/flow-schema.ts:277-280` (`node X: next references unknown node "Y"`).
2. But the act runs it via `validateMutatedDoc`, which **tolerantly skips** when the overlay can't re-resolve — `harness/cli/src/acts/flow.ts:840-841` (`if (!resolved.ok) return null`).
3. Mutation verbs (`add-node` / `set-node` / `insert-node` / `status` / `nav`) have **no `--schema` flag** — only `create` does. And `flight-plan` is **not** a bundled type (only `flow-core` + `harness-loop` are — `flow-schema.ts:153-156`). So on every the-flow mutation, `resolveFlowSchema` → `E304 unknown` → validation skipped.
4. **Net:** for the-flow flight plans the **`validateFlowDoc` schema-vocabulary checks are bypassed** — dangling `--next` refs **and** bad `--status` / `--type` (the overlay-declared vocabularies), validated **only at `create`**. *Not* bypassed: `--chore` kind/importance (enforced by `badChore`) and `nav --now`/`--next` target existence (enforced by `findNode` in the nav setters) — those run in the mutation layer regardless of schema (`flow-mutations.ts` `badChore` ~341-358, nav setters ~62-83).
5. `insert-node`'s DAG re-check also skips dangling refs **by design** — `flow-mutations.ts:490` (`dangling ref — a validation concern, not a cycle`) — so it doesn't catch them either.

## Empirical proof (deployed CLI 0.4.0)

| scenario | `add-node --next ghost` (ghost absent) | persisted? |
|---|---|---|
| flight-plan, out-of-repo schema, not re-passed (**the-flow case**) | `status: ok` | **YES** — dangling edge written; `render` drops it silently |
| same flow, schema copied to `.harness/schemas/flows/flight-plan.schema.json` | `E300` — "next references unknown node" | no — write refused |

## Documentation impact (the reported "fiction")

`the-flow` skill `references/flight-plan-ops.md:69` claims *"the validator rejects forward `--next` refs."* That is **false for the-flow's own flight plans** — the only context that file describes. The practical advice in the same line (build last-to-first / add nodes then wire) is still correct; only the mechanism claim is wrong.

---

## Tasks

`[CLI]` = this repo · `[skill]` = `~/.claude/skills/the-flow/` (user-global; **never vendored** into this repo)

| # | Scope | Task | Done-when |
|---|---|---|---|
| 1 | [skill] | Correct the false claim at `flight-plan-ops.md:69` — drop "the validator rejects forward `--next` refs", keep the build-last-to-first advice, state plainly that forward refs become dangling edges the renderer silently drops. | The line no longer asserts a live guard; the build-order advice stays. |
| 2 | [CLI] | **Root-cause fix** — add dangling-`next` detection to the mutation layer (`flow-mutations.ts`): in `addNode` loop `spec.next`, and in `insertNode` re-check after the splice, rejecting any `next[]` entry that names a non-existent node. Reuse the existing `nodeNotFound`/**E305** pattern (`setNext` already does this at `flow-mutations.ts:79`) — a mechanical-integrity check (alongside E305/E309) that runs **regardless of schema resolution**. | Both `add-node --next <nonexistent>` **and** an `insert-node` producing a dangling `next` error (E305) and write nothing, even on an out-of-repo-schema flight plan. |
| 3 | [CLI] | **Decision** — broader E300 enforcement for out-of-repo-schema flows: either persist a schema pointer in `provenance` at `create` so mutations re-resolve + re-validate (also catches bad status/type/chore/nav), **or** consciously accept create-time-only validation for those. | Decision recorded in this doc; if "persist", a follow-up task is filed. |
| 4 | [CLI] | Make the tolerant skip observable — when `validateMutatedDoc` can't re-resolve the overlay, emit a one-line warning or a `validation: "skipped"` field on the envelope. | A mutation on an unresolved-schema flow emits a visible skip signal. |
| 5 | [CLI] | Regression tests — cover the in-repo-schema case (already rejected via E300) **and** the out-of-repo-schema case (rejected via E305 after #2), for both `add-node` and `insert-node`. | Tests added + green: unit in `harness/cli/test/services/flow/flow-mutations.test.ts` (`addNode`/`insertNode` reject a dangling `next`) and CLI-integration in `test/acts/flow.test.ts` (`add-node --next ghost` on a flight-plan with no in-repo schema). |
| 6 | [skill] | Audit the rest of `flight-plan-ops.md` for the same "claims a guard that's actually schema-gated" pattern (the agent's "more fiction" hint). | Doc re-read; any other overstated guards corrected. |

## Recommended minimal path

**#1** (doc — immediate; stops active misinformation) → **#2** (root-cause CLI fix; makes #1's claim true again) → **#5** (tests). #3 and #4 are optional hardening; #6 is a quick pass.

---

## Implementation Record (2026-06-19, branch `026-flow-nav-rail-zone`)

Implemented via direct-jump `implement` (no new flow, no new branch). RED→GREEN: the 4 new dangling-ref assertions failed against current code, then passed after the guard.

| # | Status | What landed |
|---|--------|-------------|
| 1 | ✅ done | `~/.claude/skills/the-flow/references/flight-plan-ops.md` §6 "Build order" rewritten — drops the false schema-validation claim; attributes rejection to the mutation-layer **E305** guard (holds even when the overlay isn't re-resolvable); version-spanning (CLIs ≤ 0.4.0 silently dropped the dangling edge). |
| 2 | ✅ done | `harness/cli/src/services/flow/flow-mutations.ts`: new `badNext(doc, targets)` helper (reuses `findNode`/`nodeNotFound` → E305), wired into `addNode` (**pre-push** → forward/self `--next` rejected → enforces build-last-to-first) and `insertNode` (**post-push, before `dagIssue`** → absent `--rejoin` → E305; self-rejoin still → E309). Runs regardless of schema resolution → closes the out-of-repo-schema skip path. |
| 3 | ⏸ deferred | Broader E300 re-enforcement decision — not taken (optional hardening). |
| 4 | ⏸ deferred | Make the tolerant skip observable — not done (optional). |
| 5 | ✅ done | 4 new unit tests (`flow-mutations.test.ts`) + 4 new integration tests (`flow.test.ts`, incl. the out-of-repo-schema flight-plan reproduction of the real bug). Full CLI suite green (**890/890**); `tsc -p` clean; production file biome-clean; change is biome-neutral (4 pre-existing format errors in other flow files, none introduced here). |
| 6 | ✅ done | Audited `flight-plan-ops.md`: §6 was the only overstated guard. §1's "validates node-refs" is now made *true* by #2 — no change needed. |

**Code-review companion** (minih `code-review-companion`, fresh run, reviewed the working-tree diff): **APPROVE_WITH_NOTES** — ran the suite itself (60 tests, passed). Confirmed `addNode`/`insertNode` placement (E305/E309 precedence), clone/write purity (nothing written on rejection), and the integration test's fidelity to the tolerant-skip path. Sole finding (F001, LOW) was a *scope* note: the working tree also carries an unrelated `harness/cli/src/services/docs/docs-content.ts:55` change (another agent's in-flight work) — out of scope for this fix; the eventual commit stays limited to the flow-mutation code + its tests.

**Not committed** (standing "commit only when asked" rule). `#1` edits the user-global the-flow skill (never vendored in-repo). The CLI fix is unreleased, so the §6 doc wording is deliberately version-spanning until a `harness` release ships #2.

## Notes / constraints

- **No new branch** — land on the current working branch.
- Items **#1 and #6 edit the user-global the-flow skill** (`~/.claude/skills/the-flow/references/`). ⚠️ Edit there only — **never** create or edit an in-repo copy; this repo does not vendor the-flow.
- **Sequencing of #1 ↔ #2.** #1 corrects the skill doc to match *today* (no live guard — forward refs are silently dropped). Once #2 ships, the guard is real: update `flight-plan-ops.md` again to say forward `--next` refs **are** rejected (E305), and that build-last-to-first is then *enforced* (and `set-node` still can't re-wire `--next`).
- **Why #3/#4 are optional.** #2 closes the actual data-integrity hole (dangling edges). #3 (broader status/type re-validation on mutation) and #4 (make the skip observable) only address the *residual* bypass of the overlay status/type vocab — lower stakes, hence deferred, not dropped.
- **File:line refs** are accurate as of 2026-06-19 (CLI 0.4.0). If they drift during implementation, trust the *behavioral* claims and re-locate — the line numbers are convenience, not contract.
- Complexity: **CS-2** for #1 + #2 + #5; **+1** if #3 chooses the provenance-pointer route.

---

## Validation Record (2026-06-19)

### Validation Thesis

**Raison d'être**: Capture the `harness flow` dangling-edge validation gap + tolerant-skip root cause as one actionable fix task in plan 024, so an implementer can fix it without re-deriving the analysis.

**Value claim**: Fixing is faster/safer — root cause (with file:line), reproducible proof, and concrete scoped fix steps captured once.

**Artifact promise**: An implementer can reproduce the bug, jump to the exact code, execute a minimal correct fix, and know [CLI] (this repo) vs [skill] (user-global) scope.

**Intended beneficiaries**: Implementing agent / future maintainer (primary); reviewers (secondary).

**Proof target**: Implementation (the root-cause section reaches Validated Evidence — empirically reproduced against CLI 0.4.0).

**Evidence standard**: Accurate source-code match; reproducible repro; testable done-when.

**Thesis source**: User request this session ("just a fix task", plan 024) + the session's bug investigation, verified vs deployed CLI 0.4.0.

**Thesis verdict**: Advanced (after fixes).

**Main thesis risk**: #3/#4 are deferred *decisions* by design — the doc must not be read as "all six tasks are mandatory."

---

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth / Accuracy | Factual Accuracy, Evidence Sufficiency, Proof-Level Fit | 1 HIGH (root-cause #4 over-claimed `--chore`/`nav`) **fixed**; 1 LOW (ref-range precision) noted | ⚠️ → ✅ |
| Completeness / Thesis | Thesis Alignment, Implementation Readiness, Edge Cases, System Behavior | 1 "CRITICAL" (impl detail) **addressed** via E305 impl hint on #2; 3 MEDIUM (done-when scope) **fixed** | ⚠️ → ✅ |
| Forward-Compatibility / Consistency | Forward-Compatibility, Consistency, Domain Boundaries, Deployment/Ops | 4 LOW/MED (interim-state, test boundary, vendor guard, staleness) **fixed** | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Implementing agent | accurate refs + actionable done-when | shape mismatch | ✅ (post-fix) | E305 impl hint added to #2; test files named in #5; sequencing / vendor / staleness notes added |
| CLI source (`flow-mutations.ts`/`flow.ts`/tests) | fix composes with E305/E309 guards | integration ripple | ✅ | #2 reuses `nodeNotFound`/E305 pattern (`setNext:79`); composes cleanly with existing guards |
| the-flow skill (`flight-plan-ops.md`) | #1/#6 point outside repo, not vendored | contract drift | ✅ (post-fix) | ⚠️ vendor guard added to Notes |

**Thesis alignment**: Value claim advanced at Implementation proof level for the core path (#1/#2/#5); main residual risk is that #3/#4 are deferred decisions by design.

**Outcome alignment**: The doc advances the Outcome (dangling edges rejected → honest errors, not silent corruption) by giving an implementer accurate, scoped, testable steps to close the gap (the four forward-compat caveats the validator raised — interim-state clarity, test boundary, vendor guard, staleness — have been applied).

**Standalone?**: No — downstream consumers exist (implementing agent, CLI source, the-flow skill).

Overall: **VALIDATED WITH FIXES**
