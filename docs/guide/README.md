# The Engineering Harness — Guide

> **Start here.** A practical, read-in-order guide to adopting and operating an engineering harness in your repo — for the engineer doing it, and the agent helping. ~5 min to pick your path.

An **engineering harness** is the project-side development loop: the commands, checks, fixtures, and feedback that let a human *or* an agent boot your product, prove a change is good, and encode what they learn so the next run is easier. It is **not** the agent runtime (Copilot, Claude Code, Cursor) — it is the repo-local surface those agents drive. New to the idea? Read [What Is an Engineering Harness?](02-what-is-an-engineering-harness.md) or skim the [visual intro](../static-site/index.html).

This guide describes **shipped-today** behaviour, verified against the real CLI. It complements your existing workflow; it does not take it over.

## Need to… → go here

| You want to… | Start at | Then continue |
|---|---|---|
| **Understand what this is** and why it matters | [02 · What Is an Engineering Harness?](02-what-is-an-engineering-harness.md) | [03 · The Harness Loop](03-the-harness-loop.md) → [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md) |
| **Install it and bootstrap my repo** | [01 · Quick Start](01-quick-start.md) | [04 · Adopting the Harness](04-adopting-the-harness.md) |
| **Weave it into my workflow** (or start a fresh flow) | [08 · Fitting Your Workflow](08-fitting-your-workflow.md) | [09 · Operating the Loop](09-operating-the-loop.md) |
| **Use a harness someone already set up** | [05 · Using an Existing Harness](05-using-an-existing-harness.md) | [03 · The Harness Loop](03-the-harness-loop.md) |

> **For agents:** every page is self-contained and ends with a Prev/Next footer, so you can read this guide straight through. Dropped into a repo cold? The fastest orientation is `harness instructions`, then `harness doctor`. To learn the product itself, begin at [01 · Quick Start](01-quick-start.md).

## The full map

**Get going**
- [01 · Quick Start](01-quick-start.md) — install the CLI + skills and reach a green boot.

**Understand it**
- [02 · What Is an Engineering Harness?](02-what-is-an-engineering-harness.md) — the missing layer; engineering vs agent harness.
- [02b · Harness Engineering vs an Engineering Harness](02b-harness-engineering-vs-an-engineering-harness.md) — one overloaded word, untangled: the discipline vs the artifact, and where the popular term points.
- [03 · The Harness Loop](03-the-harness-loop.md) — Boot → Backpressure → Observe → Retro / Magic Wand → Improve.

**Adopt it**
- [04 · Adopting the Harness](04-adopting-the-harness.md) — the step-by-step onboarding walkthrough.
- [05 · Using an Existing Harness](05-using-an-existing-harness.md) — drive a harness that is already set up, no install.
- [06 · Repo Layouts](06-repo-layouts.md) — what lands in your repo, and what stays out.
- [07 · Multi-Repo Products](07-multi-repo-and-org-rollout.md) — one product across several repos: where the harness lives.

**Operate it**
- [08 · Fitting Your Workflow](08-fitting-your-workflow.md) — enhance your flow, don't replace it.
- [09 · Operating the Loop](09-operating-the-loop.md) — the rhythm of a working session.

**Grow it**
- [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md) — encode the fix, not the memory.
- [11 · Backpressure Patterns](11-backpressure-patterns.md) — the deterministic proof ladder.
- [12 · Extending the Harness](12-extending-the-harness.md) — author your own `harness` verb.

**Sustain it**
- [13 · Maintaining the Harness](13-maintaining-the-harness.md) — keep core + skills current.
- [14 · Metrics & Measures](14-metrics-and-measures.md) — what to measure, and how to gather it.
- [15 · Where to Next](15-where-to-next.md) — the reference map out.

## What this is *not*
- **Not** a CLI/command reference — run `harness docs`, or read [`harness/cli/README.md`](../../harness/cli/README.md).
- **Not** a guide to contributing to *this* repo — that is [`AGENTS.md`](../../AGENTS.md).
- **Not** marketing. No ROI or token-saving claims; just the loop and how to run it.

---

<sub>Start Here · [Next: Quick Start →](01-quick-start.md)</sub>
