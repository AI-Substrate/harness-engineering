# Eval Methodology — How the Field Evaluates Inference-Driven Orchestrator/Worker Loops

**Date**: 2026-07-01 · **Method**: Perplexity-grounded deep research (5 angles → synthesis), mapped onto our flow-conformance eval (see `workshops/002-eval-system-end-to-end.md`).
**Question**: How do practitioners evaluate a highly inference-driven orchestrator/worker loop like ours? What are the first principles, and how do we tidy up / strengthen — without yak-shaving?

---

## TL;DR

Our two-source design — **telemetry trajectory + filesystem state, joined by session id**, scored **three-valued (pass/fail/unknown)** with a **required-fail cap** and **unknown excluded** — is **validated by the literature**. It IS the tau-bench / WebArena state-of-the-art pattern. **Don't rebuild it.**

The real soundness holes are **statistical and validity-shaped**, not structural:

1. **We score a stochastic subject from ONE run.** A single run is one Bernoulli draw per lane — the highest-variance estimator that exists. → Fix: **K seeded rollouts, report `pass^k` per lane**.
2. **We conflate process-conformance with engineering-capability** in one capped verdict. → Fix: **two reported axes; cap only on deterministic capability + safety**.
3. **Our occurrence-based process lanes + same-family judge are gameable.** → Fix: **outcome-anchor the lanes; decouple + subordinate the judge**.

**Highest-leverage, lowest-effort first**: split the axes and tag trajectory-match modes per seam (both *low* effort, pure reporting/metadata) → then add repeated trials → harden the judge → and only then the heavier outcome-anchoring + task-family/holdout work.

---

## First principles (the durable truths)

1. **A single run is one Bernoulli draw per lane** — the highest-variance estimator possible. Our single-run verdict is the *start* of an eval, not the end: it cannot distinguish "follows the flow reliably" from "got lucky once."
2. **Temperature-0 does not make the subject deterministic.** FP non-associativity, dynamic batching, and MoE routing leave real run-to-run variance. A flipping lane is *expected behaviour*, not a harness bug — don't debug telemetry before ruling out ordinary inference noise.
3. **Process-conformance and engineering-capability are two different constructs.** Collapsing telemetry-process and filesystem-outcome into one capped verdict destroys validity: it punishes a valid emergent strategy (good artifact, non-prescribed path) and rewards ceremonial mimicry (right sequence, broken artifact).
4. **Determinism of the SCORER ≠ determinism of the VERDICT.** The two-source join is sound and SOTA, but the model under test is still a distribution — soundness comes from *repeated measurement*, not from a stable rubric.
5. **Any process lane asserting mere OCCURRENCE is gameable** without doing the work, and gameability grows combinatorially with the number of skills/verbs/seams instrumented. Honest signal ties each lane to a downstream *consequence*, not to the fact a tool fired.
6. **A blind subject given NO method must be graded by what minimally MUST emerge**, not by exact match to our reference path. Strict ordering is legitimate only where order encodes a real invariant (validate→implement, compact→implement); elsewhere strict match measures conformity-to-our-script — a category error.
7. **LLM-as-judge on a single absolute output is the weakest, most biased mode** (~0.5 correlation vs ~0.8 pairwise; self-preference, verbosity, sycophancy). It must stay strictly subordinate: never `required`, never able to flip a deterministic verdict, calibrated against human gold before it is trusted at all.
8. **Fixed public tasks decay into memory tests.** Once the md→PDF task + orchestrator prompts + assertion schema are published, every lane silently shifts from measuring capability to measuring recall. Contamination is structural — *measure* it (public-vs-holdout gap), don't assume it away.

---

## Strengthen / tidy-up actions — ranked by value ÷ effort

> The user's brief: *no yak-shave, no boil-ocean.* These are ordered so the cheap, high-validity wins come first; stop wherever the marginal value stops justifying the cost.

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 1 | **Split the verdict into two reported axes** (process from telemetry, capability from filesystem); restrict the **required-fail CAP to deterministic capability + safety lanes**; demote process lanes and the judged lane to informational on their own axis. | Pure reporting/wiring change, no new infra; removes the worst validity bug (two constructs → one cap). Highest value-per-effort move. | **low** |
| 2 | **Tag every skill-sequence / harness-verb assertion with a trajectory-match mode** — default **SUPERSET** for a blind subject; **STRICT** only on `validate→implement` and `compact→implement`; add per-arg match overrides for volatile fields (paths, timestamps). | Stops the eval manufacturing false required-fails against a subject deliberately given no method. Cheap metadata change to existing lanes. | **low** |
| 3 | **Run the subject K times with logged seeds; report `pass^k` + mean per lane and per axis** instead of a single green/red. Tier it: K=5–10 for harness dev, K=20–50 for any model-vs-model claim. | Closes the single biggest soundness hole (flagged by 3 of 5 angles). Mechanically simple — loop the existing run; cost is the only real expense. | **medium** |
| 4 | **Harden the judged lane**: judge model from a *different family* than the subject; strip identity hints; feed *verified artifacts*, not the subject's prose; decompose into named sub-criteria with CoT + reference anchor; keep non-required; build a small human-gold calibration set before trusting it. | Self-preference + verbosity + sycophancy are live confounds the moment the judge shares a family with the subject. Mostly prompt/config + a small gold set. | **medium** |
| 5 | **Upgrade the most-gameable process lanes from occurrence to effect** (`tool-used` AND output changed a later diff; `plan-called` AND content is task-specific; `compaction-occurred` AND context was actually large). Never feed process-lane scores into a model selection/training loop. | Directly defeats the documented ceremonial-call exploits; the durable anti-Goodhart fix. But needs real telemetry↔diff correlation work — do it *after* the cheap wins. | **high** |
| 6 | **Parameterize md→PDF into a task family with ≥1 unpublished holdout; vary the markdown corpus per run; track a public-vs-holdout score gap as the contamination meter.** | Protects long-term validity against the SWE-bench memory-test failure mode. Moderate effort, only urgent once the task/prompts/schema are published. | **medium** |

---

## Top techniques (the named tools worth adopting)

- **`pass^k` over K seeded rollouts, scored per axis.** `pass^k` (all-k succeed = reliability) not `pass@k` (any-of-k = retry-budget coverage). Our deployment is single-shot, so reliability is the right frame. tau-bench: ~50% single-trial collapses to <25% `pass^8`. A high output-`pass^1` with low process-`pass^k` is the literal signature of *conformed by luck*.
- **Two-axis scorecard** (process vs capability), not one capped verdict. Flag high-process / low-capability as a mimicry/contamination alarm.
- **Trajectory-match modes per seam** (LangChain AgentEvals vocabulary): STRICT / UNORDERED / SUBSET (precision: didn't use out-of-scope skills) / SUPERSET (recall: at least the required behaviour emerged). Plus `tool_args_match_overrides` to ignore non-deterministic args.
- **Outcome-anchored assertions** — assert *effect*, not occurrence.
- **Judge hardening** — decoupled (different family), artifact-only, decomposed into sub-criteria, CoT-before-score, reference-anchored, temp-0, full-prompt-logged, judge-model-version pinned, human-calibrated, strictly subordinate.
- **Boundary-robust CIs + K-aggregate gating** — Wilson / Clopper-Pearson intervals on every binary lane (our rates sit near 0/1 at small N, where the normal approximation fails); gate required lanes on the **CI lower bound or an m-of-K rule**, not a single observation. For model-vs-model: common random numbers (shared seeds) + **McNemar** on binary lanes / **task-bootstrap** on `pass^k`.
- **Task-family rotation + private holdout** — public-vs-holdout gap = contamination meter. A fired canary means *rotate tasks*, not "we're fine."
- **tau-bench forbidden-state checks** — add an explicit "subject must NOT edit files outside the extension / must NOT skip the report contract" required lane.
- **Arize convergence / loop-detection** — a soft, non-required path-efficiency signal (min_steps ÷ actual_steps, loop counter) to flag thrashing *without* prescribing a trajectory.

---

## Contradictions in the literature (and how we resolve them)

1. **Strictness of trajectory matching** — process-supervision work pushes step-level conformance; agentic + anti-gaming angles warn strict matching over-constrains a no-method subject. → **Resolution: per-seam modes** (STRICT only on true invariants, SUPERSET elsewhere), never one global strictness.
2. **Richness of instrumentation** — trace angle treats more lanes/seams as strictly better evidence; anti-gaming angle shows gameability grows combinatorially with instrumented surface. → **More lanes help only if each is outcome-anchored and kept off the optimization loop.**
3. **Required-fail capping** — conformance angle endorses it as textbook gating; statistics angle warns one required-fail on a p≈0.7 lane is a chance-driven binary cliff (fails ~30% of the time by luck). → **Keep the cap, but evaluate required lanes over K runs** (Wilson lower bound / m-of-K), not one draw.
4. **Judge abstention** — G-Eval-style probability-weighted "unknown" assumes logprob access; hosted Claude/agent judges at temp-0 usually don't expose token logprobs. → **Fall back to instruction-based "output unknown if unsure" + optional self-consistency**, accepting it is softer than true probability thresholds.
5. **Judge agreement numbers** — cited ~80% is *pairwise*; our judged lane is *single-output absolute* (~0.5 correlation), and our criteria (does the explanation match telemetry) are out-of-distribution for the cited NLG/chat benchmarks. → **The headline numbers don't transfer; only our own human calibration counts.**

---

## Gaps — what the research did NOT answer (needed before acting)

1. **No concrete K for OUR task.** Literature gives ranges (3–5 qualitative, 10–30 for `pass^k`, 50–100 for tight aggregate SE) but our per-lane variance is unknown — needs a **pilot** (a few runs) to compute the K that detects the effect size we care about before committing orchestrator budget.
2. **Cost/budget model absent.** Every reliability fix multiplies expensive-orchestrator + subject inference cost; none of the research prices the value/cost tradeoff for a single-task eval.
3. **How to make a process lane "effect-anchored" mechanically.** The fix ("output influenced a later diff") is described, but the actual telemetry→diff correlation logic for our span schema is unspecified.
4. **Whether the orchestrator confounds the measurement.** Our design *always* has the orchestrator drive the flow — so we may be measuring orchestration, not the subject. The construct-validity angle proposes randomizing prescribe-process vs state-task-only to isolate subject-intrinsic adherence, but doesn't say how to score the delta. **(This is the deepest open question for our design.)**
5. **No reference "good-flow" artifact exists yet.** Reference-guided judging + process-mining precision both need a canonical good run to anchor against; we'd have to author/curate one and define how loose the reference may be before it lets nonsense "conform."
6. **"Lane not applicable" vs "sensor dropped the evidence"** — both currently map to `unknown`, but a dropped span is a *real miss* being wrongly excluded. No detector for our pipeline yet. (Track unknown-rate per lane as a harness-health signal in the meantime.)
7. **Multi-task generalization.** One md→PDF task gives per-task reliability via seeds but supports **no cross-model ranking claim** — that needs a mid-difficulty-filtered task suite (out of current scope).

---

## How this maps to our current lanes

| Our lane | Verdict from research | Action |
|---|---|---|
| `file-created`, `file-content-matches`, `artifact-exists`, `command-succeeds` | **Capability axis.** This is tau-bench/WebArena state eval — the gold standard. Keep as the **only** required-fail driver (+ safety). | Model `file-content-matches` as locator+matcher (must_include vs exact_match) to survive incidental formatting. |
| `skill-called`, `skill-sequence`, `flow-seam-fired`, `harness-verb-ran` | **Process axis.** Valid but a different construct — must NOT cap the verdict. Occurrence-only = gameable. | Tag match-mode (STRICT only on real seams); later outcome-anchor. |
| `compaction-occurred`, `retro-drained`, `checks-ran`, `tool-used` | Process axis; occurrence-based → gameable. | Upgrade to effect-anchored (`compaction-occurred` AND context was large). |
| `judged` | Weakest, most biased lane. Never `required`. | Decouple judge family, decompose, calibrate, subordinate. |
| three-valued (pass/fail/unknown), unknown-excluded, required-fail cap | **Textbook-correct** — literature validates it directly. | Keep — but read required-fail over K runs, and watch systematic `unknown` (dropped-sensor) hollowing a lane. |

---

## Sources (representative; full set in the run output)

- **tau-bench** (Sierra) — arxiv.org/abs/2406.12045 — stateful goal-state diff, policy-as-artifact, `pass^k`.
- **WebArena** — arxiv.org/html/2307.13854v4 — functional correctness, locators, `r_prog`, exact_match/must_include.
- **LangChain AgentEvals** — docs.langchain.com/langsmith/trajectory-evals — strict/unordered/subset/superset + arg-match.
- **Agent-eval survey** — arxiv.org/html/2507.21504v1 — agent behavior vs capabilities; code-based vs LLM-judge; `pass@k` vs `pass^k`.
- **Behavioral-variance on SWE-bench** — arxiv.org/html/2603.25764v2 — CV 15%→47% across models.
- **Defeating nondeterminism in LLM inference** — thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/ — batch-invariance; temp-0 ≠ deterministic.
- **`pass@k` vs `pass^k`** — hippocampus-garden.com/pass_k/ ; Codex unbiased estimator — arxiv.org/pdf/2107.03374.pdf.
- **Efficient benchmarking / error bars** — arxiv.org/abs/2411.00640 (Miller, clustered SE, McNemar) ; arxiv.org/html/2603.23749v1 (seed counts, IRT mid-difficulty filter).
- **MT-Bench** — arxiv.org/abs/2306.05685 ; **G-Eval** — aclanthology.org/2023.emnlp-main.153 ; **Prometheus 2** — aclanthology.org/2024.emnlp-main.248 ; **Self-Preference Bias** — arxiv.org/abs/2410.21819.
- **METR reward hacking** — metr.org/blog/2025-06-05-recent-reward-hacking/.
- **Anthropic evals guidance** — anthropic.com/engineering/demystifying-evals-for-ai-agents ; **OpenAI eval best-practices** — developers.openai.com/api/docs/guides/evaluation-best-practices.
