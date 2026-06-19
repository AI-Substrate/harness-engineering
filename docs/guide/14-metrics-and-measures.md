# Metrics & Measures

> **Is the harness delivering value — not just speed?** For engineering leaders and managers — and the repo owner who runs the loop — who want a tangible way to start measuring what actually matters.

## Speed is the easy thing to measure. It is rarely the thing that matters.

Pick a quarter where pull requests per developer jumped 20% and the share price rose 15%. By every activity dashboard, things looked excellent — and in that same quarter 78% of developers reported burning out.[^engthrive] Three signals, one quarter, pointing in opposite directions. Any one alone tells a confident, wrong story.

It gets sharper. Only about **15% of a developer's day is spent writing new code** — nearer 25–30% once you count testing and debugging.[^engthrive] So a tool that makes *coding* faster is optimising a thin slice of the day, while most of the cost — and most of the leverage — sits everywhere else: understanding the problem, getting unstuck, proving the change is safe.

Here's where the harness fits — and where it doesn't. That whole landscape (planning, design, delivery, operations, the customer) is far bigger than any one tool, and most of it lives outside the harness entirely. The harness instruments just one slice: the inner loop where a change gets built, proven, and improved. But that slice is usually *dark* — and the harness already leaves a trail there: where the supported path got abandoned, where friction got fixed for good, how long each stage took. Most teams throw that trail away.

This is the trap the harness is built to help you escape. Not *"how fast did we type?"* but **what does value actually mean here, and can we begin to measure it?**

## Measure first, decide second

A useful distinction: a **measure** is a fact the system emits — an observation about the world. A **metric** is a measure you have *chosen*, given context, and attached a target to.[^engthrive] Promoting a measure to a metric is a statement of values, so do it deliberately. The harness's job is to **emit honest measures**; yours is to decide which few become the metrics you steer by — and to **keep the fact separate from the interpretation** while you do.

The reframe, in one line: prefer **idea-to-customer over lines of code**, **outcomes over activity**, **value over motion**. Lines of code penalise elegance; velocity without quality is just churn.[^engthrive] None of these are new — DORA gave teams delivery performance, SPACE insisted productivity is multi-dimensional, and EngThrive[^engthrive] organises it as **Speed, Ease, and Quality, with Thriving as a guardrail** so gains in one don't quietly cost you another. The harness doesn't replace any of them. It **feeds** them: it leaves a trail of honest signals you can pull into whichever model your org already runs.

## Where the harness gives you a place to start

You don't need a telemetry platform to begin. The harness's own record system is built to emit two measures most teams have never had:

- **Harness bypass** — every time the supported path was *avoided*, captured with *why*. Trending down means the paved path is winning. (Low capture is itself a signal: plans closing with no retro or flow trail mean the seam isn't being used — not that nobody bypassed.)
- **Encoded-mitigation (harness change)** — every time recurring friction became a permanent, runnable fix. This is your **compounding** signal: proof the loop is getting better, not just busier.

Both are *leading measures* — diagnostic evidence about the development loop — and both are extensible: the record system is yours to grow, so your flows can capture more over time. For the mechanics (record shapes, how a scanner joins them across repos), see the deeper notes linked below; this page is the *why*, not the schema.

A third worth collecting if you're smart about it: **time to a new developer's first meaningful contribution.** EngThrive found an AI onboarding tool cut time-to-first-PR by 65% — not by making the PR easier, but by automating environment setup and codebase orientation.[^engthrive] That is the same kind of work a clean-start harness does — so onboarding time is a fair *test* of whether the investment is paying off.

## Where does your time actually go?

Because the flow records each stage as it runs, you can see **how long planning took versus coding versus review** — and the gaps between them. Read this as *insight, not a stopwatch*: the point isn't to drive any stage's duration down (that just invites gaming), it's to see the **shape** of your loop and ask better questions of it.

The most interesting ones are cross-dimensional: *what happens to the other measures when we spend more time planning?* Fewer bypasses? Less rework? Fewer bugs reaching the backlog? A measure earns its keep when it lets you test a hypothesis like that — not when it becomes a target of its own.

## A short starter set

Resist the urge to track everything; more than a handful of metrics dilutes focus.[^engthrive] Start small, even with imperfect data — a couple of signals per dimension, balancing one telemetry measure against one survey question, and **choose measures where gaming them would mean genuinely doing the right thing**.[^engthrive] A workable starting kit:

- **Value / Speed** — idea-to-customer time *(outcome)*; flow-stage shape *(diagnostic, not a target)*.
- **Ease** — harness bypass rate *(outcome)*; onboarding time-to-first-contribution *(outcome)*.
- **Quality** — change-failure rate or bugs-reaching-backlog *(outcome, feeds DORA)*; encoded-mitigation rate *(compounding)*.
- **Thriving** — a "bad developer day" pulse: build failures, lost focus, toil.[^engthrive] *(guardrail — if this slips, something is wrong even if the rest improves.)*

Activity counts like tokens-per-run or skills usage are fine as **diagnostics** — they help explain *why* — but they are never what you steer by.

The optimistic claim — *"when the harness is used, fewer bugs reach the backlog"* — is a **hypothesis, not a promise**. The measures above are exactly what let a team check it on their own data: as bypass falls and encoded-mitigation rises, you'd *expect* change-failure and backlog defects to improve in a later window. Line the series up and find out. That is what evidence looks like instead of a promise.

## What this is not

- **Not individual measurement.** These are team- and repo-level signals only — never a per-person scoreboard, ranking, or productivity league table. Trust is what keeps the data honest, and surveillance destroys it.
- **Not a replacement** for DORA, SPACE, or EngThrive — it feeds them.
- **Not a dashboard or scanner spec.** The harness emits durable signals into the repo; external metric-gathering tools read them. That separation is deliberate.
- **Not the record schema.** Mechanics live in the deeper notes, not here.

## Keep reading
- The two first-class measures in detail — bypass rate, change rate, the PR denominator, DORA correlation, and the anti-gaming guardrails: [`docs/how/harness-value-measures.md`](../how/harness-value-measures.md).
- How friction becomes an encoded fix in the first place: [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md).

[^engthrive]: Houck, B., Bozarth, T., Liu, D., Carignan, D. — *EngThrive: Make It Fast and Easy to Do Great Work*, Microsoft Research, 2026. arXiv:2605.04259 · <https://www.microsoft.com/en-us/research/publication/engthrive-make-it-fast-and-easy-to-do-great-work/>. Source of the burnout/PR paradox, the ~15%-of-day-coding finding, the bad-developer-days concept, the measures-vs-metrics and activity-vs-outcomes distinctions, the Speed/Ease/Quality + Thriving model, the onboarding result, and the design-for-gaming principle.

---

<sub>[← Prev: Maintaining the Harness](13-maintaining-the-harness.md) · [↑ Start Here](README.md) · [Next: Where to Next →](15-where-to-next.md)</sub>
