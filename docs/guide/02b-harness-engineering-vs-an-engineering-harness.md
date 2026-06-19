# Harness Engineering vs an Engineering Harness

> **One overloaded word, untangled.** For anyone who has read the wider "harness" discourse and wants to know exactly where this repo sits. ~7 min.

The word *harness* is having a moment, and it is being used for at least four different things. If you have read the popular 2025–26 writing on "harness engineering" and then landed here, the terms will not line up cleanly — on purpose. This page makes the distinction explicit so the rest of the guide reads without friction.

[02 · What Is an Engineering Harness?](02-what-is-an-engineering-harness.md) already separates the **agent harness** (around the model) from the **engineering harness** (around the product). This page adds the other axis people trip on: the **discipline** versus the **artifact**, and where the industry term actually points.

## Four things people call a "harness"

| Term | What it usually means | This repo's stance |
|---|---|---|
| **Harness engineering** (the discipline) | The emerging *practice* of designing and continuously improving the whole control environment around coding agents — constraints, tools, CI, tests, telemetry, guides and sensors, learning stores. Often framed as "the third phase after prompt and context engineering." | We practise a **product-anchored slice** of it: building and improving the project-side loop. |
| **The harness / agent harness** | "Everything in the agent except the model" — the runtime *around the model*: tool dispatch, permissions, context, orchestration, session state. | This is the **agent harness** (Copilot, Claude Code, Cursor…). Explicitly **not** our subject. |
| **An engineering harness** (the artifact) | A concrete harness for one repo: its boot path, tests, fixtures, checks, repo-specific rules. | **Our core term** — the project-side loop that proves the *product*. The thing you build in *your* repo. |
| **A test harness** (classic) | Decades-old scaffolding and fixtures that exercise code (xUnit, CI, smoke suites). Predates LLMs entirely. | The lineage we build on — see ["it is not new"](#it-is-not-new) below. |

The first two are about the **agent**. The second two are about the **product**. This guide lives firmly in the product column.

## Where the popular term actually points

Here is the honest part. The mainstream "harness engineering" conversation is mostly about the **agent side**, not the product side.

Birgitta Böckeler's widely-shared framing is *"everything in an AI agent except the model itself — Agent = Model + Harness"* ([martinfowler.com](https://martinfowler.com/articles/harness-engineering.html)). Most of the follow-on writing keeps that centre of gravity: the harness is the tools, permissions, context, orchestration, and telemetry wrapped around the model so it behaves reliably. By that definition, "the harness" is close to what this guide calls the **agent harness**.

So when someone says "harness engineering," they usually mean *engineering the environment around the model*. We mean something narrower and product-shaped: **engineering the loop around your codebase that proves the software actually works.** We did not coin "harness" and we are not trying to redefine the field — we are planting a flag on the slice that proves *product* behaviour, because that is the slice an agent cannot fake and a model runtime cannot supply.

> Rule of thumb: if the subject is *the model and how it is driven*, that is the agent harness / the popular "harness." If the subject is *your product and how its behaviour is proved*, that is the **engineering harness** — this guide.

## What we mean by *an engineering harness*

An engineering harness is the project-side development loop: the repo-local commands, fixtures, docs, checks, state, and proof paths that let a human *or* an agent boot the product, prove a change is good, and encode what they learned. It makes the **product** operable; the agent harness makes the **model** operable. ([first-principles.md §1–4](../../harness-foundations/first-principles.md) sets out the boundary in full.)

You build *an* engineering harness in *your* repo. Practising **harness engineering** — in our product-anchored sense — is the ongoing work of building and improving that surface so the supported path is obvious and the proof is cheap.

## It is not new

The mechanics of an engineering harness are decades old. Test harnesses, build systems, smoke suites, CI gates, seed data, fixtures, health checks — none of this was invented for AI. It is classical software engineering and operations practice.

What changed is the **load** on that surface. A boot script or smoke suite that a human ran occasionally is now driven *every session, by every agent*. When the supported path lives in scattered scripts and tribal memory, a human absorbs that cost now and then; an agent pays it **constantly**, in tokens and in wrong guesses. Agents did not invent the engineering harness. They made an under-invested one expensive, and a well-made one compounding.

## What *is* new: the self-improving loop

The genuinely new move — and the one this repo productises — is closing the loop on the harness *itself*. Not just running checks, but turning each run's friction into a permanent improvement to the harness, so the next run is faster, clearer, or better-proven.

This idea is converging across the field under different names: the **ratchet pattern** ("every failure becomes a new rule"), **feedback-loop engineering** ("today's distilled lesson becomes tomorrow's guide"), and "running improvement loops" that analyse failures and then *fix the harness so they do not repeat*. The same instinct shows up in research on agents proposing updates to their own harness from past trajectories.

This guide's version of that idea is the loop in [03 · The Harness Loop](03-the-harness-loop.md) and the principle in [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md): **encode the fix, not the memory.** The difference in emphasis is the column again — the broader discourse encodes lessons to make *the agent* more reliable; we encode them to make *the product's development loop* more reliable. Both matter. This repo owns the second.

## So which do I need?

You already have *an* engineering harness — every repo does, even if it is implicit: a way to build, a way to test, a way to run. The question is whether it is a **first-class, provable, improving surface** or a pile of tribal steps an agent has to re-infer every session. This repo is about making it the former, and closing the loop so it gets better with use.

- New here? Start at [01 · Quick Start](01-quick-start.md).
- Want the loop itself → [03 · The Harness Loop](03-the-harness-loop.md).
- Want the encoding principle → [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md).

## Keep reading
- The thesis, in depth: [`harness-foundations/first-principles.md`](../../harness-foundations/first-principles.md) and the [simple version](../../harness-foundations/simple-mode.md).
- The wider field (agent-side framing): Birgitta Böckeler, [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html); Moss Banay, [Don't waste your backpressure](https://banay.me/dont-waste-your-backpressure/); and the curated [awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering) list.

---

<sub>[← Prev: What Is an Engineering Harness?](02-what-is-an-engineering-harness.md) · [↑ Start Here](README.md) · [Next: The Harness Loop →](03-the-harness-loop.md)</sub>
