# Research Dossier: a plan-readiness gate

**Generated**: 2026-08-05T08:05:00Z
**Query**: "one command that says whether a plan is ready to start work — ACs claimed by tasks, backpressure done or explicitly declined, and refuses to answer when there is nothing to check"
**Effort**: Standard
**Tools**: Standard
**Evidence**: 8 current sources · 1 material historical decision

## The Ask

An agent finishing a plan has no single way to ask *"is this actually ready to start building?"*. Two things go wrong quietly: acceptance criteria that no task ever accounts for, and a backpressure survey that was never done — neither of which stops anyone from starting work. The ask is for one command an agent is drilled to run at plan setup and again at gates, whose answer is the thing that makes a plan "done planning".

The critical design constraint, discovered here rather than assumed: **the check must refuse to answer for an empty plan.** A scaffold with no acceptance criteria currently scores perfectly on every existing check, so a naive readiness command would call the emptiest possible plan the readiest.

## Answer

1. Half the ask already exists and works. `plan validate --complete` reports `orphan-claim` — *"has no incoming satisfies — no task accounts for it"* — which is exactly "you have ACs but they are not linked to tasks" (F-01, F-02).
2. The other half does not, and its absence is **deliberate**. `pressure` is explicitly excluded from the relations that carry a claim, with a written rationale (F-03). A readiness command must honour that decision or overturn it in the open — not reverse it by accident.
3. Backpressure linkage *is* already mandatory one layer down: every `done_when` assertion must name an instrument or say `not-applicable` on purpose, and **silence fails** (F-04). The gap is at plan level, not assertion level.
4. The plan document *can* link a backpressure survey (`meta.backpressure`) but is not required to (F-05).
5. **The vacuity failure is real and proven, not theoretical** (F-06). An empty scaffold returns `orphans: 0`, `error: 0`, one incidental warning. Nothing anywhere notices there is nothing to check.
6. Whether the survey was *declined* rather than *skipped* is knowable, but only from the flight plan, not the document — chore status plus its receipt comment (F-07).
7. Nothing named `ready` exists today (F-08).

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | Three semantic finding classes: `contradiction` (always), `open-completable` and `orphan-claim` (under `--complete` only) | `harness/cli/src/services/dd/plan/semantics.ts:111-177` | The gate composes existing checks; it does not need a new analyzer | High |
| F-02 | `orphan-claim` = a claim row with no incoming `satisfies` | `semantics.ts:157-177` | This IS the "ACs not linked to tasks" check, already shipped | High |
| F-03 | `pressure` is **deliberately** absent from `CLAIMING_RELS`: a backpressure row "has no state to contradict, it gates nothing", and treating it as one would "re-invent the coverage predicate the design explicitly threw away" | `semantics.ts:11-21` | A prior decision the new command must not silently reverse — see R-01 | High |
| F-04 | `pressure` is MANDATORY on every `done_when` assertion — a link, or the literal `not-applicable`; **silence still fails** | `.dd/schemas/builder/plan/schema.json:3`; `core/validate.ts:142-145,304-305` | Backpressure enforcement already exists at assertion level; the gap is plan level | High |
| F-05 | `meta.backpressure` is an optional `pressure` link to `builder/backpressure/section/rows`; `meta.required` is only `title` + `status` | `schema.json` § `sections.meta` | A plan can be schema-valid with no survey linked at all | High |
| F-06 | **An empty scaffold reads clean.** `plan new` emits `acceptance_criteria: []`, `tasks: []`, `done_when: {}`, no `backpressure`. `plan validate --complete` on it → `error: 0`, `orphans: 0`, one incidental `open-completable` | probe run 2026-08-05; `plan new` output + `validate --complete` envelope | **The headline risk.** Any gate keying on "0 orphans + 0 errors" declares the emptiest plan readiest | High |
| F-07 | The flight plan carries `backpressure` as a chore (`status`, `kind`, `anchor: plan`) readable via `harness flow chores --json`; terminal chores carry an append-only receipt comment with `basis_sha256` of the surveyed plan | `harness flow chores` output; doctrine block in `eng-harness-flow/SKILL.md` | Declined-vs-never-run is answerable — but only from the flight plan | High |
| F-08 | No `ready` verb exists on the `harness` or `harness plan` surface | `harness plan --help`; `harness --help` | Greenfield verb, no migration | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Ruling **ac-7007**: per-row open warnings are suppressed by default because "a mid-flight plan is SUPPOSED to have open rows, so warning about each of them teaches a reader to ignore warnings" | `semantics.ts:141-143` | **Direct** | The gate must answer a question, not emit a wall. Noise is a known, already-ruled-on failure mode here |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| **R-01 · Reversing a deliberate decision** | F-03 | Requiring every AC to carry a `pressure` link would re-introduce exactly the coverage predicate that was thrown away on purpose | Gate on *survey done or declined*, never on per-AC pressure coverage — or overturn F-03 explicitly, in writing |
| **R-02 · Vacuity** | F-06 | An empty plan is the current best scorer. A gate that inherits this is worse than no gate: it manufactures false confidence | "Nothing to check" must be a distinct verdict, not a pass. Prove it with a fixture that is empty and must NOT read ready |
| **R-03 · Two substrates** | F-05, F-07 | The document knows about links; only the flight plan knows whether a human declined the survey. A plan authored without the-flow has no chore to read | Three-valued answer — ready / not-ready / **can't-tell** — never a two-valued guess |
| **R-04 · A decline must read green** | F-07, invariant #4 | Declining backpressure is the human's right. If a decline reads as not-ready, the gate becomes a compliance floor, which the flow forbids | A `skipped` chore **with** its decision receipt is a legitimate ready; `skipped` with no receipt is not |

## Planning Handoff

- **Preserve**: `CLAIMING_RELS` as-is (F-03); the `--complete` per-row semantics (F-01); the `not-applicable` escape and its silence-fails rule (F-04); the human's right to decline (R-04).
- **Change carefully**: anything touching `semantics.ts` — the gate should *compose* `readPlanSemantics`, not extend it. Adding a class there changes every existing caller.
- **Likely files/symbols**: `harness/cli/src/services/dd/plan/semantics.ts` (read-only consumer), `harness/cli/src/services/dd/plan/check.ts`, the `harness plan` command registration, `harness flow chores` as the receipt source.
- **Decisions still required**:
  1. Where the verb lives — `harness plan ready <plan>` vs a flag on `validate`.
  2. What makes a plan non-vacuous enough to judge (≥1 AC? ≥1 task? a locked phase roster?).
  3. Whether a missing flight plan is `can't-tell` or degrades to a document-only ready.
  4. Whether `ready` ever exits non-zero, or always exits 0 and reports (the flow forbids gating the human; CI may want the opposite).
