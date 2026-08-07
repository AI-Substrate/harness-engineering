# Workshop: Telling the Story — the `docs/how` for the eval methodology

**Type**: Documentation / Storytelling design
**Plan**: 041-flow-conformance-eval
**Spec**: [flow-conformance-eval-plan.md](../flow-conformance-eval-plan.md)
**Grounds in**: [`harness-foundations/first-principles.md`](../../../../harness-foundations/first-principles.md) (FP#24 agent-readable guidance · FP#38 repo is system of record · FP#39 give a map not a manual)
**Created**: 2026-07-01
**Status**: Approved

**Value Thesis**: Design — before writing — the **one narrative doc** that explains how this whole approach works to a fresh reader: how we run peers, **watch them two ways (an LLM watching + the data watching)**, evaluate, and feed it all back into engineering-harness-loop engineering. Designing the story first means the `docs/how` page lands as a *simple, coherent explainer* instead of a pile of facts — and stays a **map, not a manual** (FP#39).
**Target Proof Level**: Contract Ready (a section-by-section doc outline + narrative arc + voice rules, ready to write the page from)
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Onboarding / Accessibility** — a newcomer (human or agent) understands the methodology in one read.
- **Strategic Value** — tells the story of *why* this is harness engineering, not just *what* it does.
- **Knowability** (FP#38) — the methodology becomes repo-resident, not tribal.
- **Review Compression** — reviewers/stakeholders share one mental model from one page.

**Related Documents**:
- [002-eval-system-end-to-end.md](./002-eval-system-end-to-end.md) — the mechanics the story narrates (the source of truth the `docs/how` *links to*, never duplicates).
- [005-the-eval-improve-loop.md](./005-the-eval-improve-loop.md) — the feedback loop = the doc's fourth beat.
- [004-run-storage-and-comparison.md](./004-run-storage-and-comparison.md) — "the data watching" = telemetry + ledger.
- Phase 3 / AC-10 `docs/how/flow-conformance-eval.md` — the **reference** (how to author a scenario). **This workshop designs a different, complementary page**: the **methodology story** (how the approach works + why), not the authoring reference. The story page links *to* the reference.

---

## Purpose

Decide the **shape and arc** of the narrative `docs/how` page so it can be written simply and well — what story it tells, to whom, in what order, in what voice — anchored on the throughline: **run peers → watch two ways → evaluate → feed back**.

## Fresh Entrant Outcome

A fresh human or agent reaches **Contract Ready**: they can write the `docs/how` page directly from the outline below, hitting the four beats in order, in the right voice, linking to (not duplicating) the design workshops.

## Key Questions Addressed

- What is the **single throughline** of the doc?
- Who is it for, and what do they need from it?
- What are the **two ways we watch** a run, and how do we explain them simply?
- How is the story structured section-by-section, and where does it link out vs. tell?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | The page can be written straight from this |
| Primary Value Axis | Onboarding / Accessibility | One read → one mental model |
| Supporting Axes | Strategic Value, Knowability, Review Compression | Why-not-just-what; repo-resident; shared model |
| Downstream Loop Improved | Onboarding + every stakeholder conversation | Stop re-explaining the methodology from chat |

## The throughline (the spine of the whole doc)

> **We run a peer agent through real work, watch it two ways at once — an LLM watching *and* the data watching — turn that into a verdict, and feed everything back into making the harness (and the way we evaluate it) better. Then we do it again.**

Everything in the page serves that one sentence. If a paragraph doesn't advance run → watch → evaluate → feed-back, it's cut or linked out.

## Audience & what each needs

| Reader | Comes to the page wanting | The page gives them |
|--------|---------------------------|---------------------|
| A new engineer on the harness | "What is this eval thing and why?" | The four beats + the why (it's harness engineering, FP#58) |
| An agent (the next orchestrator) | "How do I reason about a run?" | The mental model + links to the runbook/playbook |
| A stakeholder | "Does this actually tell us something?" | The two-ways-of-watching + the regression/compare payoff |

Write for the **first two** primarily; the stakeholder is served by a strong opening + the payoff section.

## The "two ways we watch" — the doc's signature idea

The page's most important explanatory move. Keep it concrete and visual:

```
                     ┌─────────────────────────────────┐
   a peer agent ───► │  doing real work (the-flow on a │
   (the subject)     │  fixed markdown→PDF task)        │
                     └───────────────┬─────────────────┘
                                     │  watched two ways, at once
                 ┌───────────────────┴────────────────────┐
                 ▼                                         ▼
      ┌──────────────────────┐                ┌──────────────────────────┐
      │  THE LLM WATCHING     │               │   THE DATA WATCHING       │
      │  (judgement)          │               │   (deterministic)         │
      │  • is the plan sound? │               │  • harness records / retro │
      │  • does the explanation│              │  • telemetry (skills,      │
      │    match what happened?│              │    verbs, seams, tokens)   │
      │  • subjective quality  │              │  • the filesystem (files,  │
      │  subordinate, never the│              │    content, commands)      │
      │  final word            │              │  the verdict's backbone    │
      └──────────┬────────────┘               └────────────┬─────────────┘
                 └───────────────┬────────────────────────┘
                                 ▼
                        a verdict (pass / fail / unknown)
                        + observations from BOTH actors
```

**Why two ways**: the data proves *what happened* (FP#28 — close the gap between agent confidence and real behaviour); the LLM judges *whether the trail was sound* (Pattern 8 — observe the process, not only the product). Neither alone is enough; the data is the backbone, the LLM is subordinate (003 D1/D4).

## Doc outline — section by section (write from this)

Keep it **simple** (the user's word). Six short sections, each a beat or a bridge. Each section says "tell this" + "link out to this" (FP#39 — don't inline what a workshop already owns).

| § | Title | Tell (in the page) | Link out to |
|---|-------|--------------------|-------------|
| 1 | **Why** | One paragraph: the harness can only be trusted if we prove its real behaviour; the eval is the harness's own proof loop (FP#3, #58). | `harness-foundations/first-principles.md` |
| 2 | **Run a peer** | Beat 1. We spawn a blind peer agent and drive it through real work on a fixed task; it doesn't know it's being tested. The three actors in one line each. | `002` (end-to-end), the runbook |
| 3 | **Watch it two ways** | Beat 2 — the signature section. The diagram above + two short paragraphs: the data watching (telemetry + harness records + filesystem) and the LLM watching (judged, subordinate). | `004` (telemetry/ledger), `002` (lanes) |
| 4 | **Evaluate** | Beat 3. The two streams join into a verdict: deterministic capability caps it, process + judgement inform it; pass/fail/unknown; reliability over one run is `pass^k`. Keep it 1-screen. | `003` (decisions), `004` (`pass^k`/ledger) |
| 5 | **Feed it back** | Beat 4 — the payoff. Both actors' observations → harvest → encode → the harness *and* the eval process get better; spot regressions, compare models. This is the loop. | `005` (the loop) |
| 6 | **See it run** | One concrete walkthrough (run 003: Sonnet 5 @ xhigh) so the abstract becomes real — fire → drive → both observe → score → a finding encoded (F18). | `experience-logs/003` |

## Voice & devices

- **Map, not manual (FP#39)**: the page orients and links; the workshops/runbook hold the detail. If you're tempted to paste a schema, link instead.
- **Show one real run**, don't only describe (Pattern: show-don't-tell). Run 003 is the worked example — it even produced a finding (F18) live, which *is* the loop.
- **Plain language**: "the data watching" / "the LLM watching" beats "deterministic lanes" / "model-graded assertions" in the opening; introduce the precise terms once, then link.
- **Honest about limits**: name the open question (are we measuring the subject or the orchestration? 003 Q1) — credibility comes from naming it, not hiding it.
- **Lead with the throughline sentence**, close with the loop — the reader should leave with "run → watch → evaluate → feed back, then again."

## Decision Space (resolved)

| Option | Decision |
|--------|----------|
| One page vs. split methodology/reference | **Two pages — SELECTED.** This story page (methodology) + the AC-10 authoring reference. They link; neither duplicates. |
| Tell everything vs. link out | **Link out — SELECTED (FP#39).** The page is a map; workshops are the territory. |
| Where it lives | `docs/how/` (sibling to the AC-10 reference) — repo system of record (FP#38). Exact filename at write time (e.g. `docs/how/evaluating-the-harness.md`). |
| Tone | **Simple narrative** (the user's ask) — four beats, one worked run, minimal jargon. |

## Attention Reduction

| Future Loop | Before | After |
|-------------|--------|-------|
| Onboarding | "Let me explain the eval…" from chat each time | one page, four beats |
| Stakeholder buy-in | ad-hoc deck/verbal | the two-ways diagram + payoff section |
| Writing the page | blank-page + scope creep | this outline; write the six sections, link out |

## Open Questions

### Q1: Filename / placement. **OPEN (trivial).** `docs/how/evaluating-the-harness.md` vs `.../harness-eval-methodology.md` — decide at write time; must not collide with the AC-10 `flow-conformance-eval.md` reference.

### Q2: How much of run 003 to show. **Leaning: one tight walkthrough**, not the full log — the experience log holds the detail; §6 shows just enough to make it real.

## Validation / Acceptance

Contract Ready when:
- The throughline sentence is stated and every section maps to a beat or bridge — ✅.
- The "two ways we watch" has a concrete, simple visual + the why — ✅.
- The outline is section-by-section with tell-vs-link-out for each — ✅ (§Doc outline).
- Voice rules keep it a *simple map* (FP#39), not a duplicate of the workshops — ✅.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Throughline sentence | §The throughline | the doc's spine | Ready |
| Two-ways-of-watching diagram | §signature idea | the doc's key explanatory move | Ready |
| Section-by-section outline (tell/link) | §Doc outline | writing the page | Ready (Contract) |
| Voice & devices | §Voice & devices | keeping it simple + map-not-manual | Ready |
