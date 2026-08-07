# Workshop: Eval Hardening — Applied Decisions (from research)

**Type**: Integration Pattern / Decision Record
**Plan**: 041-flow-conformance-eval
**Spec**: [flow-conformance-eval-plan.md](../flow-conformance-eval-plan.md) · Phase 4
**Source research**: [research/eval-methodology-perplexity-2026-07-01.md](../research/eval-methodology-perplexity-2026-07-01.md)
**Created**: 2026-07-01
**Status**: Approved

**Value Thesis**: Turn the open-ended research survey into a small set of **locked, ordered decisions** — what we adopt, in what shape, in what order — so applying the hardening is execution, not re-deliberation. Stops the research from decaying into "interesting reading we never used."
**Target Proof Level**: Preferred Direction (whole set) → **Contract Ready** for the two cheap wins (axis split + match-modes)
**Current Proof Level**: Preferred Direction

**Selected Value Axes**:
- **Strategic Value** — keeps the eval *valid* (measuring what we claim) as we scale to model-vs-model.
- **Implementation Readiness** — each decision names the concrete change + the AC/phase it lands in.
- **Learning Compounding** — locks the rationale so the next loop doesn't re-litigate "should the verdict be one number or two."
- **Cost / Attention Reduction** — the value÷effort ranking means we spend effort only where validity earns it (the user's "no yak-shave" constraint).

**Related Documents**:
- [001-scenario-and-assertion-schema.md](./001-scenario-and-assertion-schema.md) — the static assertion schema these decisions modify.
- [002-eval-system-end-to-end.md](./002-eval-system-end-to-end.md) — how the eval runs end-to-end today (the baseline being hardened).
- [004-run-storage-and-comparison.md](./004-run-storage-and-comparison.md) — the ledger that the `pass^k` / drift decisions read from.

---

## Purpose

The research surfaced eight first-principles and six candidate strengthen-actions. This workshop **decides** which we apply, in what shape, and in what order — and explicitly defers the rest with a reason, so nothing is silently dropped or silently scoped.

## Fresh Entrant Outcome

A fresh human or agent can reach **Preferred Direction** with no extra context: read the decision ledger, know exactly which changes are in-scope for Phase 4, and pick up the two Contract-Ready ones (axis split, match-modes) and build them without re-reading the research.

## Key Questions Addressed

- Is our current design sound, or do we rebuild? **(Sound — don't rebuild.)**
- Which strengthen-actions do we actually apply, and in what order?
- What concretely changes in the verdict, the lanes, and the judge?
- What do we explicitly defer, and why?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Preferred Direction (set) + Contract Ready (2 cheap wins) | Enough to start Phase 4 without re-deliberation |
| Primary Value Axis | Strategic Value (validity) | The whole point is the eval measures what we claim |
| Supporting Axes | Implementation Readiness, Cost/Attention Reduction | Each decision is buildable; effort spent only where earned |
| Downstream Loop Improved | Implementation (Phase 4) + every future model-vs-model run | Stops false verdicts and wasted re-deliberation |

## The headline decision

> **D0 — Do NOT rebuild the core.** The two-source (telemetry + filesystem, joined by `PIJ_SESSION_ID`) + three-valued (pass/fail/unknown, required-fail caps, unknown-excluded) design **IS** the tau-bench / WebArena SOTA pattern. The research validates it. Every decision below is an *additive reinforcement*, not a redesign. **Status: LOCKED.**

## Decision ledger

Effort and order carried from the research's value÷effort ranking. "When" = which Phase 4 task / future phase.

| # | Decision | Shape (what concretely changes) | Effort | Verdict | When |
|---|----------|-------------------------------|--------|---------|------|
| **D1** | **Two-axis scorecard** — split the verdict into a **process axis** (telemetry) and a **capability axis** (filesystem). The required-fail **CAP fires only from deterministic capability + safety lanes**; process + judged lanes inform their own axis and never cap. | Report emits `axis_scores: {process, capability}` + overall; cap logic restricted to capability+safety lanes. Flag `high-process / low-capability` as a **mimicry/contamination alarm**. | low | **ADOPT NOW** | Phase 4 (feeds ledger record) |
| **D2** | **Per-seam trajectory-match modes** — tag every sequence/verb assertion with a mode: **STRICT** only on real invariants (`validate→implement`, `compact→implement`); **SUPERSET** (≥ required, extras allowed) as the default for a blind no-method subject; SUBSET to flag scope-creep; UNORDERED for commutative steps. Add per-arg match overrides for volatile fields (paths, timestamps). | New `match_mode` + `arg_overrides` fields on sequence/verb assertions in the schema (001). Default SUPERSET. | low | **ADOPT NOW** | Phase 4 (schema change) |
| **D3** | **K seeded rollouts → `pass^k`** — run the subject K times, re-score every lane each run, report **`pass^k`** (all-k succeed = reliability) + mean (`pass^1`) per lane and per axis. Tier K: **5–10 dev, 20–50 for model-vs-model**. Never surface `pass@k` alone. | Orchestrator loops the run; scorer aggregates from the ledger (004). `pass^k` is computed *from* stored runs, not a new scorer mode. | medium | **ADOPT (after ledger)** | Phase 4 → reads ledger |
| **D4** | **Judge hardening** — judge model from a **different family** than the subject; strip identity hints; feed **verified artifacts, not subject prose**; decompose `judged` into named pass/fail/unknown sub-criteria with CoT-before-score + reference anchor; explicit anti-verbosity criterion; **never `required`**; temp-0; full-prompt logged; judge-model-version pinned; calibrate against a small human-gold set before trusting. | `judged` lane becomes a sub-criteria set; judge config pinned in run provenance (004). | medium | **ADOPT** | Phase 4 / 5 |
| **D5** | **Boundary-robust CIs + K-aggregate gating** — Wilson interval on every binary lane rate; gate **required** lanes on the **CI lower bound or m-of-K**, not one observation (a p≈0.7 required lane fails ~30% by luck). For model-vs-model: shared seeds + **McNemar** (binary) / **task-bootstrap** (`pass^k`). | Reporting/stats layer over the ledger; no scorer-core change. | medium | **ADOPT (with D3)** | Phase 4 → reads ledger |
| **D6** | **Outcome-anchored lanes** — rewrite the gameable occurrence lanes (`tool-used`, `skill-called`, `compaction-occurred`, `harness-verb-ran`) from "X ran" to "X ran **AND** it changed a later diff/decision". Never feed process-lane scores into any model selection/training loop. | New resolver logic correlating telemetry events → later filesystem diffs. **Real work** — needs the telemetry↔diff correlation (an open gap). | high | **DEFER → backlog** | Phase 5 |
| **D7** | **Task-family + private holdout** — parameterize md→PDF into a family the orchestrator instantiates per run; keep ≥1 unpublished holdout; vary the corpus per run; track a **public-vs-holdout score gap** as the contamination meter. | Scenario becomes a template + generator; holdout variant kept out of the repo/public docs. | medium | **DEFER → trigger** | When task/prompts/schema get published |
| **D8** | **Forbidden-state required lane** (tau-bench pattern) — add an explicit required check: subject must **NOT** edit files outside the extension, must **NOT** skip the report contract. | One new required capability-axis assertion. | low | **ADOPT NOW** | Phase 4 (schema) |

## Contract-Ready specs (the two cheap wins)

### D1 — Two-axis scorecard (lane → axis assignment)

Every assertion declares a `lane`; each lane maps to exactly one axis. The **cap** fires only from `capability` + `safety`.

| Lane | Axis | Caps verdict? |
|------|------|---------------|
| `file-created`, `file-content-matches`, `artifact-exists`, `command-succeeds` | **capability** | ✅ when `required` |
| `forbidden-state` (D8) | **safety** | ✅ always |
| `skill-called`, `skill-sequence`, `flow-seam-fired`, `harness-verb-ran`, `checks-ran`, `tool-used`, `compaction-occurred`, `retro-drained` | **process** | ❌ never |
| `judged` (D4 sub-criteria) | **process** (informational) | ❌ never |

```
verdict_overall =
  FAIL            if any (capability|safety) required lane = fail   // the cap
  else PASS/PARTIAL from axis_scores
axis_scores.capability = Σpass / Σ(pass+fail)  over capability lanes   // unknown excluded
axis_scores.process    = Σpass / Σ(pass+fail)  over process lanes
ALARM: process ≥ 0.8 AND capability ≤ 0.4  →  flag "mimicry/contamination"
```

### D2 — Trajectory-match modes for md→PDF's actual assertions

The matrix the implementer applies to `assertions.json` (A1–A11 from workshop 001). STRICT only where order is a *real invariant*.

| Assertion | Lane | Mode | Why |
|-----------|------|------|-----|
| A: validate **before** implement | skill-sequence | **STRICT** | Real invariant — order is the point |
| A: compact **before** implement | skill-sequence | **STRICT** | Real invariant (scenario choreography A5) |
| A: required skills fired (explore/plan/implement/review) | skill-sequence | **SUPERSET** | Blind subject may add steps; require ≥ these |
| A: harness seams fired (boot/backpressure/retro) | harness-verb-ran | **SUPERSET** | Presence, not exact order |
| A: no out-of-scope skills | skill-sequence | **SUBSET** | Flag scope-creep |
| A: tool-used (build/test) | tool-used | SUPERSET + `arg_overrides` | Ignore volatile paths/timestamps |

## Attention Reduction

| Future Loop | Before | After |
|-------------|--------|-------|
| Implementation | "Do we change the verdict? How?" re-argued each session | D0–D8 locked; two specs are build-ready |
| Review | Reviewer reconstructs why process didn't cap | The cap rule + lane→axis table is explicit |
| Model-vs-model run | Ad-hoc "model A looked better" | D3/D5 name the metric (`pass^k`) + test (McNemar) |

## Open Questions

### Q1: Does the orchestrator confound the measurement? **OPEN (deepest question).**
Our design *always* has the orchestrator drive the flow — so a conformance score may be measuring **orchestration**, not the subject. Research proposes randomizing "orchestrator prescribes process" vs "states task only" and scoring the delta, but doesn't say how to score it. **Must resolve before any cross-model conformance *claim*.** Not a Phase 4 blocker (Phase 4 is record-keeping), but the gating question for Phase 5+.

### Q2: What is K for *our* task? **OPEN — needs a pilot.**
Literature gives ranges (5–10 dev, 20–50 comparison) but our per-lane variance is unknown. **Run a small pilot (a few runs, read the ledger) to compute K** before committing orchestrator budget. The ledger (004) is the instrument that answers this.

### Q3: "lane N/A" vs "sensor dropped the evidence". **OPEN.**
Both map to `unknown` today, but a dropped span is a *real miss* wrongly excluded. No detector yet — interim: track **unknown-rate per lane** in the ledger as a harness-health signal.

## Validation / Acceptance

This workshop reaches Preferred Direction when:
- Every research strengthen-action has a DECISION (adopt-now / adopt / defer / trigger) with a reason — ✅ (D1–D8).
- The two low-effort wins are specified concretely enough to build — ✅ (D1 cap rule + lane table; D2 mode matrix).
- Deferred items name their trigger, so nothing is silently dropped — ✅ (D6 backlog, D7 publish-trigger).
- Open questions that gate *claims* (not Phase-4 work) are flagged — ✅ (Q1–Q3).

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Decision ledger D0–D8 | §Decision ledger | which actions, order, effort | Ready |
| Lane→axis table + cap rule | §D1 spec | the two-axis verdict | Ready (Contract) |
| md→PDF match-mode matrix | §D2 spec | applying modes to A1–A11 | Ready (Contract) |
| Orchestrator-confound question | Q1 | the gate on cross-model claims | Open (named) |
